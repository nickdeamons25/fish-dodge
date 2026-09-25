import type * as THREE from 'three'
import { flow } from '../tank/space'

/**
 * Facing helpers for swimming hazards. Every model faces +X; call one of these
 * each frame so it points the right way whichever way the current runs.
 */

/** Point a +X-facing model against the current, i.e. toward the player. */
export function faceUpstream(obj: THREE.Object3D) {
  obj.rotation.y = flow.value > 0 ? Math.PI : 0
}

/**
 * Point a +X-facing swimmer the way it actually travels over the seabed.
 * speedFactor > 1: it outruns the current, swimming at the player.
 * speedFactor < 1: it's slower than the scroll, so it's really swimming the
 * same way as the player (who overtakes it) — face that way, or it moonwalks.
 */
export function faceTravel(obj: THREE.Object3D, speedFactor: number) {
  if (speedFactor >= 1) faceUpstream(obj)
  else obj.rotation.y = flow.value > 0 ? 0 : Math.PI
}
