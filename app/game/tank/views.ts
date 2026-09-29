import { TANK } from '../constants'

type Vec3 = [number, number, number]

/** Where the camera sits, in world space (see tank/space.ts). */
export interface CameraPose {
  eye: Vec3
  target: Vec3
  up: Vec3
  fov: number
  /** Fog range: short murk ahead of the chase camera. */
  fogNear: number
  fogFar: number
}

/**
 * The one camera and its gameplay rules. The fish always swims forward, away
 * from the camera; hazards come from ahead.
 *
 * Deliberately free of three.js imports so Vue components can read it.
 */
export interface View {
  camera: CameraPose
  /** Tank axes the player can steer along. The other is locked. */
  steer: { a: boolean, y: boolean, z: boolean }
  /** a at which new hazards appear, and below which they're gone. */
  spawnA: number
  despawnA: number
}

const H = TANK.height

/** Chase cam inside the tank, above and behind the fish, looking down the current. */
export const REAR: View = {
  camera: {
    eye: [-330, H * 0.8, 0],
    target: [500, H * 0.42, 0],
    up: [0, 1, 0],
    fov: 62,
    fogNear: 500,
    fogFar: 1700,
  },
  steer: { a: false, y: true, z: true },
  spawnA: 1500,
  despawnA: -300,
}
