import { FLOW_PIVOT, TANK } from '../constants'

export type ViewId = 'side-right' | 'side-left' | 'top' | 'rear'
export const VIEW_IDS: ViewId[] = ['side-right', 'side-left', 'top', 'rear']

type Vec3 = [number, number, number]

/** Where the camera sits for a view, in world space (see tank/space.ts). */
export interface CameraPose {
  eye: Vec3
  target: Vec3
  up: Vec3
  fov: number
  /** Fog range; long in the side views, short murk in the rear view. */
  fogNear: number
  fogFar: number
}

/**
 * A view is just a camera pose plus gameplay rules. The tank, fish and hazards
 * are the same 3D objects in every view; turning the tank moves the camera.
 *
 * Deliberately free of three.js imports so Vue components can read labels.
 */
export interface View {
  id: ViewId
  label: string
  /** One-line controls reminder shown with the turn warning. */
  hint: string
  camera: CameraPose
  /** Tank axes the player can steer along. The other is locked. */
  steer: { a: boolean, y: boolean, z: boolean }
  /** Tank axes that count for collision; the axis you can't see never kills you. */
  collide: { a: boolean, y: boolean, z: boolean }
  /**
   * Current direction this view forces (side views), or undefined to keep
   * whatever it is (top-down and rear follow the fish either way).
   */
  flow?: 1 | -1
  /** a at which new hazards appear, and below which they're gone. */
  spawnA: number
  despawnA: number
}

const H = TANK.height
/** Screen centre along the current in side/top views; puts a = 0 near the left edge. */
const CENTRE_A = FLOW_PIVOT
/** Camera distance that frames the water column at the fish's plane with a 30° fov. */
const SIDE_DIST = 1008

const sideRight: View = {
  id: 'side-right',
  label: 'Side view',
  hint: 'Swim right · ↑↓ height · ←→ speed',
  camera: {
    eye: [CENTRE_A, H / 2, SIDE_DIST],
    target: [CENTRE_A, H / 2, 0],
    up: [0, 1, 0],
    fov: 30,
    fogNear: 2000,
    fogFar: 4000,
  },
  steer: { a: true, y: true, z: false },
  collide: { a: true, y: true, z: false },
  flow: 1,
  spawnA: 1000,
  despawnA: -450,
}

/** Same camera — the current reverses and the fish turns around instead. */
const sideLeft: View = {
  ...sideRight,
  id: 'side-left',
  label: 'Current reversed',
  hint: 'Now swim left · ← is forward',
  flow: -1,
}

/** Looking down through the surface; screen-up is the back glass. */
const top: View = {
  id: 'top',
  label: 'Top-down',
  hint: '↑↓ now crosses the tank',
  camera: {
    eye: [CENTRE_A, H / 2 + SIDE_DIST, 0],
    target: [CENTRE_A, H / 2, 0],
    up: [0, 0, -1],
    fov: 30,
    fogNear: 2000,
    fogFar: 4000,
  },
  steer: { a: true, y: false, z: true },
  collide: { a: true, y: false, z: true },
  spawnA: 1000,
  despawnA: -450,
}

/** Chase cam inside the tank, above and behind the fish, looking down the current. */
const rear: View = {
  id: 'rear',
  label: 'Rear view',
  hint: '←→ crosses the tank · ↑↓ height',
  camera: {
    eye: [-330, H * 0.8, 0],
    target: [500, H * 0.42, 0],
    up: [0, 1, 0],
    fov: 62,
    fogNear: 500,
    fogFar: 1700,
  },
  steer: { a: false, y: true, z: true },
  collide: { a: true, y: true, z: true },
  spawnA: 1500,
  despawnA: -300,
}

/**
 * The camera pose for a view under a given current. Reversed, the pose is
 * mirrored across FLOW_PIVOT so the rear cam still chases the fish from behind
 * and top-down still shows it heading the way it swims.
 */
export function poseFor(view: View, flow: 1 | -1): CameraPose {
  if (flow > 0) return view.camera
  const m = (v: Vec3): Vec3 => [2 * FLOW_PIVOT - v[0], v[1], v[2]]
  return { ...view.camera, eye: m(view.camera.eye), target: m(view.camera.target) }
}

export const VIEWS: Record<ViewId, View> = {
  'side-right': sideRight,
  'side-left': sideLeft,
  top,
  rear,
}
