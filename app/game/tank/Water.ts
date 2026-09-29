import * as THREE from 'three'
import { TANK } from '../constants'
import { excludeFromDepth } from '../engine/RenderPipeline'
import type { TankPoint } from './space'
import { speckTexture, sunShaftTexture } from './textures'

const H = TANK.height
const SHAFTS = 18
/** Shafts live within this distance of the fish; further ones move back near it. */
const SHAFT_RANGE = 1600
/** Fully visible out to here, gone by SHAFT_RANGE. Hand-faded: fog would tint additive light, not dim it. */
const SHAFT_FADE = 1000
const SPECKS = 700
const SPECK_RANGE = 700

interface Shaft { mesh: THREE.Mesh, phase: number, strength: number }

/**
 * The water itself: slanting shafts of sunlight from the surface and a slow
 * drift of particles, both kept around the fish (the tank is far too big to
 * fill) so the water always feels thick and lit from above.
 */
export class Water {
  readonly group = new THREE.Group()
  private shafts: Shaft[] = []
  private specks: THREE.Points
  private drift: Float32Array
  private rand = mulberry(3)
  private time = 0

  constructor() {
    // Shafts: tall cards, narrow at the surface and wider at the sand, turned to
    // face the camera about the vertical. Additive and faint (opacities tuned for
    // linear-space blending; see engine/RenderPipeline.ts).
    const tex = sunShaftTexture()
    const geo = new THREE.PlaneGeometry(1, H, 1, 1)
    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) * (pos.getY(i) > 0 ? 0.55 : 1.6))
    geo.translate(0, H / 2, 0)
    for (let i = 0; i < SHAFTS; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
        color: 0xcfefff, opacity: 0,
      }))
      mesh.scale.x = 50 + this.rand() * 110
      excludeFromDepth(mesh)
      this.group.add(mesh)
      this.shafts.push({ mesh, phase: this.rand() * Math.PI * 2, strength: 0.08 + this.rand() * 0.1 })
    }

    // Particles: tiny pale specks, drifting and sinking slowly.
    const p = new Float32Array(SPECKS * 3)
    this.drift = new Float32Array(SPECKS * 3)
    for (let i = 0; i < SPECKS; i++) {
      this.placeSpeck(p, i, { x: 0, y: H / 2, z: TANK.radius * 0.55 })
      this.drift[i * 3] = (this.rand() - 0.5) * 6
      this.drift[i * 3 + 1] = -2 - this.rand() * 5
      this.drift[i * 3 + 2] = (this.rand() - 0.5) * 6
    }
    const speckGeo = new THREE.BufferGeometry()
    speckGeo.setAttribute('position', new THREE.BufferAttribute(p, 3))
    this.specks = new THREE.Points(speckGeo, new THREE.PointsMaterial({
      map: speckTexture(), size: 3.2, color: 0xd8f0ff, transparent: true, opacity: 0.45, depthWrite: false,
    }))
    this.specks.frustumCulled = false // they follow the fish around
    excludeFromDepth(this.specks)
    this.group.add(this.specks)
  }

  /** `viewYaw`: the camera's heading (tank/space.ts); shafts turn to face it. */
  update(dt: number, fish: TankPoint, viewYaw: number) {
    this.time += dt
    for (const s of this.shafts) {
      const m = s.mesh
      let d = Math.hypot(m.position.x - fish.x, m.position.z - fish.z)
      if (d > SHAFT_RANGE || m.userData.placed === undefined) {
        this.placeShaft(m, fish, m.userData.placed === undefined)
        d = Math.hypot(m.position.x - fish.x, m.position.z - fish.z)
      }
      m.rotation.y = viewYaw - Math.PI / 2
      // Shimmer, and fade out with distance so shafts never pop in or out.
      const shimmer = 0.65 + 0.35 * Math.sin(this.time * 0.6 + s.phase)
      const fade = 1 - THREE.MathUtils.smoothstep(d, SHAFT_FADE, SHAFT_RANGE)
      ;(m.material as THREE.MeshBasicMaterial).opacity = s.strength * shimmer * fade
    }

    const attr = this.specks.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    for (let i = 0; i < SPECKS; i++) {
      const x = arr[i * 3]! + this.drift[i * 3]! * dt
      const y = arr[i * 3 + 1]! + this.drift[i * 3 + 1]! * dt
      const z = arr[i * 3 + 2]! + this.drift[i * 3 + 2]! * dt
      if (y < 0 || Math.hypot(x - fish.x, z - fish.z) > SPECK_RANGE) this.placeSpeck(arr, i, fish)
      else {
        arr[i * 3] = x
        arr[i * 3 + 1] = y
        arr[i * 3 + 2] = z
      }
    }
    attr.needsUpdate = true
  }

  /** Somewhere between `min` and `range` from the fish, inside the glass. */
  private near(fish: TankPoint, range: number, out: THREE.Vector3, min = 0) {
    const a = this.rand() * Math.PI * 2
    const d = min + Math.sqrt(this.rand()) * (range - min)
    out.set(fish.x + Math.cos(a) * d, 0, fish.z + Math.sin(a) * d)
    const r = Math.hypot(out.x, out.z)
    if (r > TANK.radius - 30) out.multiplyScalar((TANK.radius - 30) / r)
    return out
  }

  /** At first anywhere around the fish; after that out in the fade band, so a moved shaft fades in. */
  private placeShaft(m: THREE.Mesh, fish: TankPoint, first: boolean) {
    this.near(fish, SHAFT_RANGE * 0.95, m.position, first ? 0 : SHAFT_FADE * 1.15)
    m.userData.placed = true
  }

  private placeSpeck(arr: Float32Array, i: number, fish: TankPoint) {
    const v = this.near(fish, SPECK_RANGE * 0.95, new THREE.Vector3())
    arr[i * 3] = v.x
    arr[i * 3 + 1] = this.rand() * H
    arr[i * 3 + 2] = v.z
  }
}

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
