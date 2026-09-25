import * as THREE from 'three'
import { FLOW_PIVOT, TANK } from '../constants'

export interface TankPoint { a: number, y: number, z: number }

/**
 * Which way the current runs through the world: 1 = hazards drift right→left,
 * -1 = reversed. Animated through 0 during a U-turn, which squeezes everything
 * toward the pivot and out the other side — the fish swims across as it turns.
 */
export const flow = { value: 1 }

/** Tank space → Three.js world space. */
export function toWorld(p: TankPoint, out = new THREE.Vector3()) {
  return out.set(FLOW_PIVOT + flow.value * (p.a - FLOW_PIVOT), TANK.height - p.y, TANK.depth / 2 - p.z)
}

/** A world-space direction → the equivalent tank-space direction. */
export function dirToTank(v: THREE.Vector3): TankPoint {
  const s = flow.value < 0 ? -1 : 1
  return { a: v.x * s, y: -v.y, z: -v.z }
}
