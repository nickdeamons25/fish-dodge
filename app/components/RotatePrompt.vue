<script setup lang="ts">
/** Shown over everything on a phone held upright: the game needs landscape. */
</script>

<template>
  <div class="rotate" role="alertdialog" aria-label="Turn your phone sideways to play">
    <svg class="phone" viewBox="0 0 64 64" aria-hidden="true">
      <rect x="20" y="8" width="24" height="44" rx="4" fill="none" stroke="currentColor" stroke-width="3" />
      <circle cx="32" cy="46" r="2" fill="currentColor" />
      <path d="M50 22a18 18 0 0 1 4 12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
      <path d="M55 28l-1 6-5-3" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <p class="title">Turn your phone sideways</p>
    <p class="hint">Fish Dodge plays in landscape. Tip to turn, tilt to rise and dive.</p>
  </div>
</template>

<style scoped>
.rotate {
  position: fixed;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
  background: radial-gradient(ellipse at top, #0b3a60, var(--bg) 70%);
}
.phone {
  width: 84px;
  height: 84px;
  color: var(--accent);
  animation: tip 2.4s ease-in-out infinite;
}
@keyframes tip {
  0%, 25% { transform: rotate(0deg); }
  50%, 75% { transform: rotate(-90deg); }
  100% { transform: rotate(0deg); }
}
@media (prefers-reduced-motion: reduce) {
  .phone { animation: none; transform: rotate(-90deg); }
}
.title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
}
.hint {
  margin: 0;
  max-width: 260px;
  opacity: 0.75;
}
</style>
