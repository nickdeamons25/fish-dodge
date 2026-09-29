import * as THREE from 'three'
import { COLORS, TANK } from '../constants'
import { excludeFromDepth } from '../engine/RenderPipeline'
import { rockGeos, rockMat } from '../hazards/registry'
import { CoralBanks } from './CoralBanks'
import { buildReef } from './Reef'
import { Seaweed } from './Seaweed'
import type { TankPoint } from './space'
import { backdropTexture, bubbleTexture, causticsTexture, sandTexture } from './textures'
import { Water } from './Water'

const R = TANK.radius
const H = TANK.height
const SAND_TILE = 256
const CAUSTIC_TILE = 300
/** The painted reef repeats a whole number of times round the wall, so there's no seam. */
const BACKDROP_REPEATS = 18
const BUBBLES = 160
/** Bubbles only exist within this distance of the fish; far ones are recycled nearby. */
const BUBBLE_RANGE = 1400

/**
 * The aquarium: a giant round glass tank, standing still while the fish swims
 * round it. Sand with rippling light, a painted reef on the inside of the
 * glass, a surface overhead, reef patches and seaweed meadows over the sand,
 * a reef mound in the middle, a few big coral banks to steer round (see
 * CoralBanks.ts), and sun shafts and drifting specks in the water.
 */
export class Tank {
  readonly group = new THREE.Group()
  private caustics: THREE.Texture
  private seaweed = new Seaweed()
  private water = new Water()
  /** Permanent coral banks: solid, so the game asks them about collisions too. */
  readonly corals = new CoralBanks()
  private bubbles: THREE.Points
  private bubbleRise: Float32Array
  private time = 0
  private rand = mulberry(11)

  constructor(scene: THREE.Scene) {
    scene.add(this.group)

    // ---- Light -------------------------------------------------------------
    this.group.add(new THREE.HemisphereLight(0xcff2ff, COLORS.deepWater, 2.4))
    this.group.add(new THREE.AmbientLight(0xffffff, 0.9))
    const sun = new THREE.DirectionalLight(0xffffff, 2.6)
    sun.position.set(200, 1200, 500)
    this.group.add(sun)
    // A soft fill from low down, so the sides of things aren't lit only from above.
    const fill = new THREE.DirectionalLight(0xbfe6ff, 1.0)
    fill.position.set(-600, 300, -900)
    this.group.add(fill)

    // ---- Seabed --------------------------------------------------------------
    const sand = sandTexture()
    sand.repeat.set((2 * R) / SAND_TILE, (2 * R) / SAND_TILE)
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(R + 4, 160),
      new THREE.MeshStandardMaterial({ map: sand, roughness: 1 }),
    )
    floor.rotation.x = -Math.PI / 2
    this.group.add(floor)

    this.caustics = causticsTexture()
    this.caustics.repeat.set((2 * R) / CAUSTIC_TILE, (2 * R) / CAUSTIC_TILE)
    const causticPlane = new THREE.Mesh(
      new THREE.CircleGeometry(R, 160),
      new THREE.MeshBasicMaterial({
        map: this.caustics, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    )
    causticPlane.rotation.x = -Math.PI / 2
    causticPlane.position.y = 1
    excludeFromDepth(causticPlane)
    this.group.add(causticPlane)

    // ---- The wall: a painted reef on the inside of the glass, all the way round ----
    const backdrop = backdropTexture()
    backdrop.wrapT = THREE.ClampToEdgeWrapping
    backdrop.repeat.set(BACKDROP_REPEATS, 1)
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, H, 256, 1, true),
      // Seen from inside, so it's the cylinder's back faces that show.
      new THREE.MeshBasicMaterial({ map: backdrop, side: THREE.BackSide }),
    )
    wall.position.y = H / 2
    this.group.add(wall)

    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(R - 2, R - 2, H, 256, 1, true),
      // Opacities here are tuned for linear-space blending (see engine/RenderPipeline.ts).
      new THREE.MeshBasicMaterial({ color: COLORS.glass, transparent: true, opacity: 0.025, depthWrite: false, side: THREE.DoubleSide }),
    )
    glass.position.y = H / 2
    excludeFromDepth(glass)
    this.group.add(glass)

    // ---- Surface, rims ---------------------------------------------------------
    const surface = new THREE.Mesh(
      new THREE.CircleGeometry(R, 160),
      // A light tint; blob shadows (tank/shadow.ts) do the work of separating things from the sand.
      new THREE.MeshBasicMaterial({ color: 0x3aa6dc, transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide }),
    )
    surface.rotation.x = -Math.PI / 2
    surface.position.y = H
    excludeFromDepth(surface)
    this.group.add(surface)

    const rimMat = new THREE.MeshStandardMaterial({ color: 0x1b2733, roughness: 0.6 })
    const rimGeo = new THREE.TorusGeometry(R, 6, 8, 256)
    for (const y of [0, H]) {
      const rim = new THREE.Mesh(rimGeo, rimMat)
      rim.rotation.x = Math.PI / 2
      rim.position.y = y
      this.group.add(rim)
    }

    // ---- The mound: a low reef outcrop in the middle -----------------------------
    this.group.add(buildMound())

    // ---- Seaweed: instanced 3D blades (see Seaweed.ts) ------------------------
    this.group.add(this.seaweed.mesh)

    // ---- Reef patches over the sand, and the water's light and particles --------
    this.group.add(buildReef(), this.corals.group, this.water.group)

    // ---- Bubbles, drifting up around the fish -----------------------------------
    const pos = new Float32Array(BUBBLES * 3)
    this.bubbleRise = new Float32Array(BUBBLES)
    for (let i = 0; i < BUBBLES; i++) {
      this.placeBubble(pos, i, { x: 0, y: 0, z: R * 0.55 })
      pos[i * 3 + 1] = this.rand() * H
      this.bubbleRise[i] = 30 + this.rand() * 60
    }
    const bubbleGeo = new THREE.BufferGeometry()
    bubbleGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.bubbles = new THREE.Points(bubbleGeo, new THREE.PointsMaterial({
      map: bubbleTexture(), size: 9, transparent: true, depthWrite: false, opacity: 0.8,
    }))
    this.bubbles.frustumCulled = false // they follow the fish around
    excludeFromDepth(this.bubbles)
    this.group.add(this.bubbles)
  }

  /** Whether a box at `pos` (half-extents `half`) touches the mound. */
  hitsMound(pos: TankPoint, half: { a: number, y: number }) {
    return Math.hypot(pos.x, pos.z) < TANK.mound.radius * 0.85 + half.a && pos.y - half.y < TANK.mound.height
  }

  /** `viewYaw`: the camera's heading, which the seaweed turns to face. */
  update(dt: number, fish: TankPoint, viewYaw: number) {
    this.time += dt
    // The light on the sand drifts slowly, like sun through moving water.
    this.caustics.offset.x = this.time * 0.013
    this.caustics.offset.y = this.time * 0.04
    this.seaweed.update(this.time, viewYaw)
    this.water.update(dt, fish, viewYaw)

    const attr = this.bubbles.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    for (let i = 0; i < this.bubbleRise.length; i++) {
      const y = arr[i * 3 + 1]! + this.bubbleRise[i]! * dt
      arr[i * 3 + 1] = y > H ? 0 : y
      if (Math.hypot(arr[i * 3]! - fish.x, arr[i * 3 + 2]! - fish.z) > BUBBLE_RANGE) this.placeBubble(arr, i, fish)
    }
    attr.needsUpdate = true
  }

  /** Put bubble `i` somewhere near the fish, inside the glass, at a random height. */
  private placeBubble(arr: Float32Array, i: number, fish: TankPoint) {
    const a = this.rand() * Math.PI * 2
    const d = Math.sqrt(this.rand()) * BUBBLE_RANGE * 0.95
    let x = fish.x + Math.cos(a) * d
    let z = fish.z + Math.sin(a) * d
    const r = Math.hypot(x, z)
    if (r > R - 20) {
      x *= (R - 20) / r
      z *= (R - 20) / r
    }
    arr[i * 3] = x
    arr[i * 3 + 1] = this.rand() * H
    arr[i * 3 + 2] = z
  }
}

/** A cluster of big rocks in the middle of the tank, lower toward its edge. */
function buildMound() {
  const g = new THREE.Group()
  const r = mulberry(5)
  const { radius, height } = TANK.mound
  for (let i = 0; i < 16; i++) {
    const d = Math.sqrt(r()) * radius * 0.8
    const a = r() * Math.PI * 2
    const size = (1 - (d / radius) * 0.6) * (60 + r() * 50)
    const m = new THREE.Mesh(rockGeos[Math.floor(r() * rockGeos.length)]!, rockMat)
    m.scale.set(size * (1 + r() * 0.4), Math.min(height, size * (0.7 + r() * 0.6)), size * (1 + r() * 0.4))
    m.position.set(Math.cos(a) * d, m.scale.y * 0.35, Math.sin(a) * d)
    m.rotation.y = r() * Math.PI * 2
    g.add(m)
  }
  return g
}

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
