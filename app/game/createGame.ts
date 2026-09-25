import * as THREE from 'three'
import type { GameStatus, GameStore } from '~/stores/game'
import { COLORS } from './constants'
import { CameraRig } from './engine/CameraRig'
import { Input } from './engine/Input'
import { RenderPipeline } from './engine/RenderPipeline'
import { FishGame } from './FishGame'
import { Tank } from './tank/Tank'
import { VIEWS, type ViewId } from './tank/views'

export interface GameHandle {
  onStatus: (status: GameStatus, prev: GameStatus) => void
  destroy: () => void
}

/**
 * Boots the three.js renderer inside `parent` and starts the loop.
 * The Pinia store is passed in so gameplay code never imports Vue.
 */
export function createGame(parent: HTMLElement, store: GameStore): GameHandle {
  // Anti-aliasing happens in the post-processing target (4× MSAA), not the canvas.
  const renderer = new THREE.WebGLRenderer({ antialias: false })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const canvas = renderer.domElement
  canvas.style.display = 'block'
  parent.appendChild(canvas)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(COLORS.room)
  const fog = new THREE.Fog(COLORS.deepWater, 2000, 4000)
  scene.fog = fog

  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 5, 6000)
  const rig = new CameraRig(camera, fog, VIEWS['side-right'].camera)
  const pipeline = new RenderPipeline(renderer, scene, camera)

  const resize = () => {
    const w = parent.clientWidth
    const h = parent.clientHeight
    if (!w || !h) return
    pipeline.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(parent)
  resize()

  // Hit flash lives in the DOM: cheaper than a full-screen quad.
  const flashEl = document.createElement('div')
  Object.assign(flashEl.style, {
    position: 'absolute', inset: '0', background: '#ff5050', opacity: '0', pointerEvents: 'none',
    transition: 'opacity 0.25s ease-out',
  })
  parent.appendChild(flashEl)
  const flash = () => {
    flashEl.style.transition = 'none'
    flashEl.style.opacity = '0.35'
    requestAnimationFrame(() => {
      flashEl.style.transition = 'opacity 0.25s ease-out'
      flashEl.style.opacity = '0'
    })
  }

  const input = new Input(canvas)
  const tank = new Tank(scene)
  const game = new FishGame({ scene, camera, canvas, rig, tank, input, store, flash })

  const focusPoint = new THREE.Vector3()
  let raf = 0
  let last = performance.now()
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    game.frame(dt)
    const strength = game.focusTarget(focusPoint)
    // BokehPass focus is a distance along the view axis.
    const toFish = focusPoint.sub(camera.position)
    pipeline.setFocus(toFish.dot(camera.getWorldDirection(new THREE.Vector3())), strength)
    pipeline.render(scene, camera, dt)
    perf?.update()
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)

  let onDevKey: ((e: KeyboardEvent) => void) | undefined
  let perf: { update: () => void, el: HTMLElement } | undefined
  if (import.meta.dev) {
    // Dev perf overlay: F toggles it, Q toggles post-processing for A/B comparison.
    const el = document.createElement('div')
    Object.assign(el.style, {
      position: 'absolute', left: '8px', bottom: '8px', padding: '4px 8px', borderRadius: '6px',
      background: 'rgb(0 0 0 / 0.55)', color: '#cfe', font: '11px ui-monospace, monospace',
      pointerEvents: 'none', whiteSpace: 'pre', display: 'none',
    })
    parent.appendChild(el)
    let lastPaint = 0
    perf = {
      el,
      update() {
        const now = performance.now()
        if (el.style.display === 'none' || now - lastPaint < 250) return
        lastPaint = now
        const s = pipeline.stats
        const gpu = s.gpuMs === null ? 'n/a' : `${s.gpuMs.toFixed(1)}ms`
        el.textContent = `${s.fps} fps  frame ${s.frameMs.toFixed(1)}ms  gpu ${gpu}  scale ${s.scale.toFixed(2)}  post ${s.post ? 'on' : 'off'}`
      },
    }
    ;(window as unknown as { __pipeline: RenderPipeline }).__pipeline = pipeline

    // Dev shortcuts: T forces a random tank turn; 1–4 force a specific view.
    const byDigit: ViewId[] = ['side-right', 'side-left', 'top', 'rear']
    onDevKey = (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.code === 'KeyT') game.beginTurn()
      if (e.code === 'KeyF' && perf) perf.el.style.display = perf.el.style.display === 'none' ? 'block' : 'none'
      if (e.code === 'KeyQ') pipeline.post = !pipeline.post
      const n = Number(e.key)
      if (n >= 1 && n <= 4) game.beginTurn(byDigit[n - 1])
    }
    window.addEventListener('keydown', onDevKey)
    ;(window as unknown as { __fishGame: FishGame }).__fishGame = game
  }

  return {
    onStatus: (s, p) => game.onStatus(s, p),
    destroy() {
      cancelAnimationFrame(raf)
      observer.disconnect()
      input.destroy()
      if (onDevKey) window.removeEventListener('keydown', onDevKey)
      renderer.dispose()
      canvas.remove()
      flashEl.remove()
      perf?.el.remove()
    },
  }
}
