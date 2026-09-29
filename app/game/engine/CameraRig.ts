import * as THREE from 'three'
import type { CameraPose } from '../tank/views'

/** Holds the camera at a pose, with a fading screen shake on top. */
export class CameraRig {
  private readonly position = new THREE.Vector3()
  private readonly quat = new THREE.Quaternion()
  private shakeLeft = 0
  private shakeTotal = 0
  private shakeAmount = 0
  private shakeTime = 0
  private readonly shakeRight = new THREE.Vector3()
  private readonly shakeUp = new THREE.Vector3()

  constructor(readonly camera: THREE.PerspectiveCamera, private fog: THREE.Fog, pose: CameraPose) {
    this.snap(pose)
  }

  /** Jump straight to a pose. */
  snap(pose: CameraPose) {
    this.position.set(...pose.eye)
    const m = new THREE.Matrix4().lookAt(this.position, new THREE.Vector3(...pose.target), new THREE.Vector3(...pose.up))
    this.quat.setFromRotationMatrix(m)
    this.camera.fov = pose.fov
    this.camera.updateProjectionMatrix()
    this.fog.near = pose.fogNear
    this.fog.far = pose.fogFar
    this.apply()
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

  private apply() {
    this.camera.position.copy(this.position)
    this.camera.quaternion.copy(this.quat)
  }
}
