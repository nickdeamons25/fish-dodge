import * as THREE from 'three'
import { TANK } from '../constants'
import type { CameraPose } from '../tank/views'

/** Camera distance from the fish at the peak of a zoomed turn. Inside the water from any angle. */
const ZOOM_DIST = 200
/** Keep a zoomed camera this far inside the glass, surface and seabed. */
const WALL_MARGIN = 14
const tankMin = new THREE.Vector3(TANK.minA, WALL_MARGIN, -TANK.depth / 2 + WALL_MARGIN)
const tankMax = new THREE.Vector3(TANK.maxA, TANK.height - WALL_MARGIN, TANK.depth / 2 - WALL_MARGIN)
/** Murk while zoomed in: the far tank fades to deep water instead of showing its ends. */
const ZOOM_FOG = { near: 260, far: 950 }

/**
 * A camera pose as an orbit: look-at target, orientation, and distance back
 * along the view direction. Slerping the orientation swings the camera around
 * the tank instead of cutting through it.
 */
interface Orbit {
  target: THREE.Vector3
  quat: THREE.Quaternion
  dist: number
  fov: number
  fogNear: number
  fogFar: number
}

function toOrbit(p: CameraPose): Orbit {
  const eye = new THREE.Vector3(...p.eye)
  const target = new THREE.Vector3(...p.target)
  const m = new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(...p.up))
  return {
    target,
    quat: new THREE.Quaternion().setFromRotationMatrix(m),
    dist: eye.distanceTo(target),
    fov: p.fov,
    fogNear: p.fogNear,
    fogFar: p.fogFar,
  }
}

/** Gentle ease: peak turn speed is ~1.6× the average, vs ~3× for a cubic. */
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}
/**
 * How far a ray from `origin` (inside the tank) along unit `dir` travels before
 * leaving the tank box. Used to keep a zoomed camera behind the glass.
 */
function distToWall(origin: THREE.Vector3, dir: THREE.Vector3) {
  let t = Infinity
  for (const axis of ['x', 'y', 'z'] as const) {
    const d = dir[axis]
    if (Math.abs(d) < 1e-6) continue
    const wall = d > 0 ? tankMax[axis] : tankMin[axis]
    t = Math.min(t, (wall - origin[axis]) / d)
  }
  return Math.max(0, t)
}

/** Smooth minimum: like Math.min but without a corner, so the camera never jolts. */
function smin(a: number, b: number, k = 40) {
  const h = THREE.MathUtils.clamp(0.5 + (0.5 * (b - a)) / k, 0, 1)
  return b + (a - b) * h - k * h * (1 - h)
}

/** Fraction of a zoomed turn spent diving in (and, mirrored, coming back out). */
const ZOOM_RAMP = 0.25

export class CameraRig {
  private from: Orbit
  private to: Orbit
  private current: Orbit
  private shakeLeft = 0
  private shakeTotal = 0
  private shakeAmount = 0
  private shakeTime = 0
  private readonly shakeRight = new THREE.Vector3()
  private readonly shakeUp = new THREE.Vector3()
  private readonly back = new THREE.Vector3()
  private readonly dir = new THREE.Vector3()
  /** Whether the current move dives in on the fish, and how far in it is (0..1). */
  private zoomMove = false
  private zoomWeight = 0
  private zoomDist = ZOOM_DIST

  constructor(readonly camera: THREE.PerspectiveCamera, private fog: THREE.Fog, pose: CameraPose) {
    this.from = this.to = this.current = toOrbit(pose)
    this.apply()
  }

  /** Jump straight to a pose. */
  snap(pose: CameraPose) {
    this.zoomMove = false
    this.zoomWeight = 0
    this.from = this.to = toOrbit(pose)
    this.current = { ...this.to, target: this.to.target.clone(), quat: this.to.quat.clone() }
    this.apply()
  }

  /**
   * Begin moving toward a pose; drive it with `blend(t, focus)` from 0 to 1.
   * The camera dives in to `zoomDist` from the focus point (the fish), turns
   * around it inside the water, then eases back out to the new pose.
   */
  moveTo(pose: CameraPose, zoomDist = ZOOM_DIST) {
    this.from = { ...this.current, target: this.current.target.clone(), quat: this.current.quat.clone() }
    this.to = toOrbit(pose)
    this.zoomMove = true
    this.zoomDist = zoomDist
  }

  blend(t: number, focus?: THREE.Vector3) {
    t = THREE.MathUtils.clamp(t, 0, 1)
    const k = easeInOutSine(t)
    const c = this.current
    c.target.lerpVectors(this.from.target, this.to.target, k)
    c.quat.slerpQuaternions(this.from.quat, this.to.quat, k)
    c.dist = THREE.MathUtils.lerp(this.from.dist, this.to.dist, k)

    if (this.zoomMove && focus) {
      // Driven by raw time, not the eased turn: dive in over the first quarter,
      // hold while the rotation does its work, come out over the last quarter.
      // Smoothstep ramps start and end at zero speed, so there's no lurch.
      this.zoomWeight = smoothstep(0, ZOOM_RAMP, t) * (1 - smoothstep(1 - ZOOM_RAMP, 1, t))
      c.target.lerp(focus, this.zoomWeight)
      c.dist = THREE.MathUtils.lerp(c.dist, this.zoomDist, this.zoomWeight)
    }
    else {
      this.zoomWeight = 0
    }

    c.fov = THREE.MathUtils.lerp(this.from.fov, this.to.fov, k)
    c.fogNear = THREE.MathUtils.lerp(this.from.fogNear, this.to.fogNear, k)
    c.fogFar = THREE.MathUtils.lerp(this.from.fogFar, this.to.fogFar, k)
    if (this.zoomWeight > 0) {
      c.fogNear = THREE.MathUtils.lerp(c.fogNear, ZOOM_FOG.near, this.zoomWeight)
      c.fogFar = THREE.MathUtils.lerp(c.fogFar, ZOOM_FOG.far, this.zoomWeight)
    }
  }

  /** A short wobble that fades out; `amount` is peak offset in world units. */
  shake(seconds: number, amount: number) {
    this.shakeLeft = this.shakeTotal = seconds
    this.shakeAmount = amount
  }

  update(dt: number) {
    this.apply()
    if (this.shakeLeft > 0) {
      this.shakeLeft -= dt
      this.shakeTime += dt
      // Smooth sum-of-sines instead of per-frame random jitter, in the camera's
      // own screen plane so it reads the same from every view.
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

  private apply() {
    const c = this.current
    this.dir.set(0, 0, 1).applyQuaternion(c.quat)
    let dist = c.dist
    if (this.zoomWeight > 0) {
      // Keep the zoomed camera inside the glass by pulling it in *along its line
      // of sight* — never sideways — so the fish stays centred in frame.
      const inside = smin(dist, distToWall(c.target, this.dir))
      dist = THREE.MathUtils.lerp(dist, inside, this.zoomWeight)
    }
    this.back.copy(this.dir).multiplyScalar(dist)
    this.camera.position.copy(c.target).add(this.back)
    this.camera.quaternion.copy(c.quat)
    if (this.camera.fov !== c.fov) {
      this.camera.fov = c.fov
      this.camera.updateProjectionMatrix()
    }
    this.fog.near = c.fogNear
    this.fog.far = c.fogFar
  }
}
