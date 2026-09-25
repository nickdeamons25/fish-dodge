<script setup lang="ts">
/**
 * A bendy "fish arrow": forked tail, a chain of body segments along a curve,
 * and an arrowhead for a head. The curve shape tells the player how the tank
 * is about to turn.
 */
export type ArrowShape = 'straight-right' | 'straight-left' | 'uturn-left' | 'uturn-right' | 'dive' | 'into'

const props = defineProps<{ shape: ArrowShape }>()

type Pt = [number, number]
interface Curve { p: [Pt, Pt, Pt, Pt], shrink: number }

const W = 240
const mirror = (c: Curve): Curve => ({ ...c, p: c.p.map(([x, y]) => [W - x, y]) as Curve['p'] })

const straight: Curve = { p: [[24, 70], [80, 48], [150, 92], [206, 70]], shrink: 0 }
const uturn: Curve = { p: [[36, 108], [236, 108], [236, 32], [52, 32]], shrink: 0 }
const CURVES: Record<ArrowShape, Curve> = {
  'straight-right': straight,
  'straight-left': mirror(straight),
  'uturn-left': uturn,
  'uturn-right': mirror(uturn),
  'dive': { p: [[20, 36], [140, 22], [196, 52], [176, 122]], shrink: 0 },
  // Recedes toward a vanishing point: segments shrink along the way.
  'into': { p: [[34, 116], [84, 116], [124, 58], [178, 40]], shrink: 0.7 },
}

function bezier(c: Curve, t: number): Pt {
  const [a, b, d, e] = c.p
  const u = 1 - t
  return [
    u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * d[0] + t * t * t * e[0],
    u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * d[1] + t * t * t * e[1],
  ]
}

function tangentAngle(c: Curve, t: number) {
  const [x1, y1] = bezier(c, Math.max(0, t - 0.01))
  const [x2, y2] = bezier(c, Math.min(1, t + 0.01))
  return (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI
}

const geo = computed(() => {
  const c = CURVES[props.shape]
  const persp = (t: number) => 1 - c.shrink * t
  const segments = Array.from({ length: 11 }, (_, i) => {
    const t = 0.06 + (i / 10) * 0.84
    const [x, y] = bezier(c, t)
    return { x, y, r: (5 + 8 * Math.sin(Math.PI * Math.min(1, t * 1.1))) * persp(t) }
  })
  const [hx, hy] = bezier(c, 1)
  const [tx, ty] = bezier(c, 0)
  return {
    segments,
    head: { x: hx, y: hy, angle: tangentAngle(c, 0.98), s: persp(1) },
    tail: { x: tx, y: ty, angle: tangentAngle(c, 0.02) },
  }
})
</script>

<template>
  <svg class="fish-arrow" viewBox="0 0 240 140" aria-hidden="true">
    <!-- tail fork -->
    <g :transform="`translate(${geo.tail.x} ${geo.tail.y}) rotate(${geo.tail.angle})`">
      <path d="M 6 0 L -14 -13 L -8 0 L -14 13 Z" class="fin" />
    </g>
    <!-- body segments; the staggered pulse reads as the fish swimming forward -->
    <circle
      v-for="(s, i) in geo.segments"
      :key="i"
      :cx="s.x"
      :cy="s.y"
      :r="s.r"
      class="seg"
      :style="{ animationDelay: `${i * 70}ms` }"
    />
    <!-- arrowhead head, with an eye -->
    <g :transform="`translate(${geo.head.x} ${geo.head.y}) rotate(${geo.head.angle}) scale(${geo.head.s})`">
      <path d="M -10 -18 L 20 0 L -10 18 L -4 0 Z" class="head" />
      <circle cx="3" cy="-5" r="3.2" fill="#fff" />
      <circle cx="4" cy="-5" r="1.6" fill="#10213a" />
    </g>
  </svg>
</template>

<style scoped>
.fish-arrow {
  width: 100%;
  height: auto;
  overflow: visible;
  filter: drop-shadow(0 3px 0 rgb(0 0 0 / 0.25));
}
.seg {
  fill: var(--accent);
  transform-box: fill-box;
  transform-origin: center;
  animation: swim 0.77s ease-in-out infinite;
}
.head {
  fill: #ffb45e;
}
.fin {
  fill: #ff7a1a;
}
@keyframes swim {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.3); }
}
</style>
