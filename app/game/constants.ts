/**
 * Tank space — every gameplay position lives here: a round aquarium, centred
 * on the origin.
 *   x, z: across the floor. The glass is at distance TANK.radius from the centre.
 *   y:    height above the sand, 0 = seabed, TANK.height = surface.
 *
 * Things also have a `heading`: the direction they face across the floor, in
 * radians (see tank/space.ts `forward`). Three.js world space maps from tank
 * space via `toWorld`, which for now is the identity.
 */
export const TANK = {
  radius: 3000,
  height: 456,
  /** Keep the fish's centre this far inside the glass. */
  glassMargin: 30,
  /** A low reef outcrop in the middle of the tank; it hurts like a hazard. */
  mound: { radius: 260, height: 130 },
}

/** World pixels per displayed metre. */
export const PX_PER_METRE = 12

export const SPEED = {
  /** Swimming speed on the menu screen, units/s. The fish always swims forward at the current speed. */
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
  /** Hazards appear this far ahead of the fish, up to `lateral` either side of its path. */
  ahead: 1500,
  lateral: 260,
  /** Never spawn a hazard closer than this to the glass. */
  glassClearance: 120,
  /** Gone once this far behind the fish, or this far away in any direction. */
  despawnBehind: 300,
  despawnFar: 2400,
}

export const FISH = {
  /** Up/down steering. */
  accel: 1900,
  drag: 1400,
  maxSpeed: 360,
  /** Fastest turn, radians/s, and how quickly the turn rate follows input, per second. */
  maxTurn: 2.1,
  turnResponse: 6,
  invulnerableMs: 1600,
  /** Half-extents of the fish hitbox, in its own frame: along its heading, height, across. */
  half: { a: 16, y: 13, z: 13 },
  /** Seconds of swimming before the glass at which the "glass ahead" warning shows. */
  glassWarnSeconds: 1.6,
}

/** How often the game pushes run stats into Pinia, in ms. */
export const STORE_SYNC_MS = 100

export const COLORS = {
  deepWater: 0x0a3a5e,
  glass: 0x9fd6ea,
}
