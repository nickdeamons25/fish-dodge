import * as THREE from 'three'
import { biasDepthToFocus } from '../engine/DofPass'
import { canvasTex } from '../entities/fishKit'

/**
 * Moon-jelly style jellyfish, in the game's pink-violet palette.
 *
 *  - Bell: a lathed, translucent dome with a scalloped rim and a fresnel glow
 *    (edges read denser, like real gel). Painted inside: four horseshoe gonads,
 *    radial canals and small sense spots round the rim.
 *  - Pulse: quick contraction, slow relaxation. The rim squeezes in more than
 *    the crown and the bell stretches taller as it contracts.
 *  - Tentacles: a ring of fine tapered tubes that trail in delayed waves and
 *    flare with each pulse. Oral arms: four frilly, twisting ribbons from the
 *    centre. Both are instanced and bent entirely in the vertex shader.
 *
 * Every deforming part carries a matching depth material, so depth of field
 * sees the jelly exactly as drawn.
 */

const BELL_R = 24
const TENTACLES = 28

interface JellyUniforms {
  uTime: { value: number }
  /** 0 = relaxed, 1 = fully contracted. */
  uPulse: { value: number }
  [key: string]: THREE.IUniform
}

// ---- Shared geometry & textures ---------------------------------------------------------
let shared: {
  bell: THREE.BufferGeometry
  tentacles: THREE.InstancedBufferGeometry
  arms: THREE.InstancedBufferGeometry
  bellTex: THREE.Texture
} | undefined

function assets() {
  if (shared) return shared
  // Bell profile, crown → rim, curling slightly under at the lip.
  const profile = [
    [0, 25], [7, 24.3], [13, 22], [18, 17.8], [21.6, 12], [23.6, 6], [24.2, 1.5], [23.6, -1.2], [22, -2],
  ].map(([r, y]) => new THREE.Vector2(r!, y!))
  const bell = new THREE.LatheGeometry(new THREE.SplineCurve(profile).getPoints(28), 64)

  // Tentacle: a unit tube hanging from y = 0 down to y = -1.
  const tube = new THREE.CylinderGeometry(1, 1, 1, 5, 18, true).translate(0, -0.5, 0)
  const tentacles = new THREE.InstancedBufferGeometry().copy(tube as unknown as THREE.InstancedBufferGeometry)
  const tent: number[] = []
  for (let i = 0; i < TENTACLES; i++) {
    const jitter = Math.sin(i * 12.9898) * 0.5 + 0.5
    tent.push((i / TENTACLES) * Math.PI * 2 + jitter * 0.12, 48 + jitter * 34, i * 1.7, 0.55 + jitter * 0.35)
  }
  tentacles.setAttribute('aTent', new THREE.InstancedBufferAttribute(new Float32Array(tent), 4))
  tentacles.instanceCount = TENTACLES

  // Oral arm: a unit ribbon hanging down, subdivided for ruffles and twist.
  const ribbon = new THREE.PlaneGeometry(1, 1, 3, 26).translate(0, -0.5, 0)
  const arms = new THREE.InstancedBufferGeometry().copy(ribbon as unknown as THREE.InstancedBufferGeometry)
  const arm: number[] = []
  for (let i = 0; i < 4; i++) arm.push((i / 4) * Math.PI * 2 + Math.PI / 4, 52 + (i % 2) * 10, i * 2.3, 7.5)
  arms.setAttribute('aArm', new THREE.InstancedBufferAttribute(new Float32Array(arm), 4))
  arms.instanceCount = 4

  shared = { bell, tentacles, arms, bellTex: bellTexture() }
  return shared
}

/**
 * Bell skin. U runs around the bell, V from crown (0) to rim (1); canvas row 0
 * is the rim. Alpha carries the translucency: thin gel, denser organs and rim.
 */
function bellTexture() {
  const W = 1024
  const H = 512
  const tex = canvasTex(W, H, (c) => {
    const row = (v: number) => (1 - v) * H
    c.fillStyle = 'rgba(236,206,255,0.3)'
    c.fillRect(0, 0, W, H)
    // Denser gel toward the rim.
    const rim = c.createLinearGradient(0, row(0.7), 0, row(1))
    rim.addColorStop(0, 'rgba(240,210,255,0)')
    rim.addColorStop(1, 'rgba(248,222,255,0.55)')
    c.fillStyle = rim
    c.fillRect(0, 0, W, row(0.7))
    // Radial canals from the crown to the rim.
    c.strokeStyle = 'rgba(214,150,255,0.42)'
    c.lineWidth = 3
    for (let i = 0; i < 16; i++) {
      const x = (i / 16) * W
      c.beginPath()
      c.moveTo(x, row(0.08))
      c.quadraticCurveTo(x + 8, row(0.55), x, row(0.98))
      c.stroke()
    }
    // Four horseshoe gonads around the crown.
    for (let k = 0; k < 4; k++) {
      const u0 = (k / 4 + 0.03) * W
      const u1 = (k / 4 + 0.22) * W
      const v0 = row(0.34)
      const v1 = row(0.1)
      c.fillStyle = 'rgba(206,86,228,0.82)'
      c.beginPath()
      c.roundRect(u0, v0, u1 - u0, v1 - v0, 40)
      c.fill()
      // Hollow centre makes the horseshoe.
      c.globalCompositeOperation = 'destination-out'
      c.fillStyle = 'rgba(0,0,0,0.75)'
      c.beginPath()
      c.roundRect(u0 + 26, v0 + 14, u1 - u0 - 52, (v1 - v0) * 0.72, 26)
      c.fill()
      c.globalCompositeOperation = 'source-over'
    }
    // Small sense spots around the rim.
    c.fillStyle = 'rgba(255,214,150,0.9)'
    for (let i = 0; i < 8; i++) {
      c.beginPath()
      c.arc(((i + 0.5) / 8) * W, row(0.975), 5, 0, Math.PI * 2)
      c.fill()
    }
  })
  return tex
}

// ---- Shaders ------------------------------------------------------------------------------
/** Pulse shape of the bell, shared by bell, tentacle and arm shaders. */
const PULSE_GLSL = /* glsl */ `
  uniform float uTime;
  uniform float uPulse;
  // Radial squeeze at bell height fraction v (0 crown, 1 rim): the rim works hardest.
  float squeeze(float v) { return 1.0 - uPulse * 0.22 * smoothstep(0.2, 1.0, v); }
  float stretch() { return 1.0 + uPulse * 0.12; }
  const float RIM_R = ${BELL_R.toFixed(1)};
  const float RIM_Y = -1.5;
`

function bellPatch(shader: THREE.WebGLProgramParametersWithUniforms, u: JellyUniforms) {
  Object.assign(shader.uniforms, u)
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${PULSE_GLSL}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        float v = uv.y;
        float ang = atan(position.z, position.x);
        // Scalloped lip.
        float scallop = 1.0 + 0.035 * sin(ang * 16.0) * smoothstep(0.86, 1.0, v);
        transformed.xz *= squeeze(v) * scallop;
        transformed.y *= stretch();
      }`)
}

function tentaclePatch(shader: THREE.WebGLProgramParametersWithUniforms, u: JellyUniforms) {
  Object.assign(shader.uniforms, u)
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      ${PULSE_GLSL}
      attribute vec4 aTent; // angle, length, phase, thickness`)
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      objectNormal = normalize(vec3(position.x, 0.0, position.z) + vec3(0.0001));`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        float t = -position.y; // 0 at the rim, 1 at the tip
        vec2 dir = vec2(cos(aTent.x), sin(aTent.x));
        vec3 root = vec3(dir.x, 0.0, dir.y) * RIM_R * squeeze(1.0) * 0.94 + vec3(0.0, RIM_Y * stretch(), 0.0);
        // Trailing waves travel down the tentacle; each pulse flares it outward.
        float ph = uTime * 1.4 + aTent.z;
        vec3 sway = vec3(sin(ph - t * 5.0) * 6.0, 0.0, cos(ph * 0.8 - t * 4.0) * 5.0) * t;
        vec3 flare = vec3(dir.x, 0.25, dir.y) * uPulse * t * 5.0;
        float r = aTent.w * (1.0 - 0.8 * t);
        transformed = root + vec3(0.0, -t * aTent.y, 0.0) + sway + flare + vec3(position.x, 0.0, position.z) * r;
      }`)
}

function armPatch(shader: THREE.WebGLProgramParametersWithUniforms, u: JellyUniforms) {
  Object.assign(shader.uniforms, u)
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      ${PULSE_GLSL}
      attribute vec4 aArm; // angle, length, phase, width`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        float t = -position.y;
        float ph = uTime * 0.9 + aArm.z;
        // Twists as it hangs, with frilly ruffled edges.
        float twist = aArm.x + t * 2.4 + sin(ph) * 0.3;
        vec3 across = vec3(cos(twist), 0.0, sin(twist));
        float ruffle = 0.65 + 0.35 * sin(t * 30.0 + ph * 2.0) * sign(position.x);
        float width = aArm.w * (1.0 - 0.55 * t) * ruffle;
        vec3 root = vec3(cos(aArm.x), 0.0, sin(aArm.x)) * 4.0 + vec3(0.0, 2.0, 0.0);
        vec3 sway = vec3(sin(ph - t * 3.0) * 8.0, 0.0, cos(ph * 0.7 - t * 2.5) * 6.0) * t;
        transformed = root + across * position.x * width + vec3(0.0, -t * aArm.y, 0.0) + sway;
      }`)
}

/** Fresnel: edges seen side-on glow and read denser, like real gel. */
function addGelGlow(shader: THREE.WebGLProgramParametersWithUniforms, color: string, strength: number) {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <map_fragment>', `#include <map_fragment>
      float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.2);
      diffuseColor.a = clamp(diffuseColor.a + fres * 0.55, 0.0, 1.0);`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += ${color} * fres * ${strength.toFixed(2)};`)
}

/**
 * Depth material matching a jelly part's deformation. Jellies are pulled most of
 * the way to the focal plane for depth of field: fine translucent detail turns
 * to mush when blurred, so they keep only a hint of their true depth.
 */
const JELLY_DOF_KEEP = 0.4

function depthFor(patch: (s: THREE.WebGLProgramParametersWithUniforms, u: JellyUniforms) => void, u: JellyUniforms) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide })
  m.onBeforeCompile = (s) => {
    patch(s, u)
    biasDepthToFocus(s, JELLY_DOF_KEEP)
  }
  return m
}

// ---- Assembly -----------------------------------------------------------------------------
export function buildJelly() {
  const a = assets()
  const u: JellyUniforms = { uTime: { value: 0 }, uPulse: { value: 0 } }
  const root = new THREE.Group()
  root.userData.uniforms = u

  const bellMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: a.bellTex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1, emissive: 0x5a2080, emissiveIntensity: 0.35,
  })
  bellMat.onBeforeCompile = (s) => {
    bellPatch(s, u)
    addGelGlow(s, 'vec3(0.95, 0.6, 1.0)', 0.9)
  }
  const bell = new THREE.Mesh(a.bell, bellMat)
  bell.userData.depthMaterial = depthFor(bellPatch, u)
  bell.renderOrder = 2 // after the tentacles and arms it contains

  const tentMat = new THREE.MeshStandardMaterial({
    color: 0xf3cfff, transparent: true, opacity: 0.62, depthWrite: false, roughness: 0.4,
    emissive: 0x9a44b8, emissiveIntensity: 0.4,
  })
  const tentacles = new THREE.Mesh(a.tentacles, tentMat)
  tentMat.onBeforeCompile = s => tentaclePatch(s, u)
  tentacles.userData.depthMaterial = depthFor(tentaclePatch, u)
  tentacles.frustumCulled = false

  const armMat = new THREE.MeshStandardMaterial({
    color: 0xe7b4ff, transparent: true, opacity: 0.78, depthWrite: false, side: THREE.DoubleSide, roughness: 0.35,
    emissive: 0x7c2c98, emissiveIntensity: 0.35,
  })
  armMat.onBeforeCompile = (s) => {
    armPatch(s, u)
    addGelGlow(s, 'vec3(0.9, 0.5, 1.0)', 0.5)
  }
  const arms = new THREE.Mesh(a.arms, armMat)
  arms.userData.depthMaterial = depthFor(armPatch, u)
  arms.frustumCulled = false

  // Lift so the hitbox (centred on the group) sits over the bell and upper tentacles.
  const body = new THREE.Group()
  body.position.y = -2
  body.add(tentacles, arms, bell)
  root.add(body)
  return root
}

/** Quick contraction (~0.3 s), slow relaxation: a pulse roughly every 1.4 s. */
export function animateJelly(root: THREE.Object3D, time: number, phase: number) {
  const u = root.userData.uniforms as JellyUniforms
  const f = (time * 0.72 + phase * 0.16) % 1
  const smooth = (x: number) => x * x * (3 - 2 * x)
  u.uPulse.value = f < 0.22 ? smooth(f / 0.22) : 1 - smooth((f - 0.22) / 0.78)
  u.uTime.value = time + phase
}
