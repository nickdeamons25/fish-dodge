import * as THREE from 'three'
import { TANK } from '../constants'
import { excludeFromDepth } from '../engine/RenderPipeline'
import { toWorld, type TankPoint } from './space'

const geo = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2)
const mat = new THREE.MeshBasicMaterial({ color: 0x06243a, transparent: true, opacity: 0.35, depthWrite: false })

/**
 * A soft blob shadow on the seabed. Cheap depth cue: it shows height in every
 * view and separates things from the sand in top-down.
 */
export function createShadow(radius: number) {
  const m = new THREE.Mesh(geo, mat.clone())
  m.userData.radius = radius
  m.renderOrder = 1
  excludeFromDepth(m)
  return m
}

/** Place the shadow under a tank point; it spreads and fades with height. */
export function placeShadow(shadow: THREE.Mesh, pos: TankPoint) {
  const height = 1 - pos.y / TANK.height // 0 at the seabed, 1 at the surface
  const r = (shadow.userData.radius as number) * (0.8 + height * 0.8)
  toWorld(pos, shadow.position).setY(2)
  shadow.scale.set(r, 1, r * 0.7)
  // Stronger than it looks: linear-space blending lightens dark overlays on bright sand.
  ;(shadow.material as THREE.MeshBasicMaterial).opacity = 0.58 * (1 - height * 0.55)
}
