import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  BodyProfile, Z, addEyes, canvasTex, finGeometry, finMaterial, heightAround, lerp, pairedFinNormal,
  scaleTexture, skinMaterial, swimMesh, swimUniforms, v3,
} from './fishKit'

export type { SwimUniforms } from './fishKit'

/**
 * The player's clownfish, built for close-ups and painted from ocellaris
 * reference photos. Shared machinery (lathed body, swimming shader, fin
 * membranes, eyes) lives in fishKit.ts.
 *
 * Reference notes that drive the shapes below:
 *  - a deep, rounded body tapering to a *thick* tail stem, which flows into a
 *    broad, rounded paddle of a tail (not a fan pinned to a point);
 *  - every fin rounded: two soft humps on the back fin, a big rounded anal
 *    paddle, large rounded pectoral fans, rounded pelvics;
 *  - fins brighter than the body, with visible rays, a thick black margin and
 *    a fine translucent fringe beyond it;
 *  - a sloping forehead down to pale, pouty lips.
 */

// (x, height-radius) from tail to nose. The tail end is blunt and deep so the
// caudal fin grows out of it rather than being pinned to a point.
const BODY = new BodyProfile([
  [-24.3, 0], [-24, 3.6], [-23.1, 5.7], [-21, 6.9], [-17, 8.3], [-12, 11.2], [-5, 14.6],
  [3, 16.8], [10, 17.3], [16, 16.6], [21, 14.8], [25, 11.8], [28, 8.2], [29.8, 5.2], [30.8, 2.6], [31, 0],
], 0.62)
const radiusAt = (x: number) => BODY.radiusAt(x)

/** How far the forehead slope pulls the snout down at x (upper head drops more than the chin). */
function headDrop(x: number, y: number) {
  if (x <= 18) return 0
  const r = Math.max(1, radiusAt(x))
  const upper = THREE.MathUtils.clamp((y + r) / (2 * r), 0, 1)
  return (x - 18) ** 2 * 0.013 * (0.35 + 0.65 * upper)
}

function bodyGeometry() {
  const g = BODY.geometry(72)
  // Sloping forehead: the lathe is symmetric top-to-bottom, so shear the head
  // down, more over the brow than under the chin, to put the mouth low and forward.
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) - headDrop(pos.getX(i), pos.getY(i)))
  g.computeVertexNormals()
  return g
}

// ---- Skin ------------------------------------------------------------------------------
/**
 * Body skin. U runs around the body (0.5 = back, 0/1 = belly seam), V along it
 * (0 = tail, 1 = nose). Canvas Y is flipped: row 0 is the nose.
 */
function skinTexture() {
  const W = 1024
  const H = 512
  const pxPerUnit = H / BODY.length
  return canvasTex(W, H, (c) => {
    const rowOf = (x: number) => BODY.rowOf(x, H)
    // Deep red-orange body warming to orange on the head, a slightly darker back
    // and a paler, warmer throat and belly.
    for (let y = 0; y < H; y += 2) {
      const x = BODY.tailX + (1 - y / H) * BODY.length
      const head = THREE.MathUtils.smoothstep(x, 8, 26)
      for (let px = 0; px < W; px += 4) {
        const h = heightAround(px / W)
        const back = Math.max(0, h)
        const belly = Math.max(0, -h)
        const r = Math.round(246 - back * 10)
        const g = Math.round(104 + head * 40 - back * 20 + belly * 32)
        const b = Math.round(4 + head * 12 + belly * 30)
        c.fillStyle = `rgb(${r},${g},${b})`
        c.fillRect(px, y, 4, 2)
      }
    }

    // Bands as x-centre-vs-height curves; h = height around the body (+1 back, -1 belly).
    const bands: { centre: (h: number) => number, half: number }[] = [
      { centre: h => 14.5 + (1 - h) * 1.8, half: 2.4 }, // head band: behind the eye, sweeping under it
      { centre: h => -1.5 + (1 - Math.abs(h)) * 3.5, half: 3.9 }, // mid band: points forward at mid-side
      { centre: () => -19.6, half: 1.5 }, // tail band on the stem
    ]
    const edge = 1.25 * pxPerUnit
    for (let px = 0; px < W; px += 2) {
      const h = heightAround(px / W)
      for (const band of bands) {
        const x = band.centre(h)
        const top = rowOf(x + band.half)
        const bottom = rowOf(x - band.half)
        c.fillStyle = '#0f0b08'
        c.fillRect(px, top - edge, 2, bottom - top + edge * 2)
        c.fillStyle = '#fdfbf6'
        c.fillRect(px, top, 2, bottom - top)
      }
    }
    // Just enough softening on the band edges to avoid aliasing; keep them crisp.
    c.filter = 'blur(0.5px)'
    c.drawImage(c.canvas, 0, 0)
    c.filter = 'none'
    for (let i = 0; i < 400; i++) {
      c.fillStyle = `rgba(${Math.random() > 0.5 ? '255,180,80' : '200,60,0'},0.03)`
      c.beginPath()
      c.arc(Math.random() * W, Math.random() * H, 6 + Math.random() * 12, 0, Math.PI * 2)
      c.fill()
    }
  })
}

// ---- Fin textures ------------------------------------------------------------------------
type FinVariant = 'plain' | 'dorsal' | 'pelvic' | 'pectoral'

/**
 * Fin membrane. U = across the fin base, V = base → tip (canvas row 0 is the tip).
 * Bright yellow-orange with visible rays, a thick black margin and a fine
 * translucent fringe at the very edge (resolved by alpha-to-coverage).
 *   dorsal:   the mid body band carries up into the fin's notch.
 *   pelvic:   a white leading edge.
 *   pectoral: only a thin black edge.
 */
function finTexture(variant: FinVariant) {
  const S = 512
  const margin = variant === 'pectoral' ? 0.86 : 0.76
  const fringe = 0.955
  return canvasTex(S, S, (c) => {
    const row = (t: number) => (1 - t) * S
    const g = c.createLinearGradient(0, S, 0, 0)
    g.addColorStop(0, '#ff9010')
    g.addColorStop(0.45, '#ffa422')
    g.addColorStop(margin - 0.09, '#ff9006')
    g.addColorStop(margin - 0.03, '#d85800')
    g.addColorStop(margin, '#100b07')
    g.addColorStop(fringe, '#100b07')
    g.addColorStop(fringe + 0.008, 'rgba(225,225,220,0.3)')
    g.addColorStop(1, 'rgba(225,225,220,0)')
    c.fillStyle = g
    c.fillRect(0, 0, S, S)

    // Rays: fine darker lines with a soft highlight beside each, fading into the margin.
    const rays = 24
    for (let i = 1; i < rays; i++) {
      const x = (i / rays) * S
      c.strokeStyle = 'rgba(180,70,0,0.38)'
      c.lineWidth = 2.2
      c.beginPath()
      c.moveTo(x, S)
      c.lineTo(x, row(margin))
      c.stroke()
      c.strokeStyle = 'rgba(255,215,130,0.25)'
      c.lineWidth = 2
      c.beginPath()
      c.moveTo(x + 4, S)
      c.lineTo(x + 4, row(margin - 0.04))
      c.stroke()
      // Ray tips feather out into the fringe.
      c.strokeStyle = 'rgba(210,210,205,0.22)'
      c.lineWidth = 1.2
      c.beginPath()
      c.moveTo(x, row(fringe))
      c.lineTo(x, 0)
      c.stroke()
    }

    if (variant === 'dorsal') {
      // The mid band continues up into the dorsal notch, edged in black.
      const x0 = 0.39 * S
      const x1 = 0.64 * S
      const top = row(0.5)
      const band = (inset: number, color: string) => {
        c.fillStyle = color
        c.beginPath()
        c.moveTo(x0 - inset, S)
        c.lineTo(x1 + inset, S)
        c.quadraticCurveTo(x1 - 6 + inset, top, (x0 + x1) / 2, top - inset)
        c.quadraticCurveTo(x0 + 6 - inset, top, x0 - inset, S)
        c.fill()
      }
      band(16, '#100b07')
      band(0, '#fdfbf6')
    }
    if (variant === 'pelvic') {
      const w = c.createLinearGradient(0, 0, S * 0.14, 0)
      w.addColorStop(0, '#fdfbf6')
      w.addColorStop(0.7, '#fdfbf6')
      w.addColorStop(1, 'rgba(253,251,246,0)')
      c.fillStyle = w
      c.fillRect(0, row(fringe), S * 0.14, S - row(fringe))
    }
  })
}

// ---- Fins ------------------------------------------------------------------------------
/** Smooth bump for building rounded fin outlines. */
const bump = (s: number, centre: number, width: number) => Math.exp(-(((s - centre) / width) ** 2))
/** Fans widen quickly near the base and round off at the edge. */
const fanT = (t: number) => 1 - (1 - t) ** 1.6

function finsGeometry() {
  const fins: THREE.BufferGeometry[] = []
  const pelvics: THREE.BufferGeometry[] = []
  const pectorals: THREE.BufferGeometry[] = []

  // Caudal: grows out of the deep tail stem along its whole height, spreading
  // into a broad rounded paddle. Rolls hardest.
  fins.push(finGeometry((s, t) => {
    const base = v3(-22.6, lerp(-5.6, 5.6, s), 0)
    const phi = lerp(-Math.PI / 2 * 0.94, Math.PI / 2 * 0.94, s)
    const edge = v3(-30.5 - 9.5 * Math.cos(phi), 14.5 * Math.sin(phi), 0)
    return v3(lerp(base.x, edge.x, t), lerp(base.y, edge.y, fanT(t)), 0)
  }, Z, [3, 1, 2.2, 0.8], 28, 14))

  // Anal: a big rounded paddle under the rear body.
  fins.push(finGeometry((s, t) => {
    const x = lerp(-1.5, -17.5, s)
    const h = 11 * Math.sin(Math.PI * s) ** 0.65 * (1 - 0.2 * s)
    return v3(x - t * 5, -(radiusAt(x) - 1.4) - t * h, 0)
  }, Z, [1.2, 0.9, 1.4, 5], 24, 10))

  for (const side of [-1, 1]) {
    // Pectorals: large rounded fans behind the gills, rowing.
    const px = 12.5
    const pz = radiusAt(px) * BODY.flat * 0.9 * side
    const baseMid = v3(px, -2.2, pz)
    const out = v3(-11, -1.2, 6.5 * side).normalize()
    const tip = baseMid.clone().addScaledVector(out, 10)
    pectorals.push(finGeometry((s, t) => {
      const base = v3(px, lerp(-6.5, 2, s), pz)
      const phi = lerp(-Math.PI / 2 * 0.9, Math.PI / 2 * 0.9, s)
      const edge = baseMid.clone().addScaledVector(out, 7 + 6 * Math.cos(phi)).add(v3(0, 7 * Math.sin(phi), 0))
      return base.clone().lerp(edge, fanT(t))
    }, pairedFinNormal(v3(0, 1, 0), baseMid, tip, side), [3, 0.6, 1.4, 0.8], 20, 12))

    // Pelvics: rounded fans tucked under the belly and swept back.
    const baseY = -(radiusAt(10) - 2)
    const pelTip = v3(1, baseY - 6.5, 8.5 * side) // short, swept back and splayed outward
    pelvics.push(finGeometry((s, t) => {
      const base = v3(lerp(14, 6, s), baseY, 2.5 * side)
      // Spread in the same direction as the base (front → back), or it twists.
      const end = pelTip.clone().add(v3(-(s - 0.5) * 9, -Math.sin(Math.PI * s) * 2.5, 0))
      return base.lerp(end, fanT(t))
    }, pairedFinNormal(v3(-1, 0, 0), v3(10, baseY, 2.5 * side), pelTip, side), [1.4, 0.7, 2, 1], 18, 10))
  }
  return { plain: mergeGeometries(fins)!, pelvic: mergeGeometries(pelvics)!, pectoral: mergeGeometries(pectorals)! }
}

// ---- Assembly ----------------------------------------------------------------------------
export function buildFishModel() {
  // Carangiform swimming: the rear half flexes, one wave per body length.
  const uniforms = swimUniforms(14, -34, 0.11, 2.5)
  const bodyMat = skinMaterial(skinTexture(), scaleTexture(18, 11), uniforms)

  const group = new THREE.Group()
  group.add(swimMesh(bodyGeometry(), bodyMat, uniforms))
  const fins = finsGeometry()
  const dorsal = dorsalGeometry()
  group.add(swimMesh(fins.plain, finMaterial(finTexture('plain'), uniforms), uniforms))
  group.add(swimMesh(dorsal, finMaterial(finTexture('dorsal'), uniforms), uniforms))
  group.add(swimMesh(fins.pelvic, finMaterial(finTexture('pelvic'), uniforms), uniforms))
  group.add(swimMesh(fins.pectoral, finMaterial(finTexture('pectoral'), uniforms), uniforms))

  // Eyes: an amber-orange iris with a thin black rim and a big black pupil, set
  // high and forward, right against the head band.
  const ex = 23.2
  const ey = 5.2 - headDrop(23.2, 5.2)
  addEyes(group, { x: ex, y: ey, surfaceZ: BODY.sideZ(ex, 5.2), radius: 4.1, iris: 0xff8a1a })

  // Pale, pouty lips at the lowered snout, with the mouth between them.
  const lipMat = new THREE.MeshPhysicalMaterial({ color: 0xffa050, roughness: 0.35, clearcoat: 0.6 })
  const sphere = new THREE.SphereGeometry(1, 20, 14)
  const noseY = -headDrop(BODY.noseX - 0.5, 0)
  for (const [y, sx, sy, sz] of [[0.9, 2.1, 1.3, 2.9], [-1.4, 1.9, 1.2, 2.6]] as const) {
    const lip = new THREE.Mesh(sphere, lipMat)
    lip.scale.set(sx, sy, sz)
    lip.position.set(BODY.noseX - 0.9, noseY + y, 0)
    group.add(lip)
  }
  const mouth = new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({ color: 0x2a0d05, roughness: 0.4 }))
  mouth.scale.set(1.1, 0.8, 2)
  mouth.position.set(BODY.noseX - 0.3, noseY - 0.25, 0)
  group.add(mouth)

  return { group, mouth, uniforms }
}

/**
 * Dorsal fin (its own mesh, for the band-patch texture): two soft humps over
 * the spiny part, a notch where the mid band rises into it, then a tall
 * rounded soft lobe that curves back down to the body.
 */
function dorsalGeometry() {
  return finGeometry((s, t) => {
    const x = lerp(15, -17, s)
    const fall = Math.sin(Math.min(1, (1 - s) * 5) * Math.PI / 2)
    const h = (2.6 + 3.2 * bump(s, 0.12, 0.1) + 3.6 * bump(s, 0.3, 0.1) + 8.6 * bump(s, 0.73, 0.2)) * fall
    return v3(x - t * 4 * (0.5 + s), radiusAt(x) - headDrop(x, radiusAt(x)) - 1.4 + t * h, 0)
  }, Z, [1.3, 0.9, 1.5, 5.5], 40, 10)
}
