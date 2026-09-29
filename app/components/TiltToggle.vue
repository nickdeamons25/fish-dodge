<script setup lang="ts">
import { useGameStore } from '~/stores/game'

/** Turns tilt steering on and off, and says so if the browser has blocked it. */
const store = useGameStore()
</script>

<template>
  <div class="tilt">
    <button class="toggle" :aria-pressed="store.profile.tilt" @click="store.setTilt(!store.profile.tilt)">
      <span class="dot" :class="{ on: store.profile.tilt }" /> Tilt to steer: {{ store.profile.tilt ? 'On' : 'Off' }}
    </button>
    <p v-if="store.profile.tilt && store.tiltPermission === 'denied'" class="note">
      Motion access is blocked, so steer by touch for now. To allow it, reload the page and tap Allow when asked.
    </p>
  </div>
</template>

<style scoped>
.tilt {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.toggle {
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-radius: 999px;
  border: 2px solid rgb(255 255 255 / 0.25);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgb(255 255 255 / 0.3);
}
.dot.on {
  background: #5fe0a0;
  box-shadow: 0 0 8px #5fe0a0;
}
.note {
  margin: 0;
  max-width: 280px;
  font-size: 12px;
  opacity: 0.75;
}
@container (max-height: 380px) {
  .toggle { font-size: 12px; padding: 3px 10px; }
  .note { font-size: 10px; }
}
</style>
