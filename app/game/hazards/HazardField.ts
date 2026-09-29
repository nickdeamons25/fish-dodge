import * as THREE from 'three'
import { SPAWN, TANK } from '../constants'
import { createShadow, placeShadow } from '../tank/shadow'
import { forward, fromCentre, right, toWorld, type TankPoint } from '../tank/space'
import { HAZARDS, type Hazard, type HazardContext, type HazardDef } from './registry'

/** Seconds for a cleared hazard to shrink away. */
const VANISH = 0.3

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

  update(dt: number, time: number, ctx: HazardContext, spawning: boolean) {
    this.clock += dt
    if (spawning) {
      this.untilNext -= dt
      if (this.untilNext <= 0) {
        this.spawn(ctx)
        const interval = Math.max(SPAWN.minInterval, SPAWN.startInterval - (ctx.level - 1) * SPAWN.shrinkPerLevel)
        this.untilNext = interval * (0.75 + ctx.rand() * 0.5)
      }
    }

    for (const h of this.live) {
      // The tank stands still and the fish swims; a hazard's own motion is
      // whatever its speedFactor adds on top (see HazardDef).
      const v = (1 - h.def.speedFactor) * ctx.speed
      forward(h.heading, fwd)
      h.pos.x += fwd.x * v * dt
      h.pos.z += fwd.z * v * dt
      h.def.update?.(h, dt, time, ctx)
      if (h.vanishing !== undefined) h.vanishing -= dt
    }

    forward(ctx.heading, fwd)
    this.live = this.live.filter((h) => {
      const dx = h.pos.x - ctx.fish.x
      const dz = h.pos.z - ctx.fish.z
      const behind = dx * fwd.x + dz * fwd.z < -(SPAWN.despawnBehind + h.half.a)
      const gone = behind || Math.hypot(dx, dz) > SPAWN.despawnFar || (h.vanishing !== undefined && h.vanishing <= 0)
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

  /** Spawn ahead of the fish, off to one side of its path; false if there's no room there. */
  private spawn(ctx: HazardContext, forced?: HazardDef) {
    const def = forced ?? weightedPick(this.eligible(ctx), ctx.rand)
    if (!def) return false

    const h: Live = {
      def,
      pos: { x: 0, y: 0, z: 0 },
      heading: ctx.heading,
      half: { a: 20, y: 20, z: 20 },
      data: {},
      mesh: new THREE.Group(),
      frame: new THREE.Group(),
      shadow: createShadow(1),
    }
    def.setup(h, ctx)
    // Past the spawn line by the hazard's own half-length so it never pops in on screen.
    const ahead = SPAWN.ahead + h.half.a
    const lateral = (ctx.rand() * 2 - 1) * SPAWN.lateral
    forward(ctx.heading, fwd)
    right(ctx.heading, side)
    h.pos.x = ctx.fish.x + fwd.x * ahead + side.x * lateral
    h.pos.z = ctx.fish.z + fwd.z * ahead + side.z * lateral
    // Only inside the glass, and clear of the mound in the middle.
    const r = fromCentre(h.pos)
    const reach = Math.max(h.half.a, h.half.z)
    if (r > TANK.radius - SPAWN.glassClearance - reach || r < TANK.mound.radius + reach + 40) return false

    this.lastSpawn.set(def.id, this.clock)
    h.mesh = def.build(h)
    h.frame.add(h.mesh)
    toWorld(h.pos, h.frame.position)
    h.frame.rotation.y = h.heading
    h.shadow.userData.radius = Math.max(h.half.a, h.half.z) * 1.1
    this.group.add(h.frame, h.shadow)
    this.live.push(h)
    return true
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
