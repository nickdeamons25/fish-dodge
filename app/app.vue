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

// Phones play sideways: in portrait, cover the game with a prompt and pause.
const portraitQuery = import.meta.client ? window.matchMedia('(orientation: portrait) and (pointer: coarse)') : undefined
const mustRotate = ref(portraitQuery?.matches ?? false)
function onOrientation() {
  mustRotate.value = portraitQuery?.matches ?? false
  if (mustRotate.value && store.status === 'playing') store.togglePause()
}

// Long-presses and pinches on a phone would otherwise open the context menu
// or zoom the page mid-run. Text fields keep their native behavior.
function onContextMenu(e: Event) {
  if ((e.target as HTMLElement)?.tagName !== 'INPUT') e.preventDefault()
}
function onGesture(e: Event) {
  e.preventDefault()
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('contextmenu', onContextMenu)
  document.addEventListener('gesturestart', onGesture)
  portraitQuery?.addEventListener('change', onOrientation)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('visibilitychange', onVisibility)
  document.removeEventListener('contextmenu', onContextMenu)
  document.removeEventListener('gesturestart', onGesture)
  portraitQuery?.removeEventListener('change', onOrientation)
})
</script>

<template>
  <main class="stage">
    <div class="frame">
      <GameCanvas />
      <GameHud v-if="store.status === 'playing' || store.status === 'paused'" />
      <GameOverlay />
    </div>
    <RotatePrompt v-if="mustRotate" />
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
/* A phone held sideways: the game fills the whole screen, edge to edge. */
@media (pointer: coarse) and (orientation: landscape) {
  .stage { padding: 0; }
  .frame {
    width: 100vw;
    height: 100dvh;
    aspect-ratio: auto;
    border-radius: 0;
    box-shadow: none;
  }
}
</style>
