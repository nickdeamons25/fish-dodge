import * as THREE from 'three'
import { TANK } from '../constants'
import { rockGeos } from '../hazards/registry'
import { CORAL_COLORS, CORAL_SOLID, coralGeometry, type CoralSpecies } from './corals'
import { forward, right, type TankPoint } from './space'

/**
 * A few banks of big coral, laid out once round the tank and there for good:
 * rows of branching bushes, tree corals, sea fans and lettuce coral on low
 * rocky ridges. They're terrain, not hazards — they never spawn or despawn —
 * but they're solid: you steer round a bank, or over its lower corals.
 *
 * All their corals are instanced together, one mesh per species, so the
 * whole lot is a handful of draws wherever you are.
 */

const BANKS = 7
/** Banks sit in the ring between the mound and the glass, clear of both, each other and the start. */
const RING: [number, number] = [TANK.mound.radius + 500, TANK.radius - 650]
const HALF_LENGTH: [number, number] = [250, 450]
const SPACING = 350
/** Where a run starts (entities/Fish.ts HOME), and how much open water to leave ahead of it. */
const START = { x: 700, z: TANK.radius * 0.55, clear: 1000 }
/** Grazing a coral's top by less than this lifts the fish over rather than stopping it. */
const TOP_GRACE = 24

const SPECIES: CoralSpecies[] = ['bush', 'bush', 'tree', 'fan', 'lettuce']
const coralMat = new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide })
const baseMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true })
const baseTones = [0x9c9384, 0x8a8478, 0x7f8a74, 0xa39a8a]

/** One coral, in tank space. What blocks is a circle `r` across, from the sand up to `top`. */
interface Coral {
  species: CoralSpecies
  x: number
  z: number
  yaw: number
  width: number
  height: number
  color: number
  r: number
  top: number
}

/**
 * What the fish hit, and how to push it back out: along a direction across the
 * floor, or straight up if it only grazed a top.
 */
export interface CoralHit { nx: number, nz: number, up: boolean, depth: number }

export class CoralBanks {
  readonly group = new THREE.Group()
  private corals: Coral[] = []

  constructor() {
    const r = mulberry(61)
    const range = ([a, b]: [number, number]) => a + r() * (b - a)
    const placed: { x: number, z: number, half: number }[] = []
    for (let tries = 0; placed.length < BANKS && tries < 500; tries++) {
      const angle = r() * Math.PI * 2
      const d = range(RING)
      const x = Math.cos(angle) * d
      const z = Math.sin(angle) * d
      const half = range(HALF_LENGTH)
      // A bank's ends must stay inside the ring too.
      if (d + half > RING[1] || d - half < RING[0]) continue
      if (Math.hypot(x - START.x, z - START.z) < START.clear + half) continue
      if (placed.some(p => Math.hypot(p.x - x, p.z - z) < p.half + half + SPACING)) continue
      placed.push({ x, z, half })
      this.layBank(x, z, r() * Math.PI * 2, half, r)
    }
    this.build(r)
  }

  /** A row of corals `half` either side of (x, z), running across `heading`. */
  private layBank(x: number, z: number, heading: number, half: number, r: () => number) {
    const f = forward(heading, new THREE.Vector3())
    const s = right(heading, new THREE.Vector3())
    for (let along = -half; along <= half; along += 85 + r() * 45) {
      const species = SPECIES[Math.floor(r() * SPECIES.length)]!
      const height = species === 'lettuce' ? 90 + r() * 60 : 130 + r() * 140
      const width = height * (species === 'fan' ? 1.1 : species === 'lettuce' ? 1.5 : 0.9)
      const off = (r() - 0.5) * 40
      const colors = CORAL_COLORS[species]
      this.corals.push({
        species,
        x: x + s.x * along + f.x * off,
        z: z + s.z * along + f.z * off,
        // Sea fans face along the bank's heading, like a wall; the rest turn a little.
        yaw: heading + (r() - 0.5) * 0.6,
        width,
        height,
        color: colors[Math.floor(r() * colors.length)]!,
        // Only the core blocks, so brushing the tips of branches is forgiven.
        r: width * CORAL_SOLID[species].r,
        top: height * CORAL_SOLID[species].top,
      })
    }
  }

  /** Every coral instanced by species, on low stones: built once. */
  private build(r: () => number) {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const color = new THREE.Color()
    for (const species of new Set(this.corals.map(c => c.species))) {
      const mine = this.corals.filter(c => c.species === species)
      const mesh = new THREE.InstancedMesh(coralGeometry(species), coralMat, mine.length)
      mine.forEach((c, i) => {
        q.setFromAxisAngle(up, c.yaw)
        m.compose(new THREE.Vector3(c.x, -4, c.z), q, new THREE.Vector3(c.width, c.height, c.width))
        mesh.setMatrixAt(i, m)
        mesh.setColorAt(i, color.set(c.color).multiplyScalar(0.9 + r() * 0.2))
      })
      mesh.computeBoundingSphere()
      this.group.add(mesh)
    }

    // The rocky footing: a few low stones under and round each coral.
    const perGeo = Math.ceil((this.corals.length * 4) / rockGeos.length) + 4
    const base = rockGeos.map(geo => new THREE.InstancedMesh(geo, baseMat, perGeo))
    const used = base.map(() => 0)
    for (const c of this.corals) {
      for (let i = 0; i < 3; i++) {
        const k = Math.floor(r() * base.length)
        if (used[k]! >= perGeo) continue
        const size = 26 + r() * 26
        q.setFromEuler(new THREE.Euler(0, r() * Math.PI * 2, 0))
        m.compose(
          new THREE.Vector3(c.x + (r() - 0.5) * c.width * 0.6, size * 0.15, c.z + (r() - 0.5) * c.width * 0.6),
          q,
          new THREE.Vector3(size * (1 + r() * 0.4), size * 0.45, size * (1 + r() * 0.4)),
        )
        base[k]!.setMatrixAt(used[k]!, m)
        base[k]!.setColorAt(used[k]!, color.set(baseTones[Math.floor(r() * baseTones.length)]!))
        used[k]!++
      }
    }
    base.forEach((mesh, k) => {
      mesh.count = used[k]!
      if (!mesh.count) return
      mesh.computeBoundingSphere()
      this.group.add(mesh)
    })
  }

  /**
   * The deepest coral the fish's box is in (half-extents `half` along and
   * across its `heading`), and which way to push it back out.
   */
  contact(pos: TankPoint, half: { a: number, y: number, z: number }, heading: number): CoralHit | undefined {
    const bottom = pos.y - half.y
    // A round coral sees the fish's box as roughly as wide as its longer side.
    const reach = Math.max(half.a, half.z)
    let best: CoralHit | undefined
    for (const c of this.corals) {
      if (bottom >= c.top) continue
      const dx = pos.x - c.x
      const dz = pos.z - c.z
      const d = Math.hypot(dx, dz)
      const pen = c.r + reach - d
      if (pen <= 0) continue
      const hit: CoralHit = c.top - bottom < Math.min(pen, TOP_GRACE)
        ? { nx: 0, nz: 0, up: true, depth: c.top - bottom }
        : d > 1e-6
          ? { nx: dx / d, nz: dz / d, up: false, depth: pen }
          : { nx: -forward(heading, tmp).x, nz: -tmp.z, up: false, depth: pen }
      if (!best || hit.depth > best.depth) best = hit
    }
    return best
  }

  /** Whether a point on the floor is within `pad` of any coral. */
  near(x: number, z: number, pad: number) {
    return this.corals.some(c => Math.hypot(x - c.x, z - c.z) < c.r + pad)
  }
}

const tmp = new THREE.Vector3()

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
