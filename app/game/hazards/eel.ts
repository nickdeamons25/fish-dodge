import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { addEyes, canvasTex } from '../entities/fishKit'
import { flow } from '../tank/space'

/**
 * Moray eel living in a rocky den.
 *
 *  - Body: one static tube bent along a spine curve entirely in the vertex
 *    shader (no per-frame geometry rebuild). Slightly compressed side to side,
 *    with a continuous dorsal fin ridge down its back.
 *  - Skin: a moray's reticulated pattern (dark blotches in a paler network), a
 *    lighter throat, fine skin relief and a strong wet clearcoat.
 *  - Head: tapered snout, a hinged lower jaw that slowly gapes (morays breathe
 *    by pumping their mouths), teeth, a dark mouth, gold eyes, tube nostrils.
 *  - Den: a smooth craggy rock with a shadowed hole and a few encrusting sponges.
 *
 * The body's spine is evaluated identically in GLSL and in TypeScript (to seat
 * the head), so keep `spineAt` and SPINE_GLSL in step.
 */

/** Full body length; longer than the reach so the tail always stays hidden in the den. */
const LENGTH = 260
const HOLE_Y = 18
const RADIUS = 7.4

interface EelUniforms {
  uExt: { value: number }
  uTime: { value: number }
  uPhase: { value: number }
  /** +1 / -1: world X direction toward the player. */
  uFace: { value: number }
  [key: string]: THREE.IUniform
}

const SPINE_GLSL = /* glsl */ `
  uniform float uExt;
  uniform float uTime;
  uniform float uPhase;
  uniform float uFace;
  const float LENGTH = ${LENGTH.toFixed(1)};
  const float HOLE_Y = ${HOLE_Y.toFixed(1)};
  const float RADIUS = ${RADIUS.toFixed(2)};

  // s = 0 at the head, 1 at the tail (deep in the den).
  vec3 spine(float s) {
    float h = uExt - s * LENGTH;              // height above the hole
    float free = clamp(h / 70.0, 0.0, 1.0);   // only the part out of the hole sways
    float x = sin(uTime * 1.4 + uPhase - s * 7.0) * 9.0 * free;
    float z = cos(uTime * 1.0 + uPhase - s * 6.0) * 4.0 * free;
    // The neck arcs forward toward the player.
    float q = s * LENGTH / max(uExt, 1.0);
    float neck = (1.0 - smoothstep(0.0, 0.45, q)) * free;
    x += uFace * 14.0 * neck * neck;
    return vec3(x, HOLE_Y + h, z);
  }
  float bodyRadius(float s) { return RADIUS * (0.97 + 0.05 * smoothstep(0.0, 0.08, s) - 0.2 * smoothstep(0.3, 1.0, s)); }

  // Point and cross-section frame on the spine for the tube vertex at local y.
  void eelFrame(float y, out float s, out vec3 C, out vec3 N1, out vec3 N2) {
    s = 0.5 - y;
    C = spine(s);
    vec3 T = normalize(spine(s + 0.004) - spine(s - 0.004));
    N1 = normalize(cross(T, vec3(0.0, 0.0, 1.0)));
    // Tube local (x, y, z) maps to (N1, -T, N2); keep that basis right-handed
    // or the winding flips and front faces get culled.
    N2 = normalize(cross(T, N1));
  }
`

/** TypeScript twin of the GLSL spine, used to seat the head. */
function spineAt(s: number, ext: number, time: number, phase: number, face: number, out = new THREE.Vector3()) {
  const h = ext - s * LENGTH
  const free = THREE.MathUtils.clamp(h / 70, 0, 1)
  let x = Math.sin(time * 1.4 + phase - s * 7) * 9 * free
  const z = Math.cos(time * 1.0 + phase - s * 6) * 4 * free
  const q = (s * LENGTH) / Math.max(ext, 1)
  const neck = (1 - THREE.MathUtils.smoothstep(q, 0, 0.45)) * free
  x += face * 14 * neck * neck
  return out.set(x, HOLE_Y + h, z)
}

function bodyPatch(shader: THREE.WebGLProgramParametersWithUniforms, u: EelUniforms, colour: boolean) {
  Object.assign(shader.uniforms, u)
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      ${SPINE_GLSL}
      varying float vFront;`)
    // (The depth material has no normal step, so each step derives the frame itself.)
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      {
        float s; vec3 C; vec3 N1; vec3 N2;
        eelFrame(position.y, s, C, N1, N2);
        // Cross-section: compressed side to side (N2 ≈ the eel's flanks).
        objectNormal = normalize(N1 * position.x + N2 * position.z / 0.82);
      }`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        float eelS; vec3 eelC; vec3 eelN1; vec3 eelN2;
        eelFrame(position.y, eelS, eelC, eelN1, eelN2);
        float cx = position.x;
        float cz = position.z;
        // Dorsal fin ridge runs down the back (the side facing away from the player).
        float keel = pow(max(0.0, cx * uFace), 10.0) * 3.2;
        float r = bodyRadius(eelS);
        transformed = eelC + eelN1 * cx * (r + keel) + eelN2 * cz * r * 0.82;
        ${colour ? 'vFront = -cx * uFace;' : ''}
      }`)
  if (!colour) return
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      varying float vFront;`)
    .replace('#include <map_fragment>', `#include <map_fragment>
      // Paler throat and belly, on the side facing the player.
      diffuseColor.rgb *= mix(1.0, 1.5, smoothstep(0.2, 1.0, vFront));`)
}

// ---- Textures -------------------------------------------------------------------------------
let shared: {
  body: THREE.BufferGeometry
  skin: THREE.Texture
  bump: THREE.Texture
  den: THREE.BufferGeometry
  headUpper: THREE.BufferGeometry
  headLower: THREE.BufferGeometry
  teethUpper: THREE.BufferGeometry
  teethLower: THREE.BufferGeometry
} | undefined

function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
}

/** Reticulated moray pattern: dark brown blotches in a paler tan network. Seamless around. */
function skinTexture() {
  const W = 256 // around the body
  const H = 1024 // along it
  const tex = canvasTex(W, H, (c) => {
    c.fillStyle = '#b89666'
    c.fillRect(0, 0, W, H)
    const r = rng(9)
    c.filter = 'blur(2px)'
    for (let i = 0; i < 520; i++) {
      const x = r() * W
      const y = r() * H
      const rx = 7 + r() * 11
      const ry = 6 + r() * 12
      const shade = 40 + Math.floor(r() * 30)
      c.fillStyle = `rgb(${shade + 36},${shade + 18},${shade - 8})`
      for (const dx of [-W, 0, W]) {
        c.beginPath()
        c.ellipse(x + dx, y, rx, ry, r() * Math.PI, 0, Math.PI * 2)
        c.fill()
      }
    }
    c.filter = 'none'
    // Fine speckle.
    for (let i = 0; i < 2500; i++) {
      c.fillStyle = r() > 0.5 ? 'rgba(230,200,140,0.18)' : 'rgba(40,25,10,0.18)'
      c.fillRect(r() * W, r() * H, 1.5, 1.5)
    }
  })
  tex.wrapS = THREE.RepeatWrapping
  return tex
}

/** Fine skin relief (pores and creases) for the bump map. */
function bumpTexture() {
  const S = 256
  const tex = canvasTex(S, S, (c) => {
    c.fillStyle = '#808080'
    c.fillRect(0, 0, S, S)
    const r = rng(4)
    for (let i = 0; i < 900; i++) {
      const v = Math.floor(90 + r() * 80)
      c.fillStyle = `rgba(${v},${v},${v},0.5)`
      const x = r() * S
      const y = r() * S
      const rad = 1 + r() * 3
      for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
        c.beginPath()
        c.arc(x + dx, y + dy, rad, 0, Math.PI * 2)
        c.fill()
      }
    }
  }, false)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(3, 12)
  return tex
}

// ---- Geometry -------------------------------------------------------------------------------
/** Head profile along +X (x, radius), from the neck to the snout tip. */
const HEAD_PROFILE: [number, number][] = [
  [-6, 7.6], [-1, 8.2], [4, 7.9], [9, 6.6], [13, 5], [16.5, 3.4], [19, 1.8], [20.2, 0.6], [20.5, 0],
]

/** Half of a lathed head: `top` = skull, otherwise the lower jaw. */
function headHalf(top: boolean) {
  const pts = new THREE.SplineCurve(HEAD_PROFILE.map(([x, r]) => new THREE.Vector2(r, x))).getPoints(24)
  const g = new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(Math.max(0, p.x), p.y)), 24, top ? Math.PI : 0, Math.PI)
  g.rotateZ(-Math.PI / 2) // lathe axis Y → X; phi π..2π is the top half
  g.scale(1, top ? 0.95 : 0.7, 0.84)
  g.computeVertexNormals()
  return g
}

function teeth(y: number, dir: number) {
  const cones: THREE.BufferGeometry[] = []
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const x = 7 + i * 2
      const cone = new THREE.ConeGeometry(0.45, 1.8 - i * 0.12, 5)
      if (dir < 0) cone.rotateX(Math.PI)
      cone.translate(x, y + dir * 0.7, side * (4.6 - i * 0.55))
      cones.push(cone)
    }
  }
  return mergeGeometries(cones)!
}

/** Smooth craggy noise from a few sine octaves, for a direction on the unit sphere. */
function denNoise(v: THREE.Vector3) {
  return Math.sin(v.x * 3.1 + v.y * 1.7) * 0.12 + Math.sin(v.z * 4.3 - v.x * 2.2) * 0.08
    + Math.sin(v.y * 7.1 + v.z * 5.3) * 0.04
}

function denGeometry() {
  // Weld the icosphere's vertices first, or every face gets its own flat normal.
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 4).deleteAttribute('normal').deleteAttribute('uv'))
  const p = g.getAttribute('position') as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    v.multiplyScalar(1 + denNoise(v))
    p.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  return g
}

function assets() {
  if (shared) return shared
  const body = new THREE.CylinderGeometry(1, 1, 1, 18, 110, true)
  shared = {
    body,
    skin: skinTexture(),
    bump: bumpTexture(),
    den: denGeometry(),
    headUpper: headHalf(true),
    headLower: headHalf(false),
    teethUpper: teeth(-0.2, -1),
    teethLower: teeth(0.2, 1),
  }
  return shared
}

// ---- Assembly -------------------------------------------------------------------------------
export function buildEel() {
  const a = assets()
  const u: EelUniforms = { uExt: { value: 0 }, uTime: { value: 0 }, uPhase: { value: 0 }, uFace: { value: -1 } }
  const root = new THREE.Group()
  root.userData.uniforms = u

  // Den: craggy rock with a dark hole and a few encrusting sponges.
  const denMat = new THREE.MeshStandardMaterial({ color: 0x6a6f78, roughness: 0.92 })
  const den = new THREE.Mesh(a.den, denMat)
  den.scale.set(38, 23, 38)
  den.position.y = 1
  root.add(den)
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(10.5, 9, 10, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x040a10, side: THREE.BackSide }))
  hole.position.y = 19
  root.add(hole)
  const holeFloor = new THREE.Mesh(new THREE.CircleGeometry(9, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x02060a }))
  holeFloor.position.y = 14.5
  root.add(holeFloor)
  const r = rng(13)
  const spongeColours = [0xc9577a, 0xe0a040, 0x7f5ab8, 0xd07a50]
  for (let i = 0; i < 7; i++) {
    const sponge = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshStandardMaterial({
      color: spongeColours[i % spongeColours.length], roughness: 0.8,
    }))
    // On the rock's actual surface: a direction on the sphere, displaced like the den.
    const ang = r() * Math.PI * 2
    const el = 0.25 + r() * 0.75
    const dir = new THREE.Vector3(Math.cos(ang) * Math.cos(el), Math.sin(el), Math.sin(ang) * Math.cos(el))
    const k = 0.97 * (1 + denNoise(dir))
    sponge.position.set(dir.x * 38 * k, 1 + dir.y * 23 * k, dir.z * 38 * k)
    sponge.scale.setScalar(1.5 + r() * 2.5)
    root.add(sponge)
  }

  // Body: bent in the shader; wet, glossy, patterned.
  const bodyMat = new THREE.MeshPhysicalMaterial({
    map: a.skin, bumpMap: a.bump, bumpScale: 0.6, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.14,
    emissive: 0x2a1a08, emissiveIntensity: 0.25,
  })
  bodyMat.onBeforeCompile = s => bodyPatch(s, u, true)
  const body = new THREE.Mesh(a.body, bodyMat)
  body.frustumCulled = false
  const bodyDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide })
  bodyDepth.onBeforeCompile = s => bodyPatch(s, u, false)
  body.userData.depthMaterial = bodyDepth
  body.name = 'body'
  root.add(body)

  // Head: skull + hinged jaw, both wearing the same skin.
  const headMat = new THREE.MeshPhysicalMaterial({
    map: a.skin, bumpMap: a.bump, bumpScale: 0.4, roughness: 0.36, clearcoat: 1, clearcoatRoughness: 0.12,
    emissive: 0x2a1a08, emissiveIntensity: 0.25, side: THREE.DoubleSide,
  })
  const toothMat = new THREE.MeshPhysicalMaterial({ color: 0xf4eee0, roughness: 0.3, clearcoat: 0.6 })
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x4a1010, roughness: 0.6 })
  const head = new THREE.Group()
  head.name = 'head'
  head.add(new THREE.Mesh(a.headUpper, headMat))
  head.add(new THREE.Mesh(a.teethUpper, toothMat))
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), mouthMat)
  mouth.scale.set(9, 2.2, 4)
  mouth.position.set(10, -0.6, 0)
  head.add(mouth)
  const jaw = new THREE.Group()
  jaw.name = 'jaw'
  jaw.position.set(-3, -0.2, 0) // hinge at the back of the mouth
  const lower = new THREE.Mesh(a.headLower, headMat)
  const lowerTeeth = new THREE.Mesh(a.teethLower, toothMat)
  lower.position.x = lowerTeeth.position.x = 3
  jaw.add(lower, lowerTeeth)
  head.add(jaw)
  addEyes(head, { x: 11, y: 3.3, surfaceZ: 4.2, radius: 1.9, iris: 0xe0b84a, rim: 0x1a1206, bulge: 0.15 })
  const nostrilMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1c, roughness: 0.5 })
  for (const side of [-1, 1]) {
    const nostril = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.8, 8), nostrilMat)
    nostril.position.set(18.2, 1.8, side * 1.4)
    nostril.rotation.z = -1.1
    head.add(nostril)
  }
  root.add(head)
  return root
}

const tmp = { a: new THREE.Vector3(), b: new THREE.Vector3() }

/** Pose the eel risen `extension` above the hole. */
export function poseEel(root: THREE.Object3D, extension: number, time: number, phase: number) {
  const u = root.userData.uniforms as EelUniforms
  const face = flow.value > 0 ? -1 : 1 // world X direction toward the player
  u.uExt.value = extension
  u.uTime.value = time
  u.uPhase.value = phase
  u.uFace.value = face

  const out = extension > 3
  const body = root.getObjectByName('body')!
  const head = root.getObjectByName('head')!
  body.visible = head.visible = out
  if (!out) return

  // Seat the head just inside the tube's end so the skull's back caps it, facing
  // along the neck.
  const tip = spineAt(0, extension, time, phase, face, tmp.a)
  const next = spineAt(0.03, extension, time, phase, face, tmp.b)
  const dir = tip.clone().sub(next).normalize() // neck direction, pointing out of the head
  head.position.copy(tip).addScaledVector(dir, -3)
  head.rotation.set(0, face > 0 ? 0 : Math.PI, 0)
  // Pitch from the neck's lean toward the player, plus a slow nod.
  const pitch = Math.atan2(dir.y, Math.abs(dir.x) + 1e-3) * 0.75 + Math.sin(time * 1.3 + phase) * 0.12
  head.rotation.z = pitch
  // Slow breathing gape.
  const gape = 0.12 + 0.3 * Math.max(0, Math.sin(time * 1.8 + phase))
  head.getObjectByName('jaw')!.rotation.z = -gape
}
