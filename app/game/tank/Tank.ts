import * as THREE from 'three'
import { COLORS, TANK } from '../constants'
import { excludeFromDepth } from '../engine/RenderPipeline'
import { Seaweed } from './Seaweed'
import { backdropTexture, bubbleTexture, causticsTexture, sandTexture } from './textures'

const LEN = TANK.maxA - TANK.minA
const MID_X = (TANK.minA + TANK.maxA) / 2
const H = TANK.height
const D = TANK.depth
const SAND_TILE = 256
const CAUSTIC_TILE = 300
const BACKDROP_TILE = 1024

/**
 * The aquarium: a fixed glass box the camera orbits. The fish never really
 * moves forward — the floor, backdrop, weeds and bubbles scroll past instead.
 */
export class Tank {
  readonly group = new THREE.Group()
  private sand: THREE.Texture
  private caustics: THREE.Texture
  /** One per long wall: [back, front]. The front one runs mirrored. */
  private backdrops: THREE.Texture[] = []
  private seaweed = new Seaweed()
  /** Total world travel, for anything scrolled in a shader. */
  private scroll = 0
  private bubbles: THREE.Points
  private bubbleRise: Float32Array
  private time = 0

  constructor(scene: THREE.Scene) {
    scene.add(this.group)

    // ---- Light -------------------------------------------------------------
    this.group.add(new THREE.HemisphereLight(0xcff2ff, COLORS.deepWater, 2.4))
    this.group.add(new THREE.AmbientLight(0xffffff, 0.9))
    const sun = new THREE.DirectionalLight(0xffffff, 2.6)
    sun.position.set(200, 1200, 500)
    this.group.add(sun)
    // Fill from the front glass so the side views aren't lit only from above.
    const fill = new THREE.DirectionalLight(0xbfe6ff, 1.2)
    fill.position.set(300, 300, 1200)
    this.group.add(fill)

    // ---- Seabed --------------------------------------------------------------
    this.sand = sandTexture()
    this.sand.repeat.set(LEN / SAND_TILE, D / SAND_TILE)
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(LEN, D),
      new THREE.MeshStandardMaterial({ map: this.sand, roughness: 1 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.set(MID_X, 0, 0)
    this.group.add(floor)

    this.caustics = causticsTexture()
    this.caustics.repeat.set(LEN / CAUSTIC_TILE, D / CAUSTIC_TILE)
    const causticPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(LEN, D),
      new THREE.MeshBasicMaterial({
        map: this.caustics, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    )
    causticPlane.rotation.x = -Math.PI / 2
    causticPlane.position.set(MID_X, 1, 0)
    excludeFromDepth(causticPlane)
    this.group.add(causticPlane)

    // ---- Long walls: a painted reef facing *into* the tank on both sides ----
    // Single-sided, so the wall nearest an outside camera is culled and you
    // see through its glass; the far wall always shows reef behind the fish.
    // From the inside (rear view) both walls show, making a reef corridor.
    const backdropSrc = backdropTexture()
    for (const side of [-1, 1]) {
      const tex = side < 0 ? backdropSrc : backdropSrc.clone()
      tex.wrapT = THREE.ClampToEdgeWrapping
      tex.repeat.set(LEN / BACKDROP_TILE, 1)
      tex.offset.x = side < 0 ? 0 : 0.37 // don't mirror the same reef exactly
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(LEN, H), new THREE.MeshBasicMaterial({ map: tex }))
      wall.position.set(MID_X, H / 2, (side * D) / 2)
      if (side > 0) wall.rotation.y = Math.PI // face back into the tank
      this.group.add(wall)
      this.backdrops.push(tex)

      const glass = new THREE.Mesh(
        new THREE.PlaneGeometry(LEN, H),
        // Opacities here are tuned for linear-space blending (see engine/RenderPipeline.ts).
        new THREE.MeshBasicMaterial({ color: COLORS.glass, transparent: true, opacity: 0.025, depthWrite: false, side: THREE.DoubleSide }),
      )
      glass.position.set(MID_X, H / 2, side * (D / 2 + 2))
      excludeFromDepth(glass)
      this.group.add(glass)
    }

    // End walls in deep-water colour, facing inward, so a camera looking down
    // the tank's length (mid-turn, or rear view) sees murk rather than the room.
    const endMat = new THREE.MeshBasicMaterial({ color: COLORS.deepWater })
    for (const [x, rot] of [[TANK.minA, Math.PI / 2], [TANK.maxA, -Math.PI / 2]] as const) {
      const end = new THREE.Mesh(new THREE.PlaneGeometry(D, H), endMat)
      end.position.set(x, H / 2, 0)
      end.rotation.y = rot
      this.group.add(end)
    }

    // ---- Surface, rims ---------------------------------------------------------

    const surface = new THREE.Mesh(
      new THREE.PlaneGeometry(LEN, D),
      // A light tint; blob shadows (tank/shadow.ts) do the work of separating things from the sand.
      new THREE.MeshBasicMaterial({ color: 0x3aa6dc, transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide }),
    )
    surface.rotation.x = -Math.PI / 2
    surface.position.set(MID_X, H, 0)
    excludeFromDepth(surface)
    this.group.add(surface)

    const rimMat = new THREE.MeshStandardMaterial({ color: 0x1b2733, roughness: 0.6 })
    const rimGeo = new THREE.BoxGeometry(LEN, 10, 10)
    for (const y of [0, H]) {
      for (const z of [-D / 2, D / 2]) {
        const rim = new THREE.Mesh(rimGeo, rimMat)
        rim.position.set(MID_X, y, z)
        this.group.add(rim)
      }
    }

    // ---- Seaweed: instanced 3D blades (see Seaweed.ts) ------------------------
    this.group.add(this.seaweed.mesh)
    const r = mulberry(11)

    // ---- Bubbles -------------------------------------------------------------
    const count = 160
    const pos = new Float32Array(count * 3)
    this.bubbleRise = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = TANK.minA + r() * LEN
      pos[i * 3 + 1] = r() * H
      pos[i * 3 + 2] = (r() - 0.5) * D
      this.bubbleRise[i] = 30 + r() * 60
    }
    const bubbleGeo = new THREE.BufferGeometry()
    bubbleGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.bubbles = new THREE.Points(bubbleGeo, new THREE.PointsMaterial({
      map: bubbleTexture(), size: 9, transparent: true, depthWrite: false, opacity: 0.8,
    }))
    excludeFromDepth(this.bubbles)
    this.group.add(this.bubbles)
  }

  update(dt: number, speed: number) {
    const step = speed * dt
    this.time += dt

    this.sand.offset.x += step / SAND_TILE
    this.caustics.offset.x += (step * 0.8) / CAUSTIC_TILE
    this.caustics.offset.y += dt * 0.04
    // The front wall's plane is turned around, so its texture runs the other way.
    this.backdrops[0]!.offset.x += (step * 0.3) / BACKDROP_TILE
    this.backdrops[1]!.offset.x -= (step * 0.3) / BACKDROP_TILE

    this.scroll += step
    this.seaweed.update(this.time, this.scroll)

    const attr = this.bubbles.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    for (let i = 0; i < this.bubbleRise.length; i++) {
      let x = arr[i * 3]! - step * 0.9
      let y = arr[i * 3 + 1]! + this.bubbleRise[i]! * dt
      if (x < TANK.minA) x += LEN
      else if (x > TANK.maxA) x -= LEN
      if (y > H) y = 0
      arr[i * 3] = x
      arr[i * 3 + 1] = y
    }
    attr.needsUpdate = true
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
