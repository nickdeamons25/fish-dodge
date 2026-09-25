import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  BodyProfile, Z, addEyes, canvasTex, finGeometry, finMaterial, heightAround, lerp, pairedFinNormal,
  scaleTexture, skinMaterial, swimMesh, swimUniforms, v3, type SwimUniforms,
} from '../entities/fishKit'

/**
 * Detailed swimming hazards, built with the same kit as the player's clownfish.
 * Geometry and textures are shared per species; each instance gets its own
 * materials only so it can swim on its own phase.
 */

/** Deterministic pseudo-random, so painted skins look the same every load. */
function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
}

const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i]! - v) * t))
/** Colour ramp by height around the body (+1 back … -1 belly). */
function ramp(stops: [number, number[]][], h: number) {
  for (let i = 1; i < stops.length; i++) {
    const [h0, c0] = stops[i - 1]!
    const [h1, c1] = stops[i]!
    if (h <= h0 && h >= h1) return mix(c0, c1, (h0 - h) / (h0 - h1))
  }
  return h > stops[0]![0] ? stops[0]![1] : stops.at(-1)![1]
}

/** Cache per-species assets (textures, geometry) across instances. */
function once<T>(make: () => T) {
  let v: T | undefined
  return () => (v ??= make())
}

// =====================================================================================
// Blue fish: a slim, fast reef fish. Cobalt back, electric-blue sides, silver
// belly, a glowing aqua stripe, pearly iridescence and a forked tail.
// =====================================================================================
const BLUE = new BodyProfile([
  [-30, 0], [-29.6, 1.3], [-28.5, 1.9], [-25, 2.4], [-18, 4.3], [-9, 6.3], [1, 7.3],
  [11, 7.1], [19, 5.9], [25, 4], [28.5, 2.2], [29.7, 0.9], [30, 0],
], 0.62)

const blueSkin = once(() => canvasTex(512, 256, (c) => {
  const W = 512
  const H = 256
  for (let px = 0; px < W; px += 2) {
    const h = heightAround(px / W)
    const [r, g, b] = ramp([[1, [18, 52, 128]], [0.4, [40, 118, 245]], [-0.05, [120, 185, 255]], [-0.5, [228, 238, 250]]], h)
    c.fillStyle = `rgb(${r},${g},${b})`
    c.fillRect(px, 0, 2, H)
    // Lateral stripe: a thin glowing aqua line from behind the eye to the tail.
    const d = Math.abs(h - 0.18)
    if (d < 0.08) {
      c.fillStyle = `rgba(130,245,255,${(1 - d / 0.08) * 0.85})`
      c.fillRect(px, BLUE.rowOf(21, H), 2, BLUE.rowOf(-25, H) - BLUE.rowOf(21, H))
    }
  }
  // Darker snout, and a faint dark smudge at the tail base.
  const snout = c.createLinearGradient(0, BLUE.rowOf(30, H), 0, BLUE.rowOf(22, H))
  snout.addColorStop(0, 'rgba(10,30,80,0.55)')
  snout.addColorStop(1, 'rgba(10,30,80,0)')
  c.fillStyle = snout
  c.fillRect(0, 0, W, BLUE.rowOf(22, H))
}))

const blueFinTex = once(() => canvasTex(256, 256, (c) => {
  const S = 256
  const g = c.createLinearGradient(0, S, 0, 0)
  g.addColorStop(0, '#6fa8ff')
  g.addColorStop(0.55, '#8fc2ff')
  g.addColorStop(0.85, '#2f63d0')
  g.addColorStop(1, '#10306e')
  c.fillStyle = g
  c.fillRect(0, 0, S, S)
  c.strokeStyle = 'rgba(20,50,130,0.4)'
  c.lineWidth = 2
  for (let i = 1; i < 14; i++) {
    const x = (i / 14) * S
    c.beginPath()
    c.moveTo(x, S)
    c.lineTo(x, S * 0.08)
    c.stroke()
  }
}))

const blueGeometry = once(() => {
  const r = (x: number) => BLUE.radiusAt(x)
  const fins: THREE.BufferGeometry[] = []
  // Forked tail: lobes long, centre short.
  fins.push(finGeometry((s, t) => {
    const phi = THREE.MathUtils.degToRad(lerp(-42, 42, s))
    const reach = 7 + 10 * Math.abs(2 * s - 1) ** 1.3
    const rad = lerp(1.5, reach, t)
    return v3(-27.8 - Math.cos(phi) * rad, Math.sin(phi) * rad, 0)
  }, Z, [2, 1, 2.8, 0.6], 16, 9))
  // Long low dorsal, sloping down toward the tail.
  fins.push(finGeometry((s, t) => {
    const x = lerp(12, -10, s)
    return v3(x - t * 3, r(x) - 0.8 + t * lerp(5, 2.2, s), 0)
  }, Z, [0.8, 1, 1.5, 4], 16, 5))
  // Anal fin under the rear body.
  fins.push(finGeometry((s, t) => {
    const x = lerp(-6, -18, s)
    return v3(x - t * 2.5, -(r(x) - 0.8) - t * lerp(3.8, 1.8, s), 0)
  }, Z, [0.8, 1, 1.5, 4], 12, 5))
  for (const side of [-1, 1]) {
    const px = 18
    const pz = BLUE.sideZ(px, -1.5) * 0.92 * side
    const baseMid = v3(px, -1.5, pz)
    const tip = v3(10, -3, pz + 4 * side)
    fins.push(finGeometry((s, t) => {
      const base = v3(px, lerp(-3.2, 0.2, s), pz)
      return base.lerp(tip.clone().add(v3(-Math.sin(Math.PI * s), (s - 0.5) * 3, 0)), t)
    }, pairedFinNormal(v3(0, 1, 0), baseMid, tip, side), [1.6, 1.4, 1.5, 0.8], 8, 6))
  }
  return { body: BLUE.geometry(40), fins: mergeGeometries(fins)! }
})

export function buildBlueFish(size: number) {
  const geo = blueGeometry()
  // Slender swimmers flex along more of the body, in a tighter S-curve.
  const swim = swimUniforms(18, -30, 0.14, 2.6)
  const group = new THREE.Group()
  const body = new THREE.Group()
  body.scale.setScalar(size)
  body.add(swimMesh(geo.body, skinMaterial(blueSkin(), scaleTexture(24, 8), swim, {
    iridescence: 0.75, bumpScale: 0.4, clearcoat: 0.9, roughness: 0.3, glow: 0.2,
  }), swim))
  body.add(swimMesh(geo.fins, finMaterial(blueFinTex(), swim, 0.22), swim))
  addEyes(body, { x: 24.3, y: 1.6, surfaceZ: BLUE.sideZ(24.3, 1.6), radius: 2.7, iris: 0xcfd9e8, rim: 0x0b1a33 })
  group.add(body)
  group.userData.swim = swim
  return group
}

/** Blue fish swim hard and fast: a quick, full-body wave. */
export function animateBlueFish(root: THREE.Object3D, time: number, phase: number) {
  ;(root.userData.swim as SwimUniforms).uPhase.value = time * 13 + phase
}

// =====================================================================================
// Pufferfish: olive-tan and spotted above, pale below, big raised green-gold
// eyes and a little beak. Paddles with fluttering pectorals; when it inflates
// it rounds out into a ball and its spines stand up from lying flat.
// =====================================================================================
const PUFF_BODY = new BodyProfile([
  [-24, 0], [-23.6, 1.8], [-22.5, 2.8], [-20, 3.6], [-16, 6], [-10, 10.5], [-3, 14.5],
  [5, 17], [12, 17], [17, 15], [20.5, 11], [22.3, 6.5], [23, 3], [23.2, 0],
], 0.88)
const EYE = { x: 15, y: 7.5 }

const pufferSkin = once(() => canvasTex(512, 256, (c) => {
  const W = 512
  const H = 256
  for (let px = 0; px < W; px += 2) {
    const h = heightAround(px / W)
    const [r, g, b] = ramp([[1, [150, 128, 64]], [0.35, [205, 180, 100]], [-0.15, [232, 214, 150]], [-0.45, [246, 240, 222]]], h)
    c.fillStyle = `rgb(${r},${g},${b})`
    c.fillRect(px, 0, 2, H)
  }
  const rand = rng(21)
  // Soft darker saddles over the back.
  for (const x of [8, -6]) {
    const y = PUFF_BODY.rowOf(x, H)
    const g = c.createRadialGradient(W / 2, y, 4, W / 2, y, 70)
    g.addColorStop(0, 'rgba(80,60,25,0.45)')
    g.addColorStop(1, 'rgba(80,60,25,0)')
    c.fillStyle = g
    c.fillRect(0, y - 70, W, 140)
  }
  // Dark spots on the back and sides, none on the belly.
  for (let i = 0; i < 260; i++) {
    const u = rand()
    if (heightAround(u) < -0.1) continue
    const x = PUFF_BODY.tailX + 4 + rand() * (PUFF_BODY.length - 10)
    c.fillStyle = `rgba(60,40,18,${0.55 + rand() * 0.35})`
    c.beginPath()
    c.arc(u * W, PUFF_BODY.rowOf(x, H), 1.6 + rand() * 3.2, 0, Math.PI * 2)
    c.fill()
  }
}))

const pufferFinTex = once(() => canvasTex(256, 256, (c) => {
  const S = 256
  const g = c.createLinearGradient(0, S, 0, 0)
  g.addColorStop(0, '#d9c27a')
  g.addColorStop(0.7, '#eadcaa')
  g.addColorStop(1, '#f6efd6')
  c.fillStyle = g
  c.fillRect(0, 0, S, S)
  c.strokeStyle = 'rgba(120,95,40,0.45)'
  c.lineWidth = 2
  for (let i = 1; i < 12; i++) {
    const x = (i / 12) * S
    c.beginPath()
    c.moveTo(x, S)
    c.quadraticCurveTo(x + 5, S * 0.5, x, S * 0.05)
    c.stroke()
  }
}))

interface Spine { p: THREE.Vector3, n: THREE.Vector3, flat: THREE.Vector3 }

const pufferGeometry = once(() => {
  const r = (x: number) => PUFF_BODY.radiusAt(x)
  const fins: THREE.BufferGeometry[] = []
  // Small rounded tail fan.
  fins.push(finGeometry((s, t) => {
    const phi = THREE.MathUtils.degToRad(lerp(-55, 55, s))
    const rad = lerp(2, 10 + 1.5 * Math.cos((s - 0.5) * Math.PI), t)
    return v3(-21 - Math.cos(phi) * rad, Math.sin(phi) * rad, 0)
  }, Z, [1.4, 0.8, 2, 0.8], 12, 7))
  // Small dorsal and anal fins set far back, as on real puffers.
  for (const dir of [1, -1]) {
    fins.push(finGeometry((s, t) => {
      const x = lerp(-7, -15, s)
      const h = 3 + 4 * Math.sin(Math.PI * s)
      return v3(x - t * 3, dir * (r(x) - 1 + t * h), 0)
    }, Z, [1.2, 1.6, 1.6, 3], 10, 5))
  }
  // Round pectorals that flutter fast: puffers paddle rather than flex.
  for (const side of [-1, 1]) {
    const px = 9
    const pz = PUFF_BODY.sideZ(px, -1) * 0.93 * side
    const baseMid = v3(px, -1, pz)
    const tip = v3(3.5, -0.5, pz + 6.5 * side)
    fins.push(finGeometry((s, t) => {
      const base = v3(px, lerp(-4.5, 3, s), pz)
      return base.lerp(tip.clone().add(v3(-2 * Math.sin(Math.PI * s), (s - 0.5) * 6, 0)), t)
    }, pairedFinNormal(v3(0, 1, 0), baseMid, tip, side), [2.2, 3.2, 1.8, 1.2], 8, 7))
  }

  // Spines scattered over the body (not the face, tail or belly centre).
  const spines: Spine[] = []
  const rand = rng(5)
  const flat = PUFF_BODY.flat
  while (spines.length < 70) {
    const x = lerp(-15, 18, rand())
    const theta = rand() * Math.PI * 2
    const rad = r(x)
    const p = v3(x, rad * Math.cos(theta), flat * rad * Math.sin(theta))
    if (p.distanceTo(v3(EYE.x, EYE.y, Math.sign(p.z) * PUFF_BODY.sideZ(EYE.x, EYE.y))) < 7) continue
    if (x > 18.5 && Math.abs(p.y) < 5) continue
    const slope = (r(x + 0.5) - r(x - 0.5))
    const n = v3(-slope, Math.cos(theta), Math.sin(theta) / flat).normalize()
    // Lying flat: along the surface, pointing toward the tail.
    const back = v3(-1, 0, 0)
    const flatDir = back.sub(n.clone().multiplyScalar(n.dot(back))).normalize().addScaledVector(n, 0.22).normalize()
    spines.push({ p, n, flat: flatDir })
  }
  return { body: PUFF_BODY.geometry(44), fins: mergeGeometries(fins)!, spines }
})

const spineGeo = new THREE.ConeGeometry(0.75, 1, 5).translate(0, 0.5, 0)
const spineMat = new THREE.MeshPhysicalMaterial({ color: 0xcdb676, roughness: 0.45, clearcoat: 0.4 })
const beakMat = new THREE.MeshPhysicalMaterial({ color: 0xf2ead2, roughness: 0.35, clearcoat: 0.8 })

export function buildPuffer(size: number) {
  const geo = pufferGeometry()
  // Barely flexes: a gentle wave confined to the tail stem.
  const swim = swimUniforms(-4, -26, 0.12, 0.8)
  const group = new THREE.Group()
  const inner = new THREE.Group() // scaled by size; body and spines inside
  inner.scale.setScalar(size)
  inner.name = 'inner'
  const body = new THREE.Group() // scaled by inflation
  body.name = 'body'
  body.add(swimMesh(geo.body, skinMaterial(pufferSkin(), scaleTexture(16, 9), swim, {
    bumpScale: 0.35, roughness: 0.5, clearcoat: 0.5, glow: 0.18,
  }), swim))
  body.add(swimMesh(geo.fins, finMaterial(pufferFinTex(), swim, 0.2), swim))
  addEyes(body, {
    x: EYE.x, y: EYE.y, surfaceZ: PUFF_BODY.sideZ(EYE.x, EYE.y), radius: 4.4, iris: 0xb9c24a, rim: 0x1e1a08, bulge: 0.28,
  })
  // Little beak: upper and lower plates at the nose.
  for (const [y, sy] of [[0.4, 1.1], [-1.6, 1]] as const) {
    const plate = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), beakMat)
    plate.scale.set(1.7, sy, 2.3)
    plate.position.set(PUFF_BODY.noseX - 0.6, y, 0)
    body.add(plate)
  }
  inner.add(body)

  // Spines live outside the inflating body group so they don't get squashed by
  // its non-uniform scale; posePuffer places them on the inflated surface.
  const spines = new THREE.InstancedMesh(spineGeo, spineMat, geo.spines.length)
  spines.name = 'spines'
  spines.frustumCulled = false // bounds change as it inflates
  inner.add(spines)
  group.add(inner)
  group.userData.swim = swim
  group.userData.lastPuff = -1
  posePuffer(group, 0, 0, 0)
  return group
}

const tmp = {
  m: new THREE.Matrix4(),
  q: new THREE.Quaternion(),
  p: new THREE.Vector3(),
  n: new THREE.Vector3(),
  d: new THREE.Vector3(),
  s: new THREE.Vector3(),
  up: new THREE.Vector3(0, 1, 0),
}

/** Inflation growth along the body, and across it. It rounds out into a ball. */
export const PUFFER_GROWTH = { length: 0.45, girth: 0.9 }

/** Pose a puffer for its inflation (0 = calm, 1 = fully puffed; may overshoot). */
export function posePuffer(root: THREE.Object3D, puff: number, time: number, phase: number) {
  const swim = root.userData.swim as SwimUniforms
  // Flutter faster when puffed: it's working to hold position.
  swim.uPhase.value = time * (6 + puff * 3) + phase
  swim.uSwim.value = 0.8 * (1 - Math.min(1, puff) * 0.6)

  const body = root.getObjectByName('body')!
  const gx = 1 + PUFFER_GROWTH.length * puff
  const gyz = 1 + PUFFER_GROWTH.girth * puff
  body.scale.set(gx, gyz, gyz)
  // Gentle roll while calm; rotate the parent so the spines roll with the body.
  const inner = root.getObjectByName('inner')!
  inner.rotation.x = Math.sin(time * 1.5 + phase) * 0.1 * (1 - Math.min(1, puff))
  inner.rotation.z = Math.sin(time * 40) * 0.025 * Math.min(1, puff) // puffed: rigid, trembling

  // Only rebuild spine matrices when inflation actually changes.
  if (Math.abs(puff - (root.userData.lastPuff as number)) < 0.002) return
  root.userData.lastPuff = puff
  const spines = root.getObjectByName('spines') as THREE.InstancedMesh
  const erect = THREE.MathUtils.smoothstep(puff, 0.05, 0.75)
  const length = lerp(2.4, 8.5, Math.min(1.1, puff))
  const data = pufferGeometry().spines
  data.forEach((sp, i) => {
    // Surface point and normal on the scaled body.
    tmp.p.set(sp.p.x * gx, sp.p.y * gyz, sp.p.z * gyz)
    tmp.n.set(sp.n.x / gx, sp.n.y / gyz, sp.n.z / gyz).normalize()
    tmp.d.copy(sp.flat).lerp(tmp.n, erect).normalize()
    tmp.p.addScaledVector(tmp.n, -0.4) // root the spine just under the skin
    tmp.q.setFromUnitVectors(tmp.up, tmp.d)
    tmp.s.set(1, length, 1)
    spines.setMatrixAt(i, tmp.m.compose(tmp.p, tmp.q, tmp.s))
  })
  spines.instanceMatrix.needsUpdate = true
}
