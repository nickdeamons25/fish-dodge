<script setup lang="ts">
import { useGameStore } from '~/stores/game'

const store = useGameStore()

const warning = computed(() =>
  store.status === 'playing' && store.run.glassAhead ? { title: 'Glass ahead!', hint: 'Turn ← →' } : null)
</script>

<template>
  <div class="hud">
    <div class="stat">
      <span class="label">Score</span>
      <span class="value">{{ store.run.score }}</span>
    </div>
    <div class="stat">
      <span class="label">Depth lvl</span>
      <span class="value">{{ store.run.level }}</span>
    </div>
    <!-- Warnings sit in the bar's free middle so they never cover the tank. -->
    <div class="center">
      <Transition name="warn" mode="out-in">
        <div v-if="warning" :key="warning.title + warning.hint" class="warn" role="status">
          {{ warning.title }} <span class="hint">{{ warning.hint }}</span>
        </div>
      </Transition>
    </div>
    <div class="lives" :aria-label="`${store.run.lives} lives`">
      <span v-for="i in store.maxLives" :key="i" class="heart" :class="{ lost: i > store.run.lives }">♥</span>
    </div>
    <button class="pause" :aria-label="store.status === 'paused' ? 'Resume' : 'Pause'" @click="store.togglePause()">
      {{ store.status === 'paused' ? '▶' : '❚❚' }}
    </button>
  </div>
</template>

<style scoped>
.hud {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  pointer-events: none;
}
.stat {
  display: flex;
  flex-direction: column;
  padding: 4px 12px;
  background: var(--panel);
  border-radius: 10px;
  min-width: 70px;
}
.label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.75;
}
.value {
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.center {
  flex: 1;
  min-width: 0;
  display: flex;
  justify-content: center;
}
.warn {
  /* Title over hint, so it fits between the stats and the hearts on a phone. */
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 100%;
  padding: 4px 14px;
  border-radius: 10px;
  background: rgb(255 120 80 / 0.85);
  color: #fff;
  font-weight: 700;
  font-size: 15px;
  line-height: 1.15;
  text-align: center;
  animation: pulse 0.5s ease-in-out infinite alternate;
}
.warn .hint {
  font-weight: 400;
  font-size: 12px;
  opacity: 0.9;
}
@keyframes pulse {
  to { transform: scale(1.05); }
}
@media (prefers-reduced-motion: reduce) {
  .warn { animation: none; }
}
.warn-enter-active, .warn-leave-active { transition: opacity 0.2s; }
.warn-enter-from, .warn-leave-to { opacity: 0; }
.lives {
  font-size: 26px;
  display: flex;
  gap: 2px;
}
.heart {
  color: #ff5a6e;
  text-shadow: 0 2px 0 rgb(0 0 0 / 0.25);
  transition: opacity 0.2s, transform 0.2s;
}
.heart.lost {
  opacity: 0.2;
  transform: scale(0.8);
}
@container (max-height: 380px) {
  .hud { padding: 6px 8px; gap: 6px; }
  .stat { padding: 2px 8px; min-width: 0; }
  .label { font-size: 9px; }
  .value { font-size: 15px; }
  .warn { font-size: 12px; padding: 2px 8px; }
  .warn .hint { font-size: 10px; }
  .lives { font-size: 18px; }
  .pause { width: 30px; height: 30px; }
}
.pause {
  pointer-events: auto;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 10px;
  background: var(--panel);
  color: inherit;
  font-size: 14px;
  cursor: pointer;
}
</style>
