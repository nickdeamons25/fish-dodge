import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { TANK } from '../constants'

/**
 * Solid obstacles: big rocks and reef walls that stand from the sand to the
 * surface. You can't swim over them or blink through them after a hit — they
 * always push the fish back out, so the only way past is to turn.
 *
 * An obstacle's shape is a list of parts in its hazard frame (see registry.ts
 * `Hazard`): boxes, whose long side runs across the frame (local z), and
 * circles. Height isn't tested: every part is full height.
 */
export type SolidPart =
  | { kind: 'box', a: number, z: number, ha: number, hz: number }
  | { kind: 'circle', a: number, z: number, r: number }

/** Where the fish would be pushed to, in the hazard's frame: a unit normal (a, z) and how far. */
export interface Contact { na: number, nz: number, depth: number }

/**
 * Deepest contact between the fish — at (la, lz) in the obstacle's frame, with
 * half-extents (ea, ez) along those axes — and any of its parts.
 */
export function contact(parts: SolidPart[], la: number, lz: number, ea: number, ez: number): Contact | undefined {
  let best: Contact | undefined
  for (const p of parts) {
    const da = la - p.a
    const dz = lz - p.z
    let c: Contact | undefined
    if (p.kind === 'box') {
      const oa = p.ha + ea - Math.abs(da)
      const oz = p.hz + ez - Math.abs(dz)
      if (oa > 0 && oz > 0) c = oa < oz ? { na: Math.sign(da) || 1, nz: 0, depth: oa } : { na: 0, nz: Math.sign(dz) || 1, depth: oz }
    }
    else {
      const d = Math.hypot(da, dz)
      const pen = p.r + Math.max(ea, ez) - d
      if (pen > 0) c = d > 1e-6 ? { na: da / d, nz: dz / d, depth: pen } : { na: -1, nz: 0, depth: pen }
    }
    if (c && (!best || c.depth > best.depth)) best = c
  }
  return best
}

/** Whether a point (in the obstacle's frame) is within `pad` of any part. */
export function near(parts: SolidPart[], la: number, lz: number, pad: number) {
  return contact(parts, la, lz, pad, pad) !== undefined
}

// ---- Meshes ---------------------------------------------------------------------

const rockTones = [0x8f887a, 0x7d7a70, 0x857f6e, 0x6f766a, 0x9a9282, 0x74716a]
const lifeTones = [0x9a6fb8, 0xd07a5a, 0xc9b25a, 0x5fa39a, 0xb85a78]
const wallMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true, vertexColors: true })

/**
 * The mesh for a set of solid parts: rock stacked from the sand to above the
 * surface, with a scatter of sponge and coral colour on the lower stones.
 * One merged geometry, so a whole wall is a single draw.
 */
export function buildObstacle(parts: SolidPart[], rockGeos: THREE.BufferGeometry[], seed: number) {
  const r = mulberry(seed)
  const pieces: THREE.BufferGeometry[] = []
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const color = new THREE.Color()
  const rock = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const g = rockGeos[Math.floor(r() * rockGeos.length)]!.clone()
    q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.5, r() * Math.PI * 2, (r() - 0.5) * 0.5))
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz))
    g.applyMatrix4(m)
    // Mostly bare rock; low down, the odd stone is crusted with sponge or coral.
    const alive = y < TANK.height * 0.35 && r() < 0.25
    color.set(alive ? lifeTones[Math.floor(r() * lifeTones.length)]! : rockTones[Math.floor(r() * rockTones.length)]!)
    color.multiplyScalar(0.85 + r() * 0.3)
    const n = g.getAttribute('position').count
    const cols = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) cols.set([color.r, color.g, color.b], i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    pieces.push(g)
  }
  /** A column of stones at (a, z), `width` across, reaching just past the surface. */
  const column = (a: number, z: number, width: number) => {
    let y = 0
    while (y < TANK.height + 20) {
      const h = 70 + r() * 70
      rock(a + (r() - 0.5) * width * 0.3, y + h * 0.4, z, width * (0.45 + r() * 0.2), h * 0.6, 40 + r() * 25)
      y += h * 0.8
    }
  }
  for (const p of parts) {
    if (p.kind === 'box') {
      for (let z = p.z - p.hz; z <= p.z + p.hz; z += 55 + r() * 20) column(p.a, z, p.ha * 2.3)
    }
    else {
      // A sea stack: columns packed into the circle, tallest in the middle.
      const count = Math.round((p.r * p.r) / 2400)
      for (let i = 0; i < count; i++) {
        const a = r() * Math.PI * 2
        const d = Math.sqrt(r()) * p.r * 0.8
        column(p.a + Math.cos(a) * d, p.z + Math.sin(a) * d, 70 + r() * 50)
      }
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(pieces)!, wallMat)
  for (const g of pieces) g.dispose()
  return mesh
}

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
