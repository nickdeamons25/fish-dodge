import { defineStore } from 'pinia'
import { enterLandscape } from '~/utils/landscape'
import { requestTiltPermission, tiltSupported, type TiltPermission } from '~/utils/tilt'

export type GameStatus = 'menu' | 'playing' | 'paused' | 'gameover'

/** Long-lived player data, persisted to localStorage between sessions. */
export interface PlayerProfile {
  name: string
  highScore: number
  totalRuns: number
  bestDistance: number
  /** Steer by tilting the phone (touch devices only). */
  tilt: boolean
}

/** State for the run currently in progress. Reset on every new run. */
export interface RunState {
  score: number
  distance: number
  level: number
  lives: number
  speed: number
  /** The fish will reach the glass soon on its current heading. */
  glassAhead: boolean
}

const PROFILE_KEY = 'fish-dodge:profile'
const MAX_LIVES = 3

function freshRun(): RunState {
  return { score: 0, distance: 0, level: 1, lives: MAX_LIVES, speed: 0, glassAhead: false }
}

function loadProfile(): PlayerProfile {
  const fallback: PlayerProfile = { name: 'Finn', highScore: 0, totalRuns: 0, bestDistance: 0, tilt: tiltSupported() }
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  }
  catch {
    return fallback
  }
}

export const useGameStore = defineStore('game', {
  state: () => ({
    status: 'menu' as GameStatus,
    profile: loadProfile(),
    run: freshRun(),
    maxLives: MAX_LIVES,
    lastRunWasHighScore: false,
    /** Whether the browser has let us read the phone's tilt. */
    tiltPermission: 'unknown' as TiltPermission,
  }),

  getters: {
    isPlaying: s => s.status === 'playing',
    /** Tilt steering is on and allowed (readings may still be on their way). */
    tiltOn: s => s.profile.tilt && tiltSupported() && s.tiltPermission !== 'denied',
  },

  actions: {
    // ---- Called from the UI -------------------------------------------------
    setName(name: string) {
      this.profile.name = name.trim().slice(0, 16) || 'Finn'
      this.saveProfile()
    },

    setTilt(on: boolean) {
      this.profile.tilt = on
      this.saveProfile()
      if (on && this.tiltPermission === 'denied') this.tiltPermission = 'unknown' // let them try again
    },

    /**
     * Call straight from a tap or click: that's the only time the browser lets
     * us ask for motion access (iOS) or go fullscreen in landscape (Android).
     */
    startRun() {
      enterLandscape()
      if (this.profile.tilt && tiltSupported() && this.tiltPermission !== 'granted') {
        requestTiltPermission().then(p => (this.tiltPermission = p))
      }
      this.run = freshRun()
      this.lastRunWasHighScore = false
      this.status = 'playing'
    },

    togglePause() {
      if (this.status === 'playing') this.status = 'paused'
      else if (this.status === 'paused') this.status = 'playing'
    },

    backToMenu() {
      this.status = 'menu'
    },

    // ---- Called from the game -----------------------------------------------
    /** Pushed from the scene a few times per second; not every frame. */
    syncRun(patch: Partial<RunState>) {
      // Final numbers are locked in once the run ends.
      if (this.status !== 'playing') return
      Object.assign(this.run, patch)
    },

    /** Returns the lives remaining so the scene can react. */
    loseLife(): number {
      this.run.lives = Math.max(0, this.run.lives - 1)
      if (this.run.lives === 0) this.endRun()
      return this.run.lives
    },

    endRun() {
      if (this.status === 'gameover') return
      this.status = 'gameover'
      this.profile.totalRuns++
      this.profile.bestDistance = Math.max(this.profile.bestDistance, Math.floor(this.run.distance))
      if (this.run.score > this.profile.highScore) {
        this.profile.highScore = this.run.score
        this.lastRunWasHighScore = true
      }
      this.saveProfile()
    },

    saveProfile() {
      try {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(this.profile))
      }
      catch {
        // Private mode / blocked storage: the game still works, it just won't remember.
      }
    },
  },
})

export type GameStore = ReturnType<typeof useGameStore>
