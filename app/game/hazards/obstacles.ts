import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { TANK } from '../constants'
import { CORAL_COLORS, CORAL_SOLID, coralGeometry, type CoralSpecies } from './corals'

/**
 * Solid obstacles: big rocks and coral banks that stand on the sand. You
 * can't blink through them after a hit — they always push the fish back out —
 * so the way past is to turn round them or, if they're low enough, swim over.
 *
 * An obstacle's shape is a list of parts in its hazard frame (see registry.ts
 * `Hazard`): boxes, whose long side runs across the frame (local z), and
 * circles. Each stands from the sand up to `top` (default: the surface).
 */
export type SolidPart =
  | { kind: 'box', a: number, z: number, ha: number, hz: number, top?: number }
  | { kind: 'circle', a: number, z: number, r: number, top?: number }

/**
 * Where the fish would be pushed to: sideways by a unit normal (na, nz) in the
 * hazard's frame, or — if it only just dipped onto a part's top — straight up.
 */
export interface Contact { na: number, nz: number, up: boolean, depth: number }

/** Grazing a top by less than this pushes the fish up rather than out sideways. */
const TOP_GRACE = 24

/**
 * Deepest contact between the fish — at (la, lz) in the obstacle's frame, with
 * half-extents (ea, ez) along those axes and its underside at `bottom` — and
 * any of its parts.
 */
export function contact(parts: SolidPart[], la: number, lz: number, ea: number, ez: number, bottom = 0): Contact | undefined {
  let best: Contact | undefined
  for (const p of parts) {
    const top = p.top ?? Infinity
    if (bottom >= top) continue
    const da = la - p.a
    const dz = lz - p.z
    let c: Contact | undefined
    if (p.kind === 'box') {
      const oa = p.ha + ea - Math.abs(da)
      const oz = p.hz + ez - Math.abs(dz)
      if (oa > 0 && oz > 0) c = oa < oz ? { na: Math.sign(da) || 1, nz: 0, up: false, depth: oa } : { na: 0, nz: Math.sign(dz) || 1, up: false, depth: oz }
    }
    else {
      const d = Math.hypot(da, dz)
      const pen = p.r + Math.max(ea, ez) - d
      if (pen > 0) c = d > 1e-6 ? { na: da / d, nz: dz / d, up: false, depth: pen } : { na: -1, nz: 0, up: false, depth: pen }
    }
    if (c && top - bottom < Math.min(c.depth, TOP_GRACE)) c = { na: 0, nz: 0, up: true, depth: top - bottom }
    if (c && (!best || c.depth > best.depth)) best = c
  }
  return best
}

/** Whether a point (in the obstacle's frame) is within `pad` of any part, at any height. */
export function near(parts: SolidPart[], la: number, lz: number, pad: number) {
  return contact(parts, la, lz, pad, pad) !== undefined
}

// ---- Big rocks --------------------------------------------------------------------

const rockTones = [0x8f887a, 0x7d7a70, 0x857f6e, 0x6f766a, 0x9a9282, 0x74716a]
const lifeTones = [0x9a6fb8, 0xd07a5a, 0xc9b25a, 0x5fa39a, 0xb85a78]
const rockMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true, vertexColors: true })

/**
 * A sea stack for a circle part: stones piled from the sand to above the
 * surface, crusted with sponge and coral low down. One merged geometry.
 */
export function buildRockStack(part: Extract<SolidPart, { kind: 'circle' }>, rockGeos: THREE.BufferGeometry[], seed: number) {
  const r = mulberry(seed)
  const pieces: THREE.BufferGeometry[] = []
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const color = new THREE.Color()
  const column = (a: number, z: number, width: number) => {
    let y = 0
    while (y < TANK.height + 20) {
      const h = 70 + r() * 70
      const g = rockGeos[Math.floor(r() * rockGeos.length)]!.clone()
      q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.5, r() * Math.PI * 2, (r() - 0.5) * 0.5))
      m.compose(new THREE.Vector3(a + (r() - 0.5) * width * 0.3, y + h * 0.4, z), q, new THREE.Vector3(width * (0.45 + r() * 0.2), h * 0.6, 40 + r() * 25))
      g.applyMatrix4(m)
      const alive = y < TANK.height * 0.35 && r() < 0.25
      color.set(alive ? lifeTones[Math.floor(r() * lifeTones.length)]! : rockTones[Math.floor(r() * rockTones.length)]!)
      color.multiplyScalar(0.85 + r() * 0.3)
      const n = g.getAttribute('position').count
      const cols = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) cols.set([color.r, color.g, color.b], i * 3)
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3))
      pieces.push(g)
      y += h * 0.8
    }
  }
  // Columns packed into the circle.
  const count = Math.round((part.r * part.r) / 2400)
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2
    const d = Math.sqrt(r()) * part.r * 0.8
    column(part.a + Math.cos(a) * d, part.z + Math.sin(a) * d, 70 + r() * 50)
  }
  const mesh = new THREE.Mesh(mergeGeometries(pieces)!, rockMat)
  for (const g of pieces) g.dispose()
  return mesh
}

// ---- Coral banks --------------------------------------------------------------------

const SPECIES: CoralSpecies[] = ['bush', 'bush', 'tree', 'fan', 'lettuce']
const coralMat = new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide })
const baseMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true })
const baseTones = [0x9c9384, 0x8a8478, 0x7f8a74, 0xa39a8a]

/** One coral on the bank: where it stands (in the hazard's frame) and how big it is. */
interface Coral { species: CoralSpecies, a: number, z: number, width: number, height: number, turn: number, color: number }

/**
 * Lay out a coral bank across the frame: a low rocky ridge `halfLength` either
 * side of the middle, with a row of big corals of mixed kinds and heights
 * along it. Returns the corals and the solid parts that match them — one
 * circle per coral, as high as the coral — so you can go round, or over the
 * low ones.
 */
export function layoutCoralBank(halfLength: number, rand: () => number) {
  const corals: Coral[] = []
  for (let z = -halfLength; z <= halfLength; z += 85 + rand() * 45) {
    const species = SPECIES[Math.floor(rand() * SPECIES.length)]!
    const height = species === 'lettuce' ? 90 + rand() * 60 : 130 + rand() * 140
    const width = height * (species === 'fan' ? 1.1 : species === 'lettuce' ? 1.5 : 0.9)
    const colors = CORAL_COLORS[species]
    corals.push({ species, a: (rand() - 0.5) * 40, z, width, height, turn: (rand() - 0.5) * 0.6, color: colors[Math.floor(rand() * colors.length)]! })
  }
  const parts: SolidPart[] = corals.map(c => ({
    kind: 'circle', a: c.a, z: c.z, r: c.width * CORAL_SOLID[c.species].r, top: c.height * CORAL_SOLID[c.species].top,
  }))
  return { corals, parts }
}

/**
 * The mesh for a coral bank: its corals, instanced per species (sharing each
 * species' geometry), on a ridge of low rocks. Static — no sway.
 */
export function buildCoralBank(corals: Coral[], halfLength: number, rockGeos: THREE.BufferGeometry[], seed: number) {
  const g = new THREE.Group()
  const r = mulberry(seed)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const color = new THREE.Color()

  for (const species of new Set(corals.map(c => c.species))) {
    const mine = corals.filter(c => c.species === species)
    const mesh = new THREE.InstancedMesh(coralGeometry(species), coralMat, mine.length)
    mine.forEach((c, i) => {
      q.setFromAxisAngle(up, c.turn)
      m.compose(new THREE.Vector3(c.a, -4, c.z), q, new THREE.Vector3(c.width, c.height, c.width))
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, color.set(c.color).multiplyScalar(0.9 + r() * 0.2))
    })
    mesh.computeBoundingSphere()
    g.add(mesh)
  }

  // The rocky footing: low stones along the whole bank, and a couple under each coral.
  const stones = Math.ceil((halfLength * 2) / 45) + corals.length * 2
  const base = rockGeos.map(geo => new THREE.InstancedMesh(geo, baseMat, stones))
  const used = base.map(() => 0)
  const stone = (a: number, z: number, size: number) => {
    const k = Math.floor(r() * base.length)
    q.setFromEuler(new THREE.Euler(0, r() * Math.PI * 2, 0))
    m.compose(new THREE.Vector3(a, size * 0.15, z), q, new THREE.Vector3(size * (1 + r() * 0.4), size * 0.45, size * (1 + r() * 0.4)))
    base[k]!.setMatrixAt(used[k]!, m)
    base[k]!.setColorAt(used[k]!, color.set(baseTones[Math.floor(r() * baseTones.length)]!))
    used[k]!++
  }
  for (let z = -halfLength - 30; z <= halfLength + 30; z += 45) stone((r() - 0.5) * 50, z, 30 + r() * 25)
  for (const c of corals) for (let i = 0; i < 2; i++) stone(c.a + (r() - 0.5) * c.width * 0.4, c.z + (r() - 0.5) * c.width * 0.4, 24 + r() * 20)
  base.forEach((mesh, k) => {
    mesh.count = used[k]!
    if (!mesh.count) return
    mesh.computeBoundingSphere()
    g.add(mesh)
  })
  return g
}

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
