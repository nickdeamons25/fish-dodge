import * as THREE from 'three'
import { TANK } from '../constants'

/**
 * Seaweed as real 3D blades rather than textured cards.
 *
 * One shared ribbon geometry is instanced hundreds of times; each instance
 * carries its base position, size, sway and colour. The vertex shader tapers
 * and bends each blade (more toward the tip, on two overlapping waves) and
 * turns it to face the camera — so the whole tank's worth is one draw call
 * with no per-frame CPU work.
 */

const R = TANK.radius

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
  uniform float uYaw; // the camera's heading (tank/space.ts)
  varying vec3 vTint;
  varying float vH;
  varying float vAcross;

  // Blades turn most of the way toward the chase camera, whichever way it
  // faces, so they don't read as edge-on sticks.
  float bladeYaw() { return 1.5708 - uYaw + (aBase.z - 1.5708) * 0.25; }

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
    float lean = aBase.w;
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
      transformed = vec3(aBase.x, 0.0, aBase.y) + bladeOffset(position);
      vTint = aTint.rgb;
      vH = position.y;
      vAcross = position.x;`)
}

export class Seaweed {
  readonly mesh: THREE.Mesh
  private uniforms = {
    uTime: { value: 0 },
    uYaw: { value: 0 },
  }

  constructor() {
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.copy(ribbon() as unknown as THREE.InstancedBufferGeometry)

    const base: number[] = []
    const shape: number[] = []
    const tint: number[] = []
    const r = rng(17)
    const range = ([a, b]: [number, number]) => a + r() * (b - a)
    /** A clump at (x, z) on the sand. */
    const plant = (kind: Kind, x: number, z: number, maxHeight = Infinity) => {
      const count = Math.round(range(kind.blades))
      const t = kind.tints[Math.floor(r() * kind.tints.length)]!
      for (let i = 0; i < count; i++) {
        const a = r() * Math.PI * 2
        const d = Math.sqrt(r()) * kind.spread
        base.push(x + Math.cos(a) * d, z + Math.sin(a) * d, r() * Math.PI, (r() - 0.5) * 0.2)
        shape.push(Math.min(maxHeight, range(kind.height)), range(kind.width) * 1.12, kind.sway * (0.7 + r() * 0.6), r() * Math.PI * 2)
        const v = 0.85 + r() * 0.3
        tint.push(t[0] * v, t[1] * v, t[2] * v, kind.wave)
      }
    }
    /** A point `dist` from the centre, at a random angle. */
    const at = (dist: number): [number, number] => {
      const a = r() * Math.PI * 2
      return [Math.cos(a) * dist, Math.sin(a) * dist]
    }
    // Meadows scattered over the sand: patches of grass, lettuce and red algae
    // with the odd kelp, leaving open sand between them.
    for (let m = 0; m < 70; m++) {
      const [cx, cz] = at(TANK.mound.radius + 250 + Math.sqrt(r()) * (R - TANK.mound.radius - 500))
      const clumps = 3 + Math.floor(r() * 5)
      for (let i = 0; i < clumps; i++) {
        const [ox, oz] = [(r() - 0.5) * 220, (r() - 0.5) * 220]
        const roll = r()
        const kind = roll < 0.55 ? KINDS.seagrass : roll < 0.75 ? KINDS.lettuce : roll < 0.9 ? KINDS.red : KINDS.kelp
        plant(kind, cx + ox, cz + oz)
      }
    }
    // A kelp forest round the foot of the glass, framing the tank's edge.
    for (let i = 0; i < 140; i++) {
      const [x, z] = at(R - 40 - r() * 180)
      plant(r() < 0.5 ? KINDS.kelp : KINDS.seagrass, x, z)
    }
    // And a ring round the mound.
    for (let i = 0; i < 26; i++) {
      const [x, z] = at(TANK.mound.radius * (0.85 + r() * 0.35))
      plant(r() < 0.4 ? KINDS.kelp : r() < 0.7 ? KINDS.seagrass : KINDS.red, x, z)
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

  /** `yaw`: the camera's heading, which blades turn to face. */
  update(time: number, yaw: number) {
    this.uniforms.uTime.value = time
    this.uniforms.uYaw.value = yaw
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
