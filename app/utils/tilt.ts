/**
 * Phone tilt steering: support check and the permission request. The readings
 * themselves are handled in the game (engine/Input.ts).
 */

export type TiltPermission = 'unknown' | 'granted' | 'denied'

/** A touch device with an orientation sensor API: worth offering tilt steering. */
export function tiltSupported() {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window && navigator.maxTouchPoints > 0
}

/**
 * Ask for motion access where the browser requires it (iOS Safari 13+).
 * iOS only allows the prompt from a tap, so call this directly from a click
 * handler, before any `await`. Elsewhere there's nothing to ask: granted.
 */
export function requestTiltPermission(): Promise<TiltPermission> {
  const api = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> }
  if (typeof api?.requestPermission !== 'function') return Promise.resolve('granted')
  return api.requestPermission().catch(() => 'denied' as const)
}
