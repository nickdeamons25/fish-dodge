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
