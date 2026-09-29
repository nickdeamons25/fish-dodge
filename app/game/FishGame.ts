import * as THREE from 'three'
import type { GameStatus, GameStore, RunAlert } from '~/stores/game'
import { FISH, METRES_PER_LEVEL, PX_PER_METRE, SPEED, STORE_SYNC_MS, TANK } from './constants'
import type { CameraRig } from './engine/CameraRig'
import type { Input } from './engine/Input'
import { Fish } from './entities/Fish'
import { HazardField, type GateKind } from './hazards/HazardField'
import type { Hazard } from './hazards/registry'
import type { Tank } from './tank/Tank'
import { forward, fromCentre, headingOf, toWorld } from './tank/space'

/** Depth-of-field strength: light, so hazards at other depths stay readable. */
const DOF_STRENGTH = 0.2

/** The level-up wall: which kinds it can be (half the time a dead end), and what the banner says for each. */
const GATE_KINDS: GateKind[] = ['gap-left', 'gap-right', 'closed', 'closed']
const GATE_ALERTS: Record<GateKind, RunAlert> = {
  'gap-left': { title: 'Reef wall ahead!', hint: 'Gap on the left ←' },
  'gap-right': { title: 'Reef wall ahead!', hint: 'Gap on the right →' },
  'closed': { title: 'Dead end ahead!', hint: 'Turn right round ↺' },
}
/** How long the banner shows, and how long other hazards hold off, after a wall goes up. */
const ALERT_SECONDS = 3
const GATE_CALM = 3.5
/** Seconds after one level-up wall goes up before another can (it stands for 14 s; see HazardField GATE). */
const GATE_MIN_GAP = 16

export interface GameDeps {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  canvas: HTMLCanvasElement
  rig: CameraRig
  tank: Tank
  input: Input
  store: GameStore
  /** Red screen flash on a hit. */
  flash: () => void
}

/**
 * Gameplay: runs, scoring and hits, seen from the chase camera. The fish
 * swims round a giant round tank; the glass and the mound in the middle bump
 * it back and cost a life. Always ticking — on the menu it plays an "attract
 * mode" (a slow lazy circle, no hazards).
 */
export class FishGame {
  private fish: Fish
  private field: HazardField

  private running = false
  private speed = SPEED.idle
  private distancePx = 0
  private level = 1
  private sinceSync = 0
  private time = 0
  private glassAhead = false
  /** A level-up wall waiting for room to go up (see HazardField.spawnGate). */
  private gatePending: GateKind | null = null
  private lastGate = -Infinity
  /** The banner being shown, and for how much longer. */
  private alert: RunAlert | null = null
  private alertLeft = 0
  private readonly fwd = new THREE.Vector3()

  constructor(private d: GameDeps) {
    this.fish = new Fish(d.scene)
    this.field = new HazardField(d.scene)
    this.onStatus(d.store.status, 'menu')
  }

  // ---------------------------------------------------------------------------
  // Store → game
  // ---------------------------------------------------------------------------
  onStatus(status: GameStatus, prev: GameStatus) {
    switch (status) {
      case 'playing':
        if (prev !== 'paused') this.startRun()
        break
      case 'gameover':
        this.running = false
        this.fish.die()
        break
      case 'menu':
        this.resetWorld()
        this.fish.controllable = false
        this.running = false
        break
    }
  }

  private startRun() {
    this.resetWorld()
    this.fish.controllable = true
    this.distancePx = 0
    this.level = 1
    this.speed = SPEED.start
    this.running = true
  }

  private resetWorld() {
    this.gatePending = null
    this.lastGate = -Infinity
    this.alert = null
    this.alertLeft = 0
    this.field.clear()
    this.fish.respawn()
    this.d.rig.snap(this.fish.pos, this.fish.heading)
  }

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------
  frame(dt: number) {
    const { store, rig } = this.d
    if (store.status !== 'paused') this.update(dt)
    rig.update(store.status === 'paused' ? 0 : dt, this.fish.pos, this.fish.heading)
    this.fish.render(this.time)
    this.field.render(this.time)
  }

  private update(dt: number) {
    const { store } = this.d
    this.time += dt

    if (this.running) {
      this.distancePx += this.speed * dt
      const metres = this.distancePx / PX_PER_METRE
      const level = 1 + Math.floor(metres / METRES_PER_LEVEL)
      // A wall at each level-up — unless one went up only a moment ago. At top
      // speed levels come every few seconds, and walls would pile up.
      if (level > this.level && this.time - this.lastGate > GATE_MIN_GAP) {
        this.gatePending = GATE_KINDS[Math.floor(Math.random() * GATE_KINDS.length)]!
      }
      this.level = level
      this.speed = Math.min(SPEED.max, SPEED.start + metres * SPEED.rampPerMetre)

      this.sinceSync += dt * 1000
      if (this.sinceSync >= STORE_SYNC_MS) {
        this.sinceSync = 0
        store.syncRun({
          distance: metres,
          score: Math.floor(metres),
          level: this.level,
          speed: Math.round(this.speed),
          glassAhead: this.glassAhead,
          alert: this.alert,
        })
      }
    }
    else if (store.status === 'gameover') {
      this.speed = Math.max(0, this.speed - 400 * dt) // coast to a stop after dying
    }
    else {
      this.speed = SPEED.idle
    }

    this.fish.update(dt, this.time, this.speed, this.d.input, this.d.camera, this.d.canvas)
    this.d.tank.update(dt, this.fish.pos, this.d.rig.yaw)
    this.bumpGlass()
    this.bumpMound()
    this.bumpSolids()
    this.glassAhead = this.running && this.secondsToGlass() < FISH.glassWarnSeconds
    if (this.running && this.gatePending) this.raiseGate(this.gatePending)
    this.alertLeft -= dt
    if (this.alertLeft <= 0) this.alert = null
    this.field.update(dt, this.time, this.hazardContext(), this.running)

    if (this.running && !this.fish.isInvulnerable) {
      const hit = this.field.hitTest(this.fish.pos, this.fish.half, this.fish.heading)
      if (hit) this.onHit(hit)
    }
  }

  /** Seconds until the fish reaches the glass on its current heading. */
  private secondsToGlass() {
    const p = this.fish.pos
    const f = forward(this.fish.heading, this.fwd)
    const limit = TANK.radius - TANK.glassMargin
    // |p + t·f| = limit, forward root.
    const pf = p.x * f.x + p.z * f.z
    const t = -pf + Math.sqrt(Math.max(0, pf * pf - (p.x * p.x + p.z * p.z - limit * limit)))
    return t / Math.max(1, this.speed)
  }

  /** Put up the level-up wall once there's room ahead, and say what kind it is. */
  private raiseGate(kind: GateKind) {
    if (!this.field.spawnGate(this.hazardContext(), kind)) return // try again next frame
    this.gatePending = null
    this.lastGate = this.time
    this.field.pause(GATE_CALM)
    this.alert = GATE_ALERTS[kind]
    this.alertLeft = ALERT_SECONDS
  }

  /**
   * Keep the fish inside a circle of `limit` round the centre (or outside it,
   * for the mound): if it's crossed, put it back on the line and turn its
   * heading to glance off. Returns the push-back direction if it bumped.
   */
  private bounce(limit: number, inside: boolean) {
    const p = this.fish.pos
    const r = fromCentre(p)
    if (inside ? r <= limit : r >= limit) return undefined
    // Outward normal from the centre; "back" is the way the fish gets pushed.
    const nx = p.x / Math.max(1e-6, r)
    const nz = p.z / Math.max(1e-6, r)
    p.x = nx * limit
    p.z = nz * limit
    const back = inside ? { x: -nx, z: -nz } : { x: nx, z: nz }
    this.glance(back)
    return back
  }

  /** Mirror the heading off a surface facing `back`, like a ball off a cushion, if the fish is swimming into it. */
  private glance(back: { x: number, z: number }) {
    const f = forward(this.fish.heading, this.fwd)
    const into = -(f.x * back.x + f.z * back.z)
    if (into > 0) {
      this.fish.heading = headingOf(f.x + 2 * into * back.x, f.z + 2 * into * back.z)
      this.fish.turnRate = 0
    }
  }

  /** Big rocks and reef walls: never swum through, even while blinking. Out the way it came, and it hurts. */
  private bumpSolids() {
    const hit = this.field.solidContact(this.fish.pos, this.fish.half, this.fish.heading)
    if (!hit) return
    this.fish.pos.x += hit.nx * hit.depth
    this.fish.pos.z += hit.nz * hit.depth
    const back = { x: hit.nx, z: hit.nz }
    this.glance(back)
    this.onBump(back)
  }

  private bumpGlass() {
    const back = this.bounce(TANK.radius - TANK.glassMargin, true)
    if (back) this.onBump(back)
  }

  private bumpMound() {
    if (!this.d.tank.hitsMound(this.fish.pos, this.fish.half)) return
    const back = this.bounce(TANK.mound.radius * 0.85 + this.fish.half.a, false)
    if (back) this.onBump(back)
  }

  /** Swam into the glass, the mound or an obstacle: it hurts like a hazard, unless still blinking from the last hit. */
  private onBump(back: { x: number, z: number }) {
    if (this.running && !this.fish.isInvulnerable) this.onHit(undefined, back)
    else this.d.rig.shake(0.15, 4)
  }

  private onHit(_hazard?: Hazard, back?: { x: number, z: number }) {
    this.d.rig.shake(0.3, 10)
    this.d.flash()

    const livesLeft = this.d.store.loseLife()
    if (livesLeft > 0) this.fish.hit(back)
    // At 0 lives the store flips to 'gameover' and onStatus handles the rest;
    // stop immediately rather than waiting for Vue's watcher to flush.
    else this.running = false
  }

  /** Dev only: spawn a hazard by id (e.g. 'eel') regardless of rarity. */
  spawn(id: string) {
    return this.field.spawnById(id, this.hazardContext())
  }

  private hazardContext() {
    return {
      speed: this.speed,
      level: this.level,
      rand: Math.random,
      fish: this.fish.pos,
      heading: this.fish.heading,
      turnRate: this.fish.turnRate,
      viewYaw: this.d.rig.yaw,
    }
  }

  /** Depth-of-field target: focus on the fish. */
  focusTarget(out: THREE.Vector3) {
    toWorld(this.fish.pos, out)
    return DOF_STRENGTH
  }
}
