import * as THREE from 'three'
import { DofPass } from './DofPass'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'

/** Mark an object (and its children) as invisible to the depth-of-field depth pass (see DofPass). */
export function excludeFromDepth(obj: THREE.Object3D) {
  obj.userData.noDepth = true
}

/** Depth-of-field strength per unit of distance from the focal plane. */
const APERTURE = 0.000034
/** Cap on blur radius, as a fraction of the screen. */
const MAX_BLUR = 0.009

/** Adaptive resolution: aim for this much GPU time per frame (60 fps = 16.7 ms). */
const GPU_BUDGET_MS = 12
const SCALE = { min: 0.6, max: 1, step: 0.1 }

export interface FrameStats {
  fps: number
  frameMs: number
  /** GPU time per frame, if the browser exposes timer queries. */
  gpuMs: number | null
  scale: number
  post: boolean
}

/**
 * Note on colour: the post-processing target blends transparency in linear
 * space (physically correct), unlike drawing straight to the canvas. Overlay
 * opacities in tank/ are tuned for this.
 *
 * Renders the scene through post-processing (4× MSAA + depth of field focused
 * on the fish), measures frame and GPU time, and trades render resolution for
 * frame rate when the GPU gets close to budget.
 */
export class RenderPipeline {
  post = true
  readonly stats: FrameStats = { fps: 0, frameMs: 0, gpuMs: null, scale: 1, post: true }

  private composer: EffectComposer
  private dof: DofPass
  private width = 1
  private height = 1
  private baseRatio = Math.min(window.devicePixelRatio, 2)
  private scale = 1
  /** Eased 0..1 depth-of-field strength; the game sets a target per view. */
  private dofStrength = 1
  private dofTarget = 1

  // Timing
  private gl: WebGL2RenderingContext
  private timerExt: { TIME_ELAPSED_EXT: number, GPU_DISJOINT_EXT: number } | null
  private query: WebGLQuery | null = null
  private gpuSamples: number[] = []
  private frameSamples: number[] = []
  private sinceAdapt = 0

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.gl = renderer.getContext() as WebGL2RenderingContext
    this.timerExt = this.gl.getExtension('EXT_disjoint_timer_query_webgl2')

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
    this.composer = new EffectComposer(renderer, target)
    this.composer.addPass(new RenderPass(scene, camera))
    this.dof = new DofPass(scene, camera)
    this.dof.uniforms.maxblur.value = MAX_BLUR
    this.composer.addPass(this.dof)
    this.composer.addPass(new OutputPass())
  }

  setSize(width: number, height: number) {
    this.width = width
    this.height = height
    this.applyResolution()
  }

  /** Focus on a world-space distance from the camera; `strength` 0..1 scales the blur. */
  setFocus(distance: number, strength: number) {
    this.dof.uniforms.focus.value = distance
    this.dofTarget = strength
  }

  render(scene: THREE.Scene, camera: THREE.Camera, dt: number) {
    this.dofStrength += (this.dofTarget - this.dofStrength) * Math.min(1, dt * 3)
    this.dof.uniforms.aperture.value = APERTURE * this.dofStrength
    this.dof.enabled = this.dofStrength > 0.02

    this.beginGpuTimer()
    if (this.post) this.composer.render(dt)
    else this.renderer.render(scene, camera)
    this.endGpuTimer()

    this.track(dt)
  }

  private applyResolution() {
    const ratio = this.baseRatio * this.scale
    this.renderer.setPixelRatio(ratio)
    this.renderer.setSize(this.width, this.height)
    this.composer.setPixelRatio(ratio)
    this.composer.setSize(this.width, this.height)
  }

  // ---- Measurement & adaptive resolution -------------------------------------
  private beginGpuTimer() {
    if (!this.timerExt || this.query) return
    this.query = this.gl.createQuery()
    this.gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, this.query!)
    this.queryOpen = true
  }

  private queryOpen = false

  private endGpuTimer() {
    if (this.queryOpen && this.timerExt) {
      this.gl.endQuery(this.timerExt.TIME_ELAPSED_EXT)
      this.queryOpen = false
    }
    // Results arrive a frame or two later; one query in flight at a time.
    const q = this.query
    if (!q || !this.timerExt) return
    if (!this.gl.getQueryParameter(q, this.gl.QUERY_RESULT_AVAILABLE)) return
    const disjoint = this.gl.getParameter(this.timerExt.GPU_DISJOINT_EXT)
    if (!disjoint) this.push(this.gpuSamples, this.gl.getQueryParameter(q, this.gl.QUERY_RESULT) / 1e6)
    this.gl.deleteQuery(q)
    this.query = null
  }

  private push(list: number[], v: number) {
    list.push(v)
    if (list.length > 60) list.shift()
  }

  private track(dt: number) {
    this.push(this.frameSamples, dt * 1000)
    const avg = (l: number[]) => l.reduce((a, b) => a + b, 0) / Math.max(1, l.length)
    const frameMs = avg(this.frameSamples)
    const gpuMs = this.gpuSamples.length ? avg(this.gpuSamples) : null
    Object.assign(this.stats, { fps: Math.round(1000 / frameMs), frameMs, gpuMs, scale: this.scale, post: this.post })

    // Re-evaluate once a second. With GPU timing we can aim precisely; without
    // it, missed vsyncs (frames well over 16.7 ms) are the only signal.
    this.sinceAdapt += dt
    if (this.sinceAdapt < 1) return
    this.sinceAdapt = 0
    let next = this.scale
    if (gpuMs !== null) {
      if (gpuMs > GPU_BUDGET_MS) next -= SCALE.step
      else if (gpuMs < GPU_BUDGET_MS * 0.6) next += SCALE.step
    }
    else if (frameMs > 18.5) next -= SCALE.step
    else if (frameMs < 17.2) next += SCALE.step / 2
    next = THREE.MathUtils.clamp(Math.round(next * 100) / 100, SCALE.min, SCALE.max)
    if (next !== this.scale) {
      this.scale = next
      this.applyResolution()
    }
  }
}
