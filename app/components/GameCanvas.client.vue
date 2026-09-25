<script setup lang="ts">
import type { GameHandle } from '~/game/createGame'
import { useGameStore } from '~/stores/game'

const store = useGameStore()
const host = ref<HTMLDivElement>()
let game: GameHandle | undefined

onMounted(async () => {
  // Lazy-load so three.js lands in its own chunk.
  const { createGame } = await import('~/game/createGame')
  if (!host.value) return
  game = createGame(host.value, store)
})

// Forward status changes into the game.
watch(() => store.status, (status, prev) => {
  game?.onStatus(status, prev)
})

onBeforeUnmount(() => {
  game?.destroy()
  game = undefined
})
</script>

<template>
  <div ref="host" class="game-canvas" />
</template>

<style scoped>
.game-canvas {
  position: absolute;
  inset: 0;
  touch-action: none;
}
.game-canvas :deep(canvas) {
  display: block;
  border-radius: var(--radius);
}
</style>
