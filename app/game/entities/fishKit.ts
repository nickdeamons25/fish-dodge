import * as THREE from 'three'

/**
 * Shared building blocks for the detailed fish models (clownfish, blue fish,
 * pufferfish): lathed bodies with painted skins, swimming vertex shaders,
 * rippling fin membranes and glossy eyes.
 *
 * Conventions: every model faces +X with Y up. Geometry is authored in fish
 * space with transforms baked in, so the shader's body wave (a function of x)
 * lines up across body and fins.
 */

export const lerp = THREE.MathUtils.lerp
export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
export const Z = v3(0, 0, 1)

// ---- Textures -------------------------------------------------------------------
export function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, srgb = true) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  draw(canvas.getContext('2d')!)
  const tex = new THREE.CanvasTexture(canvas)
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

const scaleTextures = new Map<string, THREE.Texture>()

/** Faint overlapping scales for a bump map, tiled `repeat` times around × along the body. */
export function scaleTexture(repeatU: number, repeatV: number) {
  const key = `${repeatU}x${repeatV}`
  const cached = scaleTextures.get(key)
  if (cached) return cached
  const S = 256
  const tex = canvasTex(S, S, (c) => {
    c.fillStyle = '#808080'
    c.fillRect(0, 0, S, S)
    const cell = 32
    // Rows drawn back-to-front so each row of scales overlaps the one behind it.
    for (let row = -1; row <= S / cell + 1; row++) {
      for (let col = -1; col <= S / cell + 1; col++) {
        const cx = col * cell + (row % 2 ? cell / 2 : 0)
        const cy = row * cell * 0.75
        const g = c.createRadialGradient(cx, cy - 6, 2, cx, cy, cell * 0.72)
        g.addColorStop(0, '#b4b4b4')
        g.addColorStop(0.7, '#8c8c8c')
        g.addColorStop(0.92, '#5c5c5c')
        g.addColorStop(1, 'rgba(92,92,92,0)')
        c.fillStyle = g
        c.beginPath()
        c.arc(cx, cy, cell * 0.72, 0, Math.PI * 2)
        c.fill()
      }
    }
  }, false)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeatU, repeatV)
  scaleTextures.set(key, tex)
  return tex
}

// ---- Body ---------------------------------------------------------------------------
/**
 * A fish body lathed from a side-on profile of (x, height-radius) points,
 * tail → nose, then flattened side to side by `flat`.
 *
 * Skin UVs: U runs around the body (0.5 = back, 0/1 = belly, where the lathe
 * seam is hidden), V runs along it (0 = tail, 1 = nose) linearly in x, so skin
 * features can be painted at exact body positions.
 */
export class BodyProfile {
  readonly tailX: number
  readonly noseX: number
  readonly length: number
  private pts: THREE.Vector3[]

  constructor(profile: [number, number][], readonly flat: number) {
    this.tailX = profile[0]![0]
    this.noseX = profile.at(-1)![0]
    this.length = this.noseX - this.tailX
    const curve = new THREE.CatmullRomCurve3(profile.map(([x, r]) => new THREE.Vector3(r, x, 0)))
    this.pts = curve.getPoints(140) // dense sampling for a smooth silhouette
  }

  /** Height-radius at x (for seating fins and eyes on the surface). */
  radiusAt(x: number) {
    const p = this.pts
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1]!
      const b = p[i]!
      if ((a.y - x) * (b.y - x) <= 0) return a.x + (b.x - a.x) * ((x - a.y) / (b.y - a.y || 1))
    }
    return 0
  }

  /** Half-width of the body at (x, y) — where the side surface is. */
  sideZ(x: number, y: number) {
    return this.flat * Math.sqrt(Math.max(0, this.radiusAt(x) ** 2 - y ** 2))
  }

  /** Canvas row for body position x in a skin texture of height `h` (row 0 = nose). */
  rowOf(x: number, h: number) {
    return (1 - (x - this.tailX) / this.length) * h
  }

  geometry(segments = 48) {
    const g = new THREE.LatheGeometry(this.pts.map(p => new THREE.Vector2(Math.max(0, p.x), p.y)), segments)
    g.rotateZ(-Math.PI / 2) // lathe axis Y → fish axis X
    g.rotateX(Math.PI / 2) // UV seam along the belly, out of sight
    g.scale(1, 1, this.flat)
    const pos = g.getAttribute('position') as THREE.BufferAttribute
    const uv = g.getAttribute('uv') as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) uv.setY(i, (pos.getX(i) - this.tailX) / this.length)
    g.computeVertexNormals()
    return g
  }
}

/** Height around the body for a skin-texture column: +1 on the back, -1 on the belly. */
export const heightAround = (u: number) => -Math.cos(u * Math.PI * 2)

// ---- Swimming shader ------------------------------------------------------------------
/**
 * Per-fish swimming state. Each fish owns one set, shared by its body and fin
 * materials. The wave shape is per species.
 */
export interface SwimUniforms {
  uPhase: { value: number }
  /** Sideways flex amplitude, in model units. */
  uSwim: { value: number }
  /** The flex ramps from nothing at x = uWaveFrom to full at x = uWaveTo (toward the tail). */
  uWaveFrom: { value: number }
  uWaveTo: { value: number }
  /** Wavenumber along the body; larger = more S-curves along its length. */
  uWaveK: { value: number }
}

export function swimUniforms(from: number, to: number, k: number, amp: number): SwimUniforms {
  return {
    uPhase: { value: 0 },
    uSwim: { value: amp },
    uWaveFrom: { value: from },
    uWaveTo: { value: to },
    uWaveK: { value: k },
  }
}

const SWIM_GLSL = /* glsl */ `
  uniform float uPhase;
  uniform float uSwim;
  uniform float uWaveFrom;
  uniform float uWaveTo;
  uniform float uWaveK;
  #ifdef FIN
    attribute vec2 finUV;
    attribute vec3 finNormal;
    attribute vec4 finWave; // amp, phase rate, wave along V, wave along U
  #endif
  // Sideways flex: nothing at the head, growing toward the tail, travelling tailward.
  float bodyWave(float x) {
    float w = smoothstep(uWaveFrom, uWaveTo, x);
    return uSwim * w * w * sin(uPhase + x * uWaveK);
  }
`

/** Patch a material to swim. Fin materials need `defines.FIN` and fin attributes. */
export function addSwim(material: THREE.Material, uniforms: SwimUniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SWIM_GLSL}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        {
          // Tilt normals with the flex (inverse-transpose of the shear z += f(x)).
          float slope = (bodyWave(position.x + 0.5) - bodyWave(position.x - 0.5));
          objectNormal.x -= slope * objectNormal.z;
        }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.z += bodyWave(position.x);
        #ifdef FIN
          // Membrane wave: rolls from base to tip (and along the base), growing toward the tip.
          float membrane = finWave.x * pow(finUV.y, 1.35)
            * sin(uPhase * finWave.y - finUV.y * finWave.z - finUV.x * finWave.w);
          transformed += finNormal * membrane;
        #endif`)
  }
}

export interface SkinOptions {
  bumpScale?: number
  roughness?: number
  clearcoat?: number
  /** Self-illumination from the skin itself, so colours stay vivid in the blue water. */
  glow?: number
  iridescence?: number
}

/** Body material: painted skin, faint scales, wet sheen, swimming. */
export function skinMaterial(map: THREE.Texture, bump: THREE.Texture | null, uniforms: SwimUniforms, o: SkinOptions = {}) {
  const mat = new THREE.MeshPhysicalMaterial({
    map,
    emissiveMap: map,
    emissive: 0xffffff,
    emissiveIntensity: o.glow ?? 0.22,
    bumpMap: bump,
    bumpScale: o.bumpScale ?? 0.55,
    roughness: o.roughness ?? 0.42,
    clearcoat: o.clearcoat ?? 0.6,
    clearcoatRoughness: 0.35,
    iridescence: o.iridescence ?? 0,
    iridescenceIOR: 1.35,
  })
  addSwim(mat, uniforms)
  return mat
}

/** Fin material: double-sided membrane that ripples with the fish. */
/**
 * Fin material: double-sided membrane that ripples with the fish. Texture alpha
 * (e.g. a translucent fringe) is resolved with alpha-to-coverage, which uses the
 * pipeline's MSAA for soft edges without transparency sorting.
 */
export function finMaterial(map: THREE.Texture, uniforms: SwimUniforms, glow = 0.18) {
  const mat = new THREE.MeshPhysicalMaterial({
    map,
    emissiveMap: map,
    emissive: 0xffffff,
    emissiveIntensity: glow,
    roughness: 0.6,
    side: THREE.DoubleSide,
    clearcoat: 0.12,
    alphaToCoverage: true,
  })
  mat.defines = { FIN: '' }
  addSwim(mat, uniforms)
  return mat
}

/**
 * Build a swimming mesh. It also carries a matching depth material (same wave,
 * double-sided) for the depth-of-field depth pass; without it the depth image
 * would show the fish unbent and miss back-facing fins, blurring their edges.
 */
export function swimMesh(geometry: THREE.BufferGeometry, material: THREE.Material, uniforms: SwimUniforms) {
  const mesh = new THREE.Mesh(geometry, material)
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide })
  if ((material as THREE.ShaderMaterial).defines?.FIN !== undefined) depth.defines = { FIN: '' }
  addSwim(depth, uniforms)
  mesh.userData.depthMaterial = depth
  return mesh
}

// ---- Fins -----------------------------------------------------------------------------
export type FinShape = (s: number, t: number) => THREE.Vector3
/** Membrane wave: [amplitude, phase rate relative to the body, wave along V (base→tip), wave along U]. */
export type FinWave = [number, number, number, number]

/** A subdivided membrane over (s, t) ∈ [0,1]², carrying its wave parameters. */
export function finGeometry(shape: FinShape, normal: THREE.Vector3, wave: FinWave, nu = 14, nv = 9) {
  const positions: number[] = []
  const uvs: number[] = []
  const normals: number[] = []
  const waves: number[] = []
  const index: number[] = []
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const s = i / nu
      const t = j / nv
      const p = shape(s, t)
      positions.push(p.x, p.y, p.z)
      uvs.push(s, t)
      normals.push(normal.x, normal.y, normal.z)
      waves.push(...wave)
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i
      const b = a + 1
      const c = a + nu + 1
      const d = c + 1
      index.push(a, c, b, b, c, d)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setAttribute('finUV', new THREE.Float32BufferAttribute(uvs, 2))
  g.setAttribute('finNormal', new THREE.Float32BufferAttribute(normals, 3))
  g.setAttribute('finWave', new THREE.Float32BufferAttribute(waves, 4))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

/**
 * Outward normal for a paired fin whose base runs along `baseDir` and which
 * reaches toward `tip` from `baseMid`; mirrored per side so pairs move together.
 */
export function pairedFinNormal(baseDir: THREE.Vector3, baseMid: THREE.Vector3, tip: THREE.Vector3, side: number) {
  return baseDir.clone().cross(tip.clone().sub(baseMid)).normalize().multiplyScalar(side)
}

// ---- Eyes -----------------------------------------------------------------------------
const eyeSphere = new THREE.SphereGeometry(1, 24, 16)
const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
const pupilMat = new THREE.MeshPhysicalMaterial({ color: 0x050302, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02 })

export interface EyeOptions {
  x: number
  y: number
  /** Z of the body surface at the eye (use BodyProfile.sideZ). */
  surfaceZ: number
  radius: number
  iris: number
  rim?: number
  /** How far the eye bulges out of the head, as a fraction of its radius. */
  bulge?: number
}

/** A glossy eye on each side: dark rim, coloured iris, black pupil and a catch-light. */
export function addEyes(group: THREE.Object3D, o: EyeOptions) {
  const rimMat = new THREE.MeshPhysicalMaterial({ color: o.rim ?? 0x120a04, roughness: 0.3, clearcoat: 1 })
  const irisMat = new THREE.MeshPhysicalMaterial({
    color: o.iris, emissive: o.iris, emissiveIntensity: 0.18, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05,
  })
  const r = o.radius
  const out = (o.bulge ?? 0) * r
  for (const side of [-1, 1]) {
    const add = (mat: THREE.Material, s: [number, number, number], dx: number, dy: number, z: number) => {
      const m = new THREE.Mesh(eyeSphere, mat)
      m.scale.set(s[0] * r, s[1] * r, s[2] * r)
      m.position.set(o.x + dx * r, o.y + dy * r, (o.surfaceZ + out + z * r) * side)
      group.add(m)
    }
    add(rimMat, [1, 1, 0.65], 0, 0, -0.28)
    add(irisMat, [0.87, 0.87, 0.6], 0, 0, -0.17)
    add(pupilMat, [0.5, 0.5, 0.4], 0.04, 0, 0.13)
    add(glintMat, [0.15, 0.15, 0.09], 0.28, 0.3, 0.46)
  }
}
