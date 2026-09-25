<script setup lang="ts">
import { useGameStore } from '~/stores/game'

const store = useGameStore()

// Meta controls live in Vue; movement input is handled inside the game.
function onKey(e: KeyboardEvent) {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return
  const key = e.key.toLowerCase()
  if (key === 'p' || key === 'escape') store.togglePause()
  else if ((key === ' ' || key === 'enter') && (store.status === 'menu' || store.status === 'gameover')) {
    e.preventDefault()
    store.startRun()
  }
}

// Auto-pause when the tab loses focus.
function onVisibility() {
  if (document.hidden && store.status === 'playing') store.togglePause()
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  document.addEventListener('visibilitychange', onVisibility)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <main class="stage">
    <div class="frame">
      <GameCanvas />
      <GameHud v-if="store.status === 'playing' || store.status === 'paused'" />
      <GameOverlay />
    </div>
  </main>
</template>

<style scoped>
.stage {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 16px;
}
.frame {
  position: relative;
  width: min(100%, 960px, calc((100dvh - 32px) * 16 / 9));
  aspect-ratio: 16 / 9;
  border-radius: var(--radius);
  overflow: hidden;
  container-type: size;
  box-shadow: 0 30px 80px rgb(0 0 0 / 0.45);
}
</style>
