import * as THREE from 'three'
import { SPAWN, TANK } from '../constants'
import { createShadow, placeShadow } from '../tank/shadow'
import type { CoralBanks } from '../tank/CoralBanks'
import { forward, headingOf, right, toWorld, wrapAngle, type TankPoint } from '../tank/space'
import { HAZARDS, type Hazard, type HazardContext, type HazardDef } from './registry'

/** Seconds for a cleared hazard to shrink away. */
const VANISH = 0.3
/** How far behind the fish the chase camera sits (engine/CameraRig.ts). */
const CAMERA_BACK = 330
/** Homing swimmers stop turning once the fish is this close ahead, and commit to their line. */
const HOMING_COMMIT = 300

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

  /** `corals`: the permanent coral banks, which hazards never spawn on. */
  constructor(scene: THREE.Scene, private corals: CoralBanks) {
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
    }

    // Behind the camera means out of sight. Measured along the camera's own
    // heading, which lags the fish's mid-turn, so nothing vanishes in view.
    forward(ctx.viewYaw, fwd)
    this.live = this.live.filter((h) => {
      const dx = h.pos.x - ctx.fish.x
      const dz = h.pos.z - ctx.fish.z
      const reach = Math.max(h.half.a, h.half.z)
      const behind = dx * fwd.x + dz * fwd.z < -(CAMERA_BACK + SPAWN.despawnBehind + reach)
      const far = Math.hypot(dx, dz) > SPAWN.despawnFar
      const gone = behind || far || (h.vanishing !== undefined && h.vanishing <= 0)
      if (gone) this.remove(h)
      return !gone
    })
  }

  render(time: number) {
    for (const h of this.live) {
      toWorld(h.pos, h.frame.position)
      h.frame.rotation.y = h.heading
      h.def.animate?.(h, time)
      const k = h.vanishing !== undefined ? Math.max(0.001, h.vanishing / VANISH) : 1
      h.frame.scale.setScalar(k)
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
      if (h.vanishing !== undefined) return false
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
   * glass, the mound, the coral and other hazards. A few tries; false if there's no room.
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
      if (this.crowded(x, z, reach)) continue

      h.pos.x = x
      h.pos.z = z
      h.heading = wrapAngle(bearing)
      return true
    }
    return false
  }

  /** Too close to another hazard, or on the coral. */
  private crowded(x: number, z: number, reach: number) {
    return this.corals.near(x, z, reach + SPAWN.separation)
      || this.live.some(o => Math.hypot(o.pos.x - x, o.pos.z - z) < reach + Math.max(o.half.a, o.half.z) + SPAWN.separation)
  }

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
