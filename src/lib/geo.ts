export type Point = { lat: number; lng: number }

const toRad = (v: number) => (v * Math.PI) / 180

export function haversineKm(a: Point, b: Point) {
  const R = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function detourScoreKm(driverFrom: Point, driverTo: Point, pickup: Point, dropoff: Point) {
  const direct = haversineKm(driverFrom, driverTo)
  const withPassenger = haversineKm(driverFrom, pickup) + haversineKm(pickup, dropoff) + haversineKm(dropoff, driverTo)
  return Math.max(0, withPassenger - direct)
}
