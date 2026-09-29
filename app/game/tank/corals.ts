import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Big, simple coral shapes for the coral banks you steer round or over:
 * branching bushes, tree corals, sea fans and ruffled lettuce coral. Each
 * species is one shared unit geometry — base at y = 0, about 1 tall and 1
 * wide, facing +X — built once and instanced with a colour per coral.
 */

export type CoralSpecies = 'bush' | 'tree' | 'fan' | 'lettuce'

/** Vivid reef colours, per species (sRGB hex). */
export const CORAL_COLORS: Record<CoralSpecies, number[]> = {
  bush: [0xa45aa8, 0x3d8fc9, 0xd04aa0, 0x9d8ad8, 0xe86a9a],
  tree: [0xe86a9a, 0xf07a8a, 0xd8586e],
  fan: [0xf08a4b, 0xe8552a, 0xf2a060, 0xc84a8a],
  lettuce: [0xe0603a, 0xe8883a, 0xd84a4a],
}

/** How much of a coral's width and height actually blocks, so glancing the tips of branches is forgiven. */
export const CORAL_SOLID: Record<CoralSpecies, { r: number, top: number }> = {
  bush: { r: 0.34, top: 0.85 },
  tree: { r: 0.3, top: 0.85 },
  fan: { r: 0.22, top: 0.85 },
  lettuce: { r: 0.4, top: 0.9 },
}

const cache = new Map<CoralSpecies, THREE.BufferGeometry>()

export function coralGeometry(species: CoralSpecies) {
  let g = cache.get(species)
  if (!g) {
    g = { bush, tree, fan, lettuce }[species]()
    cache.set(species, g)
  }
  return g
}

/** One tapered branch from `from` along `dir`, as a cylinder. */
function limb(from: THREE.Vector3, dir: THREE.Vector3, len: number, r0: number, r1: number, sides = 6) {
  const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1)
  g.translate(0, len / 2, 0)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir))
  g.translate(from.x, from.y, from.z)
  return g
}

/** Scale merged parts so the shape is 1 tall and sits on y = 0. */
function normalise(parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts)!
  for (const p of parts) p.dispose()
  g.computeBoundingBox()
  const b = g.boundingBox!
  g.translate(0, -b.min.y, 0)
  g.scale(1 / (b.max.y - b.min.y), 1 / (b.max.y - b.min.y), 1 / (b.max.y - b.min.y))
  return g
}

/** Staghorn / acropora: a dense bush of upright, forking, blunt-tipped branches. */
function bush() {
  const r = mulberry(31)
  const parts: THREE.BufferGeometry[] = []
  const grow = (from: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number) => {
    parts.push(limb(from, dir, len, rad, rad * 0.75))
    const tip = from.clone().addScaledVector(dir, len)
    if (depth === 0) {
      parts.push(new THREE.SphereGeometry(rad * 0.95, 6, 4).translate(tip.x, tip.y, tip.z)) // blunt tip
      return
    }
    const kids = depth > 1 ? 3 : 2
    for (let i = 0; i < kids; i++) {
      const d = dir.clone().add(new THREE.Vector3(r() - 0.5, 0.35 + r() * 0.3, r() - 0.5).multiplyScalar(0.8)).normalize()
      grow(tip, d, len * (0.68 + r() * 0.12), rad * 0.72, depth - 1)
    }
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + r()
    grow(new THREE.Vector3(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05), new THREE.Vector3(Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5).normalize(), 0.3, 0.075, 3)
  }
  return normalise(parts)
}

/** Tree coral: a stout trunk that splits and splits into a fine, rounded crown. */
function tree() {
  const r = mulberry(17)
  const parts: THREE.BufferGeometry[] = []
  const grow = (from: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number) => {
    parts.push(limb(from, dir, len, rad, rad * 0.7, 5))
    if (depth === 0) return
    const tip = from.clone().addScaledVector(dir, len)
    for (let i = 0; i < 3; i++) {
      const spread = 0.55 + (4 - depth) * 0.1
      const d = dir.clone().add(new THREE.Vector3((r() - 0.5) * spread * 2, 0.2, (r() - 0.5) * spread * 2)).normalize()
      grow(tip, d, len * 0.72, rad * 0.62, depth - 1)
    }
  }
  grow(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 0.45, 0.07, 4)
  return normalise(parts)
}

/** Sea fan: a flat fan of fine forking branches in one plane (across the frame, so it faces the fish). */
function fan() {
  const r = mulberry(5)
  const parts: THREE.BufferGeometry[] = []
  const grow = (from: THREE.Vector3, angle: number, len: number, rad: number, depth: number) => {
    const dir = new THREE.Vector3(0, Math.sin(angle), Math.cos(angle))
    parts.push(limb(from, dir, len, rad, rad * 0.8, 4))
    if (depth === 0) return
    const tip = from.clone().addScaledVector(dir, len)
    for (const turn of [-1, 1]) grow(tip, angle + turn * (0.22 + r() * 0.16), len * (0.78 + r() * 0.08), rad * 0.78, depth - 1)
  }
  parts.push(limb(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 0.12, 0.035, 0.03, 5))
  for (const a of [0.6, 1.0, 1.35, 1.57, 1.8, 2.15, 2.55]) grow(new THREE.Vector3(0, 0.1, 0), a, 0.13, 0.022, 5)
  return normalise(parts)
}

/** Lettuce coral: a clump of thin, ruffled cups, like crumpled paper. */
function lettuce() {
  const r = mulberry(9)
  const parts: THREE.BufferGeometry[] = []
  // A cup's profile: narrow stem flaring into a wide, thin lip.
  const profile = [
    new THREE.Vector2(0.02, 0), new THREE.Vector2(0.06, 0.12), new THREE.Vector2(0.16, 0.26),
    new THREE.Vector2(0.28, 0.36), new THREE.Vector2(0.34, 0.4),
  ]
  for (let i = 0; i < 7; i++) {
    const g = new THREE.LatheGeometry(profile, 28)
    // Ruffle the rim: push points in and out round the cup, more toward the lip.
    const p = g.getAttribute('position') as THREE.BufferAttribute
    const k = 5 + Math.floor(r() * 3)
    const ph = r() * 6
    for (let v = 0; v < p.count; v++) {
      const x = p.getX(v)
      const y = p.getY(v)
      const z = p.getZ(v)
      const a = Math.atan2(z, x)
      const rim = y / 0.4
      p.setY(v, y + Math.sin(a * k + ph) * 0.06 * rim)
      const s = 1 + Math.sin(a * (k + 2) + ph * 2) * 0.12 * rim
      p.setX(v, x * s)
      p.setZ(v, z * s)
    }
    g.computeVertexNormals()
    const size = 0.6 + r() * 0.6
    g.scale(size, size * (0.8 + r() * 0.5), size)
    g.rotateX((r() - 0.5) * 0.7)
    g.rotateZ((r() - 0.5) * 0.7)
    const a = r() * Math.PI * 2
    const d = i === 0 ? 0 : 0.12 + r() * 0.15
    g.translate(Math.cos(a) * d, r() * 0.25, Math.sin(a) * d)
    parts.push(g.toNonIndexed())
    g.dispose()
  }
  return normalise(parts.map((g) => {
    // Lathe and cylinder attributes differ; keep only what every part shares.
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name)
    return g
  }))
}

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
