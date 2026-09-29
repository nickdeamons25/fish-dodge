/**
 * Phone tilt tuning, in degrees. Turn: tip the phone left or right (like a
 * steering wheel, or tipping it sideways when it's held flatter). Climb: tilt
 * the top edge away from you to rise and toward you to dive, like pushing a
 * joystick, measured from how the phone was held when the run started.
 */
const TILT = {
  turnDead: 3,
  turnFull: 25,
  /** Up/down is gentler: a wide dead zone, and a curve so small tilts do little. */
  climbDead: 8,
  climbFull: 30,
  climbCurve: 1.7,
  /**
   * Seconds for "level" to drift to however the phone is held now, so a hand
   * that slowly sags doesn't leave the fish diving. Only while the phone is
   * within `relevelWithin` degrees of level: a deliberate tilt is left alone,
   * however long it's held.
   */
  relevelSeconds: 6,
  relevelWithin: 12,
  /**
   * Holding a tilt builds up over time: seconds for turn and climb to grow to
   * what the tilt asks for, so a bigger move takes a longer tilt. Letting go
   * (or easing off) settles much faster, so stopping still feels immediate.
   */
  turnBuild: 0.6,
  climbBuild: 1.2,
  release: 0.15,
  /** Smoothing per reading (0..1): higher follows the hand faster, lower hides sensor jitter. */
  follow: 0.35,
  /** Readings older than this mean tilt has stopped (sensor off, tab hidden). */
  staleMs: 500,
}

const DEG = Math.PI / 180

/** Keyboard + pointer + tilt state, polled by the game each frame. */
export class Input {
  private down = new Set<string>()
  /** Pointer position in canvas CSS pixels, and whether it's held. */
  pointer = { x: 0, y: 0, isDown: false }
  /** Tilt steering, each -1..1: turn (+ = left) and climb (+ = up). Only used while `tiltActive`. */
  readonly tilt = { turn: 0, climb: 0 }
  /** Whether the player wants tilt steering (set per run from the store). */
  tiltEnabled = false
  /** Gravity in the screen's frame (x right, y up, z out of the screen), smoothed. */
  private gravity: { x: number, y: number, z: number } | null = null
  private neutralPitch: number | null = null
  private lastTilt = -Infinity
  private listeners: [EventTarget, string, EventListener][] = []

  constructor(private canvas: HTMLCanvasElement) {
    this.on(window, 'keydown', (e) => {
      const ke = e as KeyboardEvent
      if ((ke.target as HTMLElement)?.tagName === 'INPUT') return
      this.down.add(ke.code)
      if (ke.code.startsWith('Arrow')) ke.preventDefault()
    })
    this.on(window, 'keyup', e => this.down.delete((e as KeyboardEvent).code))
    this.on(window, 'blur', () => this.down.clear())

    const move = (e: Event) => {
      const pe = e as PointerEvent
      const r = this.canvas.getBoundingClientRect()
      this.pointer.x = pe.clientX - r.left
      this.pointer.y = pe.clientY - r.top
    }
    this.on(canvas, 'pointerdown', (e) => {
      move(e)
      this.pointer.isDown = true
      canvas.setPointerCapture((e as PointerEvent).pointerId)
    })
    this.on(canvas, 'pointermove', move)
    this.on(canvas, 'pointerup', () => (this.pointer.isDown = false))
    this.on(canvas, 'pointercancel', () => (this.pointer.isDown = false))

    this.on(window, 'deviceorientation', e => this.onOrientation(e as DeviceOrientationEvent))
    // Turning the phone round changes what "level" means.
    this.on(window, 'orientationchange', () => this.calibrateTilt())
  }

  isDown(...codes: string[]) {
    return codes.some(c => this.down.has(c))
  }

  /** Tilt steering is on and readings are coming in. */
  get tiltActive() {
    return this.tiltEnabled && performance.now() - this.lastTilt < TILT.staleMs
  }

  /** Take the phone's current pose as level for climbing (sideways tilt is always measured from upright). */
  calibrateTilt() {
    this.neutralPitch = null
    this.gravity = null
    this.tilt.turn = this.tilt.climb = 0
  }

  destroy() {
    for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn)
    this.listeners = []
  }

  private onOrientation(e: DeviceOrientationEvent) {
    if (e.beta === null || e.gamma === null) return // desktop browsers may fire once with no data
    // Gravity in the device's own frame, from its tilt angles (W3C: Z-X'-Y'' with
    // alpha, beta, gamma): x right, y toward the top edge, z out of the screen.
    const b = e.beta * DEG
    const c = e.gamma * DEG
    const dx = Math.sin(c) * Math.cos(b)
    const dy = -Math.sin(b)
    const dz = -Math.cos(c) * Math.cos(b)
    // Into the screen's frame, which turns with the phone in landscape.
    const a = screenAngle() * DEG
    const raw = { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a), z: dz }
    const g = this.gravity
    this.gravity = g
      ? { x: g.x + (raw.x - g.x) * TILT.follow, y: g.y + (raw.y - g.y) * TILT.follow, z: g.z + (raw.z - g.z) * TILT.follow }
      : raw
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.lastTilt) / 1000)
    this.lastTilt = now

    const grav = this.gravity
    // Sideways: how far gravity leans toward the screen's left or right edge.
    const side = Math.asin(Math.max(-1, Math.min(1, grav.x))) / DEG
    // Forward/back: the angle of gravity between "down the screen" and "into it".
    const pitch = Math.atan2(grav.z, -grav.y) / DEG
    this.neutralPitch ??= pitch
    if (Math.abs(pitch - this.neutralPitch) < TILT.relevelWithin) {
      this.neutralPitch += (pitch - this.neutralPitch) * Math.min(1, dt / TILT.relevelSeconds)
    }
    // Left edge down leans gravity toward -x: turn left.
    this.tilt.turn = build(this.tilt.turn, shape(-side, TILT.turnDead, TILT.turnFull), TILT.turnBuild, dt)
    // Top edge away from you lowers the pitch: swim up.
    this.tilt.climb = build(this.tilt.climb, shape(this.neutralPitch - pitch, TILT.climbDead, TILT.climbFull, TILT.climbCurve), TILT.climbBuild, dt)
  }

  private on(target: EventTarget, type: string, fn: EventListener) {
    target.addEventListener(type, fn)
    this.listeners.push([target, type, fn])
  }
}

/**
 * Ease `current` toward `target`: slowly (over `seconds`) while the tilt is
 * asking for more in the same direction, quickly when it eases off or flips.
 */
function build(current: number, target: number, seconds: number, dt: number) {
  const growing = Math.abs(target) > Math.abs(current) && Math.sign(target) !== -Math.sign(current)
  return current + (target - current) * (1 - Math.exp(-dt / (growing ? seconds : TILT.release)))
}

/** Degrees → -1..1, with a dead zone round zero, full strength past `full`, and an optional ease-in curve. */
function shape(deg: number, dead: number, full: number, curve = 1) {
  const k = Math.max(0, Math.min(1, (Math.abs(deg) - dead) / (full - dead)))
  return Math.sign(deg) * k ** curve
}

/** How far the screen is turned from the device's natural (portrait) orientation, degrees. */
function screenAngle() {
  const legacy = (window as { orientation?: number }).orientation
  return screen.orientation?.angle ?? legacy ?? 0
}
