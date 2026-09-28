import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  BackHandler,
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import * as Location from 'expo-location'
import { WebView } from 'react-native-webview'
import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import { StripeProvider } from '@stripe/stripe-react-native'
import { supabase } from './src/lib/supabase'
import { biometricAvailable, unlockWithBiometrics } from './src/lib/biometric'
import { detourScoreKm } from './src/lib/geo'

type Mode = 'home' | 'search' | 'offer' | 'matches' | 'map' | 'payments' | 'setPassword'
type Point = { lat: number; lng: number; name: string }
type MapTarget = 'from' | 'to'
const APP_VERSION = '1.0.4'
const APP_BUILD = '104'
const ANDROID_APK_URL = 'https://github.com/mlodyk85/samvei/releases/latest/download/Samvei-Scandinavia.apk'
type Match = {
  id: string
  from: string
  to: string
  seats: number
  departure: string
  detourKm: number
}

export default function App() {
  const [mode, setMode] = useState<Mode>('home')
  const previousMode = useRef<Mode>('home')
  const [authenticated, setAuthenticated] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [locked, setLocked] = useState(false)
  const [biometrics, setBiometrics] = useState(false)
  const [from, setFrom] = useState<Point | null>(null)
  const [to, setTo] = useState<Point | null>(null)
  const [date, setDate] = useState('2026-09-30 16:00')
  const [seats, setSeats] = useState('1')
  const [maxDetour, setMaxDetour] = useState('15')
  const [mapTarget, setMapTarget] = useState<MapTarget>('from')
  const [mapPoint, setMapPoint] = useState<Point | null>(null)
  const [matches, setMatches] = useState<Match[]>([])
  const [busy, setBusy] = useState(false)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updateInstalling, setUpdateInstalling] = useState(false)
  const updateCheckedOnce = useRef(false)

  useEffect(() => {
    biometricAvailable().then(setBiometrics).catch(() => setBiometrics(false))
    supabase.auth.getSession().then(({ data }) => {
      const hasSession = Boolean(data.session)
      setAuthenticated(hasSession)
      setLocked(hasSession)
      setAuthLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      const logged = Boolean(session)
      setAuthenticated(logged)
      if (event === 'PASSWORD_RECOVERY') {
        setLocked(false)
        setMode('setPassword')
        return
      }
      if (logged) setLocked(true)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (mode === 'home') return false
      if (mode === 'map') setMode(previousMode.current)
      else setMode('home')
      return true
    })
    return () => sub.remove()
  }, [mode])

  const title = useMemo(() => {
    if (mode === 'search') return 'Szukam przejazdu'
    if (mode === 'offer') return 'Mam wolne miejsca'
    if (mode === 'matches') return 'Pasażerowie po trasie'
    if (mode === 'map') return mapTarget === 'from' ? 'Wybierz punkt startu' : 'Wybierz cel'
    if (mode === 'payments') return 'Płatności'
    if (mode === 'setPassword') return 'Ustaw nowe hasło'
    return 'Samvei'
  }, [mode, mapTarget])

  const stripeKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || 'pk_test_placeholder'

  function compareVersions(a: string, b: string) {
    const aa = a.split('.').map((v) => Number(v) || 0)
    const bb = b.split('.').map((v) => Number(v) || 0)
    const len = Math.max(aa.length, bb.length)
    for (let i = 0; i < len; i++) {
      const av = aa[i] || 0
      const bv = bb[i] || 0
      if (av > bv) return 1
      if (av < bv) return -1
    }
    return 0
  }

  async function installAndroidUpdate() {
    if (Platform.OS !== 'android') return
    setUpdateInstalling(true)
    try {
      const target = FileSystem.cacheDirectory + 'Samvei-update.apk'
      try { await FileSystem.deleteAsync(target, { idempotent: true }) } catch {}
      const result = await FileSystem.downloadAsync(ANDROID_APK_URL, target)
      if (result.status < 200 || result.status >= 300) throw new Error('Nie udało się pobrać aktualizacji.')
      const contentUri = await FileSystem.getContentUriAsync(target)
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1,
        type: 'application/vnd.android.package-archive',
      })
    } catch (e: any) {
      Alert.alert('Aktualizacja', e?.message || 'Nie udało się uruchomić instalatora aktualizacji.')
    } finally {
      setUpdateInstalling(false)
    }
  }

  async function checkForUpdates(showCurrent = true) {
    setUpdateChecking(true)
    try {
      const { data, error } = await supabase
        .from('app_release_config')
        .select('latest_app_version,min_supported_version,store_url,force_native_update,release_notes,release_date')
        .eq('platform', Platform.OS === 'ios' ? 'ios' : 'android')
        .eq('channel', 'production')
        .maybeSingle()

      if (error) throw error
      if (!data?.latest_app_version) {
        if (showCurrent) Alert.alert('Aktualizacje', `Masz Samvei ${APP_VERSION} (${APP_BUILD}). Brak informacji o nowszej wersji.`)
        return
      }

      const newer = compareVersions(data.latest_app_version, APP_VERSION) > 0
      if (!newer) {
        if (showCurrent) Alert.alert('Samvei jest aktualny', `Wersja ${APP_VERSION} (${APP_BUILD}) jest najnowsza.`)
        return
      }

      const notes = data.release_notes ? `\n\n${data.release_notes}` : ''
      const buttons: any[] = [{ text: data.force_native_update ? 'Zamknij' : 'Później', style: 'cancel' }]
      buttons.push({
        text: Platform.OS === 'android' ? 'Pobierz i zainstaluj' : 'Aktualizuj',
        onPress: () => {
          if (Platform.OS === 'android') installAndroidUpdate()
          else if (data.store_url) Linking.openURL(data.store_url).catch(() => Alert.alert('Aktualizacja', 'Nie udało się otworzyć linku aktualizacji.'))
        },
      })
      Alert.alert(
        data.force_native_update ? 'Wymagana aktualizacja' : 'Dostępna aktualizacja',
        `Dostępna wersja ${data.latest_app_version}. Masz ${APP_VERSION}.${notes}`,
        buttons,
      )
    } catch (e: any) {
      if (showCurrent) Alert.alert('Aktualizacje', e?.message || 'Nie udało się sprawdzić aktualizacji.')
    } finally {
      setUpdateChecking(false)
    }
  }

  function authMessage(message?: string) {
    const m = (message || '').toLowerCase()
    if (m.includes('invalid login credentials')) return 'Nieprawidłowy e-mail lub hasło. Jeśli konto już istnieje, użyj opcji „Nie pamiętam hasła”.'
    if (m.includes('email not confirmed')) return 'Adres e-mail nie został jeszcze potwierdzony. Sprawdź skrzynkę lub wyślij link potwierdzający ponownie.'
    if (m.includes('already registered') || m.includes('user already registered')) return 'Konto z tym adresem e-mail już istnieje. Zaloguj się albo użyj opcji odzyskiwania hasła.'
    if (m.includes('password')) return 'Hasło nie spełnia wymagań lub jest nieprawidłowe.'
    if (m.includes('rate limit')) return 'Za dużo prób. Odczekaj chwilę i spróbuj ponownie.'
    return message || 'Wystąpił błąd logowania.'
  }

  useEffect(() => {
    if (authLoading || updateCheckedOnce.current) return
    updateCheckedOnce.current = true
    checkForUpdates(false)
  }, [authLoading])

  async function signIn() {
    if (!email || password.length < 6) return Alert.alert('Sprawdź dane', 'Podaj e-mail i hasło min. 6 znaków.')
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) Alert.alert('Nie udało się zalogować', authMessage(error.message))
  }

  async function signUp() {
    if (!email || password.length < 6) return Alert.alert('Sprawdź dane', 'Podaj e-mail i hasło min. 6 znaków.')
    setBusy(true)
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
    setBusy(false)
    if (error) return Alert.alert('Nie udało się utworzyć konta', authMessage(error.message))

    const identities = data.user?.identities
    if (data.user && Array.isArray(identities) && identities.length === 0) {
      return Alert.alert(
        'Konto już istnieje',
        'Ten adres e-mail jest już zarejestrowany. Zaloguj się albo użyj opcji „Nie pamiętam hasła”.',
      )
    }

    if (data.session) {
      setAuthenticated(true)
      setLocked(false)
      return Alert.alert('Konto gotowe', 'Rejestracja zakończona. Jesteś zalogowany.')
    }

    Alert.alert(
      'Sprawdź e-mail',
      'Wysłaliśmy link potwierdzający. Po kliknięciu wróć do aplikacji i zaloguj się.',
    )
  }

  async function resendConfirmation() {
    if (!email) return Alert.alert('Podaj e-mail', 'Wpisz adres e-mail konta.')
    setBusy(true)
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() })
    setBusy(false)
    if (error) return Alert.alert('Nie udało się wysłać', authMessage(error.message))
    Alert.alert('Wysłano', 'Jeśli konto oczekuje na potwierdzenie, nowy link został wysłany na podany adres.')
  }

  async function resetPassword() {
    if (!email) return Alert.alert('Podaj e-mail', 'Wpisz adres e-mail, dla którego chcesz odzyskać hasło.')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: 'samvei://reset-password' })
    if (error) return Alert.alert('Błąd', authMessage(error.message))
    Alert.alert('Wysłano', 'Sprawdź skrzynkę e-mail. Jeśli konto istnieje, otrzymasz link do zmiany hasła.')
  }

  async function saveNewPassword() {
    if (newPassword.length < 8) return Alert.alert('Hasło', 'Nowe hasło musi mieć co najmniej 8 znaków.')
    if (newPassword !== confirmNewPassword) return Alert.alert('Hasło', 'Hasła nie są identyczne.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setBusy(false)
    if (error) return Alert.alert('Nie udało się zmienić hasła', authMessage(error.message))
    setNewPassword('')
    setConfirmNewPassword('')
    setMode('home')
    setLocked(false)
    Alert.alert('Hasło zmienione', 'Możesz korzystać z Samvei.')
  }

  async function signOut() {
    await supabase.auth.signOut()
    setAuthenticated(false)
    setLocked(false)
    setMode('home')
  }

  async function unlock() {
    const result = await unlockWithBiometrics()
    if (result.success) setLocked(false)
    else Alert.alert('Nie odblokowano', 'Użyj biometrii lub kodu urządzenia.')
  }

  async function pointName(lat: number, lng: number) {
    try {
      const rows = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng })
      const r = rows[0]
      if (!r) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
      return [r.name, r.street, r.city || r.district, r.region].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ')
    } catch {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
    }
  }

  async function useMyLocation(target: MapTarget) {
    const perm = await Location.requestForegroundPermissionsAsync()
    if (perm.status !== 'granted') return Alert.alert('Brak dostępu do GPS', 'Zezwól Samvei na dostęp do lokalizacji podczas używania aplikacji.')
    setBusy(true)
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      const lat = pos.coords.latitude
      const lng = pos.coords.longitude
      const name = await pointName(lat, lng)
      const p = { lat, lng, name }
      target === 'from' ? setFrom(p) : setTo(p)
    } catch (e: any) {
      Alert.alert('GPS', e?.message || 'Nie udało się pobrać lokalizacji.')
    } finally {
      setBusy(false)
    }
  }

  function openMap(target: MapTarget) {
    setMapTarget(target)
    setMapPoint(target === 'from' ? from : to)
    previousMode.current = mode
    setMode('map')
  }

  async function saveMapPoint() {
    if (!mapPoint) return Alert.alert('Wybierz punkt', 'Dotknij miejsca na mapie.')
    const name = await pointName(mapPoint.lat, mapPoint.lng)
    const p = { ...mapPoint, name }
    mapTarget === 'from' ? setFrom(p) : setTo(p)
    setMode(previousMode.current)
  }

  function parseDate() {
    const normalized = date.replace(' ', 'T')
    const d = new Date(normalized)
    if (Number.isNaN(d.getTime())) return null
    return d
  }

  async function savePassengerRequest() {
    if (!from || !to) return Alert.alert('Wybierz trasę', 'Ustaw punkt startu i cel przez GPS albo mapę.')
    const d = parseDate()
    if (!d) return Alert.alert('Data', 'Wpisz datę w formacie YYYY-MM-DD HH:mm.')
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) return Alert.alert('Zaloguj się')
    setBusy(true)
    const { error } = await supabase.from('ride_requests').insert({
      passenger_id: userData.user.id,
      origin_name: from.name,
      destination_name: to.name,
      origin_lat: from.lat,
      origin_lng: from.lng,
      destination_lat: to.lat,
      destination_lng: to.lng,
      desired_departure_at: d.toISOString(),
      seats_needed: Number(seats) || 1,
      status: 'pending',
    })
    setBusy(false)
    if (error) return Alert.alert('Błąd zapisu', error.message)
    Alert.alert('Zgłoszenie opublikowane', 'Kierowcy jadący podobną trasą mogą teraz znaleźć Twoje zgłoszenie.')
    setMode('home')
  }

  async function saveDriverRide() {
    if (!from || !to) return Alert.alert('Wybierz trasę', 'Ustaw punkt startu i cel przez GPS albo mapę.')
    const d = parseDate()
    if (!d) return Alert.alert('Data', 'Wpisz datę w formacie YYYY-MM-DD HH:mm.')
    const { data: userData } = await supabase.auth.getUser()
    if (!userData.user) return Alert.alert('Zaloguj się')
    setBusy(true)
    const { data: route, error } = await supabase.from('routes').insert({
      driver_id: userData.user.id,
      origin_name: from.name,
      destination_name: to.name,
      origin_lat: from.lat,
      origin_lng: from.lng,
      destination_lat: to.lat,
      destination_lng: to.lng,
      departure_at: d.toISOString(),
      seats_available: Number(seats) || 1,
      max_detour_m: Math.round((Number(maxDetour) || 15) * 1000),
      status: 'active',
      is_preplanned: true,
    }).select('id').single()
    if (error) {
      setBusy(false)
      return Alert.alert('Błąd zapisu', error.message)
    }
    await loadMatches(route.id)
    setBusy(false)
    setMode('matches')
  }

  async function loadMatches(_routeId?: string) {
    if (!from || !to) return
    const { data, error } = await supabase
      .from('ride_requests')
      .select('id,origin_name,destination_name,origin_lat,origin_lng,destination_lat,destination_lng,desired_departure_at,seats_needed,status')
      .eq('status', 'pending')
      .limit(50)
    if (error) return Alert.alert('Dopasowanie', error.message)
    const max = Number(maxDetour) || 15
    const list = (data || []).map((r: any) => ({
      id: r.id,
      from: r.origin_name,
      to: r.destination_name,
      seats: r.seats_needed,
      departure: new Date(r.desired_departure_at).toLocaleString(),
      detourKm: detourScoreKm(
        { lat: from.lat, lng: from.lng },
        { lat: to.lat, lng: to.lng },
        { lat: r.origin_lat, lng: r.origin_lng },
        { lat: r.destination_lat, lng: r.destination_lng },
      ),
    })).filter((r: Match) => r.detourKm <= max).sort((a: Match, b: Match) => a.detourKm - b.detourKm)
    setMatches(list)
  }

  function offerRide() {
    Alert.alert('Propozycja przejazdu', 'Dopasowanie działa na rzeczywistych współrzędnych. Kolejnym krokiem jest potwierdzenie pasażera i płatność za zaakceptowany przejazd.')
  }

  if (authLoading) {
    return <SafeAreaView style={styles.safe}><View style={styles.center}><Text style={styles.logo}>Samvei</Text><Text style={styles.subtitle}>Ładowanie bezpiecznej sesji…</Text></View></SafeAreaView>
  }

  if (!authenticated) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.authScreen} keyboardShouldPersistTaps="handled">
          <View style={styles.brandMark}><Text style={styles.brandS}>S</Text></View>
          <Text style={styles.logo}>Samvei</Text>
          <Text style={styles.subtitle}>Podwózki po Norwegii, Szwecji i Danii.</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="E-mail" placeholderTextColor="#6f7785" />
          <TextInput style={[styles.input,{marginTop:12}]} value={password} onChangeText={setPassword} secureTextEntry placeholder="Hasło" placeholderTextColor="#6f7785" />
          <TouchableOpacity style={[styles.primary, busy && styles.disabled]} onPress={signIn} disabled={busy}><Text style={styles.primaryText}>{busy ? 'Proszę czekać…' : 'Zaloguj się'}</Text></TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={signUp}><Text style={styles.secondaryText}>Utwórz konto</Text></TouchableOpacity>
          <TouchableOpacity onPress={resetPassword}><Text style={styles.link}>Nie pamiętam hasła</Text></TouchableOpacity>
          <TouchableOpacity onPress={resendConfirmation}><Text style={styles.linkSecondary}>Wyślij potwierdzenie ponownie (tylko dla nowego konta)</Text></TouchableOpacity>
          <Text style={styles.authHint}>Po zalogowaniu aplikację możesz odblokowywać odciskiem palca, Face ID lub kodem urządzenia.</Text>
        </ScrollView>
      </SafeAreaView>
    )
  }

  if (locked) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <View style={styles.center}>
          <View style={styles.brandMark}><Text style={styles.brandS}>S</Text></View>
          <Text style={styles.logo}>Samvei</Text>
          <Text style={styles.subtitle}>Konto jest zablokowane</Text>
          <TouchableOpacity style={styles.primaryWide} onPress={unlock}><Text style={styles.primaryText}>{biometrics ? 'Odblokuj biometrią' : 'Odblokuj urządzeniem'}</Text></TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <StripeProvider publishableKey={stripeKey} merchantIdentifier="merchant.no.samvei.scandinavia" urlScheme="samvei">
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        {mode === 'setPassword' ? (
          <ScrollView contentContainerStyle={styles.authScreen} keyboardShouldPersistTaps="handled">
            <View style={styles.brandMark}><Text style={styles.brandS}>S</Text></View>
            <Text style={styles.logo}>Nowe hasło</Text>
            <Text style={styles.subtitle}>Link odzyskiwania został potwierdzony. Ustaw nowe hasło do konta Samvei.</Text>
            <TextInput style={styles.input} value={newPassword} onChangeText={setNewPassword} secureTextEntry placeholder="Nowe hasło" placeholderTextColor="#6f7785" />
            <TextInput style={[styles.input,{marginTop:12}]} value={confirmNewPassword} onChangeText={setConfirmNewPassword} secureTextEntry placeholder="Powtórz nowe hasło" placeholderTextColor="#6f7785" />
            <TouchableOpacity style={[styles.primary,busy&&styles.disabled]} onPress={saveNewPassword} disabled={busy}>
              <Text style={styles.primaryText}>{busy ? 'Zapisywanie…' : 'Zapisz nowe hasło'}</Text>
            </TouchableOpacity>
          </ScrollView>
        ) : mode === 'map' ? (
          <MapPicker point={mapPoint} setPoint={setMapPoint} onCancel={() => setMode(previousMode.current)} onSave={saveMapPoint} title={title} />
        ) : (
          <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              {mode !== 'home' ? <TouchableOpacity style={styles.backButton} onPress={() => setMode('home')}><Text style={styles.back}>←</Text></TouchableOpacity> : <View style={{width:42}} />}
              <Text style={styles.title}>{title}</Text>
              <TouchableOpacity onPress={signOut}><Text style={styles.logout}>Wyjdź</Text></TouchableOpacity>
            </View>

            {mode === 'home' && <Home setMode={setMode} biometrics={biometrics} onCheckUpdates={() => checkForUpdates(true)} updateChecking={updateChecking} updateInstalling={updateInstalling} />}

            {(mode === 'search' || mode === 'offer') && (
              <View style={styles.form}>
                <LocationField label="Skąd" point={from} onGps={() => useMyLocation('from')} onMap={() => openMap('from')} />
                <LocationField label="Dokąd" point={to} onGps={() => useMyLocation('to')} onMap={() => openMap('to')} />
                <Field label="Data i godzina" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD HH:mm" />
                <Field label="Liczba osób / miejsc" value={seats} onChangeText={setSeats} keyboardType="numeric" />
                {mode === 'offer' && <Field label="Maksymalny objazd (km)" value={maxDetour} onChangeText={setMaxDetour} keyboardType="numeric" />}
                <TouchableOpacity style={[styles.primary, busy && styles.disabled]} onPress={mode === 'search' ? savePassengerRequest : saveDriverRide} disabled={busy}>
                  <Text style={styles.primaryText}>{busy ? 'Zapisywanie…' : mode === 'search' ? 'Zgłoś potrzebę przejazdu' : 'Opublikuj przejazd'}</Text>
                </TouchableOpacity>
              </View>
            )}

            {mode === 'matches' && (
              <>
                <Text style={styles.subtitle}>Pasażerowie, których start i cel pasują do Twojej trasy:</Text>
                {matches.length === 0 ? <View style={styles.empty}><Text style={styles.cardText}>Na razie nie ma pasujących zgłoszeń w ustawionym limicie objazdu.</Text></View> : matches.map((r) => (
                  <View key={r.id} style={styles.matchCard}>
                    <Text style={styles.cardTitle}>{r.from} → {r.to}</Text>
                    <Text style={styles.cardText}>{r.departure} · {r.seats} os.</Text>
                    <Text style={styles.detour}>Szacowany dodatkowy dystans: {r.detourKm.toFixed(1)} km</Text>
                    <TouchableOpacity style={styles.smallPrimary} onPress={offerRide}><Text style={styles.primaryText}>Mogę zabrać</Text></TouchableOpacity>
                  </View>
                ))}
              </>
            )}

            {mode === 'payments' && <Payments />}
          </ScrollView>
        )}
      </SafeAreaView>
    </StripeProvider>
  )
}

function Home({ setMode, biometrics, onCheckUpdates, updateChecking, updateInstalling }: {setMode:(m:Mode)=>void; biometrics:boolean; onCheckUpdates:()=>void; updateChecking:boolean; updateInstalling:boolean}) {
  return <>
    <Text style={styles.hero}>Podróżujesz po Skandynawii?</Text>
    <Text style={styles.subtitle}>Znajdź wolne miejsce albo zabierz pasażera po swojej trasie.</Text>
    <TouchableOpacity style={styles.primaryCard} onPress={() => setMode('search')}><Text style={styles.cardIcon}>⌕</Text><View style={{flex:1}}><Text style={styles.cardTitle}>Szukam przejazdu</Text><Text style={styles.cardText}>Zgłoś A → B. Użyj GPS lub wybierz dokładne punkty na mapie.</Text></View></TouchableOpacity>
    <TouchableOpacity style={styles.card} onPress={() => setMode('offer')}><Text style={styles.cardIcon}>🚗</Text><View style={{flex:1}}><Text style={styles.cardTitle}>Mam wolne miejsca</Text><Text style={styles.cardText}>Opublikuj trasę i znajdź pasażerów, których możesz zabrać po drodze.</Text></View></TouchableOpacity>
    <TouchableOpacity style={styles.card} onPress={() => setMode('payments')}><Text style={styles.cardIcon}>💳</Text><View style={{flex:1}}><Text style={styles.cardTitle}>Płatności</Text><Text style={styles.cardText}>Karta, Google Pay i Apple Pay — moduł płatności przygotowany dla rezerwacji.</Text></View></TouchableOpacity>
    <View style={styles.badgeRow}><Text style={styles.badge}>🇳🇴 Norwegia</Text><Text style={styles.badge}>🇸🇪 Szwecja</Text><Text style={styles.badge}>🇩🇰 Dania</Text></View>
    <View style={styles.securityBox}><Text style={styles.securityTitle}>🔐 Bezpieczny dostęp</Text><Text style={styles.cardText}>{biometrics ? 'Biometria jest dostępna na tym urządzeniu.' : 'Biometria pojawi się automatycznie na obsługiwanym urządzeniu.'}</Text></View>
    <TouchableOpacity style={styles.updateBox} onPress={onCheckUpdates} disabled={updateChecking}>
      <View style={{flex:1}}>
        <Text style={styles.updateTitle}>↻ Aktualizacje</Text>
        <Text style={styles.cardText}>{updateInstalling ? 'Pobieranie aktualizacji…' : updateChecking ? 'Sprawdzanie…' : 'Aktualizacje są sprawdzane automatycznie przy uruchomieniu.'}</Text>
      </View>
      <Text style={styles.versionChip}>v{APP_VERSION}</Text>
    </TouchableOpacity>
    <Text style={styles.versionFooter}>Samvei v{APP_VERSION} · build {APP_BUILD}</Text>
  </>
}

function Payments() {
  return <View style={styles.form}>
    <Text style={styles.sectionTitle}>Metody płatności</Text>
    <PaymentRow icon="💳" title="Karta" subtitle="Visa / Mastercard" />
    <PaymentRow icon="G" title="Google Pay" subtitle={Platform.OS === 'android' ? 'Obsługiwane na Androidzie' : 'Dostępne na urządzeniach Android'} />
    <PaymentRow icon="" title="Apple Pay" subtitle={Platform.OS === 'ios' ? 'Obsługiwane na iPhone' : 'Dostępne na iPhone'} />
    <View style={styles.infoBox}><Text style={styles.infoTitle}>Prowizja Samvei</Text><Text style={styles.cardText}>Warstwa PaymentSheet jest w aplikacji. Realne pobieranie pieniędzy wymaga produkcyjnego konta operatora płatności i jego kluczy serwerowych; tych sekretów nie zapisujemy w APK.</Text></View>
  </View>
}

function PaymentRow({icon,title,subtitle}:{icon:string;title:string;subtitle:string}) {
  return <View style={styles.paymentRow}><View style={styles.payIcon}><Text style={styles.payIconText}>{icon}</Text></View><View><Text style={styles.cardTitle}>{title}</Text><Text style={styles.cardText}>{subtitle}</Text></View></View>
}

function LocationField({label,point,onGps,onMap}:{label:string;point:Point|null;onGps:()=>void;onMap:()=>void}) {
  return <View style={{marginBottom:16}}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.locationBox}><Text numberOfLines={2} style={point ? styles.locationValue : styles.locationPlaceholder}>{point?.name || 'Nie wybrano punktu'}</Text></View>
    <View style={styles.locationActions}><TouchableOpacity style={styles.actionBtn} onPress={onGps}><Text style={styles.actionText}>◎ Moja pozycja</Text></TouchableOpacity><TouchableOpacity style={styles.actionBtn} onPress={onMap}><Text style={styles.actionText}>⌖ Wybierz z mapy</Text></TouchableOpacity></View>
  </View>
}

function Field(props:any) {
  const { label, ...inputProps } = props
  return <View style={{marginBottom:14}}><Text style={styles.label}>{label}</Text><TextInput style={styles.input} placeholderTextColor="#6f7785" {...inputProps} /></View>
}

function MapPicker({point,setPoint,onCancel,onSave,title}:{point:Point|null;setPoint:(p:Point)=>void;onCancel:()=>void;onSave:()=>void;title:string}) {
  const lat = point?.lat ?? 58.7642
  const lng = point?.lng ?? 5.8550
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/><style>html,body,#map{height:100%;margin:0;background:#091014}.leaflet-control-attribution{font-size:9px}</style></head><body><div id="map"></div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>const map=L.map('map').setView([${lat},${lng}],${point ? 14 : 8});L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);let marker=${point ? `L.marker([${lat},${lng}]).addTo(map)` : 'null'};map.on('click',e=>{if(marker) marker.setLatLng(e.latlng); else marker=L.marker(e.latlng).addTo(map);window.ReactNativeWebView.postMessage(JSON.stringify({lat:e.latlng.lat,lng:e.latlng.lng}));});</script></body></html>`
  return <View style={styles.mapScreen}>
    <View style={styles.mapHeader}><TouchableOpacity onPress={onCancel}><Text style={styles.back}>←</Text></TouchableOpacity><Text style={styles.title}>{title}</Text><View style={{width:36}} /></View>
    <WebView source={{html}} style={styles.map} javaScriptEnabled domStorageEnabled onMessage={(e)=>{try{const p=JSON.parse(e.nativeEvent.data);setPoint({lat:p.lat,lng:p.lng,name:`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`})}catch{}}} />
    <View style={styles.mapBottom}><Text style={styles.mapHint}>{point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : 'Dotknij miejsca na mapie'}</Text><TouchableOpacity style={[styles.primaryWide,!point&&styles.disabled]} onPress={onSave} disabled={!point}><Text style={styles.primaryText}>Użyj tego miejsca</Text></TouchableOpacity></View>
  </View>
}

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#071014'},page:{padding:20,paddingBottom:48},center:{flex:1,alignItems:'center',justifyContent:'center',padding:28},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:24,paddingTop:16},backButton:{width:48,height:48,alignItems:'flex-start',justifyContent:'center',paddingTop:5},back:{color:'#76f6be',fontSize:30,fontWeight:'600'},title:{color:'white',fontSize:20,fontWeight:'800'},logout:{color:'#8f9ca5',fontWeight:'700',fontSize:13},
  logo:{color:'white',fontWeight:'900',fontSize:38,marginBottom:6},brandMark:{width:74,height:74,borderRadius:22,backgroundColor:'#12362d',borderWidth:1,borderColor:'#2e8f70',alignItems:'center',justifyContent:'center',marginBottom:16},brandS:{color:'#76f6be',fontWeight:'900',fontSize:46},
  hero:{color:'white',fontSize:34,lineHeight:40,fontWeight:'900',marginBottom:10},subtitle:{color:'#aeb7c3',fontSize:16,lineHeight:23,marginBottom:22},
  primaryCard:{backgroundColor:'#12362d',borderColor:'#2e8f70',borderWidth:1,borderRadius:20,padding:18,flexDirection:'row',gap:14,marginBottom:14},card:{backgroundColor:'#121b21',borderColor:'#26333c',borderWidth:1,borderRadius:20,padding:18,flexDirection:'row',gap:14,marginBottom:14},cardIcon:{fontSize:29,color:'#76f6be',width:40,textAlign:'center'},cardTitle:{color:'white',fontSize:18,fontWeight:'800',marginBottom:5},cardText:{color:'#9eabb5',fontSize:14,lineHeight:20},
  badgeRow:{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:8,marginBottom:24},badge:{color:'#d8e0e6',backgroundColor:'#101820',borderRadius:999,paddingHorizontal:12,paddingVertical:8},securityBox:{backgroundColor:'#0e171c',borderRadius:16,padding:16},securityTitle:{color:'#76f6be',fontWeight:'800',marginBottom:7},
  form:{backgroundColor:'#0f171c',borderRadius:20,padding:18},label:{color:'#c6d0d8',fontWeight:'700',marginBottom:7},input:{color:'white',backgroundColor:'#182229',borderWidth:1,borderColor:'#2a3740',borderRadius:12,paddingHorizontal:14,paddingVertical:13,fontSize:16},
  primary:{backgroundColor:'#63e6ad',borderRadius:14,paddingVertical:15,alignItems:'center',marginTop:8},primaryWide:{backgroundColor:'#63e6ad',borderRadius:14,paddingVertical:15,alignItems:'center',width:'100%'},primaryText:{color:'#04110c',fontWeight:'900',fontSize:16},disabled:{opacity:.45},secondaryButton:{borderWidth:1,borderColor:'#3c4a53',borderRadius:14,paddingVertical:14,alignItems:'center',marginTop:10},secondaryText:{color:'#dce5ea',fontWeight:'800'},link:{color:'#76f6be',textAlign:'center',marginTop:18,fontWeight:'700'},linkSecondary:{color:'#8fa5b0',textAlign:'center',marginTop:12,fontWeight:'700',fontSize:13},
  authScreen:{flexGrow:1,justifyContent:'center',padding:28,alignItems:'stretch'},authHint:{color:'#72808a',lineHeight:19,fontSize:12,marginTop:18,textAlign:'center'},
  locationBox:{backgroundColor:'#182229',borderWidth:1,borderColor:'#2a3740',borderRadius:12,padding:13,minHeight:52,justifyContent:'center'},locationValue:{color:'white',fontSize:15},locationPlaceholder:{color:'#6f7785',fontSize:15},locationActions:{flexDirection:'row',gap:8,marginTop:8},actionBtn:{flex:1,borderWidth:1,borderColor:'#2e8f70',borderRadius:11,paddingVertical:10,alignItems:'center'},actionText:{color:'#76f6be',fontWeight:'800',fontSize:12},
  matchCard:{backgroundColor:'#121b21',borderRadius:18,padding:17,marginBottom:12,borderWidth:1,borderColor:'#26333c'},detour:{color:'#76f6be',fontWeight:'700',marginTop:9,marginBottom:12},smallPrimary:{backgroundColor:'#63e6ad',borderRadius:12,paddingVertical:12,alignItems:'center'},empty:{backgroundColor:'#121b21',borderRadius:18,padding:18},
  mapScreen:{flex:1,backgroundColor:'#071014'},mapHeader:{height:64,paddingHorizontal:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},map:{flex:1},mapBottom:{padding:16,backgroundColor:'#0f171c',gap:10},mapHint:{color:'#aeb7c3',textAlign:'center'},
  updateBox:{backgroundColor:'#101820',borderWidth:1,borderColor:'#26333c',borderRadius:16,padding:16,marginTop:12,flexDirection:'row',alignItems:'center',gap:12},updateTitle:{color:'#76f6be',fontWeight:'900',fontSize:16,marginBottom:5},versionChip:{color:'#071014',backgroundColor:'#63e6ad',fontWeight:'900',borderRadius:999,paddingHorizontal:10,paddingVertical:6,overflow:'hidden'},versionFooter:{color:'#65727b',fontSize:12,textAlign:'center',marginTop:18},
  sectionTitle:{color:'white',fontSize:21,fontWeight:'900',marginBottom:16},paymentRow:{flexDirection:'row',alignItems:'center',gap:14,paddingVertical:14,borderBottomWidth:1,borderBottomColor:'#26333c'},payIcon:{width:44,height:44,borderRadius:13,backgroundColor:'#182229',alignItems:'center',justifyContent:'center'},payIconText:{fontSize:20,color:'white',fontWeight:'900'},infoBox:{backgroundColor:'#12362d',borderRadius:16,padding:15,marginTop:18},infoTitle:{color:'#76f6be',fontWeight:'900',marginBottom:6},
})
