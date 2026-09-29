import type * as THREE from 'three'
import type { GameStatus, GameStore } from '~/stores/game'
import { METRES_PER_LEVEL, PX_PER_METRE, SPEED, STORE_SYNC_MS } from './constants'
import type { CameraRig } from './engine/CameraRig'
import type { Input } from './engine/Input'
import { Fish } from './entities/Fish'
import { HazardField } from './hazards/HazardField'
import type { Hazard } from './hazards/registry'
import type { Tank } from './tank/Tank'
import { toWorld } from './tank/space'
import { REAR } from './tank/views'

/** Depth-of-field strength: light, so hazards at other depths stay readable. */
const DOF_STRENGTH = 0.2

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
 * Gameplay: runs, scoring and hits, seen from the chase camera. Always
 * ticking — on the menu it plays an "attract mode" (slow scroll, no hazards).
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
    this.d.rig.snap(REAR.camera)
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
      this.level = 1 + Math.floor(metres / METRES_PER_LEVEL)
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

    this.d.tank.update(dt, this.speed)
    this.fish.update(dt, this.time, REAR, this.d.input, this.d.camera, this.d.canvas)
    this.field.update(dt, this.time, this.hazardContext(), REAR, this.running)

    if (this.running && !this.fish.isInvulnerable) {
      const hit = this.field.hitTest(this.fish.pos, this.fish.half)
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

  /** Dev only: spawn a hazard by id (e.g. 'eel') regardless of rarity. */
  spawn(id: string) {
    return this.field.spawnById(id, this.hazardContext(), REAR)
  }

  private hazardContext() {
    return { speed: this.speed, level: this.level, rand: Math.random, fish: this.fish.pos }
  }

  /** Depth-of-field target: focus on the fish. */
  focusTarget(out: THREE.Vector3) {
    toWorld(this.fish.pos, out)
    return DOF_STRENGTH
  }
}
