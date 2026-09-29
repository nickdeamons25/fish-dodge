import * as THREE from 'three'
import { FISH, TANK } from '../constants'
import type { Input } from '../engine/Input'
import { excludeFromDepth } from '../engine/RenderPipeline'
import { createShadow, placeShadow } from '../tank/shadow'
import { forward, toWorld, wrapAngle, type TankPoint } from '../tank/space'
import { buildFishModel, type SwimUniforms } from './fishModel'

/** Start of every run: mid-height, well off-centre, swimming across the tank past the mound. */
const HOME: TankPoint = { x: 0, y: TANK.height / 2, z: TANK.radius * 0.55 }
const HOME_HEADING = 0

/** Mouth: a slow "blub blub" — two openings over BLUB_SECONDS, every few seconds. */
const BLUB_SECONDS = 1.3
const BLUB_GAP = [3, 7] as const
const bubbleGeo = new THREE.SphereGeometry(1, 10, 8)
const clamp = THREE.MathUtils.clamp
/** How quickly a knockback dies away, units/s². */
const PUSH_DRAG = 700

/**
 * The player. Always swimming forward along its heading at the game's speed;
 * the player turns it (left/right) and moves it up and down. Simulated in
 * tank space with simple kinematics; the chase camera does the rest.
 */
export class Fish {
  readonly pos: TankPoint = { ...HOME }
  /** Facing across the floor, radians (see tank/space.ts `forward`). */
  heading = HOME_HEADING
  /** Current turn rate, radians/s; + = turning left. */
  turnRate = 0
  /** Vertical speed, and a knockback across the floor that dies away. */
  vy = 0
  readonly push = { x: 0, z: 0 }
  readonly half = FISH.half
  /** Placed in the world and turned to face the heading. */
  readonly mesh = new THREE.Group()
  /** The model itself; pitches, yaws and rolls locally inside `mesh`. */
  private body: THREE.Group
  private mouth: THREE.Mesh
  /** Drives the body/fin swimming wave in the model's shaders. */
  private swim: SwimUniforms
  private lastRenderTime = 0
  private nextBlub = 2
  private blubbedAt = -10
  private lastBlubTime = 0
  private bubbles: { mesh: THREE.Mesh, age: number }[] = []
  private shadow = createShadow(26)

  controllable = false
  dead = false
  private invulnerableUntil = 0
  private now = 0

  // Scratch objects, reused every frame.
  private readonly fwd = new THREE.Vector3()
  private readonly screen = new THREE.Vector3()

  constructor(scene: THREE.Scene) {
    const { group, mouth, uniforms } = buildFishModel()
    this.body = group
    this.mouth = mouth
    this.swim = uniforms
    this.mesh.add(group)
    scene.add(this.mesh, this.shadow)

    // A small pool of mouth bubbles, one puffed out per "blub".
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(bubbleGeo, new THREE.MeshStandardMaterial({
        color: 0xe6f7ff, transparent: true, opacity: 0, roughness: 0.1, depthWrite: false,
      }))
      mesh.visible = false
      excludeFromDepth(mesh)
      scene.add(mesh)
      this.bubbles.push({ mesh, age: Infinity })
    }
  }

  get isInvulnerable() {
    return this.now < this.invulnerableUntil
  }

  respawn() {
    Object.assign(this.pos, HOME)
    this.heading = HOME_HEADING
    this.turnRate = 0
    this.vy = 0
    this.push.x = this.push.z = 0
    this.dead = false
    this.invulnerableUntil = 0
    this.body.rotation.set(0, 0, 0)
  }

  /** Took a hit: blink, and get knocked back (along `dir` across the floor, default straight back). */
  hit(dir?: { x: number, z: number }) {
    this.invulnerableUntil = this.now + FISH.invulnerableMs / 1000
    const back = dir ?? { x: -forward(this.heading, this.fwd).x, z: -this.fwd.z }
    this.push.x = back.x * 220
    this.push.z = back.z * 220
  }

  /** Belly-up float to the surface. */
  die() {
    this.controllable = false
    this.dead = true
  }

  /** `speed`: how fast the fish is swimming forward, units/s. */
  update(dt: number, time: number, speed: number, input: Input, camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement) {
    this.now = time

    // Steering intent: turn (+ = left) and climb (+ = up), each -1..1.
    let turn = 0
    let climb = 0
    if (this.dead) {
      this.vy = 0
      this.pos.y = Math.min(TANK.height - this.half.y, this.pos.y + 110 * dt)
    }
    else if (this.controllable) {
      if (input.isDown('ArrowUp', 'KeyW')) climb += 1
      if (input.isDown('ArrowDown', 'KeyS')) climb -= 1
      if (input.isDown('ArrowLeft', 'KeyA')) turn += 1
      if (input.isDown('ArrowRight', 'KeyD')) turn -= 1

      // Touch / mouse: hold to steer toward the pointer, relative to where the
      // fish is on screen: sideways turns, up/down climbs.
      if (input.pointer.isDown && turn === 0 && climb === 0) {
        toWorld(this.pos, this.screen).project(camera)
        const fx = ((this.screen.x + 1) / 2) * canvas.clientWidth
        const fy = ((1 - this.screen.y) / 2) * canvas.clientHeight
        const dx = input.pointer.x - fx
        const dy = input.pointer.y - fy
        const dist = Math.hypot(dx, dy)
        if (dist > 8) {
          turn = -dx / dist
          climb = -dy / dist
        }
      }
    }
    else {
      // Attract mode (menu): a lazy circle, bobbing about mid-height.
      turn = 0.25
      const k = 1 - Math.exp(-1.5 * dt)
      this.pos.y += (HOME.y + Math.sin(time * 2.5) * 14 - this.pos.y) * k
    }

    // Turning eases in and out, so the fish (and the camera after it) swings round smoothly.
    this.turnRate += (turn * FISH.maxTurn - this.turnRate) * (1 - Math.exp(-FISH.turnResponse * dt))
    this.heading = wrapAngle(this.heading + this.turnRate * dt)

    if (this.controllable) {
      if (climb !== 0) this.vy += climb * FISH.accel * dt
      else this.vy -= Math.sign(this.vy) * Math.min(Math.abs(this.vy), FISH.drag * dt)
      this.vy = clamp(this.vy, -FISH.maxSpeed, FISH.maxSpeed)
      this.pos.y += this.vy * dt
      if (this.pos.y < this.half.y || this.pos.y > TANK.height - this.half.y) {
        this.pos.y = clamp(this.pos.y, this.half.y, TANK.height - this.half.y)
        this.vy = 0
      }
    }

    // Always swimming forward, plus whatever knockback is left.
    forward(this.heading, this.fwd)
    this.pos.x += (this.fwd.x * speed + this.push.x) * dt
    this.pos.z += (this.fwd.z * speed + this.push.z) * dt
    const push = Math.hypot(this.push.x, this.push.z)
    if (push > 0) {
      const k = Math.max(0, push - PUSH_DRAG * dt) / push
      this.push.x *= k
      this.push.z *= k
    }
  }

  render(time: number) {
    const dt = Math.max(0, Math.min(0.1, time - this.lastRenderTime))
    this.lastRenderTime = time
    this.animateSwim(dt)
    toWorld(this.pos, this.mesh.position)
    this.mesh.rotation.y = this.heading
    placeShadow(this.shadow, this.pos, this.heading)
    const m = this.body

    if (this.dead) {
      m.rotation.x = THREE.MathUtils.lerp(m.rotation.x, Math.PI, 0.05) // roll belly-up
      this.mesh.visible = true
      return
    }

    // Nose follows the climb; the body yaws a touch and banks into turns.
    m.rotation.z = clamp(this.vy * 0.0016, -0.45, 0.45)
    m.rotation.y = clamp(this.turnRate * 0.12, -0.3, 0.3)
    m.rotation.x = clamp(-this.turnRate * 0.28, -0.55, 0.55)
    this.blub(time)

    this.mesh.visible = !(this.isInvulnerable && Math.floor(time * 10) % 2 === 0)
  }

  /**
   * Swimming wave: always cruising forward, and beating harder and
   * faster the more the player is steering. Winds down to stillness on death.
   */
  private animateSwim(dt: number) {
    const effort = this.dead ? 0 : Math.min(1, (Math.abs(this.vy) + Math.abs(this.turnRate) * 140) / FISH.maxSpeed)
    const amp = this.dead ? 0 : 2.4 + effort * 2.6
    const freq = this.dead ? 1.5 : 7 + effort * 6
    this.swim.uSwim.value += (amp - this.swim.uSwim.value) * Math.min(1, dt * 4)
    this.swim.uPhase.value += freq * dt
  }

  /** Open and close the mouth slowly, twice, every few seconds; puff a bubble each time. */
  private blub(time: number) {
    // Game time, so bubbles freeze on pause and don't depend on frame rate.
    const dt = Math.max(0, time - this.lastBlubTime)
    this.lastBlubTime = time
    if (time >= this.nextBlub) {
      this.blubbedAt = time
      this.nextBlub = time + BLUB_SECONDS + BLUB_GAP[0] + Math.random() * (BLUB_GAP[1] - BLUB_GAP[0])
    }
    const t = time - this.blubbedAt
    const open = t >= 0 && t < BLUB_SECONDS ? Math.sin((Math.PI * t) / (BLUB_SECONDS / 2)) ** 2 : 0
    this.mouth.scale.y = 0.8 + open * 2.8

    // Release a bubble at the widest point of each opening.
    const half = BLUB_SECONDS / 2
    const prev = t - dt
    for (const peak of [half / 2, half * 1.5]) {
      if (prev < peak && t >= peak) this.releaseBubble()
    }
    for (const b of this.bubbles) {
      if (b.age === Infinity) continue
      b.age += dt
      const k = b.age / 1.4
      b.mesh.position.y += 55 * dt
      b.mesh.scale.setScalar(2 + k * 3)
      ;(b.mesh.material as THREE.MeshStandardMaterial).opacity = 0.75 * (1 - k)
      if (k >= 1) {
        b.age = Infinity
        b.mesh.visible = false
      }
    }
  }

  private releaseBubble() {
    const b = this.bubbles.find(x => x.age === Infinity)
    if (!b) return
    this.mouth.getWorldPosition(b.mesh.position)
    b.age = 0
    b.mesh.visible = true
  }
}
