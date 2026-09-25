import * as THREE from 'three'
import { SPAWN } from '../constants'
import { createShadow, placeShadow } from '../tank/shadow'
import { toWorld, type TankPoint } from '../tank/space'
import type { View } from '../tank/views'
import { HAZARDS, type Hazard, type HazardContext, type HazardDef } from './registry'

/** Seconds for a cleared hazard to shrink away. */
const VANISH = 0.3

interface Live extends Hazard {
  shadow: THREE.Mesh
  /** Seconds left in a vanish animation, if clearing. */
  vanishing?: number
}

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

  update(dt: number, time: number, ctx: HazardContext, view: View, spawning: boolean, fish: TankPoint) {
    this.clock += dt
    if (spawning) {
      this.untilNext -= dt
      if (this.untilNext <= 0) {
        this.spawn(ctx, view, fish)
        const interval = Math.max(SPAWN.minInterval, SPAWN.startInterval - (ctx.level - 1) * SPAWN.shrinkPerLevel)
        this.untilNext = interval * (0.75 + ctx.rand() * 0.5)
      }
    }

    for (const h of this.live) {
      h.pos.a -= ctx.speed * h.def.speedFactor * dt
      h.def.update?.(h, dt, time, ctx)
      if (h.vanishing !== undefined) h.vanishing -= dt
    }

    this.live = this.live.filter((h) => {
      const gone = h.pos.a + h.half.a < view.despawnA || (h.vanishing !== undefined && h.vanishing <= 0)
      if (gone) this.remove(h)
      return !gone
    })
  }

  render(time: number) {
    for (const h of this.live) {
      toWorld(h.pos, h.mesh.position)
      h.def.animate?.(h, time)
      const k = h.vanishing !== undefined ? Math.max(0.001, h.vanishing / VANISH) : 1
      h.mesh.scale.setScalar(k)
      // Hitboxes can change size (pufferfish, eels), so the shadow follows.
      h.shadow.userData.radius = Math.max(h.half.a, h.half.z) * 1.1
      placeShadow(h.shadow, h.pos)
      h.shadow.scale.multiplyScalar(k)
    }
  }

  /** First hazard overlapping the given box on the view's collidable axes. */
  hitTest(pos: TankPoint, half: TankPoint, view: View): Hazard | undefined {
    const c = view.collide
    return this.live.find(h =>
      h.vanishing === undefined
      && (!c.a || Math.abs(h.pos.a - pos.a) < h.half.a + half.a)
      && (!c.y || Math.abs(h.pos.y - pos.y) < h.half.y + half.y)
      && (!c.z || Math.abs(h.pos.z - pos.z) < h.half.z + half.z),
    )
  }

  private remove(h: Live) {
    this.group.remove(h.mesh, h.shadow)
    ;(h.shadow.material as THREE.Material).dispose() // each shadow owns its material for per-hazard opacity
  }

  /** Spawn a specific hazard now, ignoring level, view and cooldown rules (dev/testing). */
  spawnById(id: string, ctx: HazardContext, view: View, fish: TankPoint) {
    const def = HAZARDS.find(d => d.id === id)
    if (def) this.spawn(ctx, view, fish, def)
    return !!def
  }

  /** What may spawn right now: unlocked, allowed in this view, and off cooldown. */
  private eligible(ctx: HazardContext, view: View) {
    return HAZARDS.filter((d) => {
      if (d.minLevel > ctx.level) return false
      if (d.views && !d.views.includes(view.id)) return false
      const last = this.lastSpawn.get(d.id)
      return !d.cooldown || last === undefined || this.clock - last >= d.cooldown
    })
  }

  private spawn(ctx: HazardContext, view: View, fish: TankPoint, forced?: HazardDef) {
    const def = forced ?? weightedPick(this.eligible(ctx, view), ctx.rand)
    if (!def) return
    this.lastSpawn.set(def.id, this.clock)

    const h: Live = {
      def,
      pos: { a: view.spawnA, y: 0, z: 0 },
      half: { a: 20, y: 20, z: 20 },
      data: {},
      mesh: new THREE.Group(),
      shadow: createShadow(1),
    }
    def.setup(h, ctx)
    // In side views depth is invisible and doesn't collide, but it still shows
    // through perspective. Put hazards on the fish's plane so what you see lines
    // up with what hits. (Which hazards suit which view is its own question.)
    if (!view.collide.z) {
      h.pos.z = fish.z
      if (h.data.baseZ !== undefined) h.data.baseZ = fish.z
    }
    // Push past the spawn line by the hazard's own half-length so it never pops in on screen.
    h.pos.a += h.half.a
    h.mesh = def.build(h)
    toWorld(h.pos, h.mesh.position)
    h.shadow.userData.radius = Math.max(h.half.a, h.half.z) * 1.1
    this.group.add(h.mesh, h.shadow)
    this.live.push(h)
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
