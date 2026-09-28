import * as LocalAuthentication from 'expo-local-authentication'

export async function biometricAvailable() {
  const hasHardware = await LocalAuthentication.hasHardwareAsync()
  const enrolled = await LocalAuthentication.isEnrolledAsync()
  return hasHardware && enrolled
}

export async function unlockWithBiometrics() {
  const available = await biometricAvailable()
  if (!available) return { success: false, reason: 'not_available' as const }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Odblokuj Samvei',
    cancelLabel: 'Anuluj',
    disableDeviceFallback: false,
    fallbackLabel: 'Użyj kodu urządzenia',
  })

  return result.success
    ? { success: true as const }
    : { success: false as const, reason: 'cancelled' as const }
}
