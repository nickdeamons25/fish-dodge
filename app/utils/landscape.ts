/**
 * Phones play sideways. Where the browser allows it (Android Chrome), go
 * fullscreen and lock to landscape; iPhones can't do either from a web page,
 * so the app shows a "turn your phone" prompt in portrait instead (app.vue).
 */

/** A phone or tablet: a touch screen with no fine pointer. */
export function isTouchDevice() {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
}

/**
 * Go fullscreen and lock landscape. Call straight from a tap (browsers only
 * allow it then); failures are fine and silent — the prompt still covers it.
 */
export function enterLandscape() {
  if (!isTouchDevice()) return
  const el = document.documentElement
  const lock = () => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => {})
  if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).then(lock, () => {})
  else lock()
}
