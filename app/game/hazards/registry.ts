import * as THREE from 'three'
import { TANK } from '../constants'
import { forward, right, type TankPoint } from '../tank/space'
import { faceTravel } from './critters'
import { buildEel, poseEel } from './eel'
import { animateJelly, buildJelly } from './jellyfish'
import { PUFFER_GROWTH, animateBlueFish, buildBlueFish, buildPuffer, posePuffer } from './swimmers'

export interface HazardContext {
  /** How fast the fish is swimming, units/s. */
  speed: number
  level: number
  rand: () => number
  /** Where the player is, which way it's heading and how fast it's turning, for hazards that react to them. */
  fish: TankPoint
  heading: number
  turnRate: number
  /** The camera's heading, which may lag the fish's mid-turn. */
  viewYaw: number
}

/**
 * A live hazard. Position is in tank space. Each hazard has its own frame,
 * turned to `heading`: at spawn that's the bearing from the fish to the
 * hazard, so local +X runs away from the fish, local -X back toward it, and
 * +Z is to the fish's right. Homing swimmers keep turning it (see `homing`).
 */
export interface Hazard {
  def: HazardDef
  pos: TankPoint
  heading: number
  /** Hitbox half-extents in the hazard's frame: along its heading (a), height (y), across (z). */
  half: { a: number, y: number, z: number }
  /** Free-form per-instance state for behaviours. */
  data: Record<string, number>
  mesh: THREE.Object3D
}

/**
 * One kind of hazard. To add a new one, write a definition and push it onto
 * HAZARDS — the field picks from whatever is unlocked at the current level.
 * Build the mesh in the hazard's frame (see Hazard), origin at the hitbox
 * centre; the field turns and places it.
 */
export interface HazardDef {
  id: string
  minLevel: number
  /** Relative spawn chance among unlocked hazards. */
  weight: number
  /**
   * Speed relative to the fish's, as if everything drifted toward it: 1 =
   * stays put while the fish swims up to it, >1 swims at you, <1 swims the
   * same way (and the fish overtakes it).
   */
  speedFactor: number
  /** Minimum seconds between two spawns of this hazard, for rare ones. */
  cooldown?: number
  /**
   * Swimmers that come at you turn toward the fish at up to this rate
   * (radians/s) while it's still well ahead of them, so turning away doesn't
   * lose them; close up they commit to a line, so they can still be dodged.
   */
  homing?: number
  /** Size the hitbox and set height and behaviour. `pos.x`/`pos.z` and `heading` are already set. */
  setup: (h: Hazard, ctx: HazardContext) => void
  /** Build the 3D object once `setup` has sized the hitbox. */
  build: (h: Hazard) => THREE.Object3D
  /** Optional per-frame behaviour on top of its drift (see `speedFactor`). */
  update?: (h: Hazard, dt: number, time: number, ctx: HazardContext) => void
  /** Optional per-frame visual animation (mesh already positioned). */
  animate?: (h: Hazard, time: number) => void
}

const range = (r: () => number, min: number, max: number) => min + r() * (max - min)
const H = TANK.height

// ---- Shared geometry & materials --------------------------------------------
export const rockMat = new THREE.MeshStandardMaterial({ color: 0x6b7484, roughness: 0.95, flatShading: true })
export const rockGeos = Array.from({ length: 5 }, (_, i) => {
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


const tmp = new THREE.Vector3()
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
    h.pos.y = h.half.y // on the sand
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
    h.data.baseY = range(rand, 90, H - 60)
    h.data.amp = range(rand, 40, 90)
    h.data.zAmp = 30
    h.data.phase = rand() * Math.PI * 2
    h.data.drift = 0
    h.pos.y = h.data.baseY
  },
  build: () => buildJelly(),
  update(h, _dt, time) {
    const t = time * 1.67 + h.data.phase!
    h.pos.y = h.data.baseY! + Math.sin(t) * h.data.amp!
    // Sway side to side across its path.
    const drift = Math.cos(t * 0.7) * h.data.zAmp!
    const side = right(h.heading, tmp)
    h.pos.x += side.x * (drift - h.data.drift!)
    h.pos.z += side.z * (drift - h.data.drift!)
    h.data.drift = drift
  },
  animate(h, time) {
    animateJelly(h.mesh, time, h.data.phase!)
  },
}

const blueFish: HazardDef = {
  id: 'blue-fish',
  minLevel: 1,
  weight: 2,
  speedFactor: 1.5, // swims at you, faster than the current
  homing: 0.9,
  setup(h, { rand }) {
    h.data.size = range(rand, 0.9, 1.25)
    const s = h.data.size
    h.half = { a: 26 * s, y: 7 * s, z: 6 * s }
    h.data.baseY = range(rand, 60, H - 40)
    h.data.phase = rand() * Math.PI * 2
    h.pos.y = h.data.baseY
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
  homing: 0.6,
  setup(h, { rand }) {
    h.data.size = range(rand, 0.9, 1.2)
    const s = h.data.size
    h.half = pufferHalf(s, 0)
    h.data.baseY = range(rand, 60, H - 50)
    h.data.phase = rand() * Math.PI * 2
    h.pos.y = h.data.baseY
  },
  build: h => buildPuffer(h.data.size!),
  update(h, dt, time, ctx) {
    h.pos.y = h.data.baseY! + Math.sin(time * 1.2 + h.data.phase!) * 25

    // Puff up when the player swims close, deflate once they're past.
    // Measured in the fish's frame: how far ahead of it, and how far off its path.
    const fwd = forward(ctx.heading, tmp)
    const dx = h.pos.x - ctx.fish.x
    const dz = h.pos.z - ctx.fish.z
    const ahead = dx * fwd.x + dz * fwd.z // > 0 while the fish is still approaching
    const across = dx * fwd.z - dz * fwd.x
    const level = Math.hypot(h.pos.y - ctx.fish.y, across)
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
    h.pos.y = h.half.y
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
    h.pos.y = h.half.y
  },
  animate(h, time) {
    // The group sits at the hitbox centre; drop the den back onto the seabed.
    const root = h.mesh.getObjectByName('root')!
    root.position.y = -h.pos.y
    poseEel(root, h.data.ext!, time, h.data.phase!)
  },
}

export const HAZARDS: HazardDef[] = [rock, jellyfish, blueFish, puffer, eel]
