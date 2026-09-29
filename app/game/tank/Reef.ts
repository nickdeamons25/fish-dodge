import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { TANK } from '../constants'
import { rockGeos } from '../hazards/registry'
import { seaFanTexture } from './textures'

/**
 * Seabed decoration: patches of reef scattered over the sand — rock clusters,
 * brain and table corals, branching staghorn, tube sponges and sea fans.
 * Purely scenery (nothing here collides), kept under about 110 units — well below
 * the fish's usual height — so it reads as the seabed it swims over rather
 * than obstacles. Each kind is one instanced draw
 * with per-instance colour, sharing its geometry.
 */

const R = TANK.radius
/** Scenery stays clear of the glass and the mound by this much. */
const CLEAR = 60

type Placer = (x: number, z: number, size: number) => void

interface Kind {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  colors: number[]
  /** Size range (world units) for this kind, as [min, max] of its unit geometry's scale. */
  size: [number, number]
  /** Height and width as multiples of size. */
  shape: { y: [number, number], xz: [number, number] }
  /** Sink this fraction of the height into the sand. */
  sink?: number
  depthMaterial?: THREE.Material
  instances: THREE.Matrix4[]
  tints: THREE.Color[]
}

export function buildReef() {
  const group = new THREE.Group()
  const r = mulberry(23)
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]!
  const range = ([a, b]: [number, number]) => a + r() * (b - a)

  // White bases: each instance's colour is its tint.
  const rockMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true })
  const coralMat = new THREE.MeshStandardMaterial({ roughness: 0.8, vertexColors: true })
  const plainCoral = new THREE.MeshStandardMaterial({ roughness: 0.75 })
  const fanTex = seaFanTexture()
  const fanMat = new THREE.MeshStandardMaterial({
    map: fanTex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.8,
    emissive: 0xffffff, emissiveMap: fanTex, emissiveIntensity: 0.12, // a little light through the lattice
  })
  // Depth of field: the cut-out lattice, not a solid card.
  const fanDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: fanTex, alphaTest: 0.5, side: THREE.DoubleSide })

  const kind = (k: Omit<Kind, 'instances' | 'tints'>): Kind => ({ ...k, instances: [], tints: [] })
  const rocks = rockGeos.map(geometry => kind({
    geometry, material: rockMat, colors: [0x9c9384, 0x8a8478, 0x7f8a74, 0xa39a8a, 0x8c8c86],
    size: [18, 60], shape: { y: [0.6, 1.0], xz: [0.9, 1.4] }, sink: 0.3,
  }))
  const brain = kind({
    geometry: brainGeometry(), material: coralMat, colors: [0xd9a15a, 0xc98a6a, 0xb6c46a, 0xd07fa0, 0xe0c070],
    size: [16, 42], shape: { y: [0.9, 1.1], xz: [0.9, 1.2] }, sink: 0.05,
  })
  const staghorn = kind({
    geometry: staghornGeometry(), material: plainCoral, colors: [0xe8b27a, 0xd8866a, 0x9c7ad0, 0xe0d08a, 0x7fc7c0],
    size: [45, 90], shape: { y: [0.9, 1.1], xz: [0.8, 1.2] },
  })
  const table = kind({
    geometry: tableGeometry(), material: plainCoral, colors: [0xa8b88a, 0xc8a878, 0x8ab0a8],
    size: [36, 70], shape: { y: [0.8, 1.1], xz: [0.9, 1.2] },
  })
  const tubes = kind({
    geometry: tubeGeometry(), material: plainCoral, colors: [0xd0703a, 0x9a5ab8, 0xe0a040, 0x5a8ac0],
    size: [30, 68], shape: { y: [0.8, 1.2], xz: [0.8, 1.1] },
  })
  const fans = kind({
    geometry: new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), material: fanMat, depthMaterial: fanDepth,
    colors: [0xb05ac8, 0xe06a4a, 0xe8c050, 0xd04a80], size: [60, 110], shape: { y: [0.9, 1.1], xz: [0.9, 1.3] },
  })
  const kinds = [...rocks, brain, staghorn, table, tubes, fans]

  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const place = (k: Kind): Placer => (x, z, size) => {
    const h = size * range(k.shape.y)
    const w = size * range(k.shape.xz)
    q.setFromAxisAngle(up, r() * Math.PI * 2)
    m.compose(new THREE.Vector3(x, -(k.sink ?? 0) * h, z), q, new THREE.Vector3(w, h, w * range([0.8, 1.2])))
    k.instances.push(m.clone())
    k.tints.push(new THREE.Color(pick(k.colors)).multiplyScalar(0.85 + r() * 0.3))
  }
  const ok = (x: number, z: number) => {
    const d = Math.hypot(x, z)
    return d < R - CLEAR && d > TANK.mound.radius + CLEAR
  }
  const scatter = (k: Kind, cx: number, cz: number, spread: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2
      const d = Math.sqrt(r()) * spread
      const x = cx + Math.cos(a) * d
      const z = cz + Math.sin(a) * d
      if (ok(x, z)) place(k)(x, z, range(k.size))
    }
  }
  const anywhere = (): [number, number] => {
    const a = r() * Math.PI * 2
    const d = TANK.mound.radius + CLEAR + Math.sqrt(r()) * (R - TANK.mound.radius - 2 * CLEAR)
    return [Math.cos(a) * d, Math.sin(a) * d]
  }

  // Reef patches: a rocky base with corals growing on and around it.
  for (let p = 0; p < 280; p++) {
    const [cx, cz] = anywhere()
    const big = r() < 0.35
    const spread = big ? 220 : 120
    for (let i = 0; i < (big ? 2 : 1); i++) scatter(pick(rocks), cx, cz, spread * 0.4, 1 + Math.floor(r() * 3))
    scatter(brain, cx, cz, spread, 2 + Math.floor(r() * (big ? 6 : 3)))
    if (r() < 0.8) scatter(staghorn, cx, cz, spread, 1 + Math.floor(r() * (big ? 5 : 3)))
    if (r() < 0.45) scatter(table, cx, cz, spread, 1 + Math.floor(r() * 2))
    if (r() < 0.6) scatter(tubes, cx, cz, spread, 1 + Math.floor(r() * 3))
    if (r() < 0.6) scatter(fans, cx, cz, spread, 1 + Math.floor(r() * 3))
  }
  // Loose stones and the odd lone coral head between the patches.
  for (let i = 0; i < 280; i++) {
    const [x, z] = anywhere()
    place(r() < 0.6 ? pick(rocks) : brain)(x, z, range([10, 28]))
  }
  // Sea fans round the foot of the glass and the mound, among the kelp.
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2
    const d = r() < 0.7 ? R - CLEAR - r() * 160 : TANK.mound.radius + CLEAR + r() * 120
    place(fans)(Math.cos(a) * d, Math.sin(a) * d, range(fans.size))
  }

  for (const k of kinds) {
    if (!k.instances.length) continue
    const mesh = new THREE.InstancedMesh(k.geometry, k.material, k.instances.length)
    k.instances.forEach((mat, i) => {
      mesh.setMatrixAt(i, mat)
      mesh.setColorAt(i, k.tints[i]!)
    })
    mesh.computeBoundingSphere()
    if (k.depthMaterial) mesh.userData.depthMaterial = k.depthMaterial
    group.add(mesh)
  }
  return group
}

// ---- Shared unit geometries: base at y = 0, about 1 unit tall and wide ------------

/** A brain coral: a squashed dome covered in meandering ridges, darker in the grooves. */
function brainGeometry() {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(0.5, 4)
  g.deleteAttribute('normal')
  g.deleteAttribute('uv')
  g = mergeVertices(g)
  const p = g.getAttribute('position') as THREE.BufferAttribute
  const colors: number[] = []
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize()
    const ridge = Math.sin(v.x * 23 + Math.sin(v.z * 11) * 3) * Math.sin(v.z * 21 + Math.sin(v.y * 9) * 2.5)
    const k = 0.5 + 0.03 * ridge
    v.multiplyScalar(k)
    v.y = Math.max(-0.05, v.y * 0.7) + 0.05 // flattened, with a flat base on the sand
    p.setXYZ(i, v.x, v.y, v.z)
    const shade = 0.7 + 0.3 * (ridge * 0.5 + 0.5)
    colors.push(shade, shade, shade)
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  g.computeVertexNormals()
  return g
}

/** Branching staghorn coral: a few tapered branches forking from a short trunk. */
function staghornGeometry() {
  const r = mulberry(41)
  const parts: THREE.BufferGeometry[] = []
  const branch = (from: THREE.Vector3, dir: THREE.Vector3, len: number, radius: number, depth: number) => {
    const g = new THREE.CylinderGeometry(radius * 0.6, radius, len, 6, 1)
    g.translate(0, len / 2, 0)
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir))
    g.translate(from.x, from.y, from.z)
    parts.push(g)
    if (depth === 0) return
    const tip = from.clone().addScaledVector(dir, len)
    for (let i = 0; i < 2; i++) {
      const d = dir.clone().add(new THREE.Vector3(r() - 0.5, 0.2 + r() * 0.3, r() - 0.5).multiplyScalar(0.9)).normalize()
      branch(tip, d, len * (0.6 + r() * 0.2), radius * 0.65, depth - 1)
    }
  }
  for (let i = 0; i < 3; i++) {
    const d = new THREE.Vector3(r() - 0.5, 1.2, r() - 0.5).normalize()
    branch(new THREE.Vector3(), d, 0.38, 0.06, 2)
  }
  return mergeGeometries(parts)!
}

/** Table coral: a broad, flat plate on a short stalk. */
function tableGeometry() {
  const stalk = new THREE.CylinderGeometry(0.08, 0.12, 0.5, 8).translate(0, 0.25, 0)
  const plate = new THREE.CylinderGeometry(0.5, 0.44, 0.08, 20).translate(0, 0.52, 0)
  return mergeGeometries([stalk, plate])!
}

/** Tube sponges: a clutch of upright tubes of different heights. */
function tubeGeometry() {
  const r = mulberry(7)
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 5; i++) {
    const h = 0.45 + r() * 0.55
    const rad = 0.08 + r() * 0.06
    const a = r() * Math.PI * 2
    const d = i === 0 ? 0 : 0.12 + r() * 0.14
    parts.push(new THREE.CylinderGeometry(rad, rad * 0.8, h, 10).translate(Math.cos(a) * d, h / 2, Math.sin(a) * d))
  }
  return mergeGeometries(parts)!
}

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
