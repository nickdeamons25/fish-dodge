import type * as THREE from 'three'

/**
 * Facing helpers for swimming hazards. Every model faces +X; the current runs
 * toward -X (hazards drift at the player), so call one of these each frame.
 */

/** Point a +X-facing model against the current, i.e. toward the player. */
export function faceUpstream(obj: THREE.Object3D) {
  obj.rotation.y = Math.PI
}

/**
 * Point a +X-facing swimmer the way it actually travels over the seabed.
 * speedFactor > 1: it outruns the current, swimming at the player.
 * speedFactor < 1: it's slower than the scroll, so it's really swimming the
 * same way as the player (who overtakes it) — face that way, or it moonwalks.
 */
export function faceTravel(obj: THREE.Object3D, speedFactor: number) {
  if (speedFactor >= 1) faceUpstream(obj)
  else obj.rotation.y = 0
}
