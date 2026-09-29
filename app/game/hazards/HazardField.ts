import * as THREE from 'three'
import { SPAWN, TANK } from '../constants'
import { createShadow, placeShadow } from '../tank/shadow'
import { forward, headingOf, right, toWorld, wrapAngle, type TankPoint } from '../tank/space'
import { buildObstacle, contact, near, type SolidPart } from './obstacles'
import { HAZARDS, RISE_SOLID, rockGeos, type Hazard, type HazardContext, type HazardDef } from './registry'

/** Seconds for a cleared hazard to shrink away. */
const VANISH = 0.3
/** How far behind the fish the chase camera sits (engine/CameraRig.ts). */
const CAMERA_BACK = 330
/** Homing swimmers stop turning once the fish is this close ahead, and commit to their line. */
const HOMING_COMMIT = 300
/** Seconds for an obstacle to rise out of the sand, and to sink back. */
const RISE_SECONDS = 1.2
const SINK_SECONDS = 1.6

/**
 * The wall that goes up across the tank at each level-up (see `spawnGate`).
 * It stands for `lifetime` seconds, then sinks. The gap, when there is one,
 * is off to one side, so you have to swing out to it.
 */
export const GATE = {
  /** Tried nearest-first from the far end: as far ahead as fits in the tank. */
  distances: [1500, 1300, 1100, 900],
  thickness: 40,
  gap: 380,
  gapOffset: [650, 1050] as [number, number],
  lifetime: 14,
  /** Keep the wall's middle, and the gap, this far inside the glass. */
  glassClearance: 260,
  /** Clear water around a new wall: other hazards in it shrink away. */
  clearance: 90,
}

export type GateKind = 'gap-left' | 'gap-right' | 'closed'

/** What the fish hit when it met a solid obstacle, with the world direction to push it out along. */
export interface SolidHit { hazard: Hazard, nx: number, nz: number, depth: number }

const smoothstep = (x: number) => THREE.MathUtils.smoothstep(x, 0, 1)

interface Live extends Hazard {
  /** Turned to the hazard's heading and placed in the tank; holds the def's mesh. */
  frame: THREE.Group
  shadow: THREE.Mesh
  /** Seconds left in a vanish animation, if clearing. */
  vanishing?: number
}

const fwd = new THREE.Vector3()
const side = new THREE.Vector3()

/** Spawns, moves, draws and collides every hazard. */
export class HazardField {
  private live: Live[] = []
  private untilNext = 0
  private clock = 0
  /** Field clock time each hazard id last spawned, for cooldowns. */
  private lastSpawn = new Map<string, number>()
  private readonly group = new THREE.Group()

  constructor(scene: THREE.Scene) {
    scene.add(this.group)
  }

  /** Remove everything; with `animate`, hazards shrink away instead of popping. */
  clear(animate = false) {
    if (animate) {
      for (const h of this.live) h.vanishing ??= VANISH
    }
    else {
      for (const h of this.live) this.remove(h)
      this.live = []
    }
    this.untilNext = 0.6
  }

  /** Hold off random spawns for a while (after a level-up wall goes up, so it reads clearly). */
  pause(seconds: number) {
    this.untilNext = Math.max(this.untilNext, seconds)
  }

  update(dt: number, time: number, ctx: HazardContext, spawning: boolean) {
    this.clock += dt
    if (spawning) {
      this.untilNext -= dt
      if (this.untilNext <= 0) {
        const interval = Math.max(SPAWN.minInterval, SPAWN.startInterval - (ctx.level - 1) * SPAWN.shrinkPerLevel)
        // No room (say, heading for the glass): try again shortly rather than
        // leave a gap once the fish turns back into open water.
        this.untilNext = this.spawn(ctx) ? interval * (0.75 + ctx.rand() * 0.5) : SPAWN.retry
      }
    }

    forward(ctx.heading, fwd)
    const fishFwd = { x: fwd.x, z: fwd.z }
    for (const h of this.live) {
      if (h.def.homing && h.vanishing === undefined) this.home(h, ctx, fishFwd, dt)
      // The tank stands still and the fish swims; a hazard's own motion is
      // whatever its speedFactor adds on top (see HazardDef).
      const v = (1 - h.def.speedFactor) * ctx.speed
      forward(h.heading, fwd)
      h.pos.x += fwd.x * v * dt
      h.pos.z += fwd.z * v * dt
      h.def.update?.(h, dt, time, ctx)
      if (h.vanishing !== undefined) h.vanishing -= dt
      if (h.rise !== undefined) this.riseOrSink(h, dt)
    }

    // Behind the camera means out of sight. Measured along the camera's own
    // heading, which lags the fish's mid-turn, so nothing vanishes in view.
    forward(ctx.viewYaw, fwd)
    this.live = this.live.filter((h) => {
      const dx = h.pos.x - ctx.fish.x
      const dz = h.pos.z - ctx.fish.z
      const reach = Math.max(h.half.a, h.half.z)
      const behind = dx * fwd.x + dz * fwd.z < -(CAMERA_BACK + SPAWN.despawnBehind + reach)
      const far = Math.hypot(dx, dz) > SPAWN.despawnFar + (h.solid ? reach : 0)
      // Temporary walls leave by sinking (riseOrSink), wherever the fish is.
      const timed = h.lifetime !== undefined
      const gone = (!timed && (behind || far))
        || (h.vanishing !== undefined && h.vanishing <= 0)
        || (timed && h.lifetime! <= 0 && h.rise! <= 0)
      if (gone) this.remove(h)
      return !gone
    })
  }

  /** Obstacles rise from the sand when they appear; temporary ones sink back when their time's up. */
  private riseOrSink(h: Live, dt: number) {
    if (h.lifetime !== undefined) h.lifetime -= dt
    if (h.lifetime !== undefined && h.lifetime <= 0) h.rise = Math.max(0, h.rise! - dt / SINK_SECONDS)
    else h.rise = Math.min(1, h.rise! + dt / RISE_SECONDS)
  }

  render(time: number) {
    for (const h of this.live) {
      toWorld(h.pos, h.frame.position)
      h.frame.rotation.y = h.heading
      h.def.animate?.(h, time)
      const k = h.vanishing !== undefined ? Math.max(0.001, h.vanishing / VANISH) : 1
      // Obstacles grow up out of the sand (their mesh stands on y = 0).
      h.frame.scale.set(k, k * (h.rise === undefined ? 1 : Math.max(0.001, smoothstep(h.rise))), k)
      if (h.solid) continue // walls and stacks meet the sand; no blob shadow
      // Hitboxes can change size (pufferfish, eels), so the shadow follows.
      h.shadow.userData.radius = Math.max(h.half.a, h.half.z) * 1.1
      placeShadow(h.shadow, h.pos, h.heading)
      h.shadow.scale.multiplyScalar(k)
    }
  }

  /**
   * First hazard overlapping the fish's box, tested in the hazard's frame. The
   * fish's box is turned into that frame too, as its extent along each axis.
   */
  hitTest(pos: TankPoint, half: { a: number, y: number, z: number }, heading: number): Hazard | undefined {
    return this.live.find((h) => {
      if (h.vanishing !== undefined || h.solid) return false
      forward(h.heading, fwd)
      right(h.heading, side)
      const dx = pos.x - h.pos.x
      const dz = pos.z - h.pos.z
      const c = Math.abs(Math.cos(heading - h.heading))
      const s = Math.abs(Math.sin(heading - h.heading))
      return Math.abs(dx * fwd.x + dz * fwd.z) < h.half.a + c * half.a + s * half.z
        && Math.abs(pos.y - h.pos.y) < h.half.y + half.y
        && Math.abs(dx * side.x + dz * side.z) < h.half.z + s * half.a + c * half.z
    })
  }

  /**
   * The deepest solid obstacle the fish's box is in, and which way (in the
   * tank) to push it back out. Obstacles still low in the sand don't count.
   */
  solidContact(pos: TankPoint, half: { a: number, z: number }, heading: number): SolidHit | undefined {
    let best: SolidHit | undefined
    for (const h of this.live) {
      if (!h.solid || h.vanishing !== undefined || (h.rise ?? 1) < RISE_SOLID) continue
      const { la, lz } = toLocal(h, pos.x, pos.z)
      const c = Math.abs(Math.cos(heading - h.heading))
      const s = Math.abs(Math.sin(heading - h.heading))
      const hit = contact(h.solid, la, lz, c * half.a + s * half.z, s * half.a + c * half.z)
      if (!hit || (best && hit.depth <= best.depth)) continue
      forward(h.heading, fwd)
      right(h.heading, side)
      best = { hazard: h, nx: fwd.x * hit.na + side.x * hit.nz, nz: fwd.z * hit.na + side.z * hit.nz, depth: hit.depth }
    }
    return best
  }

  /**
   * Put up the level-up wall: straight across the tank, glass to glass, as far
   * ahead in view as fits, with a gap off to one side or none at all. Clears
   * any hazards in its way. Returns false if there's no room yet (say, the fish
   * is heading for the glass).
   */
  spawnGate(ctx: HazardContext, kind: GateKind) {
    const bearing = ctx.viewYaw
    forward(bearing, fwd)
    right(bearing, side)
    for (const d of GATE.distances) {
      const cx = ctx.fish.x + fwd.x * d
      const cz = ctx.fish.z + fwd.z * d
      if (Math.hypot(cx, cz) > TANK.radius - GATE.glassClearance) continue
      // The chord through (cx, cz) across the fish's way: |c + side·t| = R.
      const cs = cx * side.x + cz * side.z
      const disc = cs * cs - (cx * cx + cz * cz - TANK.radius * TANK.radius)
      const t0 = -cs - Math.sqrt(disc) - 60 // a little way into the glass at both ends
      const t1 = -cs + Math.sqrt(disc) + 60
      let parts: SolidPart[]
      if (kind === 'closed') {
        parts = [{ kind: 'box', a: 0, z: (t0 + t1) / 2, ha: GATE.thickness, hz: (t1 - t0) / 2 }]
      }
      else {
        const off = (GATE.gapOffset[0] + ctx.rand() * (GATE.gapOffset[1] - GATE.gapOffset[0])) * (kind === 'gap-right' ? 1 : -1)
        // The gap must be inside the glass, or it isn't a way through.
        const g = THREE.MathUtils.clamp(off, t0 + GATE.glassClearance, t1 - GATE.glassClearance)
        if (Math.sign(g) !== Math.sign(off)) continue
        const w = GATE.gap / 2
        parts = [
          { kind: 'box', a: 0, z: (t0 + g - w) / 2, ha: GATE.thickness, hz: (g - w - t0) / 2 },
          { kind: 'box', a: 0, z: (g + w + t1) / 2, ha: GATE.thickness, hz: (t1 - g - w) / 2 },
        ]
      }
      const h = this.makeLive(GATE_DEF, ctx)
      h.pos.x = cx
      h.pos.z = cz
      h.heading = wrapAngle(bearing)
      h.half = { a: GATE.thickness, y: TANK.height / 2, z: Math.max(-t0, t1) }
      h.solid = parts
      h.rise = 0
      h.lifetime = GATE.lifetime
      h.data.seed = Math.floor(ctx.rand() * 1e6)
      this.add(h)
      this.clearAround(h)
      return true
    }
    return false
  }

  /** Shrink away every other hazard standing in (or right by) a new obstacle. */
  private clearAround(obstacle: Live) {
    for (const o of this.live) {
      if (o === obstacle || o.vanishing !== undefined) continue
      const { la, lz } = toLocal(obstacle, o.pos.x, o.pos.z)
      if (near(obstacle.solid!, la, lz, Math.max(o.half.a, o.half.z) + GATE.clearance)) o.vanishing = VANISH
    }
  }

  /**
   * Turn a swimmer toward the fish, a little at a time. Only while the fish is
   * still well ahead of it; close up it holds its line, so a late dodge works.
   */
  private home(h: Live, ctx: HazardContext, fishFwd: { x: number, z: number }, dt: number) {
    const dx = h.pos.x - ctx.fish.x
    const dz = h.pos.z - ctx.fish.z
    if (dx * fishFwd.x + dz * fishFwd.z < HOMING_COMMIT || Math.hypot(dx, dz) < HOMING_COMMIT) return
    // Its heading points from the fish to it; it swims back along that line.
    const want = headingOf(dx, dz)
    const step = h.def.homing! * dt
    h.heading = wrapAngle(h.heading + THREE.MathUtils.clamp(wrapAngle(want - h.heading), -step, step))
  }

  private remove(h: Live) {
    this.group.remove(h.frame, h.shadow)
    ;(h.shadow.material as THREE.Material).dispose() // each shadow owns its material for per-hazard opacity
    if (h.solid) (h.mesh as THREE.Mesh).geometry?.dispose() // obstacle meshes are built per instance
  }

  /** Spawn a specific hazard now, ignoring level and cooldown rules (dev/testing). */
  spawnById(id: string, ctx: HazardContext) {
    const def = HAZARDS.find(d => d.id === id)
    return !!def && this.spawn(ctx, def)
  }

  /** What may spawn right now: unlocked and off cooldown. */
  private eligible(ctx: HazardContext) {
    return HAZARDS.filter((d) => {
      if (d.minLevel > ctx.level) return false
      const last = this.lastSpawn.get(d.id)
      return !d.cooldown || last === undefined || this.clock - last >= d.cooldown
    })
  }

  /**
   * Spawn out ahead, in view: along the camera's heading, led a little into
   * any turn, somewhere within `SPAWN.lateral` of that line, clear of the
   * glass, the mound and other hazards. A few tries; false if there's no room.
   */
  private spawn(ctx: HazardContext, forced?: HazardDef) {
    const def = forced ?? weightedPick(this.eligible(ctx), ctx.rand)
    if (!def) return false
    const h = this.makeLive(def, ctx)
    def.setup(h, ctx)
    const reach = Math.max(h.half.a, h.half.z)
    if (!this.findSpot(h, reach, ctx)) return false
    this.lastSpawn.set(def.id, this.clock)
    this.add(h)
    if (h.solid) this.clearAround(h)
    return true
  }

  private makeLive(def: HazardDef, ctx: HazardContext): Live {
    return {
      def,
      pos: { x: 0, y: 0, z: 0 },
      heading: ctx.heading,
      half: { a: 20, y: 20, z: 20 },
      data: {},
      mesh: new THREE.Group(),
      frame: new THREE.Group(),
      shadow: createShadow(1),
    }
  }

  /** Build the mesh and put a placed hazard in the tank. */
  private add(h: Live) {
    h.mesh = h.def.build(h)
    h.frame.add(h.mesh)
    toWorld(h.pos, h.frame.position)
    h.frame.rotation.y = h.heading
    h.shadow.userData.radius = Math.max(h.half.a, h.half.z) * 1.1
    h.shadow.visible = !h.solid
    this.group.add(h.frame, h.shadow)
    this.live.push(h)
  }

  /** Place `h` somewhere valid ahead and face it along the line from the fish; false if nowhere fits. */
  private findSpot(h: Live, reach: number, ctx: HazardContext) {
    for (let i = 0; i < SPAWN.tries; i++) {
      // Past the spawn line by the hazard's own size so it never pops in on screen.
      const dist = SPAWN.aheadMin + ctx.rand() * (SPAWN.aheadMax - SPAWN.aheadMin) + reach
      // Aim where the player will be looking: the camera's heading (it lags the
      // fish's), plus where a turn is taking it. At full lock the fish circles
      // tightly and never gets far, so what counts is what comes into view.
      const lead = THREE.MathUtils.clamp(ctx.turnRate * SPAWN.leadSeconds, -SPAWN.maxLead, SPAWN.maxLead)
      const spread = (ctx.rand() * 2 - 1) * (SPAWN.lateral / dist)
      const bearing = ctx.viewYaw + lead + spread
      forward(bearing, fwd)
      const x = ctx.fish.x + fwd.x * dist
      const z = ctx.fish.z + fwd.z * dist

      const r = Math.hypot(x, z)
      if (r > TANK.radius - SPAWN.glassClearance - reach || r < TANK.mound.radius + reach + 40) continue
      // Obstacles are checked by their whole shape once placed, below.
      if ((!h.solid && this.crowded(x, z, reach)) || this.hidden(ctx.fish, x, z)) continue

      h.pos.x = x
      h.pos.z = z
      h.heading = wrapAngle(bearing)
      // An obstacle mustn't land on anything, even by its far end.
      if (h.solid && this.overlapsOthers(h)) continue
      return true
    }
    return false
  }

  /** Whether a placed obstacle's shape comes within spacing of any other hazard. */
  private overlapsOthers(obstacle: Live) {
    return this.live.some((o) => {
      if (o.solid) return Math.hypot(o.pos.x - obstacle.pos.x, o.pos.z - obstacle.pos.z) < Math.max(o.half.a, o.half.z) + Math.max(obstacle.half.a, obstacle.half.z) + SPAWN.separation
      const { la, lz } = toLocal(obstacle, o.pos.x, o.pos.z)
      return near(obstacle.solid!, la, lz, Math.max(o.half.a, o.half.z) + SPAWN.separation)
    })
  }

  /** Too close to another hazard (by its shape, for obstacles). */
  private crowded(x: number, z: number, reach: number) {
    return this.live.some((o) => {
      if (o.solid) {
        const { la, lz } = toLocal(o, x, z)
        return near(o.solid, la, lz, reach + SPAWN.separation)
      }
      return Math.hypot(o.pos.x - x, o.pos.z - z) < reach + Math.max(o.half.a, o.half.z) + SPAWN.separation
    })
  }

  /** Behind an obstacle as seen from the fish: pointless to spawn there, and you'd never see it. */
  private hidden(fish: TankPoint, x: number, z: number) {
    const solids = this.live.filter(o => o.solid && o.vanishing === undefined)
    if (!solids.length) return false
    const steps = Math.ceil(Math.hypot(x - fish.x, z - fish.z) / 80)
    for (let i = 1; i < steps; i++) {
      const px = fish.x + ((x - fish.x) * i) / steps
      const pz = fish.z + ((z - fish.z) * i) / steps
      for (const o of solids) {
        const { la, lz } = toLocal(o, px, pz)
        if (near(o.solid!, la, lz, 0)) return true
      }
    }
    return false
  }
}

/** A point in the tank → a hazard's own frame: along its heading (a), and across (z). */
function toLocal(h: Hazard, x: number, z: number) {
  const f = forward(h.heading, tmpF)
  const s = right(h.heading, tmpS)
  const dx = x - h.pos.x
  const dz = z - h.pos.z
  return { la: dx * f.x + dz * f.z, lz: dx * s.x + dz * s.z }
}
const tmpF = new THREE.Vector3()
const tmpS = new THREE.Vector3()

/** The level-up wall isn't in the random pool; it's put up by `spawnGate`. */
const GATE_DEF: HazardDef = {
  id: 'gate',
  minLevel: Infinity,
  weight: 0,
  speedFactor: 1,
  setup() {},
  build: h => buildObstacle(h.solid!, rockGeos, h.data.seed!),
}

function weightedPick(defs: HazardDef[], rand: () => number) {
  const total = defs.reduce((sum, d) => sum + d.weight, 0)
  let roll = rand() * total
  for (const d of defs) {
    roll -= d.weight
    if (roll <= 0) return d
  }
  return defs.at(-1)
}
