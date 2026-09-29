import * as THREE from 'three'
import { TANK } from '../constants'

/**
 * Seaweed as real 3D blades rather than textured cards.
 *
 * One shared ribbon geometry is instanced hundreds of times; each instance
 * carries its base position, size, sway and colour. The vertex shader tapers
 * and bends each blade (more toward the tip, on two overlapping waves, leaning
 * with the current) and scrolls it with the world, wrapping along the tank —
 * so the whole bed is one draw call with no per-frame CPU work.
 */

const H = TANK.height
const D = TANK.depth
const LEN = TANK.maxA - TANK.minA

/** Deterministic pseudo-random, so the bed is laid out the same every load. */
function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
}

interface Kind {
  height: [number, number]
  width: [number, number]
  /** Tip sway per unit of bend. */
  sway: number
  /** Wavy-edge amount (kelp ruffles). */
  wave: number
  /** Blades per clump. */
  blades: [number, number]
  /** Spread of a clump's blade bases. */
  spread: number
  /** Linear-space tints to pick from. */
  tints: [number, number, number][]
}

const KINDS = {
  kelp: {
    height: [130, 235], width: [10, 15], sway: 0.11, wave: 0.18, blades: [3, 6], spread: 11,
    tints: [[0.2, 0.4, 0.07], [0.28, 0.34, 0.06], [0.14, 0.36, 0.09]],
  },
  seagrass: {
    height: [55, 125], width: [2.2, 3.6], sway: 0.2, wave: 0, blades: [7, 12], spread: 14,
    tints: [[0.1, 0.42, 0.16], [0.16, 0.5, 0.12], [0.08, 0.34, 0.14]],
  },
  lettuce: {
    height: [32, 58], width: [13, 19], sway: 0.1, wave: 0.1, blades: [3, 5], spread: 8,
    tints: [[0.24, 0.58, 0.2], [0.3, 0.62, 0.16]],
  },
  red: {
    height: [36, 68], width: [3.5, 5], sway: 0.16, wave: 0.05, blades: [4, 7], spread: 8,
    tints: [[0.45, 0.1, 0.08], [0.5, 0.14, 0.12]],
  },
} satisfies Record<string, Kind>

const SWAY_GLSL = /* glsl */ `
  attribute vec4 aBase;  // x, z, yaw, static lean
  attribute vec4 aShape; // height, width, sway, phase
  attribute vec4 aTint;  // rgb (linear), wavy edge
  uniform float uTime;
  uniform float uScroll;
  uniform float uFlow;
  uniform float uMinX;
  uniform float uLen;
  uniform float uRear; // 0..1: how far blades have turned to face the rear camera
  varying vec3 vTint;
  varying float vH;
  varying float vAcross;

  // Blades mostly face the side cameras; in rear view they turn most of the way
  // toward the camera looking down the tank, so they don't read as edge-on sticks.
  float bladeYaw() { return mix(aBase.z, 1.5708 + (aBase.z - 1.5708) * 0.25, uRear); }

  vec3 bladeOffset(vec3 p) {
    float h = p.y;
    // Taper to a point, slightly fuller through the middle; kelp ruffles its edges.
    float taper = (1.0 - 0.85 * h * h) * (0.75 + 0.25 * sin(h * 3.1416));
    float ruffle = 1.0 + aTint.w * sin(h * 22.0 + aShape.w * 3.0);
    vec3 across = vec3(cos(bladeYaw()), 0.0, sin(bladeYaw())) * p.x * aShape.y * taper * ruffle;
    // Bend grows with the square of height: stiff at the base, loose at the tip.
    float bend = h * h * aShape.x;
    float t = uTime * 1.1 + aShape.w;
    float swayX = (sin(t + h * 2.2) * 0.7 + sin(t * 1.9 + h * 4.0) * 0.3) * aShape.z;
    float swayZ = cos(t * 0.8 + h * 1.7) * aShape.z * 0.6;
    float lean = -uFlow * 0.12 + aBase.w; // lean downstream with the current
    return across + vec3((swayX + lean) * bend, h * aShape.x, swayZ * bend);
  }
`

function patchVertex(shader: { vertexShader: string, uniforms: Record<string, THREE.IUniform> }, uniforms: Record<string, THREE.IUniform>) {
  Object.assign(shader.uniforms, uniforms)
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${SWAY_GLSL}`)
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      objectNormal = vec3(-sin(bladeYaw()), 0.0, cos(bladeYaw()));`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      // Scroll with the world and wrap along the tank.
      float baseX = mod(aBase.x - uScroll - uMinX, uLen) + uMinX;
      transformed = vec3(baseX, 0.0, aBase.y) + bladeOffset(position);
      vTint = aTint.rgb;
      vH = position.y;
      vAcross = position.x;`)
}

export class Seaweed {
  readonly mesh: THREE.Mesh
  private uniforms = {
    uTime: { value: 0 },
    uScroll: { value: 0 },
    uFlow: { value: 1 },
    uMinX: { value: TANK.minA },
    uLen: { value: LEN },
    uRear: { value: 1 },
  }

  constructor() {
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.copy(ribbon() as unknown as THREE.InstancedBufferGeometry)

    const base: number[] = []
    const shape: number[] = []
    const tint: number[] = []
    const r = rng(17)
    const range = ([a, b]: [number, number]) => a + r() * (b - a)
    const plant = (kind: Kind, z0: number, z1: number, maxHeight = Infinity) => {
      const x = TANK.minA + r() * LEN
      const z = z0 + r() * (z1 - z0)
      const count = Math.round(range(kind.blades))
      const t = kind.tints[Math.floor(r() * kind.tints.length)]!
      for (let i = 0; i < count; i++) {
        const a = r() * Math.PI * 2
        const d = Math.sqrt(r()) * kind.spread
        // Most blades face the side cameras so they read broad, not as sticks;
        // the rest are random so top-down and rear views still look natural.
        const yaw = r() < 0.7 ? (r() - 0.5) * 1.0 : r() * Math.PI
        base.push(x + Math.cos(a) * d, z + Math.sin(a) * d * 0.6, yaw, (r() - 0.5) * 0.2)
        shape.push(Math.min(maxHeight, range(kind.height)), range(kind.width) * 1.12, kind.sway * (0.7 + r() * 0.6), r() * Math.PI * 2)
        const v = 0.85 + r() * 0.3
        tint.push(t[0] * v, t[1] * v, t[2] * v, kind.wave)
      }
    }
    // Back of the bed (either long wall): tall kelp among grass, lettuce and red accents.
    for (const side of [-1, 1]) {
      const z0 = side * (D / 2 - 12)
      const z1 = side * (D / 2 - 135)
      for (let i = 0; i < 14; i++) plant(KINDS.kelp, z0, z1)
      for (let i = 0; i < 19; i++) plant(KINDS.seagrass, z0, z1)
      for (let i = 0; i < 8; i++) plant(KINDS.lettuce, z0, z1)
      for (let i = 0; i < 5; i++) plant(KINDS.red, z0, z1)
    }
    // A low fringe right against the glass, to frame the foreground without
    // hiding the fish's lane.
    for (const side of [-1, 1]) {
      const z0 = side * (D / 2 - 10)
      const z1 = side * (D / 2 - 45)
      for (let i = 0; i < 8; i++) plant(KINDS.seagrass, z0, z1, 62)
      for (let i = 0; i < 4; i++) plant(KINDS.lettuce, z0, z1, 45)
    }

    geometry.setAttribute('aBase', new THREE.InstancedBufferAttribute(new Float32Array(base), 4))
    geometry.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(shape), 4))
    geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(tint), 4))
    geometry.instanceCount = base.length / 4

    const material = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0, side: THREE.DoubleSide })
    material.onBeforeCompile = (shader) => {
      patchVertex(shader, this.uniforms)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vTint;
          varying float vH;
          varying float vAcross;`)
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
          // Darker at the base, a subtle midrib, lighter and slightly yellower tips.
          float shade = mix(0.42, 1.08, vH);
          float rib = 1.0 - 0.28 * (1.0 - smoothstep(0.02, 0.1, abs(vAcross)));
          vec3 leaf = vTint * shade * rib;
          leaf = mix(leaf, leaf * vec3(1.08, 1.14, 0.9), smoothstep(0.75, 1.0, vH));
          vec4 diffuseColor = vec4(leaf, opacity);`)
        .replace('vec3 totalEmissiveRadiance = emissive;', `vec3 totalEmissiveRadiance = emissive;
          // A little light through the thin upper blade.
          totalEmissiveRadiance += vTint * 0.25 * vH;`)
    }

    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.frustumCulled = false // blades are placed in the shader

    // Depth-of-field depth pass: same bending and scrolling, so near weeds blur
    // as foreground and far ones as background.
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide })
    depth.onBeforeCompile = shader => patchVertex(shader, this.uniforms)
    this.mesh.userData.depthMaterial = depth
  }

  /** `scroll` is total world travel. */
  update(time: number, scroll: number) {
    this.uniforms.uTime.value = time
    this.uniforms.uScroll.value = scroll
  }
}

/** A unit blade: x across [-0.5, 0.5], y up [0, 1], subdivided so it can bend smoothly. */
function ribbon() {
  const rows = 12
  const cols = 2
  const pos: number[] = []
  const uv: number[] = []
  const index: number[] = []
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      pos.push(i / cols - 0.5, j / rows, 0)
      uv.push(i / cols, j / rows)
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i
      index.push(a, a + 1, a + cols + 1, a + 1, a + cols + 2, a + cols + 1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 3).fill(0).map((_, k) => (k % 3 === 2 ? 1 : 0)), 3))
  g.setIndex(index)
  return g
}
