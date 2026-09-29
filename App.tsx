import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, BackHandler, Linking, Platform, SafeAreaView, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import * as Location from 'expo-location'
import { WebView } from 'react-native-webview'
import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import { supabase } from './src/lib/supabase'
import { biometricAvailable, unlockWithBiometrics } from './src/lib/biometric'
import { detourScoreKm } from './src/lib/geo'

type Mode =
  | 'home' | 'search' | 'offer' | 'matches' | 'map' | 'setPassword'
  | 'myRides' | 'activeRides' | 'rideOffers' | 'chat' | 'settings'

type Point = { lat:number; lng:number; name:string }
type MapTarget = 'from' | 'to'
type CountryCode = 'NO' | 'SE' | 'DK'
type LanguageCode = 'pl' | 'no' | 'sv' | 'da' | 'en'

type Match = {
  id:string; passengerId:string; from:string; to:string; seats:number;
  departure:string; detourKm:number
}

type MyRideItem = {
  id:string; kind:'driver'|'passenger'; from:string; to:string; departure:string;
  status:string; seats:number
}

type OfferItem = {
  id:string; requestId:string; routeId:string; driverId:string; passengerId:string;
  status:string; seats:number; message?:string|null; conversationId?:string|null;
  from:string; to:string; departure:string; driverName:string; passengerName:string
}

type ActiveRideItem = {
  requestId:string; role:'driver'|'passenger'; routeId:string; conversationId?:string|null;
  driverId:string; passengerId:string; from:string; to:string; departure:string;
  seats:number; driverName:string; passengerName:string
}

type ChatMessage = {
  id:string; sender_id:string; recipient_id?:string|null; body?:string|null;
  content?:string|null; created_at:string
}

const APP_VERSION = '1.1.0'
const APP_BUILD = '110'
const ANDROID_APK_URL = 'https://github.com/mlodyk85/samvei/releases/latest/download/Samvei-Scandinavia.apk'

const COPY = {
  pl:{home:'Samvei',hero:'Podróżujesz po Skandynawii?',sub:'Znajdź przejazd albo zabierz pasażera po swojej trasie.',search:'Szukam przejazdu',offer:'Mam wolne miejsca',active:'Aktualne przejazdy',mine:'Moje trasy i zgłoszenia',offers:'Oferty i wiadomości',settings:'Ustawienia',country:'Kraj',language:'Język'},
  no:{home:'Samvei',hero:'Reiser du i Skandinavia?',sub:'Finn skyss eller ta med en passasjer på veien.',search:'Jeg søker skyss',offer:'Jeg har ledige seter',active:'Aktive turer',mine:'Mine ruter og forespørsler',offers:'Tilbud og meldinger',settings:'Innstillinger',country:'Land',language:'Språk'},
  sv:{home:'Samvei',hero:'Reser du i Skandinavien?',sub:'Hitta skjuts eller ta med en passagerare längs vägen.',search:'Jag söker skjuts',offer:'Jag har lediga platser',active:'Aktiva resor',mine:'Mina rutter och förfrågningar',offers:'Erbjudanden och meddelanden',settings:'Inställningar',country:'Land',language:'Språk'},
  da:{home:'Samvei',hero:'Rejser du i Skandinavien?',sub:'Find et lift eller tag en passager med på vejen.',search:'Jeg søger et lift',offer:'Jeg har ledige pladser',active:'Aktive ture',mine:'Mine ruter og forespørgsler',offers:'Tilbud og beskeder',settings:'Indstillinger',country:'Land',language:'Sprog'},
  en:{home:'Samvei',hero:'Travelling around Scandinavia?',sub:'Find a ride or pick up a passenger along your route.',search:'I need a ride',offer:'I have free seats',active:'Active rides',mine:'My routes and requests',offers:'Offers and messages',settings:'Settings',country:'Country',language:'Language'},
} as const

export default function App() {
  const [mode,setMode]=useState<Mode>('home')
  const previousMode=useRef<Mode>('home')
  const [authenticated,setAuthenticated]=useState(false)
  const [authLoading,setAuthLoading]=useState(true)
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [newPassword,setNewPassword]=useState('')
  const [confirmNewPassword,setConfirmNewPassword]=useState('')
  const [locked,setLocked]=useState(false)
  const [biometrics,setBiometrics]=useState(false)

  const [from,setFrom]=useState<Point|null>(null)
  const [to,setTo]=useState<Point|null>(null)
  const [date,setDate]=useState('2026-09-30 16:00')
  const [seats,setSeats]=useState('1')
  const [maxDetour,setMaxDetour]=useState('15')
  const [mapTarget,setMapTarget]=useState<MapTarget>('from')
  const [mapPoint,setMapPoint]=useState<Point|null>(null)

  const [matches,setMatches]=useState<Match[]>([])
  const [activeRouteId,setActiveRouteId]=useState<string|null>(null)
  const [myRides,setMyRides]=useState<MyRideItem[]>([])
  const [offers,setOffers]=useState<OfferItem[]>([])
  const [activeRides,setActiveRides]=useState<ActiveRideItem[]>([])
  const [messages,setMessages]=useState<ChatMessage[]>([])
  const [chatText,setChatText]=useState('')
  const [activeConversation,setActiveConversation]=useState<{id:string;driverId:string;requesterId:string;label:string}|null>(null)

  const [busy,setBusy]=useState(false)
  const [listLoading,setListLoading]=useState(false)
  const [updateChecking,setUpdateChecking]=useState(false)
  const [updateInstalling,setUpdateInstalling]=useState(false)
  const [country,setCountry]=useState<CountryCode>('NO')
  const [language,setLanguage]=useState<LanguageCode>('pl')
  const updateCheckedOnce=useRef(false)

  const c=COPY[language]

  useEffect(()=>{
    try{
      const sc=localStorage.getItem('samvei_country') as CountryCode|null
      const sl=localStorage.getItem('samvei_language') as LanguageCode|null
      if(sc&&['NO','SE','DK'].includes(sc)) setCountry(sc)
      if(sl&&['pl','no','sv','da','en'].includes(sl)) setLanguage(sl)
    }catch{}
    biometricAvailable().then(setBiometrics).catch(()=>setBiometrics(false))
    supabase.auth.getSession().then(({data})=>{
      const has=Boolean(data.session)
      setAuthenticated(has)
      setLocked(has)
      setAuthLoading(false)
    })
    const {data:listener}=supabase.auth.onAuthStateChange((event,session)=>{
      const logged=Boolean(session)
      setAuthenticated(logged)
      if(event==='PASSWORD_RECOVERY'){
        setLocked(false); setMode('setPassword'); return
      }
      if(logged) setLocked(true)
    })
    return ()=>listener.subscription.unsubscribe()
  },[])

  useEffect(()=>{
    const sub=BackHandler.addEventListener('hardwareBackPress',()=>{
      if(mode==='home') return false
      if(mode==='map') setMode(previousMode.current)
      else if(mode==='chat') setMode('activeRides')
      else setMode('home')
      return true
    })
    return ()=>sub.remove()
  },[mode])

  useEffect(()=>{
    if(!activeConversation||mode!=='chat') return
    const channel=supabase.channel('chat-'+activeConversation.id)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`conversation_id=eq.${activeConversation.id}`},payload=>{
        const row=payload.new as ChatMessage
        setMessages(prev=>prev.some(m=>m.id===row.id)?prev:[...prev,row])
      }).subscribe()
    return ()=>{supabase.removeChannel(channel)}
  },[activeConversation,mode])

  useEffect(()=>{
    if(authLoading||updateCheckedOnce.current) return
    updateCheckedOnce.current=true
    checkForUpdates(false)
  },[authLoading])

  const title=useMemo(()=>{
    if(mode==='search') return c.search
    if(mode==='offer') return c.offer
    if(mode==='matches') return 'Pasażerowie po trasie'
    if(mode==='map') return mapTarget==='from'?'Wybierz punkt startu':'Wybierz cel'
    if(mode==='setPassword') return 'Ustaw nowe hasło'
    if(mode==='myRides') return c.mine
    if(mode==='activeRides') return c.active
    if(mode==='rideOffers') return c.offers
    if(mode==='chat') return activeConversation?.label||'Wiadomości'
    if(mode==='settings') return c.settings
    return 'Samvei'
  },[mode,mapTarget,language,activeConversation])

  function compareVersions(a:string,b:string){
    const aa=a.split('.').map(v=>Number(v)||0), bb=b.split('.').map(v=>Number(v)||0)
    for(let i=0;i<Math.max(aa.length,bb.length);i++){
      const av=aa[i]||0,bv=bb[i]||0
      if(av>bv)return 1;if(av<bv)return-1
    }
    return 0
  }

  async function installAndroidUpdate(){
    if(Platform.OS!=='android') return
    setUpdateInstalling(true)
    try{
      const target=FileSystem.cacheDirectory+'Samvei-update.apk'
      try{await FileSystem.deleteAsync(target,{idempotent:true})}catch{}
      const result=await FileSystem.downloadAsync(ANDROID_APK_URL,target)
      if(result.status<200||result.status>=300) throw new Error('Nie udało się pobrać aktualizacji.')
      const contentUri=await FileSystem.getContentUriAsync(target)
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW',{
        data:contentUri,flags:1,type:'application/vnd.android.package-archive'
      })
    }catch(e:any){Alert.alert('Aktualizacja',e?.message||'Nie udało się uruchomić instalatora.')}
    finally{setUpdateInstalling(false)}
  }

  async function checkForUpdates(showCurrent=true){
    setUpdateChecking(true)
    try{
      const {data,error}=await supabase.from('app_release_config')
        .select('latest_app_version,store_url,force_native_update,release_notes')
        .eq('platform',Platform.OS==='ios'?'ios':'android').eq('channel','production').maybeSingle()
      if(error) throw error
      if(!data?.latest_app_version){
        if(showCurrent)Alert.alert('Aktualizacje',`Masz Samvei ${APP_VERSION} (${APP_BUILD}).`)
        return
      }
      if(compareVersions(data.latest_app_version,APP_VERSION)<=0){
        if(showCurrent)Alert.alert('Samvei jest aktualny',`Wersja ${APP_VERSION} (${APP_BUILD}) jest najnowsza.`)
        return
      }
      Alert.alert('Dostępna aktualizacja',`Dostępna wersja ${data.latest_app_version}.\n\n${data.release_notes||''}`,[
        {text:'Później',style:'cancel'},
        {text:Platform.OS==='android'?'Pobierz i zainstaluj':'Aktualizuj',onPress:()=>{
          if(Platform.OS==='android') installAndroidUpdate()
          else if(data.store_url) Linking.openURL(data.store_url)
        }}
      ])
    }catch(e:any){if(showCurrent)Alert.alert('Aktualizacje',e?.message||'Nie udało się sprawdzić aktualizacji.')}
    finally{setUpdateChecking(false)}
  }

  function authMessage(message?:string){
    const m=(message||'').toLowerCase()
    if(m.includes('invalid login credentials')) return 'Nieprawidłowy e-mail lub hasło.'
    if(m.includes('email not confirmed')) return 'Adres e-mail nie został potwierdzony.'
    if(m.includes('rate limit')) return 'Za dużo prób. Odczekaj chwilę i spróbuj ponownie.'
    return message||'Wystąpił błąd logowania.'
  }

  async function signIn(){
    if(!email||password.length<6)return Alert.alert('Sprawdź dane','Podaj e-mail i hasło min. 6 znaków.')
    setBusy(true)
    const {error}=await supabase.auth.signInWithPassword({email:email.trim(),password})
    setBusy(false)
    if(error)Alert.alert('Nie udało się zalogować',authMessage(error.message))
  }

  async function signUp(){
    if(!email||password.length<6)return Alert.alert('Sprawdź dane','Podaj e-mail i hasło min. 6 znaków.')
    setBusy(true)
    const {data,error}=await supabase.auth.signUp({email:email.trim(),password})
    setBusy(false)
    if(error)return Alert.alert('Nie udało się utworzyć konta',authMessage(error.message))
    const identities=data.user?.identities
    if(data.user&&Array.isArray(identities)&&identities.length===0){
      return Alert.alert('Konto już istnieje','Ten adres jest już zarejestrowany. Użyj logowania albo odzyskania hasła.')
    }
    if(data.session){setAuthenticated(true);setLocked(false);return}
    Alert.alert('Sprawdź e-mail','Wysłaliśmy link potwierdzający.')
  }

  async function resetPassword(){
    if(!email)return Alert.alert('Podaj e-mail')
    const {error}=await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:'samvei://reset-password'})
    if(error)return Alert.alert('Błąd',authMessage(error.message))
    Alert.alert('Wysłano','Sprawdź skrzynkę e-mail.')
  }

  async function saveNewPassword(){
    if(newPassword.length<8)return Alert.alert('Hasło','Minimum 8 znaków.')
    if(newPassword!==confirmNewPassword)return Alert.alert('Hasło','Hasła nie są identyczne.')
    setBusy(true)
    const {error}=await supabase.auth.updateUser({password:newPassword})
    setBusy(false)
    if(error)return Alert.alert('Błąd',authMessage(error.message))
    setMode('home');setLocked(false);setNewPassword('');setConfirmNewPassword('')
  }

  async function signOut(){
    await supabase.auth.signOut()
    setAuthenticated(false);setLocked(false);setMode('home')
  }

  async function unlock(){
    const result=await unlockWithBiometrics()
    if(result.success)setLocked(false)
    else Alert.alert('Nie odblokowano','Użyj biometrii lub kodu urządzenia.')
  }

  async function selectCountry(value:CountryCode){
    setCountry(value);try{localStorage.setItem('samvei_country',value)}catch{}
    const {data}=await supabase.auth.getUser()
    if(data.user) await supabase.from('users').update({registration_country_code:value}).eq('id',data.user.id)
  }

  async function selectLanguage(value:LanguageCode){
    setLanguage(value);try{localStorage.setItem('samvei_language',value)}catch{}
    const dbLang=value==='no'?'nb':value
    const {data}=await supabase.auth.getUser()
    if(data.user) await supabase.from('users').update({preferred_language:dbLang}).eq('id',data.user.id)
  }

  async function pointName(lat:number,lng:number){
    try{
      const rows=await Location.reverseGeocodeAsync({latitude:lat,longitude:lng})
      const r=rows[0]
      if(!r)return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
      return [r.name,r.street,r.city||r.district,r.region].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(', ')
    }catch{return `${lat.toFixed(5)}, ${lng.toFixed(5)}`}
  }

  async function useMyLocation(target:MapTarget){
    const perm=await Location.requestForegroundPermissionsAsync()
    if(perm.status!=='granted')return Alert.alert('Brak dostępu do GPS')
    setBusy(true)
    try{
      const pos=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High})
      const lat=pos.coords.latitude,lng=pos.coords.longitude
      const p={lat,lng,name:await pointName(lat,lng)}
      target==='from'?setFrom(p):setTo(p)
    }finally{setBusy(false)}
  }

  function openMap(target:MapTarget){
    setMapTarget(target);setMapPoint(target==='from'?from:to);previousMode.current=mode;setMode('map')
  }

  async function saveMapPoint(){
    if(!mapPoint)return
    const p={...mapPoint,name:await pointName(mapPoint.lat,mapPoint.lng)}
    mapTarget==='from'?setFrom(p):setTo(p)
    setMode(previousMode.current)
  }

  function parseDate(){
    const d=new Date(date.replace(' ','T'))
    return Number.isNaN(d.getTime())?null:d
  }

  async function savePassengerRequest(){
    if(!from||!to)return Alert.alert('Wybierz trasę','Ustaw punkt startu i cel.')
    const d=parseDate();if(!d)return Alert.alert('Data','Format: YYYY-MM-DD HH:mm')
    const {data:u}=await supabase.auth.getUser();if(!u.user)return
    setBusy(true)
    const {error}=await supabase.from('ride_requests').insert({
      passenger_id:u.user.id,origin_name:from.name,destination_name:to.name,
      origin_lat:from.lat,origin_lng:from.lng,destination_lat:to.lat,destination_lng:to.lng,
      desired_departure_at:d.toISOString(),seats_needed:Number(seats)||1,status:'pending'
    })
    setBusy(false)
    if(error)return Alert.alert('Błąd zapisu',error.message)
    Alert.alert('Zgłoszenie opublikowane','Kierowcy jadący podobną trasą mogą wysłać Ci ofertę.')
    setMode('home')
  }

  async function saveDriverRide(){
    if(!from||!to)return Alert.alert('Wybierz trasę','Ustaw punkt startu i cel.')
    const d=parseDate();if(!d)return Alert.alert('Data','Format: YYYY-MM-DD HH:mm')
    const {data:u}=await supabase.auth.getUser();if(!u.user)return
    setBusy(true)
    const {data:route,error}=await supabase.from('routes').insert({
      driver_id:u.user.id,origin_name:from.name,destination_name:to.name,
      origin_lat:from.lat,origin_lng:from.lng,destination_lat:to.lat,destination_lng:to.lng,
      departure_at:d.toISOString(),seats_available:Number(seats)||1,
      max_detour_m:Math.round((Number(maxDetour)||15)*1000),status:'active',is_preplanned:true
    }).select('id').single()
    if(error){setBusy(false);return Alert.alert('Błąd zapisu',error.message)}
    setActiveRouteId(route.id)
    await loadMatches(route.id)
    setBusy(false);setMode('matches')
  }

  async function loadMatches(routeId?:string){
    if(!from||!to)return
    if(routeId)setActiveRouteId(routeId)
    const {data,error}=await supabase.from('ride_requests')
      .select('id,passenger_id,origin_name,destination_name,origin_lat,origin_lng,destination_lat,destination_lng,desired_departure_at,seats_needed,status')
      .eq('status','pending').limit(100)
    if(error)return Alert.alert('Dopasowanie',error.message)
    const max=Number(maxDetour)||15
    const list=(data||[]).map((r:any)=>({
      id:r.id,passengerId:r.passenger_id,from:r.origin_name,to:r.destination_name,seats:r.seats_needed,
      departure:new Date(r.desired_departure_at).toLocaleString(),
      detourKm:detourScoreKm(
        {lat:from.lat,lng:from.lng},{lat:to.lat,lng:to.lng},
        {lat:r.origin_lat,lng:r.origin_lng},{lat:r.destination_lat,lng:r.destination_lng}
      )
    })).filter((r:Match)=>r.detourKm<=max).sort((a:Match,b:Match)=>a.detourKm-b.detourKm)
    setMatches(list)
  }

  async function sendRideOffer(match:Match){
    if(!activeRouteId)return Alert.alert('Brak trasy kierowcy')
    const {data:u}=await supabase.auth.getUser();if(!u.user)return
    const {error}=await supabase.from('ride_offers').insert({
      request_id:match.id,route_id:activeRouteId,driver_id:u.user.id,passenger_id:match.passengerId,
      seats_offered:match.seats,status:'pending',
      message:`Mogę zabrać Cię na trasie ${match.from} → ${match.to}`
    })
    if(error){
      if(String(error.message).toLowerCase().includes('duplicate')) return Alert.alert('Oferta już wysłana')
      return Alert.alert('Nie udało się wysłać oferty',error.message)
    }
    Alert.alert('Oferta wysłana','Pasażer może ją zaakceptować lub odrzucić.')
  }

  async function loadNames(ids:string[]){
    const unique=[...new Set(ids.filter(Boolean))]
    if(!unique.length)return {} as Record<string,string>
    const {data}=await supabase.from('users').select('id,full_name,email').in('id',unique)
    const map:Record<string,string>={}
    for(const r of data||[]) map[r.id]=r.full_name||r.email||'Użytkownik'
    return map
  }

  async function openRideOffers(){
    setListLoading(true)
    try{
      const {data:raw,error}=await supabase.from('ride_offers')
        .select('id,request_id,route_id,driver_id,passenger_id,status,seats_offered,message,conversation_id,created_at')
        .order('created_at',{ascending:false}).limit(100)
      if(error)throw error
      const rows=raw||[]
      const reqIds=[...new Set(rows.map((r:any)=>r.request_id))]
      const routeIds=[...new Set(rows.map((r:any)=>r.route_id))]
      const [{data:reqs},{data:routes},names]=await Promise.all([
        reqIds.length?supabase.from('ride_requests').select('id,origin_name,destination_name,desired_departure_at').in('id',reqIds):Promise.resolve({data:[] as any[]}),
        routeIds.length?supabase.from('routes').select('id,origin_name,destination_name,departure_at').in('id',routeIds):Promise.resolve({data:[] as any[]}),
        loadNames(rows.flatMap((r:any)=>[r.driver_id,r.passenger_id]))
      ])
      const reqMap=Object.fromEntries((reqs||[]).map((r:any)=>[r.id,r]))
      const routeMap=Object.fromEntries((routes||[]).map((r:any)=>[r.id,r]))
      setOffers(rows.map((r:any)=>{
        const rr=reqMap[r.request_id],rt=routeMap[r.route_id]
        return {
          id:r.id,requestId:r.request_id,routeId:r.route_id,driverId:r.driver_id,passengerId:r.passenger_id,
          status:r.status,seats:r.seats_offered,message:r.message,conversationId:r.conversation_id,
          from:rr?.origin_name||rt?.origin_name||'Start',to:rr?.destination_name||rt?.destination_name||'Cel',
          departure:new Date(rr?.desired_departure_at||rt?.departure_at||Date.now()).toLocaleString(),
          driverName:names[r.driver_id]||'Kierowca',passengerName:names[r.passenger_id]||'Pasażer'
        } as OfferItem
      }))
      setMode('rideOffers')
    }catch(e:any){Alert.alert('Oferty',e?.message||'Nie udało się pobrać ofert.')}
    finally{setListLoading(false)}
  }

  async function acceptOffer(item:OfferItem){
    setBusy(true)
    const {data,error}=await supabase.rpc('accept_ride_offer',{p_offer_id:item.id})
    setBusy(false)
    if(error)return Alert.alert('Nie udało się zaakceptować',error.message)
    Alert.alert('Przejazd zaakceptowany','Możecie teraz pisać do siebie.')
    await openChat(String(data),item.driverId,item.passengerId,`${item.from} → ${item.to}`)
  }

  async function rejectOffer(item:OfferItem){
    const {error}=await supabase.from('ride_offers').update({status:'rejected',responded_at:new Date().toISOString()}).eq('id',item.id)
    if(error)return Alert.alert('Błąd',error.message)
    await openRideOffers()
  }

  async function cancelOffer(item:OfferItem){
    const {error}=await supabase.from('ride_offers').update({status:'cancelled',responded_at:new Date().toISOString()}).eq('id',item.id)
    if(error)return Alert.alert('Błąd',error.message)
    await openRideOffers()
  }

  async function openMyRides(){
    setListLoading(true)
    try{
      const {data:u}=await supabase.auth.getUser();if(!u.user)return
      const [dr,pr]=await Promise.all([
        supabase.from('routes').select('id,origin_name,destination_name,departure_at,seats_available,status').eq('driver_id',u.user.id).order('departure_at',{ascending:false}).limit(50),
        supabase.from('ride_requests').select('id,origin_name,destination_name,desired_departure_at,seats_needed,status').eq('passenger_id',u.user.id).order('desired_departure_at',{ascending:false}).limit(50)
      ])
      if(dr.error)throw dr.error;if(pr.error)throw pr.error
      setMyRides([
        ...(dr.data||[]).map((r:any)=>({id:r.id,kind:'driver' as const,from:r.origin_name,to:r.destination_name,departure:new Date(r.departure_at).toLocaleString(),status:r.status,seats:r.seats_available})),
        ...(pr.data||[]).map((r:any)=>({id:r.id,kind:'passenger' as const,from:r.origin_name,to:r.destination_name,departure:new Date(r.desired_departure_at).toLocaleString(),status:r.status,seats:r.seats_needed}))
      ])
      setMode('myRides')
    }catch(e:any){Alert.alert('Moje przejazdy',e?.message||'Błąd pobierania')}
    finally{setListLoading(false)}
  }

  async function openActiveRides(){
    setListLoading(true)
    try{
      const {data:u}=await supabase.auth.getUser();if(!u.user)return
      const {data:rr,error}=await supabase.from('ride_requests')
        .select('id,passenger_id,route_id,conversation_id,seats_needed,status')
        .eq('status','accepted').limit(100)
      if(error)throw error
      const rows=rr||[]
      const routeIds=[...new Set(rows.map((r:any)=>r.route_id).filter(Boolean))]
      const {data:routes}=routeIds.length?await supabase.from('routes')
        .select('id,driver_id,origin_name,destination_name,departure_at').in('id',routeIds):{data:[] as any[]}
      const routeMap=Object.fromEntries((routes||[]).map((r:any)=>[r.id,r]))
      const names=await loadNames(rows.flatMap((r:any)=>[r.passenger_id,routeMap[r.route_id]?.driver_id]).filter(Boolean))
      setActiveRides(rows.map((r:any)=>{
        const rt=routeMap[r.route_id]
        const driverId=rt?.driver_id||''
        return {
          requestId:r.id,role:r.passenger_id===u.user!.id?'passenger':'driver',
          routeId:r.route_id,conversationId:r.conversation_id,driverId,passengerId:r.passenger_id,
          from:rt?.origin_name||'Start',to:rt?.destination_name||'Cel',
          departure:new Date(rt?.departure_at||Date.now()).toLocaleString(),seats:r.seats_needed,
          driverName:names[driverId]||'Kierowca',passengerName:names[r.passenger_id]||'Pasażer'
        } as ActiveRideItem
      }))
      setMode('activeRides')
    }catch(e:any){Alert.alert('Aktualne przejazdy',e?.message||'Błąd pobierania')}
    finally{setListLoading(false)}
  }

  async function completeRide(item:ActiveRideItem){
    if(item.role!=='driver')return
    const {error}=await supabase.from('ride_requests').update({status:'completed'}).eq('id',item.requestId)
    if(error)return Alert.alert('Błąd',error.message)
    await openActiveRides()
  }

  async function openChat(conversationId:string,driverId:string,requesterId:string,label:string){
    setActiveConversation({id:conversationId,driverId,requesterId,label})
    setListLoading(true)
    const {data,error}=await supabase.from('messages')
      .select('id,sender_id,recipient_id,body,content,created_at')
      .eq('conversation_id',conversationId).order('created_at',{ascending:true}).limit(200)
    setListLoading(false)
    if(error)return Alert.alert('Wiadomości',error.message)
    setMessages((data||[]) as ChatMessage[]);setMode('chat')
  }

  async function sendMessage(){
    if(!activeConversation||!chatText.trim())return
    const {data:u}=await supabase.auth.getUser();if(!u.user)return
    const recipient=u.user.id===activeConversation.driverId?activeConversation.requesterId:activeConversation.driverId
    const body=chatText.trim();setChatText('')
    const {error}=await supabase.from('messages').insert({
      conversation_id:activeConversation.id,sender_id:u.user.id,recipient_id:recipient,body,content:body
    })
    if(error)Alert.alert('Nie wysłano',error.message)
  }

  if(authLoading)return <SafeAreaView style={styles.safe}><View style={styles.center}><Text style={styles.logo}>Samvei</Text><Text style={styles.subtitle}>Ładowanie…</Text></View></SafeAreaView>

  if(!authenticated)return <SafeAreaView style={styles.safe}>
    <StatusBar style="light"/>
    <ScrollView contentContainerStyle={styles.authScreen} keyboardShouldPersistTaps="handled">
      <View style={styles.brandMark}><Text style={styles.brandS}>S</Text></View>
      <Text style={styles.logo}>Samvei</Text>
      <Text style={styles.subtitle}>Podwózki po Norwegii, Szwecji i Danii.</Text>
      <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="E-mail" placeholderTextColor="#6f7785"/>
      <TextInput style={[styles.input,{marginTop:12}]} value={password} onChangeText={setPassword} secureTextEntry placeholder="Hasło" placeholderTextColor="#6f7785"/>
      <TouchableOpacity style={[styles.primary,busy&&styles.disabled]} onPress={signIn} disabled={busy}><Text style={styles.primaryText}>Zaloguj się</Text></TouchableOpacity>
      <TouchableOpacity style={styles.secondaryButton} onPress={signUp}><Text style={styles.secondaryText}>Utwórz konto</Text></TouchableOpacity>
      <TouchableOpacity onPress={resetPassword}><Text style={styles.link}>Nie pamiętam hasła</Text></TouchableOpacity>
      <View style={styles.preloginUpdateBox}><View style={{flex:1}}><Text style={styles.updateTitle}>↻ Aktualizacja aplikacji</Text><Text style={styles.cardText}>Działa bez logowania.</Text></View><Text style={styles.versionChip}>v{APP_VERSION}</Text></View>
      <TouchableOpacity style={styles.secondaryButton} onPress={()=>checkForUpdates(true)} disabled={updateChecking||updateInstalling}><Text style={styles.secondaryText}>{updateInstalling?'Pobieranie…':updateChecking?'Sprawdzanie…':'Sprawdź aktualizację'}</Text></TouchableOpacity>
      <Text style={styles.versionFooter}>Samvei v{APP_VERSION} · build {APP_BUILD}</Text>
    </ScrollView>
  </SafeAreaView>

  if(locked)return <SafeAreaView style={styles.safe}><StatusBar style="light"/><View style={styles.center}>
    <View style={styles.brandMark}><Text style={styles.brandS}>S</Text></View><Text style={styles.logo}>Samvei</Text>
    <Text style={styles.subtitle}>Konto jest zablokowane</Text>
    <TouchableOpacity style={styles.primaryWide} onPress={unlock}><Text style={styles.primaryText}>{biometrics?'Odblokuj biometrią':'Odblokuj urządzeniem'}</Text></TouchableOpacity>
  </View></SafeAreaView>

  return <SafeAreaView style={styles.safe}>
    <StatusBar style="light"/>
    {mode==='setPassword'?<ScrollView contentContainerStyle={styles.authScreen}>
      <Text style={styles.logo}>Nowe hasło</Text>
      <TextInput style={styles.input} value={newPassword} onChangeText={setNewPassword} secureTextEntry placeholder="Nowe hasło" placeholderTextColor="#6f7785"/>
      <TextInput style={[styles.input,{marginTop:12}]} value={confirmNewPassword} onChangeText={setConfirmNewPassword} secureTextEntry placeholder="Powtórz hasło" placeholderTextColor="#6f7785"/>
      <TouchableOpacity style={styles.primary} onPress={saveNewPassword}><Text style={styles.primaryText}>Zapisz nowe hasło</Text></TouchableOpacity>
    </ScrollView>:mode==='map'?<MapPicker point={mapPoint} setPoint={setMapPoint} onCancel={()=>setMode(previousMode.current)} onSave={saveMapPoint} title={title}/>:<ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        {mode!=='home'?<TouchableOpacity style={styles.backButton} onPress={()=>setMode('home')}><Text style={styles.back}>←</Text></TouchableOpacity>:<View style={{width:48}}/>}
        <Text style={styles.title}>{title}</Text>
        <TouchableOpacity onPress={()=>setMode('settings')}><Text style={styles.headerAction}>{mode==='settings'?'':'⚙'}</Text></TouchableOpacity>
      </View>

      {mode==='home'&&<Home copy={c} country={country} language={language} onSearch={()=>setMode('search')} onOffer={()=>setMode('offer')} onActive={openActiveRides} onMine={openMyRides} onOffers={openRideOffers} onSettings={()=>setMode('settings')} loading={listLoading}/>}

      {(mode==='search'||mode==='offer')&&<View style={styles.form}>
        <LocationField label="Skąd" point={from} onGps={()=>useMyLocation('from')} onMap={()=>openMap('from')}/>
        <LocationField label="Dokąd" point={to} onGps={()=>useMyLocation('to')} onMap={()=>openMap('to')}/>
        <Field label="Data i godzina" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD HH:mm"/>
        <Field label="Liczba osób / miejsc" value={seats} onChangeText={setSeats} keyboardType="numeric"/>
        {mode==='offer'&&<Field label="Maksymalny objazd (km)" value={maxDetour} onChangeText={setMaxDetour} keyboardType="numeric"/>}
        <TouchableOpacity style={[styles.primary,busy&&styles.disabled]} onPress={mode==='search'?savePassengerRequest:saveDriverRide} disabled={busy}><Text style={styles.primaryText}>{mode==='search'?'Opublikuj zgłoszenie':'Opublikuj trasę'}</Text></TouchableOpacity>
      </View>}

      {mode==='matches'&&<>
        <Text style={styles.subtitle}>Pasażerowie pasujący do Twojej trasy. Wyślij konkretną ofertę przejazdu.</Text>
        {!matches.length?<Empty text="Brak pasujących zgłoszeń w ustawionym limicie objazdu."/>:matches.map(r=><View key={r.id} style={styles.itemCard}>
          <Text style={styles.cardTitle}>{r.from} → {r.to}</Text>
          <Text style={styles.cardText}>{r.departure} · {r.seats} os.</Text>
          <Text style={styles.detour}>Objazd ok. {r.detourKm.toFixed(1)} km</Text>
          <TouchableOpacity style={styles.smallPrimary} onPress={()=>sendRideOffer(r)}><Text style={styles.primaryText}>Wyślij ofertę</Text></TouchableOpacity>
        </View>)}
      </>}

      {mode==='myRides'&&<>
        <Text style={styles.subtitle}>Twoje otwarte i zakończone trasy oraz zgłoszenia.</Text>
        {!myRides.length?<Empty text="Nie masz jeszcze żadnych tras ani zgłoszeń."/>:myRides.map(r=><View key={r.kind+r.id} style={styles.itemCard}>
          <View style={styles.rowBetween}><Text style={styles.kind}>{r.kind==='driver'?'🚗 Kierowca':'🙋 Pasażer'}</Text><Text style={styles.statusChip}>{r.status}</Text></View>
          <Text style={styles.cardTitle}>{r.from} → {r.to}</Text><Text style={styles.cardText}>{r.departure}</Text>
          <Text style={styles.cardText}>{r.kind==='driver'?'Wolne miejsca':'Osoby'}: {r.seats}</Text>
        </View>)}
      </>}

      {mode==='rideOffers'&&<>
        <Text style={styles.subtitle}>Oferty między kierowcą i pasażerem. Po akceptacji uruchamia się kontakt.</Text>
        {!offers.length?<Empty text="Brak ofert."/>:offers.map(o=><OfferCard key={o.id} item={o} onAccept={()=>acceptOffer(o)} onReject={()=>rejectOffer(o)} onCancel={()=>cancelOffer(o)} onChat={()=>o.conversationId&&openChat(o.conversationId,o.driverId,o.passengerId,`${o.from} → ${o.to}`)}/>)}
      </>}

      {mode==='activeRides'&&<>
        <Text style={styles.subtitle}>Zaakceptowane przejazdy. Tutaj kontaktujesz się z drugą stroną i zamykasz przejazd.</Text>
        {!activeRides.length?<Empty text="Brak aktualnych zaakceptowanych przejazdów."/>:activeRides.map(r=><View key={r.requestId} style={styles.itemCard}>
          <View style={styles.rowBetween}><Text style={styles.kind}>{r.role==='driver'?'🚗 Kierowca':'🙋 Pasażer'}</Text><Text style={styles.statusChip}>zaakceptowany</Text></View>
          <Text style={styles.cardTitle}>{r.from} → {r.to}</Text>
          <Text style={styles.cardText}>{r.departure} · {r.seats} os.</Text>
          <Text style={styles.cardText}>{r.role==='driver'?`Pasażer: ${r.passengerName}`:`Kierowca: ${r.driverName}`}</Text>
          <View style={styles.actionRow}>
            {r.conversationId&&<TouchableOpacity style={styles.actionBtnWide} onPress={()=>openChat(r.conversationId!,r.driverId,r.passengerId,`${r.from} → ${r.to}`)}><Text style={styles.actionText}>💬 Wiadomości</Text></TouchableOpacity>}
            {r.role==='driver'&&<TouchableOpacity style={styles.actionBtnWide} onPress={()=>completeRide(r)}><Text style={styles.actionText}>✓ Zakończ</Text></TouchableOpacity>}
          </View>
        </View>)}
      </>}

      {mode==='chat'&&activeConversation&&<View style={styles.chatWrap}>
        <View style={styles.chatList}>
          {listLoading?<Text style={styles.cardText}>Ładowanie…</Text>:messages.map(m=><MessageBubble key={m.id} m={m}/>)}
        </View>
        <View style={styles.chatInputRow}><TextInput style={[styles.input,{flex:1}]} value={chatText} onChangeText={setChatText} placeholder="Napisz wiadomość…" placeholderTextColor="#6f7785"/><TouchableOpacity style={styles.sendBtn} onPress={sendMessage}><Text style={styles.primaryText}>Wyślij</Text></TouchableOpacity></View>
      </View>}

      {mode==='settings'&&<View style={styles.form}>
        <Text style={styles.sectionTitle}>Kraj</Text>
        <View style={styles.badgeRow}>
          <Choice active={country==='NO'} label="🇳🇴 Norwegia" onPress={()=>selectCountry('NO')}/>
          <Choice active={country==='SE'} label="🇸🇪 Szwecja" onPress={()=>selectCountry('SE')}/>
          <Choice active={country==='DK'} label="🇩🇰 Dania" onPress={()=>selectCountry('DK')}/>
        </View>
        <Text style={styles.sectionTitle}>Język</Text>
        <View style={styles.badgeRow}>
          <Choice active={language==='pl'} label="PL" onPress={()=>selectLanguage('pl')}/><Choice active={language==='no'} label="NO" onPress={()=>selectLanguage('no')}/><Choice active={language==='sv'} label="SV" onPress={()=>selectLanguage('sv')}/><Choice active={language==='da'} label="DA" onPress={()=>selectLanguage('da')}/><Choice active={language==='en'} label="EN" onPress={()=>selectLanguage('en')}/>
        </View>
        <TouchableOpacity style={styles.settingsRow} onPress={()=>checkForUpdates(true)}><Text style={styles.cardTitle}>↻ Aktualizacje</Text><Text style={styles.cardText}>v{APP_VERSION} · build {APP_BUILD}</Text></TouchableOpacity>
        <View style={styles.settingsRow}><Text style={styles.cardTitle}>🔐 Biometria</Text><Text style={styles.cardText}>{biometrics?'Dostępna':'Niedostępna'}</Text></View>
        <TouchableOpacity style={styles.secondaryButton} onPress={signOut}><Text style={styles.secondaryText}>Wyloguj się</Text></TouchableOpacity>
      </View>}
    </ScrollView>}
  </SafeAreaView>
}

function Home({copy,country,language,onSearch,onOffer,onActive,onMine,onOffers,onSettings,loading}:any){
  return <>
    <View style={styles.homeMeta}><Text style={styles.metaChip}>{country==='NO'?'🇳🇴':country==='SE'?'🇸🇪':'🇩🇰'} {country}</Text><TouchableOpacity onPress={onSettings}><Text style={styles.metaChip}>{language.toUpperCase()} ⚙</Text></TouchableOpacity></View>
    <Text style={styles.hero}>{copy.hero}</Text><Text style={styles.subtitle}>{copy.sub}</Text>
    <TouchableOpacity style={styles.primaryCard} onPress={onSearch}><Text style={styles.cardIcon}>⌕</Text><View style={{flex:1}}><Text style={styles.cardTitle}>{copy.search}</Text><Text style={styles.cardText}>Dodaj skąd, dokąd i kiedy chcesz jechać.</Text></View></TouchableOpacity>
    <TouchableOpacity style={styles.card} onPress={onOffer}><Text style={styles.cardIcon}>🚗</Text><View style={{flex:1}}><Text style={styles.cardTitle}>{copy.offer}</Text><Text style={styles.cardText}>Opublikuj trasę i zaproponuj miejsce pasażerowi po drodze.</Text></View></TouchableOpacity>
    <View style={styles.grid}>
      <TouchableOpacity style={styles.gridCard} onPress={onActive}><Text style={styles.gridIcon}>✓</Text><Text style={styles.gridTitle}>{copy.active}</Text><Text style={styles.gridText}>Zaakceptowane przejazdy i kontakt</Text></TouchableOpacity>
      <TouchableOpacity style={styles.gridCard} onPress={onOffers}><Text style={styles.gridIcon}>💬</Text><Text style={styles.gridTitle}>{copy.offers}</Text><Text style={styles.gridText}>Akceptuj, odrzucaj i pisz</Text></TouchableOpacity>
      <TouchableOpacity style={styles.gridCard} onPress={onMine}><Text style={styles.gridIcon}>☰</Text><Text style={styles.gridTitle}>{copy.mine}</Text><Text style={styles.gridText}>{loading?'Ładowanie…':'Wszystkie Twoje wpisy'}</Text></TouchableOpacity>
      <TouchableOpacity style={styles.gridCard} onPress={onSettings}><Text style={styles.gridIcon}>⚙</Text><Text style={styles.gridTitle}>{copy.settings}</Text><Text style={styles.gridText}>Kraj, język, aktualizacje</Text></TouchableOpacity>
    </View>
  </>
}

function OfferCard({item,onAccept,onReject,onCancel,onChat}:{item:OfferItem;onAccept:()=>void;onReject:()=>void;onCancel:()=>void;onChat:()=>void}){
  return <View style={styles.itemCard}>
    <View style={styles.rowBetween}><Text style={styles.kind}>🚗 {item.driverName}</Text><Text style={styles.statusChip}>{item.status}</Text></View>
    <Text style={styles.cardTitle}>{item.from} → {item.to}</Text><Text style={styles.cardText}>{item.departure}</Text>
    {item.message?<Text style={[styles.cardText,{marginTop:6}]}>{item.message}</Text>:null}
    <OfferActions item={item} onAccept={onAccept} onReject={onReject} onCancel={onCancel} onChat={onChat}/>
  </View>
}

function OfferActions({item,onAccept,onReject,onCancel,onChat}:any){
  const [uid,setUid]=useState<string|null>(null)
  useEffect(()=>{supabase.auth.getUser().then(({data})=>setUid(data.user?.id||null))},[])
  if(item.status==='accepted'&&item.conversationId)return <TouchableOpacity style={styles.smallPrimary} onPress={onChat}><Text style={styles.primaryText}>💬 Otwórz wiadomości</Text></TouchableOpacity>
  if(item.status!=='pending')return null
  if(uid===item.passengerId)return <View style={styles.actionRow}><TouchableOpacity style={styles.smallPrimaryFlex} onPress={onAccept}><Text style={styles.primaryText}>Akceptuj</Text></TouchableOpacity><TouchableOpacity style={styles.smallSecondaryFlex} onPress={onReject}><Text style={styles.secondaryText}>Odrzuć</Text></TouchableOpacity></View>
  if(uid===item.driverId)return <TouchableOpacity style={styles.smallSecondary} onPress={onCancel}><Text style={styles.secondaryText}>Wycofaj ofertę</Text></TouchableOpacity>
  return null
}

function MessageBubble({m}:{m:ChatMessage}){
  const [uid,setUid]=useState<string|null>(null)
  useEffect(()=>{supabase.auth.getUser().then(({data})=>setUid(data.user?.id||null))},[])
  const mine=uid===m.sender_id
  return <View style={[styles.messageBubble,mine?styles.messageMine:styles.messageOther]}><Text style={styles.messageText}>{m.body||m.content}</Text><Text style={styles.messageTime}>{new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</Text></View>
}

function Choice({active,label,onPress}:{active:boolean;label:string;onPress:()=>void}){return <TouchableOpacity onPress={onPress}><Text style={[styles.badge,active&&styles.badgeActive]}>{label}</Text></TouchableOpacity>}
function Empty({text}:{text:string}){return <View style={styles.empty}><Text style={styles.cardText}>{text}</Text></View>}
function LocationField({label,point,onGps,onMap}:{label:string;point:Point|null;onGps:()=>void;onMap:()=>void}){return <View style={{marginBottom:16}}><Text style={styles.label}>{label}</Text><View style={styles.locationBox}><Text numberOfLines={2} style={point?styles.locationValue:styles.locationPlaceholder}>{point?.name||'Nie wybrano punktu'}</Text></View><View style={styles.locationActions}><TouchableOpacity style={styles.actionBtn} onPress={onGps}><Text style={styles.actionText}>◎ Moja pozycja</Text></TouchableOpacity><TouchableOpacity style={styles.actionBtn} onPress={onMap}><Text style={styles.actionText}>⌖ Mapa</Text></TouchableOpacity></View></View>}
function Field(props:any){const {label,...rest}=props;return <View style={{marginBottom:14}}><Text style={styles.label}>{label}</Text><TextInput style={styles.input} placeholderTextColor="#6f7785" {...rest}/></View>}

function MapPicker({point,setPoint,onCancel,onSave,title}:{point:Point|null;setPoint:(p:Point)=>void;onCancel:()=>void;onSave:()=>void;title:string}){
  const lat=point?.lat??58.7642,lng=point?.lng??5.8550
  const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/><style>html,body,#map{height:100%;margin:0;background:#091014}</style></head><body><div id="map"></div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>const map=L.map('map').setView([${lat},${lng}],${point?14:8});L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);let marker=${point?`L.marker([${lat},${lng}]).addTo(map)`:'null'};map.on('click',e=>{if(marker)marker.setLatLng(e.latlng);else marker=L.marker(e.latlng).addTo(map);window.ReactNativeWebView.postMessage(JSON.stringify({lat:e.latlng.lat,lng:e.latlng.lng}));});</script></body></html>`
  return <View style={styles.mapScreen}><View style={styles.mapHeader}><TouchableOpacity onPress={onCancel}><Text style={styles.back}>←</Text></TouchableOpacity><Text style={styles.title}>{title}</Text><View style={{width:36}}/></View><WebView source={{html}} style={styles.map} javaScriptEnabled domStorageEnabled onMessage={e=>{try{const p=JSON.parse(e.nativeEvent.data);setPoint({lat:p.lat,lng:p.lng,name:`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`})}catch{}}}/><View style={styles.mapBottom}><Text style={styles.mapHint}>{point?`${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`:'Dotknij miejsca na mapie'}</Text><TouchableOpacity style={[styles.primaryWide,!point&&styles.disabled]} onPress={onSave} disabled={!point}><Text style={styles.primaryText}>Użyj tego miejsca</Text></TouchableOpacity></View></View>
}

const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:'#071014'},page:{padding:20,paddingBottom:48},center:{flex:1,alignItems:'center',justifyContent:'center',padding:28},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:20,paddingTop:14},backButton:{width:48,height:48,justifyContent:'center'},back:{color:'#76f6be',fontSize:30,fontWeight:'600'},title:{color:'white',fontSize:20,fontWeight:'800'},headerAction:{color:'#76f6be',fontSize:24,width:48,textAlign:'right'},
  logo:{color:'white',fontWeight:'900',fontSize:38,marginBottom:6},brandMark:{width:74,height:74,borderRadius:22,backgroundColor:'#12362d',borderWidth:1,borderColor:'#2e8f70',alignItems:'center',justifyContent:'center',marginBottom:16},brandS:{color:'#76f6be',fontWeight:'900',fontSize:46},
  hero:{color:'white',fontSize:32,lineHeight:38,fontWeight:'900',marginBottom:8},subtitle:{color:'#aeb7c3',fontSize:16,lineHeight:23,marginBottom:20},
  homeMeta:{flexDirection:'row',justifyContent:'space-between',marginBottom:12},metaChip:{color:'#aeb7c3',backgroundColor:'#101820',paddingHorizontal:10,paddingVertical:7,borderRadius:999,overflow:'hidden'},
  primaryCard:{backgroundColor:'#12362d',borderColor:'#2e8f70',borderWidth:1,borderRadius:20,padding:18,flexDirection:'row',gap:14,marginBottom:12},card:{backgroundColor:'#121b21',borderColor:'#26333c',borderWidth:1,borderRadius:20,padding:18,flexDirection:'row',gap:14,marginBottom:14},cardIcon:{fontSize:28,color:'#76f6be',width:40,textAlign:'center'},cardTitle:{color:'white',fontSize:18,fontWeight:'800',marginBottom:5},cardText:{color:'#9eabb5',fontSize:14,lineHeight:20},
  grid:{flexDirection:'row',flexWrap:'wrap',gap:10,marginTop:4},gridCard:{width:'48%',backgroundColor:'#101820',borderColor:'#26333c',borderWidth:1,borderRadius:16,padding:14,minHeight:130},gridIcon:{fontSize:25,marginBottom:10},gridTitle:{color:'white',fontWeight:'900',fontSize:15,marginBottom:5},gridText:{color:'#89969f',fontSize:12,lineHeight:17},
  form:{backgroundColor:'#0f171c',borderRadius:20,padding:18},label:{color:'#c6d0d8',fontWeight:'700',marginBottom:7},input:{color:'white',backgroundColor:'#182229',borderWidth:1,borderColor:'#2a3740',borderRadius:12,paddingHorizontal:14,paddingVertical:13,fontSize:16},
  primary:{backgroundColor:'#63e6ad',borderRadius:14,paddingVertical:15,alignItems:'center',marginTop:8},primaryWide:{backgroundColor:'#63e6ad',borderRadius:14,paddingVertical:15,alignItems:'center',width:'100%'},primaryText:{color:'#04110c',fontWeight:'900',fontSize:15},disabled:{opacity:.45},secondaryButton:{borderWidth:1,borderColor:'#3c4a53',borderRadius:14,paddingVertical:14,alignItems:'center',marginTop:10},secondaryText:{color:'#dce5ea',fontWeight:'800'},link:{color:'#76f6be',textAlign:'center',marginTop:18,fontWeight:'700'},
  authScreen:{flexGrow:1,justifyContent:'center',padding:28},preloginUpdateBox:{backgroundColor:'#0f171c',borderWidth:1,borderColor:'#26333c',borderRadius:16,padding:14,marginTop:22,flexDirection:'row',alignItems:'center',gap:12},updateTitle:{color:'#76f6be',fontWeight:'900',fontSize:16},versionChip:{color:'#071014',backgroundColor:'#63e6ad',fontWeight:'900',borderRadius:999,paddingHorizontal:10,paddingVertical:6,overflow:'hidden'},versionFooter:{color:'#65727b',fontSize:12,textAlign:'center',marginTop:18},
  locationBox:{backgroundColor:'#182229',borderWidth:1,borderColor:'#2a3740',borderRadius:12,padding:13,minHeight:52,justifyContent:'center'},locationValue:{color:'white',fontSize:15},locationPlaceholder:{color:'#6f7785',fontSize:15},locationActions:{flexDirection:'row',gap:8,marginTop:8},actionBtn:{flex:1,borderWidth:1,borderColor:'#2e8f70',borderRadius:11,paddingVertical:10,alignItems:'center'},actionText:{color:'#76f6be',fontWeight:'800',fontSize:12},
  itemCard:{backgroundColor:'#121b21',borderRadius:18,padding:17,marginBottom:12,borderWidth:1,borderColor:'#26333c'},rowBetween:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:9},kind:{color:'#76f6be',fontWeight:'900'},statusChip:{color:'#dce5ea',backgroundColor:'#1b252b',paddingHorizontal:9,paddingVertical:5,borderRadius:999,fontSize:12,overflow:'hidden'},detour:{color:'#76f6be',fontWeight:'700',marginTop:9,marginBottom:12},
  smallPrimary:{backgroundColor:'#63e6ad',borderRadius:12,paddingVertical:12,alignItems:'center',marginTop:12},smallPrimaryFlex:{flex:1,backgroundColor:'#63e6ad',borderRadius:12,paddingVertical:12,alignItems:'center'},smallSecondary:{borderWidth:1,borderColor:'#3c4a53',borderRadius:12,paddingVertical:12,alignItems:'center',marginTop:12},smallSecondaryFlex:{flex:1,borderWidth:1,borderColor:'#3c4a53',borderRadius:12,paddingVertical:12,alignItems:'center'},empty:{backgroundColor:'#121b21',borderRadius:18,padding:18},
  actionRow:{flexDirection:'row',gap:8,marginTop:12},actionBtnWide:{flex:1,borderWidth:1,borderColor:'#2e8f70',borderRadius:11,paddingVertical:11,alignItems:'center'},
  chatWrap:{flex:1},chatList:{gap:8,marginBottom:16},chatInputRow:{flexDirection:'row',gap:8,alignItems:'center'},sendBtn:{backgroundColor:'#63e6ad',borderRadius:12,paddingHorizontal:16,paddingVertical:14},messageBubble:{maxWidth:'82%',borderRadius:16,padding:12,marginBottom:7},messageMine:{alignSelf:'flex-end',backgroundColor:'#12362d'},messageOther:{alignSelf:'flex-start',backgroundColor:'#182229'},messageText:{color:'white',fontSize:15,lineHeight:20},messageTime:{color:'#829098',fontSize:10,marginTop:5,textAlign:'right'},
  badgeRow:{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:18},badge:{color:'#d8e0e6',backgroundColor:'#101820',borderRadius:999,paddingHorizontal:12,paddingVertical:8,borderWidth:1,borderColor:'#1d2a31'},badgeActive:{backgroundColor:'#12362d',borderColor:'#63e6ad',color:'#76f6be'},sectionTitle:{color:'white',fontSize:18,fontWeight:'900',marginBottom:10,marginTop:8},settingsRow:{backgroundColor:'#121b21',borderRadius:14,padding:14,marginBottom:10},
  mapScreen:{flex:1,backgroundColor:'#071014'},mapHeader:{height:64,paddingHorizontal:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},map:{flex:1},mapBottom:{padding:16,backgroundColor:'#0f171c',gap:10},mapHint:{color:'#aeb7c3',textAlign:'center'}
})
