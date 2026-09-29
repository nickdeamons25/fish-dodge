import * as THREE from 'three'
import { TANK } from '../constants'
import { forward, wrapAngle, type TankPoint } from '../tank/space'

const H = TANK.height

/**
 * Where the chase camera sits relative to the fish, in the camera's own frame:
 * `back` behind and `ahead` in front along its yaw, at fixed heights, so the
 * horizon stays put while the fish climbs and dives.
 */
const CHASE = {
  back: 330,
  eyeY: H * 0.8,
  ahead: 500,
  targetY: H * 0.42,
  fov: 62,
  /** Thick water: things fade from quite close, but the glass still looms out of it before you reach it. */
  fogNear: 250,
  fogFar: 1800,
  /** How quickly the camera's yaw catches up with the fish's heading, per second. The lag is what lets you see yourself turn. */
  yawRate: 3,
  /** Keep the camera this far inside the glass. */
  glassMargin: 40,
}

/**
 * A level chase camera behind the fish. It follows the fish's position
 * exactly and eases its yaw after the fish's heading, so turning swings the
 * whole tank round the fish. Plus a fading screen shake on hits.
 */
export class CameraRig {
  /** The camera's heading (tank/space.ts), easing after the fish's. */
  yaw = 0
  private shakeLeft = 0
  private shakeTotal = 0
  private shakeAmount = 0
  private shakeTime = 0
  private readonly fwd = new THREE.Vector3()
  private readonly target = new THREE.Vector3()
  private readonly shakeRight = new THREE.Vector3()
  private readonly shakeUp = new THREE.Vector3()

  constructor(readonly camera: THREE.PerspectiveCamera, fog: THREE.Fog) {
    camera.fov = CHASE.fov
    camera.updateProjectionMatrix()
    fog.near = CHASE.fogNear
    fog.far = CHASE.fogFar
  }

  /** Jump straight behind a fish. */
  snap(fish: TankPoint, heading: number) {
    this.yaw = heading
    this.place(fish)
  }

  /** A short wobble that fades out; `amount` is peak offset in world units. */
  shake(seconds: number, amount: number) {
    this.shakeLeft = this.shakeTotal = seconds
    this.shakeAmount = amount
  }

  update(dt: number, fish: TankPoint, heading: number) {
    // Always the short way round, however many turns the fish has made.
    this.yaw += wrapAngle(heading - this.yaw) * (1 - Math.exp(-CHASE.yawRate * dt))
    this.place(fish)
    if (this.shakeLeft > 0) {
      this.shakeLeft -= dt
      this.shakeTime += dt
      // Smooth sum-of-sines instead of per-frame random jitter, in the camera's
      // own screen plane.
      const fade = Math.max(0, this.shakeLeft / this.shakeTotal) ** 2
      const s = this.shakeAmount * fade
      const t = this.shakeTime
      this.shakeRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion)
      this.shakeUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion)
      this.camera.position
        .addScaledVector(this.shakeRight, s * (Math.sin(t * 47) + Math.sin(t * 29)) / 2)
        .addScaledVector(this.shakeUp, s * (Math.sin(t * 41 + 1) + Math.sin(t * 23 + 2)) / 2)
    }
  }

  private place(fish: TankPoint) {
    forward(this.yaw, this.fwd)
    // Pull in along the line to the fish rather than leave the tank, so a fish
    // swimming away from the glass never shows the camera outside it.
    const limit = TANK.radius - CHASE.glassMargin
    let back = CHASE.back
    const ex = fish.x - this.fwd.x * back
    const ez = fish.z - this.fwd.z * back
    if (Math.hypot(ex, ez) > limit) back = Math.max(20, backInside(fish, this.fwd, limit))
    this.camera.position.set(fish.x - this.fwd.x * back, CHASE.eyeY, fish.z - this.fwd.z * back)
    this.target.set(fish.x + this.fwd.x * CHASE.ahead, CHASE.targetY, fish.z + this.fwd.z * CHASE.ahead)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(this.target)
  }
}

/** Largest distance back from `p` along -`fwd` that stays within `limit` of the centre. */
function backInside(p: TankPoint, fwd: THREE.Vector3, limit: number) {
  // |p - t·fwd|² = limit²  →  t² − 2t(p·fwd) + |p|² − limit² = 0; take the positive root.
  const pf = p.x * fwd.x + p.z * fwd.z
  const c = p.x * p.x + p.z * p.z - limit * limit
  const disc = pf * pf - c
  return disc > 0 ? pf + Math.sqrt(disc) : 0
}
