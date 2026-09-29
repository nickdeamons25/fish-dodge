import * as THREE from 'three'

/** A position in tank space (see constants.ts): x, z across the floor, y height above the sand. */
export interface TankPoint { x: number, y: number, z: number }

/** Tank space → Three.js world space. */
export function toWorld(p: TankPoint, out = new THREE.Vector3()) {
  return out.set(p.x, p.y, p.z)
}

/**
 * The unit direction across the floor for a heading. Heading 0 faces +X, and
 * it increases turning left (counterclockwise seen from above). Matches a
 * +X-facing model with `rotation.y = heading`.
 */
export function forward(heading: number, out = new THREE.Vector3()) {
  return out.set(Math.cos(heading), 0, -Math.sin(heading))
}

/** The unit direction to the right of a heading: screen-right for a camera looking along it. */
export function right(heading: number, out = new THREE.Vector3()) {
  return out.set(Math.sin(heading), 0, Math.cos(heading))
}

const TAU = Math.PI * 2

/** Wrap an angle into (-π, π]. */
export function wrapAngle(x: number) {
  return x - TAU * Math.floor((x + Math.PI) / TAU)
}

/** Heading of a direction across the floor. */
export function headingOf(dx: number, dz: number) {
  return Math.atan2(-dz, dx)
}

/** Distance from the tank's centre across the floor. */
export function fromCentre(p: TankPoint) {
  return Math.hypot(p.x, p.z)
}
