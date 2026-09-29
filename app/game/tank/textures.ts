import * as THREE from 'three'

/**
 * Procedural canvas textures so the project still has zero binary assets.
 * Replace any of these with `new THREE.TextureLoader().load(...)` later.
 */
function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat = true) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  draw(canvas.getContext('2d')!)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  return tex
}

/** Deterministic pseudo-random so textures look the same every load. */
function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
}

export function sandTexture() {
  return canvasTexture(512, 512, (c) => {
    const r = rng(7)
    c.fillStyle = '#c9a86a'
    c.fillRect(0, 0, 512, 512)
    for (let i = 0; i < 900; i++) {
      c.fillStyle = r() > 0.5 ? '#b8975c' : '#d8bb80'
      const x = r() * 512
      const y = r() * 512
      const s = 1 + r() * 3
      // Wrapped copies keep the tile seamless.
      for (const dx of [-512, 0, 512]) for (const dy of [-512, 0, 512]) c.fillRect(x + dx, y + dy, s, s)
    }
    for (let i = 0; i < 40; i++) {
      c.fillStyle = r() > 0.5 ? '#8f7a55' : '#a0917a'
      c.beginPath()
      c.ellipse(r() * 512, r() * 512, 3 + r() * 6, 2 + r() * 4, r() * Math.PI, 0, Math.PI * 2)
      c.fill()
    }
  })
}

export function causticsTexture() {
  return canvasTexture(256, 256, (c) => {
    const r = rng(3)
    c.strokeStyle = 'rgba(255,255,255,0.55)'
    c.lineWidth = 2.5
    for (let i = 0; i < 18; i++) {
      const x = r() * 256
      const y = r() * 256
      const w = 20 + r() * 30
      const h = 14 + r() * 20
      for (const dx of [-256, 0, 256]) {
        for (const dy of [-256, 0, 256]) {
          c.beginPath()
          c.ellipse(x + dx, y + dy, w, h, r() * Math.PI, 0, Math.PI * 2)
          c.stroke()
        }
      }
    }
  })
}

/** Painted back wall: water gradient with distant reef silhouettes. */
export function backdropTexture() {
  return canvasTexture(1024, 512, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 512)
    g.addColorStop(0, '#2aa5d8')
    g.addColorStop(1, '#083457')
    c.fillStyle = g
    c.fillRect(0, 0, 1024, 512)

    const ridge = (base: number, amp: number[], color: string) => {
      c.fillStyle = color
      c.beginPath()
      c.moveTo(0, 512)
      for (let x = 0; x <= 1024; x += 8) {
        let y = 512 - base
        amp.forEach((a, i) => { y += Math.sin((x / 1024) * Math.PI * 2 * (i * 3 + 2)) * a })
        c.lineTo(x, y)
      }
      c.lineTo(1024, 512)
      c.fill()
    }
    ridge(230, [40, 18, 8], '#0d4a6b')
    ridge(140, [24, 14, 6], '#0b3f5e')
  })
}

export function bubbleTexture() {
  return canvasTexture(32, 32, (c) => {
    c.strokeStyle = 'rgba(223,246,255,0.95)'
    c.lineWidth = 3
    c.beginPath()
    c.arc(16, 16, 12, 0, Math.PI * 2)
    c.stroke()
    c.fillStyle = 'rgba(255,255,255,0.9)'
    c.beginPath()
    c.arc(11, 11, 3, 0, Math.PI * 2)
    c.fill()
  }, false)
}

/**
 * A gorgonian sea fan, white on transparent (tinted per instance): a fan of
 * forking branches from a short stem, knitted together by a fine lattice.
 * Used as a cut-out, so it has real holes.
 */
export function seaFanTexture() {
  const S = 256
  return canvasTexture(S, S, (c) => {
    const r = rng(13)
    c.strokeStyle = '#ffffff'
    c.lineCap = 'round'
    const tips: [number, number][] = []
    const branch = (x: number, y: number, angle: number, len: number, width: number, depth: number) => {
      const x2 = x + Math.cos(angle) * len
      const y2 = y - Math.sin(angle) * len
      c.lineWidth = width
      c.beginPath()
      c.moveTo(x, y)
      c.lineTo(x2, y2)
      c.stroke()
      if (depth === 0) {
        tips.push([x2, y2])
        return
      }
      for (const turn of [-1, 1]) branch(x2, y2, angle + turn * (0.25 + r() * 0.2), len * (0.72 + r() * 0.1), width * 0.72, depth - 1)
    }
    // The stem.
    c.lineWidth = 7
    c.beginPath()
    c.moveTo(S / 2, S - 4)
    c.lineTo(S / 2, S - 38)
    c.stroke()
    for (const a of [0.55, 0.9, 1.25, 1.57, 1.9, 2.25, 2.6]) branch(S / 2, S - 36, a, 30 + r() * 10, 4.5, 4)
    // The lattice: fine threads joining neighbouring branches across the fan.
    c.lineWidth = 1.4
    for (let ring = 0; ring < 9; ring++) {
      const d = 50 + ring * 22
      c.beginPath()
      for (let a = 0.45; a <= 2.7; a += 0.05) {
        const x = S / 2 + Math.cos(a) * d * (0.98 + r() * 0.04)
        const y = S - 36 - Math.sin(a) * d * (0.98 + r() * 0.04)
        if (a === 0.45) c.moveTo(x, y)
        else c.lineTo(x, y)
      }
      c.stroke()
    }
    // Trim the lattice to the fan's outline, so no threads dangle past the tips.
    c.globalCompositeOperation = 'destination-in'
    c.beginPath()
    c.moveTo(S / 2, S)
    for (const [x, y] of [...tips].sort((p, q) => Math.atan2(S - 36 - q[1], q[0] - S / 2) - Math.atan2(S - 36 - p[1], p[0] - S / 2))) c.lineTo(x, y)
    c.closePath()
    c.fill()
  }, false)
}

/** A shaft of sunlight: bright at the top, fading out toward the sand, soft at the edges. */
export function sunShaftTexture() {
  return canvasTexture(64, 256, (c) => {
    const down = c.createLinearGradient(0, 0, 0, 256)
    down.addColorStop(0, 'rgba(255,255,255,1)')
    down.addColorStop(0.55, 'rgba(255,255,255,0.45)')
    down.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = down
    c.fillRect(0, 0, 64, 256)
    // Feather the sides.
    c.globalCompositeOperation = 'destination-in'
    const across = c.createLinearGradient(0, 0, 64, 0)
    across.addColorStop(0, 'rgba(0,0,0,0)')
    across.addColorStop(0.5, 'rgba(0,0,0,1)')
    across.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = across
    c.fillRect(0, 0, 64, 256)
  }, false)
}

/** A soft round speck for drifting particles in the water. */
export function speckTexture() {
  return canvasTexture(16, 16, (c) => {
    const g = c.createRadialGradient(8, 8, 0, 8, 8, 8)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 16, 16)
  }, false)
}
