<script setup lang="ts">
import { TURN } from '~/game/constants'
import { VIEWS, type ViewId } from '~/game/tank/views'
import { useGameStore } from '~/stores/game'
import type { ArrowShape } from './FishArrow.vue'

const store = useGameStore()

function shapeFor(from: ViewId, to: ViewId): ArrowShape {
  if (to === 'rear') return 'into'
  if (to === 'top') return 'dive'
  if (to === 'side-left') return from === 'side-right' ? 'uturn-left' : 'straight-left'
  return from === 'side-left' ? 'uturn-right' : 'straight-right'
}

const incoming = computed(() => {
  const to = store.run.incomingView
  if (!to) return null
  return { shape: shapeFor(store.run.view, to), view: VIEWS[to] }
})
</script>

<template>
  <Transition name="warn">
    <div
      v-if="incoming"
      :key="incoming.view.id"
      class="warning"
      :class="{ paused: store.status === 'paused' }"
      role="status"
    >
      <div class="arrow">
        <FishArrow :shape="incoming.shape" />
      </div>
      <div class="text">
        <p class="title">Tank turning! <strong>{{ incoming.view.label }}</strong></p>
        <p class="hint">{{ incoming.view.hint }}</p>
      </div>
      <div class="timer" :style="{ animationDuration: `${TURN.warn}s` }" />
    </div>
  </Transition>
</template>

<style scoped>
/* Lives in the HUD bar, so it never covers the play area. */
.warning {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 12px 7px 6px;
  background: var(--panel-strong);
  border: 2px solid var(--accent);
  border-radius: 12px;
  overflow: hidden;
  animation: nudge 0.4s ease-in-out infinite alternate;
}
.arrow {
  width: 66px;
  flex: none;
}
.text {
  min-width: 0;
}
.title {
  margin: 0;
  font-size: 15px;
  white-space: nowrap;
}
.title strong {
  color: var(--accent);
}
.hint {
  margin: 0;
  font-size: 11px;
  opacity: 0.8;
  white-space: nowrap;
}
.timer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: var(--accent);
  transform-origin: left;
  animation: drain linear forwards;
}
.paused,
.paused .timer {
  animation-play-state: paused;
}
@keyframes drain {
  from { transform: scaleX(1); }
  to { transform: scaleX(0); }
}
@keyframes nudge {
  from { rotate: -1deg; }
  to { rotate: 1deg; }
}
.warn-enter-active, .warn-leave-active {
  transition: opacity 0.2s, translate 0.2s;
}
.warn-enter-from, .warn-leave-to {
  opacity: 0;
  translate: 0 -8px;
}
@container (max-height: 380px) {
  .warning { gap: 4px; padding: 1px 8px 4px 4px; border-radius: 8px; }
  .arrow { width: 40px; }
  .title { font-size: 11px; }
  .hint { display: none; }
}
</style>
