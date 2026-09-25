import * as THREE from 'three'
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js'

/**
 * Depth of field without halos.
 *
 * A plain gather blur (like three's BokehPass) averages every neighbour into an
 * out-of-focus pixel, including in-focus ones — so a sharp fish bleeds an
 * orange glow into the blurred water around it and its outline looks smeared.
 *
 * Here each neighbour only counts if its *own* blur is big enough to reach the
 * pixel being shaded. In-focus pixels have ~no blur, so they never spread onto
 * the background, and silhouettes of whatever is in focus stay crisp. Blurry
 * foreground objects still spill over sharp ones, as a real lens would.
 */
const DofShader = {
  uniforms: {
    tColor: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    focus: { value: 1000 },
    aperture: { value: 0.00003 },
    maxblur: { value: 0.009 },
    nearClip: { value: 1 },
    farClip: { value: 1000 },
    aspect: { value: 1 },
    /** Blur for things nearer than focus, relative to things beyond it. */
    nearScale: { value: 0.35 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    #include <common>
    #include <packing>
    uniform sampler2D tColor;
    uniform sampler2D tDepth;
    uniform float focus;
    uniform float aperture;
    uniform float maxblur;
    uniform float nearClip;
    uniform float farClip;
    uniform float aspect;
    uniform float nearScale;
    varying vec2 vUv;

    const int SAMPLES = 36;

    // Blur radius (as a fraction of screen height) for the scene at uv.
    float cocAt(vec2 uv) {
      float depth = unpackRGBAToDepth(texture2D(tDepth, uv));
      float viewZ = perspectiveDepthToViewZ(depth, nearClip, farClip);
      float d = focus + viewZ; // > 0: nearer than focus
      // Foreground softens less than background, so close weeds by the glass
      // stay readable while the far reef keeps its depth.
      return clamp(abs(d) * aperture * (d > 0.0 ? nearScale : 1.0), 0.0, maxblur);
    }

    void main() {
      vec4 centre = texture2D(tColor, vUv);
      float coc = cocAt(vUv);
      if (coc < 0.0004) { gl_FragColor = centre; return; }

      vec4 sum = centre;
      float weight = 1.0;
      vec2 stretch = vec2(1.0, aspect);
      for (int i = 0; i < SAMPLES; i++) {
        float fi = float(i);
        // Golden-angle spiral: evenly fills the disc without banding.
        float r = sqrt((fi + 0.5) / float(SAMPLES));
        float a = fi * 2.39996323;
        vec2 uv = vUv + vec2(cos(a), sin(a)) * r * coc * stretch;
        float sampleCoc = cocAt(uv);
        // Only neighbours blurred enough to reach this pixel contribute.
        float w = smoothstep(0.0, 1.0, sampleCoc / max(r * coc, 1e-5));
        sum += texture2D(tColor, uv) * w;
        weight += w;
      }
      gl_FragColor = sum / weight;
    }
  `,
}

/** Current focus distance, shared with depth materials that bias toward it. */
export const dofFocus = { value: 1000 }

/**
 * Patch a depth material so its object blurs less than its true depth implies:
 * the reported distance is pulled toward the focal plane by `keep` (0 = always
 * sharp, 1 = true depth). Only depth changes, so its silhouette stays exact.
 */
export function biasDepthToFocus(shader: THREE.WebGLProgramParametersWithUniforms, keep: number) {
  shader.uniforms.uDofFocus = dofFocus
  shader.uniforms.uDofKeep = { value: keep }
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      uniform float uDofFocus;
      uniform float uDofKeep;`)
    .replace('#include <project_vertex>', `#include <project_vertex>
      {
        float dist = -mvPosition.z;
        float biased = uDofFocus + (dist - uDofFocus) * uDofKeep;
        float ndc = (projectionMatrix[2][2] * -biased + projectionMatrix[3][2]) / biased;
        gl_Position.z = ndc * gl_Position.w;
      }`)
}

export class DofPass extends Pass {
  readonly uniforms: typeof DofShader.uniforms
  private quad: FullScreenQuad
  private depthTarget: THREE.WebGLRenderTarget
  /**
   * Fallback depth materials, one per face side. Each mesh gets the one matching
   * its own material, so one-sided walls (the tank's near wall is invisible
   * from outside) stay invisible to depth, while double-sided fins still write it.
   */
  private depthMaterials = {
    [THREE.FrontSide]: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.FrontSide }),
    [THREE.BackSide]: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.BackSide }),
    [THREE.DoubleSide]: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide }),
  }
  private hidden: THREE.Object3D[] = []
  private swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = []
  private oldClearColor = new THREE.Color()

  constructor(private scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    super()
    this.uniforms = THREE.UniformsUtils.clone(DofShader.uniforms) as typeof DofShader.uniforms
    this.uniforms.focus = dofFocus // shared, so focus-biased depth materials track it
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: DofShader.vertexShader,
      fragmentShader: DofShader.fragmentShader,
    }))
    this.depthTarget = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter })
  }

  override setSize(width: number, height: number) {
    this.depthTarget.setSize(width, height)
    this.uniforms.aspect.value = width / height
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    // Depth: see-through and cut-out objects (flagged `noDepth`) are hidden, or
    // the override material would treat glass and seaweed cards as solid walls.
    // Meshes that deform in their vertex shader (the swimming fish) supply
    // their own depth material, so depth matches what's actually on screen.
    this.hidden.length = 0
    this.swapped.length = 0
    this.scene.traverseVisible((o) => {
      if (o.userData.noDepth) {
        this.hidden.push(o)
        return
      }
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      this.swapped.push([mesh, mesh.material])
      const side = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.side ?? THREE.FrontSide
      mesh.material = (mesh.userData.depthMaterial as THREE.Material | undefined) ?? this.depthMaterials[side]
    })
    for (const o of this.hidden) o.visible = false
    const oldBackground = this.scene.background
    renderer.getClearColor(this.oldClearColor)
    const oldAlpha = renderer.getClearAlpha()
    this.scene.background = null
    renderer.setClearColor(0xffffff, 1) // packed depth 1.0 = far
    renderer.setRenderTarget(this.depthTarget)
    renderer.clear()
    renderer.render(this.scene, this.camera)
    for (const [mesh, material] of this.swapped) mesh.material = material
    this.scene.background = oldBackground
    renderer.setClearColor(this.oldClearColor, oldAlpha)
    for (const o of this.hidden) o.visible = true

    this.uniforms.tColor.value = readBuffer.texture
    this.uniforms.tDepth.value = this.depthTarget.texture
    this.uniforms.nearClip.value = this.camera.near
    this.uniforms.farClip.value = this.camera.far
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer)
    this.quad.render(renderer)
  }

  override dispose() {
    this.depthTarget.dispose()
    for (const m of Object.values(this.depthMaterials)) m.dispose()
    this.quad.dispose()
  }
}
