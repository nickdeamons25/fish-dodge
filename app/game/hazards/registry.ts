import * as THREE from 'three'
import { TANK } from '../constants'
import type { TankPoint } from '../tank/space'
import { faceTravel } from './critters'
import { buildEel, poseEel } from './eel'
import { animateJelly, buildJelly } from './jellyfish'
import { PUFFER_GROWTH, animateBlueFish, buildBlueFish, buildPuffer, posePuffer } from './swimmers'

export interface HazardContext {
  /** Current world scroll speed, units/s. */
  speed: number
  level: number
  rand: () => number
  /** Where the player is, for hazards that react to them. */
  fish: TankPoint
}

/** A live hazard. Position and hitbox are in tank space. */
export interface Hazard {
  def: HazardDef
  pos: TankPoint
  /** Hitbox half-extents in tank units. */
  half: TankPoint
  /** Free-form per-instance state for behaviours. */
  data: Record<string, number>
  mesh: THREE.Object3D
}

/**
 * One kind of hazard. To add a new one, write a definition and push it onto
 * HAZARDS — the field picks from whatever is unlocked at the current level.
 * The mesh's origin should sit at the hitbox centre.
 */
export interface HazardDef {
  id: string
  minLevel: number
  /** Relative spawn chance among unlocked hazards. */
  weight: number
  /** Multiplier on world scroll speed (1 = drifts with the current, >1 swims at you). */
  speedFactor: number
  /** Minimum seconds between two spawns of this hazard, for rare ones. */
  cooldown?: number
  /** Place the hazard across the tank and size its hitbox. `pos.a` is already set. */
  setup: (h: Hazard, ctx: HazardContext) => void
  /** Build the 3D object once `setup` has sized the hitbox. */
  build: (h: Hazard) => THREE.Object3D
  /** Optional per-frame behaviour on top of drifting down the current. */
  update?: (h: Hazard, dt: number, time: number, ctx: HazardContext) => void
  /** Optional per-frame visual animation (mesh already positioned). */
  animate?: (h: Hazard, time: number) => void
}

const range = (r: () => number, min: number, max: number) => min + r() * (max - min)
const randomZ = (h: Hazard, r: () => number) => range(r, h.half.z, TANK.depth - h.half.z)

// ---- Shared geometry & materials --------------------------------------------
const rockMat = new THREE.MeshStandardMaterial({ color: 0x6b7484, roughness: 0.95, flatShading: true })
const rockGeos = Array.from({ length: 5 }, (_, i) => {
  const g = new THREE.IcosahedronGeometry(1, 1)
  const p = g.getAttribute('position') as THREE.BufferAttribute
  // Jitter each shared vertex consistently so faces stay closed.
  const seen = new Map<string, number>()
  for (let v = 0; v < p.count; v++) {
    const key = `${p.getX(v).toFixed(3)},${p.getY(v).toFixed(3)},${p.getZ(v).toFixed(3)}`
    if (!seen.has(key)) seen.set(key, 0.78 + (((v * 9301 + i * 49297) % 233280) / 233280) * 0.4)
    const k = seen.get(key)!
    p.setXYZ(v, p.getX(v) * k, p.getY(v) * k, p.getZ(v) * k)
  }
  g.computeVertexNormals()
  return g
})

const steelMat = new THREE.MeshStandardMaterial({ color: 0xc8d0d8, metalness: 0.8, roughness: 0.25 })
const beadMat = new THREE.MeshStandardMaterial({ color: 0xff4d4d, roughness: 0.3 })
const lineMat = new THREE.MeshBasicMaterial({ color: 0xe8eef5, transparent: true, opacity: 0.6 })
const lineGeo = new THREE.CylinderGeometry(0.8, 0.8, 1, 4).translate(0, 0.5, 0)

const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t) }

// ---- Definitions ------------------------------------------------------------
const rock: HazardDef = {
  id: 'rock',
  minLevel: 1,
  weight: 3,
  speedFactor: 1,
  setup(h, { rand }) {
    const s = range(rand, 0.8, 1.6)
    h.half = { a: 36 * s, y: 28 * s, z: 36 * s }
    h.pos.y = TANK.height - h.half.y
    h.pos.z = randomZ(h, rand)
    h.data.geo = Math.floor(rand() * rockGeos.length)
    h.data.spin = rand() * Math.PI * 2
  },
  build(h) {
    const m = new THREE.Mesh(rockGeos[h.data.geo!]!, rockMat)
    // Slightly larger than the hitbox and sunk into the sand.
    m.scale.set(h.half.a * 1.15, h.half.y * 1.3, h.half.z * 1.15)
    m.position.y = -h.half.y * 0.2
    m.rotation.y = h.data.spin!
    const g = new THREE.Group()
    g.add(m)
    return g
  },
}

const jellyfish: HazardDef = {
  id: 'jellyfish',
  minLevel: 1,
  weight: 3,
  speedFactor: 0.8,
  setup(h, { rand }) {
    h.half = { a: 20, y: 22, z: 20 }
    h.data.baseY = range(rand, 60, TANK.height - 90)
    h.data.amp = range(rand, 40, 90)
    h.data.baseZ = randomZ(h, rand)
    h.data.zAmp = 30
    h.data.phase = rand() * Math.PI * 2
    h.pos.y = h.data.baseY
    h.pos.z = h.data.baseZ
  },
  build: () => buildJelly(),
  update(h, _dt, time) {
    const t = time * 1.67 + h.data.phase!
    h.pos.y = h.data.baseY! + Math.sin(t) * h.data.amp!
    h.pos.z = h.data.baseZ! + Math.cos(t * 0.7) * h.data.zAmp!
  },
  animate(h, time) {
    animateJelly(h.mesh, time, h.data.phase!)
  },
}

const hook: HazardDef = {
  id: 'hook',
  minLevel: 2,
  weight: 2,
  speedFactor: 1,
  setup(h, { rand }) {
    h.half = { a: 13, y: 18, z: 13 }
    h.pos.y = -40
    h.pos.z = randomZ(h, rand)
    h.data.targetY = range(rand, TANK.height * 0.4, TANK.height - 40)
    h.data.dropSpeed = range(rand, 160, 260)
  },
  build() {
    const g = new THREE.Group()
    const hookGroup = new THREE.Group()
    const shank = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 30, 8), steelMat)
    shank.position.y = 6
    const bend = new THREE.Mesh(new THREE.TorusGeometry(8, 2.2, 8, 16, Math.PI * 1.15), steelMat)
    bend.rotation.z = Math.PI
    bend.position.set(-8, -9, 0)
    const bead = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 10), beadMat)
    bead.position.y = 22
    hookGroup.add(shank, bend, bead)
    // Angled so the bend reads from the chase camera.
    hookGroup.rotation.y = Math.PI / 4
    g.add(hookGroup)

    const line = new THREE.Mesh(lineGeo, lineMat)
    line.position.y = 26
    line.name = 'line'
    g.add(line)
    return g
  },
  update(h, dt) {
    if (h.pos.y < h.data.targetY!) h.pos.y = Math.min(h.data.targetY!, h.pos.y + h.data.dropSpeed! * dt)
  },
  animate(h) {
    // The line runs from the bead up past the surface.
    const line = h.mesh.getObjectByName('line')!
    line.scale.y = Math.max(1, h.pos.y + 60)
  },
}

const blueFish: HazardDef = {
  id: 'blue-fish',
  minLevel: 1,
  weight: 2,
  speedFactor: 1.5, // swims at you, faster than the current
  setup(h, { rand }) {
    h.data.size = range(rand, 0.9, 1.25)
    const s = h.data.size
    h.half = { a: 26 * s, y: 7 * s, z: 6 * s }
    h.data.baseY = range(rand, 40, TANK.height - 60)
    h.data.phase = rand() * Math.PI * 2
    h.pos.y = h.data.baseY
    h.pos.z = randomZ(h, rand)
  },
  build: h => buildBlueFish(h.data.size!),
  update(h, _dt, time) {
    h.pos.y = h.data.baseY! + Math.sin(time * 2 + h.data.phase!) * 18
  },
  animate(h, time) {
    faceTravel(h.mesh, blueFish.speedFactor)
    animateBlueFish(h.mesh, time, h.data.phase!)
  },
}

/** Pufferfish inflate tuning. */
const PUFF = {
  /** Minimum distance ahead of the player that sets it off. */
  triggerDist: 230,
  /** …or this many seconds of closing speed, whichever is further… */
  warnSeconds: 0.9,
  /** …but never so far ahead that it's lost in the fog. */
  maxTriggerDist: 520,
  /** Only when roughly level with the player. */
  triggerLevel: 140,
  releaseLevel: 220,
  inflateStiffness: 170,
  inflateDamping: 11,
  deflateStiffness: 14,
  deflateDamping: 8,
}

/** Puffer hitbox: its body grows more in girth than length, and erect spines add reach. */
function pufferHalf(size: number, puff: number) {
  const spines = 4 * Math.min(1, puff)
  return {
    a: 20 * size * (1 + PUFFER_GROWTH.length * puff),
    y: (16 * (1 + PUFFER_GROWTH.girth * puff) + spines) * size,
    z: (15 * (1 + PUFFER_GROWTH.girth * puff) + spines) * size,
  }
}

const puffer: HazardDef = {
  id: 'puffer',
  minLevel: 1,
  weight: 1.5,
  speedFactor: 1.2, // a slow swim toward you: face first, and it lingers in your way
  setup(h, { rand }) {
    h.data.size = range(rand, 0.9, 1.2)
    const s = h.data.size
    h.half = pufferHalf(s, 0)
    h.data.baseY = range(rand, 50, TANK.height - 60)
    h.data.phase = rand() * Math.PI * 2
    h.pos.y = h.data.baseY
    h.pos.z = randomZ(h, rand)
  },
  build: h => buildPuffer(h.data.size!),
  update(h, dt, time, ctx) {
    h.pos.y = h.data.baseY! + Math.sin(time * 1.2 + h.data.phase!) * 25

    // Puff up when the player swims close, deflate once they're past.
    const ahead = h.pos.a - ctx.fish.a // > 0 while the fish is still approaching
    // "Level with you" across both axes you steer: height and across the tank.
    const level = Math.hypot(h.pos.y - ctx.fish.y, h.pos.z - ctx.fish.z)
    // React at a distance that gives the same warning time at any speed.
    const reach = Math.min(PUFF.maxTriggerDist, Math.max(PUFF.triggerDist, ctx.speed * puffer.speedFactor * PUFF.warnSeconds))
    if (!h.data.puffed && ahead < reach && ahead > -30 && level < PUFF.triggerLevel) h.data.puffed = 1
    if (h.data.puffed && (ahead < -60 || level > PUFF.releaseLevel)) h.data.puffed = 0

    // Springy inflate (fast, overshoots), slow deflate.
    const target = h.data.puffed ? 1 : 0
    const [k, c] = target ? [PUFF.inflateStiffness, PUFF.inflateDamping] : [PUFF.deflateStiffness, PUFF.deflateDamping]
    const puff = h.data.puff ?? 0
    const vel = (h.data.puffVel ?? 0) + ((target - puff) * k - (h.data.puffVel ?? 0) * c) * dt
    h.data.puffVel = vel
    h.data.puff = Math.max(0, puff + vel * dt)

    // The hitbox swells with the body (and its now-erect spines).
    h.half = pufferHalf(h.data.size!, Math.min(1.1, h.data.puff))
  },
  animate(h, time) {
    faceTravel(h.mesh, puffer.speedFactor)
    posePuffer(h.mesh, h.data.puff ?? 0, time, h.data.phase!)
  },
}

/** Seconds for one eel cycle: rise, look around, sink, lurk. */
const EEL_CYCLE = 10

const eel: HazardDef = {
  id: 'eel',
  minLevel: 1,
  weight: 0.6,
  speedFactor: 1,
  cooldown: 25, // rare: never two within 25 s
  setup(h, { rand }) {
    h.half = { a: 16, y: 14, z: 16 }
    h.pos.y = TANK.height - h.half.y
    h.pos.z = randomZ(h, rand)
    h.data.reach = range(rand, 150, 185)
    h.data.phase = rand() * Math.PI * 2
    h.data.ext = 0
    h.data.born = -1
  },
  build() {
    const g = new THREE.Group()
    const root = buildEel()
    root.name = 'root'
    g.add(root)
    return g
  },
  update(h, _dt, time) {
    if (h.data.born! < 0) h.data.born = time
    const u = (((time - h.data.born!) / EEL_CYCLE) + 0.85) % 1 // start part-way through the lurk
    // Slow rise, hold, slow sink, then hide.
    const k = u < 0.3 ? smooth(u / 0.3) : u < 0.5 ? 1 : u < 0.8 ? 1 - smooth((u - 0.5) / 0.3) : 0
    h.data.ext = k * h.data.reach!
    // Hitbox runs from the seabed up to the head, so it grows as the eel rises.
    h.half.y = (h.data.ext + 28) / 2
    h.pos.y = TANK.height - h.half.y
  },
  animate(h, time) {
    // The group sits at the hitbox centre; drop the den back onto the seabed.
    const root = h.mesh.getObjectByName('root')!
    root.position.y = -(TANK.height - h.pos.y)
    poseEel(root, h.data.ext!, time, h.data.phase!)
  },
}

export const HAZARDS: HazardDef[] = [rock, jellyfish, hook, blueFish, puffer, eel]
