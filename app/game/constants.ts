/**
 * Tank space — every gameplay position lives here, independent of the camera.
 *   a: along the current. The fish sits near 0; hazards arrive from +a.
 *   y: height below the surface, 0 = surface, TANK.height = seabed.
 *   z: depth, 0 = front glass, TANK.depth = back glass.
 *
 * Three.js world space maps from it via `toWorld` (tank/space.ts):
 *   X = a, Y = height above the seabed, Z = +front / -back.
 */
export const TANK = {
  height: 456,
  depth: 456,
  /** Length of the physical tank box; the world scrolls through it. */
  minA: -1100,
  maxA: 1700,
  /** How far forward/back the fish may swim along the current. */
  fishAMin: -60,
  fishAMax: 420,
}

/** World pixels per displayed metre. */
export const PX_PER_METRE = 12

export const SPEED = {
  /** Scroll speed on the menu screen, units/s. */
  idle: 70,
  start: 240,
  max: 620,
  /** units/s gained per metre travelled. */
  rampPerMetre: 0.35,
}

/** Metres between difficulty levels. */
export const METRES_PER_LEVEL = 300

export const SPAWN = {
  /** Seconds between spawns at level 1, and the floor it shrinks to. */
  startInterval: 1.5,
  minInterval: 0.45,
  shrinkPerLevel: 0.12,
}

export const FISH = {
  accel: 1900,
  drag: 1400,
  maxSpeed: 360,
  invulnerableMs: 1600,
  /** Half-extents of the fish hitbox in tank units (a, y, z). */
  half: { a: 16, y: 13, z: 13 },
}

/** How often the game pushes run stats into Pinia, in ms. */
export const STORE_SYNC_MS = 100

export const COLORS = {
  room: 0x04182c,
  deepWater: 0x0a3a5e,
  sand: 0xc9a86a,
  glass: 0x9fd6ea,
}
