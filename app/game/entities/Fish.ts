import * as THREE from 'three'
import { FISH, TANK } from '../constants'
import type { Input } from '../engine/Input'
import { excludeFromDepth } from '../engine/RenderPipeline'
import { createShadow, placeShadow } from '../tank/shadow'
import { dirToTank, toWorld, type TankPoint } from '../tank/space'
import type { View } from '../tank/views'
import { buildFishModel, type SwimUniforms } from './fishModel'

const HOME: TankPoint = { a: 0, y: TANK.height / 2, z: TANK.depth / 2 }

/** Mouth: a slow "blub blub" — two openings over BLUB_SECONDS, every few seconds. */
const BLUB_SECONDS = 1.3
const BLUB_GAP = [3, 7] as const
const bubbleGeo = new THREE.SphereGeometry(1, 10, 8)
const clamp = THREE.MathUtils.clamp

/**
 * The player. Simulated in tank space with simple kinematics; the mesh is
 * placed in the 3D tank and the camera does the rest.
 */
export class Fish {
  readonly pos: TankPoint = { ...HOME }
  readonly vel: TankPoint = { a: 0, y: 0, z: 0 }
  readonly half = FISH.half
  /** Placed in the world and turned to face the current's direction. */
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
  private readonly right = new THREE.Vector3()
  private readonly up = new THREE.Vector3()
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
    Object.assign(this.vel, { a: 0, y: 0, z: 0 })
    this.dead = false
    this.invulnerableUntil = 0
    this.body.rotation.set(0, 0, 0)
  }

  hit() {
    this.invulnerableUntil = this.now + FISH.invulnerableMs / 1000
    this.vel.a = -220
  }

  /** Belly-up float to the surface. */
  die() {
    this.controllable = false
    this.dead = true
  }

  update(dt: number, time: number, view: View, input: Input, camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement) {
    this.now = time
    if (this.dead) {
      this.pos.y = Math.max(this.half.y, this.pos.y - 110 * dt)
      return
    }

    // Steering intent in screen space: +x right, +y down.
    let sx = 0
    let sy = 0
    if (this.controllable) {
      if (input.isDown('ArrowUp', 'KeyW')) sy -= 1
      if (input.isDown('ArrowDown', 'KeyS')) sy += 1
      if (input.isDown('ArrowLeft', 'KeyA')) sx -= 1
      if (input.isDown('ArrowRight', 'KeyD')) sx += 1

      // Touch / mouse: hold to steer toward the pointer.
      if (input.pointer.isDown && sx === 0 && sy === 0) {
        toWorld(this.pos, this.screen).project(camera)
        const fx = ((this.screen.x + 1) / 2) * canvas.clientWidth
        const fy = ((1 - this.screen.y) / 2) * canvas.clientHeight
        const dx = input.pointer.x - fx
        const dy = input.pointer.y - fy
        const dist = Math.hypot(dx, dy)
        if (dist > 8) {
          sx = dx / dist
          sy = dy / dist
        }
      }
    }
    else {
      // Idle bob (menu / not under player control): drive position directly and
      // ease back home. Pushing acceleration with a sine drifts off over time.
      const k = 1 - Math.exp(-1.5 * dt)
      this.pos.a += (HOME.a - this.pos.a) * k
      this.pos.z += (HOME.z - this.pos.z) * k
      this.pos.y += (HOME.y + Math.sin(time * 2.5) * 14 - this.pos.y) * k
      this.vel.a = this.vel.y = this.vel.z = 0
      return
    }

    // Screen direction → world via the live camera basis → tank axes the view allows.
    // Because this reads the real camera, controls stay screen-relative.
    const acc = { a: 0, y: 0, z: 0 }
    const mag = Math.min(1, Math.hypot(sx, sy))
    if (mag > 0) {
      this.right.set(1, 0, 0).applyQuaternion(camera.quaternion)
      this.up.set(0, 1, 0).applyQuaternion(camera.quaternion)
      const world = this.right.multiplyScalar(sx).addScaledVector(this.up, -sy)
      const t = dirToTank(world)
      if (!view.steer.a) t.a = 0
      if (!view.steer.y) t.y = 0
      if (!view.steer.z) t.z = 0
      const len = Math.hypot(t.a, t.y, t.z)
      if (len > 1e-3) {
        acc.a = (t.a / len) * mag
        acc.y = (t.y / len) * mag
        acc.z = (t.z / len) * mag
      }
    }
    // When the along-current axis is locked, drift gently back home on it.
    if (!view.steer.a) acc.a = clamp(-this.pos.a / 60, -1, 1)

    this.integrate('a', acc.a, dt, TANK.fishAMin, TANK.fishAMax)
    this.integrate('y', acc.y, dt, this.half.y, TANK.height - this.half.y)
    this.integrate('z', acc.z, dt, this.half.z, TANK.depth - this.half.z)
  }

  render(time: number) {
    const dt = Math.max(0, Math.min(0.1, time - this.lastRenderTime))
    this.lastRenderTime = time
    this.animateSwim(dt)
    toWorld(this.pos, this.mesh.position)
    placeShadow(this.shadow, this.pos)
    const m = this.body

    if (this.dead) {
      m.rotation.x = THREE.MathUtils.lerp(m.rotation.x, Math.PI, 0.05) // roll belly-up
      this.mesh.visible = true
      return
    }

    // Nose follows velocity: pitch with height, yaw with depth.
    m.rotation.z = clamp(-this.vel.y * 0.0016, -0.45, 0.45)
    m.rotation.y = clamp(this.vel.z * 0.0016, -0.5, 0.5)
    m.rotation.x = clamp(this.vel.z * 0.0008, -0.3, 0.3)
    this.blub(time)

    this.mesh.visible = !(this.isInvulnerable && Math.floor(time * 10) % 2 === 0)
  }

  /**
   * Swimming wave: always cruising against the current, and beating harder and
   * faster the more the player is steering. Winds down to stillness on death.
   */
  private animateSwim(dt: number) {
    const effort = this.dead ? 0 : Math.min(1, Math.hypot(this.vel.a, this.vel.y, this.vel.z) / FISH.maxSpeed)
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

  private integrate(axis: keyof TankPoint, input: number, dt: number, min: number, max: number) {
    let v = this.vel[axis]
    if (input !== 0) v += input * FISH.accel * dt
    else v -= Math.sign(v) * Math.min(Math.abs(v), FISH.drag * dt)
    v = clamp(v, -FISH.maxSpeed, FISH.maxSpeed)

    let p = this.pos[axis] + v * dt
    if (p < min || p > max) {
      p = clamp(p, min, max)
      v = 0
    }
    this.pos[axis] = p
    this.vel[axis] = v
  }
}
