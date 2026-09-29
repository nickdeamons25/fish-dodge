<script setup lang="ts">
import { useGameStore } from '~/stores/game'

const store = useGameStore()
const nameDraft = ref(store.profile.name)

function play() {
  store.setName(nameDraft.value)
  store.startRun()
}
</script>

<template>
  <Transition name="fade">
    <div v-if="store.status !== 'playing'" class="overlay">
      <!-- Menu -->
      <div v-if="store.status === 'menu'" class="card">
        <h1>Fish Dodge</h1>
        <p class="sub">Swim far. Mind the glass.</p>
        <label class="name">
          <span>Your fish</span>
          <input v-model="nameDraft" maxlength="16" @keydown.enter="play">
        </label>
        <button class="primary" @click="play">Swim!</button>
        <p v-if="store.profile.highScore" class="meta">
          Best: <strong>{{ store.profile.highScore }}</strong> · Runs: {{ store.profile.totalRuns }}
        </p>
        <p class="controls">← → turn · ↑ ↓ up and down · hold mouse or touch to steer · P to pause</p>
      </div>

      <!-- Paused -->
      <div v-else-if="store.status === 'paused'" class="card">
        <h2>Paused</h2>
        <button class="primary" @click="store.togglePause()">Resume</button>
        <button class="ghost" @click="store.backToMenu()">Quit to menu</button>
      </div>

      <!-- Game over -->
      <div v-else-if="store.status === 'gameover'" class="card">
        <h2>{{ store.lastRunWasHighScore ? 'New best!' : 'Belly up!' }}</h2>
        <p class="big">{{ store.run.score }}</p>
        <p class="meta">{{ store.profile.name }} swam {{ Math.floor(store.run.distance) }}m · best {{ store.profile.highScore }}</p>
        <button class="primary" @click="store.startRun()">Swim again</button>
        <button class="ghost" @click="store.backToMenu()">Menu</button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(3 20 38 / 0.35);
  backdrop-filter: blur(2px);
  padding: 16px;
}
.card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 28px 36px;
  background: var(--panel-strong);
  border-radius: 20px;
  text-align: center;
  max-width: 420px;
  width: 100%;
  box-shadow: 0 20px 60px rgb(0 0 0 / 0.35);
}
h1 {
  margin: 0;
  font-size: clamp(36px, 7vw, 56px);
  line-height: 1;
  color: var(--accent);
  text-shadow: 0 4px 0 rgb(0 0 0 / 0.2);
}
h2 {
  margin: 0;
  font-size: 32px;
}
.sub, .meta, .controls {
  margin: 0;
  opacity: 0.85;
}
.controls {
  font-size: 13px;
  opacity: 0.6;
}
.big {
  margin: 0;
  font-size: 56px;
  font-weight: 700;
  color: var(--accent);
}
.name {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  width: 100%;
  max-width: 240px;
}
.name input {
  font: inherit;
  font-size: 18px;
  text-align: center;
  padding: 8px 12px;
  border-radius: 10px;
  border: 2px solid rgb(255 255 255 / 0.2);
  background: rgb(0 0 0 / 0.25);
  color: inherit;
}
button {
  font: inherit;
  font-weight: 600;
  font-size: 18px;
  border: 0;
  border-radius: 12px;
  padding: 10px 28px;
  cursor: pointer;
  min-width: 180px;
}
.primary {
  background: var(--accent);
  color: #3a1600;
  box-shadow: 0 4px 0 #c45a00;
}
.primary:active {
  transform: translateY(2px);
  box-shadow: 0 2px 0 #c45a00;
}
.ghost {
  background: transparent;
  color: inherit;
  border: 2px solid rgb(255 255 255 / 0.25);
}
/* Small frames (portrait phones): keep only the essentials. */
@container (max-height: 380px) {
  .overlay { padding: 8px; }
  .card { gap: 6px; padding: 10px 16px; border-radius: 14px; }
  h1 { font-size: 28px; }
  h2 { font-size: 22px; }
  .big { font-size: 32px; }
  .sub, .controls, .name span { display: none; }
  .name input { font-size: 15px; padding: 4px 10px; }
  button { font-size: 15px; padding: 6px 18px; min-width: 140px; }
  .meta { font-size: 13px; }
}
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
