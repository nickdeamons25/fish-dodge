import * as THREE from 'three'
import { TANK } from '../constants'

export interface TankPoint { a: number, y: number, z: number }

/** Tank space → Three.js world space. */
export function toWorld(p: TankPoint, out = new THREE.Vector3()) {
  return out.set(p.a, TANK.height - p.y, TANK.depth / 2 - p.z)
}

/** A world-space direction → the equivalent tank-space direction. */
export function dirToTank(v: THREE.Vector3): TankPoint {
  return { a: v.x, y: -v.y, z: -v.z }
}
