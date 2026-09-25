import * as THREE from 'three'
import type { GameStatus, GameStore } from '~/stores/game'
import { METRES_PER_LEVEL, PX_PER_METRE, SPEED, STORE_SYNC_MS, TURN } from './constants'
import type { CameraRig } from './engine/CameraRig'
import type { Input } from './engine/Input'
import { Fish } from './entities/Fish'
import { HazardField } from './hazards/HazardField'
import type { Hazard } from './hazards/registry'
import type { Tank } from './tank/Tank'
import { flow, toWorld } from './tank/space'
import { VIEWS, VIEW_IDS, poseFor, type ViewId } from './tank/views'

type TurnPhase = 'none' | 'warning' | 'flipping' | 'settling'
type Flow = 1 | -1

const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2

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
 * Gameplay: runs, scoring, hits and tank turns. Always ticking — on the menu
 * it plays an "attract mode" (slow scroll, no hazards).
 *
 * Every level-up turns the tank to a random new view: warn → camera move → settle.
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

  private view: ViewId = 'side-right'
  /** Settled direction of the current; `flow.value` animates between these. */
  private currentFlow: Flow = 1
  private turn: { phase: TurnPhase, t: number, to: ViewId, toFlow: Flow, swapped: boolean } = {
    phase: 'none', t: 0, to: 'side-right', toFlow: 1, swapped: false,
  }
  /**
   * Point the turn camera orbits. The fish's position is smoothed in tank space
   * (so steering doesn't jolt the camera) and only then mapped to the world, so
   * the U-turn's swim across the screen is followed exactly, with no lag.
   */
  private readonly focus = new THREE.Vector3()
  /** Eased 0..1: scenery turns to face the rear camera while in rear view. */
  private rearFacing = 0
  private readonly focusTank = { a: 0, y: 0, z: 0 }

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
        if (this.turn.phase === 'warning') this.cancelTurn()
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
    this.turn.phase = 'none'
    this.currentFlow = 1
    flow.value = 1
    this.rearFacing = 0
    this.setView('side-right')
    this.d.rig.snap(poseFor(VIEWS['side-right'], 1))
    this.field.clear()
    this.fish.respawn()
  }

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------
  frame(dt: number) {
    const { store, rig } = this.d
    if (store.status !== 'paused') this.update(dt)
    rig.update(store.status === 'paused' ? 0 : dt)
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
      if (level > this.level && this.turn.phase === 'none') this.beginTurn()
      this.level = level
      this.speed = Math.min(SPEED.max, SPEED.start + metres * SPEED.rampPerMetre)

      this.sinceSync += dt * 1000
      if (this.sinceSync >= STORE_SYNC_MS) {
        this.sinceSync = 0
        store.syncRun({ distance: metres, score: Math.floor(metres), level: this.level, speed: Math.round(this.speed) })
      }
    }
    else if (store.status === 'gameover') {
      this.speed = Math.max(0, this.speed - 400 * dt) // coast to a stop after dying
    }
    else {
      this.speed = SPEED.idle
    }

    this.updateTurn(dt)

    const view = VIEWS[this.view]
    const spawning = this.running && this.turn.phase === 'none'
    this.rearFacing += ((this.view === 'rear' ? 1 : 0) - this.rearFacing) * Math.min(1, dt * 2.5)
    this.d.tank.update(dt, this.speed * flow.value, this.rearFacing)
    this.fish.update(dt, this.time, view, this.d.input, this.d.camera, this.d.canvas)
    this.field.update(dt, this.time, this.hazardContext(), view, spawning, this.fish.pos)

    if (this.running && this.turn.phase !== 'flipping' && !this.fish.isInvulnerable) {
      const hit = this.field.hitTest(this.fish.pos, this.fish.half, view)
      if (hit) this.onHit(hit)
    }
  }

  private onHit(_hazard: Hazard) {
    this.d.rig.shake(0.3, 10)
    this.d.flash()

    const livesLeft = this.d.store.loseLife()
    if (livesLeft > 0) this.fish.hit()
    // At 0 lives the store flips to 'gameover' and onStatus handles the rest;
    // stop immediately rather than waiting for Vue's watcher to flush.
    else this.running = false
  }

  // ---------------------------------------------------------------------------
  // Tank turning
  // ---------------------------------------------------------------------------
  /** Start the warning for a turn. Public so the dev shortcut can force one. */
  beginTurn(forced?: ViewId) {
    if (!this.running || this.turn.phase !== 'none') return
    const options = VIEW_IDS.filter(v => v !== this.view)
    const to = forced && forced !== this.view ? forced : options[Math.floor(Math.random() * options.length)]!
    const toFlow = VIEWS[to].flow ?? this.currentFlow
    this.turn = { phase: 'warning', t: 0, to, toFlow, swapped: false }
    this.d.store.announceTurn(to)
  }

  /** Dev only: spawn a hazard by id (e.g. 'eel') regardless of rarity or view rules. */
  spawn(id: string) {
    return this.field.spawnById(id, this.hazardContext(), VIEWS[this.view], this.fish.pos)
  }

  private hazardContext() {
    return { speed: this.speed, level: this.level, rand: Math.random, fish: this.fish.pos, view: this.view }
  }

  private cancelTurn() {
    this.turn.phase = 'none'
    this.d.store.cancelTurn()
  }

  private updateTurn(dt: number) {
    const turn = this.turn
    if (turn.phase === 'none') return
    turn.t += dt

    if (turn.phase === 'warning' && turn.t >= TURN.warn) {
      turn.phase = 'flipping'
      turn.t = 0
      this.field.clear(true)
      // For a current reversal the camera pose doesn't change — it just leans in
      // to watch the fish turn around; the fish is the thing that turns.
      this.d.rig.moveTo(poseFor(VIEWS[turn.to], turn.toFlow))
      Object.assign(this.focusTank, this.fish.pos)
    }
    else if (turn.phase === 'flipping') {
      const p = Math.min(1, turn.t / TURN.flip)
      if (turn.toFlow !== this.currentFlow) {
        // The current slows, stops and runs the other way; the fish turns with it.
        flow.value = this.currentFlow + (turn.toFlow - this.currentFlow) * easeInOutSine(p)
      }
      const k = 1 - Math.exp(-4 * dt)
      const f = this.focusTank
      f.a += (this.fish.pos.a - f.a) * k
      f.y += (this.fish.pos.y - f.y) * k
      f.z += (this.fish.pos.z - f.z) * k
      this.d.rig.blend(p, toWorld(f, this.focus))
      // Swap gameplay rules (steering, collision, spawn lines) halfway round.
      if (p >= 0.5 && !turn.swapped) {
        turn.swapped = true
        this.setView(turn.to)
      }
      if (p >= 1) {
        flow.value = this.currentFlow = turn.toFlow
        turn.phase = 'settling'
        turn.t = 0
      }
    }
    else if (turn.phase === 'settling' && turn.t >= TURN.settle) {
      turn.phase = 'none'
    }
  }

  /**
   * Depth-of-field target: focus on the fish. Full strength in the side views
   * (hazards share the fish's plane, so only scenery softens) and during turns.
   * Light in top-down and rear, where hazards sit at other depths and must stay
   * sharp enough to read.
   */
  focusTarget(out: THREE.Vector3) {
    toWorld(this.fish.pos, out)
    const turning = this.turn.phase === 'flipping'
    const strength = turning ? 1 : this.view === 'rear' || this.view === 'top' ? 0.2 : 1
    return strength
  }

  private setView(id: ViewId) {
    this.view = id
    if (this.d.store.run.view !== id) this.d.store.completeTurn(id)
  }
}
