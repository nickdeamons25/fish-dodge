# Fish Dodge — Project Status

_Last updated: 2026-09-25_

> **Refactor in progress (branch `refactor/rear-tunnel`, 2026-09-29):** the game is
> being rebuilt as rear view only, with roll-around-a-tunnel steering, phone tilt,
> and open-ocean scenery. **Step 1 is done:** the four views, tank turns, `flow`, the
> turn warning (`TurnWarning.vue`, `FishArrow.vue`) and the T/1–4 dev keys are gone.
> A roll-round-a-tunnel version was tried and rejected (it broke the grounded feel); it's
> parked on the local branch `experiment/tunnel-roll`.
> **New step 1 is done: turning in circles in a giant round aquarium.** The tank is round
> (`TANK.radius` 3000, `tank/Tank.ts`): sand with light ripples, the reef painted inside the
> glass, surface, rims, seaweed meadows plus kelp round the glass and a reef mound in the
> middle. The fish always swims forward along its `heading` at the game's speed; ←→ turn
> (no limit), ↑↓ climb/dive, and it banks into turns. The level chase camera eases its yaw
> after the fish (`engine/CameraRig.ts`) and pulls in rather than leave the glass. The glass
> and the mound bump you back (mirroring your heading) and cost a life; a "Glass ahead!"
> banner shows 1.6 s before you'd hit it. Hazards spawn ahead of the fish within the tank and
> live in their own frame, turned to the heading they spawned with. **Fishing hooks are gone.**
> Next: proper spawning (step 2), walls/big rocks that force turns (step 3), phone tilt (step 4).
> Sections 2, 3, 8 and 9 below still describe the pre-refactor game. That version is saved as
> branch `_version/alpha` and tag `alpha`.

A 3D side-scrolling dodge game: you steer a clownfish through a moving aquarium
while hazards swim, drift and drop at you. At each new level the tank "turns" to
a different view (side, current reversed, top-down, rear), which changes how you
steer and what you have to dodge.

**Stack:** Nuxt 4.5 (SPA, `ssr: false`) · Vue 3 · Pinia 4 · three.js 0.186 ·
TypeScript (pinned to v5 for `vue-tsc`). No binary assets — every texture is
painted on a canvas at load time.

**Run:** `npm run dev` · **Check:** `npx nuxi typecheck` · **Build:** `npx nuxi build`

**Repo:** git initialised on `main`, **no commits yet**. ~4,900 lines of TS/Vue.

---

## 1. Interface (Vue + Pinia)

| Piece | File | State |
|---|---|---|
| Game store | `app/stores/game.ts` | Done. Status (`menu`/`playing`/`paused`/`gameover`), run stats, 3 lives, current + incoming view. Profile (name, high score, runs, best distance) persisted to `localStorage`. |
| App shell / keys | `app/app.vue` | Done. Space/Enter start, P/Esc pause, auto-pause when the tab is hidden. 16:9 frame, container queries for small screens. |
| HUD | `app/components/GameHud.vue` | Done. Score, depth level, tank view badge, hearts, pause button. |
| Turn warning | `app/components/TurnWarning.vue`, `FishArrow.vue` | Done. Sits in the HUD bar: bendy "fish arrow" (U-turn / dive / into-screen / straight), view name, controls hint, draining timer; freezes on pause. |
| Menu / pause / game over | `app/components/GameOverlay.vue` | Done. Name entry, best score, "New best!". |
| Canvas host | `app/components/GameCanvas.client.vue` | Done. Lazy-loads the three.js chunk; forwards status changes to the game. |

**Not done:** settings screen (quality/post-processing toggle, volume), control remapping, onboarding/tutorial, accessibility pass (reduced motion for the camera turns).

## 2. Tank, views and turns

Files: `app/game/tank/views.ts`, `space.ts`, `Tank.ts`, `app/game/engine/CameraRig.ts`, `app/game/FishGame.ts`.

- **Tank space:** gameplay runs in tank coordinates (`a` along the current, `y` height, `z` depth). The world is a fixed 3D glass box; the seabed, backdrops, seaweed and bubbles scroll through it.
- **Views** (a view = camera pose + steering/collision rules):
  - **Side (right):** steer height and speed.
  - **Current reversed (left):** same camera. The current reverses and the fish U-turns, facing the camera mid-turn.
  - **Top-down:** steer across the tank; height is ignored.
  - **Rear:** chase camera. Steer height and across the tank; hazards come from ahead.
- **Collision rule:** the axis you can't see never hits you.
- **Turns:** forced at each level-up to a random other view, in three phases: 2.6 s warning (no new spawns), 3.2 s camera move, 0.8 s settle.
  - **Camera move:** dives in close to the fish (orbiting a smoothed follow point), stays inside the water, then eases out.
  - **Flow:** turns between the side views reverse `flow` (the current's direction). Top-down and rear keep whichever direction it's running.
- **Scenery:**
  - **Walls and floor:** inward-facing reef backdrops on both long walls, deep-water end walls, glass, water surface, rims, and sand with animated light patterns.
  - **Life:** bubbles, and blob shadows under the fish and hazards.

## 3. Rendering pipeline

Files: `app/game/createGame.ts`, `engine/RenderPipeline.ts`, `engine/DofPass.ts`.

- **Anti-aliasing:** 4× MSAA through the post-processing target, and fin edges use alpha-to-coverage.
- **Depth of field (custom, no halos):** a neighbour only contributes blur if its own blur reaches the pixel, so in-focus silhouettes stay crisp.
  - **Focus:** always on the player fish.
  - **Strength by view:** full in side views and mid-turn; 0.2 in top-down and rear.
  - **Foreground:** blurs at 35% of the background amount.
  - **Opt-outs:** objects can opt out (`excludeFromDepth`), supply their own deforming depth material (`userData.depthMaterial`), or pull themselves toward the focal plane (`biasDepthToFocus`; jellyfish keep 40%).
- **Adaptive resolution:** watches GPU time once a second and lowers render scale (down to 60%) if it goes over 12 ms.
- **Colour note:** the post-processing target blends transparency in linear space, so overlay opacities in `tank/` are tuned for that.
- **Performance (2× pixel density display):** a steady 60 fps. GPU time is typically 6–10 ms with 6–11 detailed hazards on screen, against a 16.7 ms budget.
- **Dev tools (dev builds only):** F toggles the perf overlay; Q toggles post-processing.

## 4. Player clownfish — high detail ✅

Files: `app/game/entities/fishModel.ts`, `Fish.ts`, shared kit `fishKit.ts`.

- **Reference:** modelled from ocellaris photos.
- **Body:** lathed, with a sloping forehead and pouty lips. Deep red-orange skin with three black-edged white bands, faint scale bump and a wet clearcoat.
- **Fins:** a rounded paddle tail growing from a thick tail stem, a two-hump dorsal with the band rising into its notch, and rounded anal, pectoral and pelvic fins. They have visible rays, a thick black margin and a translucent fringe.
- **Motion:**
  - Carangiform body wave on the GPU; fins ripple base to tip.
  - Effort-driven stroke; belly-up float on death.
  - "Blub blub" mouth with bubbles every 3–7 s.
- **Hit feedback:** 1.6 s of invulnerable blinking plus knockback.
- **Possible next:** light through the fins, and contact shadows where fins meet the body.

## 5. Other fish

### Blue fish — high detail ✅ (`app/game/hazards/swimmers.ts`)
- **Look:** a slim reef fish with a cobalt back, electric-blue sides, silver belly, a glowing aqua lateral stripe, iridescence and a forked tail.
- **Motion:** a fast full-body S-wave.
- **Behaviour:** swims at you at 1.5× the current, weaving up and down. Spawns in every view.

### Pufferfish — high detail ✅ (`swimmers.ts`, behaviour in `registry.ts` `PUFF`)
- **Look:** olive-tan and spotted, with a pale belly, big green-gold eyes and a beak. It paddles with fluttering pectorals.
- **Speed:** 1.2× the current.
- **Inflation:** in the side and rear views, when you approach and you're roughly level with it:
  - It swells into a ball (girth +90%, length +45%), and 70 instanced spines rise from lying flat to erect. It trembles while puffed, then slowly deflates after you pass.
  - Its hitbox grows to match, including the reach of the spines.
  - The trigger distance scales with speed but is capped so the puff always happens on screen, giving about 0.7–0.9 s of warning.
- **Top-down:** it never inflates.

## 6. Jellyfish — high detail ✅ (`app/game/hazards/jellyfish.ts`)
- **Look:** a moon-jelly style translucent bell with a scalloped rim and edge glow. Inside it: four magenta horseshoe organs, radial canals and sense spots.
- **Motion:** a quick-contract, slow-relax pulse. 28 instanced tentacles trail in delayed waves and flare with each pulse; four frilly oral arms twist as they hang.
- **Behaviour:** drifts at 0.8× the current and bobs.
- **Kept near the focal plane:** ±10 depth drift in side views; in top-down it spawns near the fish's height.
- **Hitbox:** covers the bell and upper tentacles only. The long tentacles are harmless.

## 7. Eel — high detail ✅ (`app/game/hazards/eel.ts`)
- **Look:** a moray with a GPU-bent tube body, dorsal ridge, reticulated brown/tan skin, pale throat and wet gloss. The head gapes a hinged jaw showing teeth and a dark mouth, with gold eyes and tube nostrils.
- **Den:** a smooth craggy rock with a shadowed hole and sponges.
- **Behaviour:**
  - A 10 s cycle: rise, look around, sink, lurk.
  - Its hitbox grows with how far it has risen.
  - Rare: weight 0.6, with at least 25 s between eels.
  - Never spawns in top-down.
- **Important:** its spine is defined twice, in GLSL (`SPINE_GLSL`) and in TypeScript (`spineAt`). Keep them identical.

## 8. Remaining hazards and scenery

| Element | State |
|---|---|
| **Rock** (`registry.ts`) | **Still the older low-poly style** (jittered icosahedrons). Not in top-down. Candidate for the detail pass next. |
| **Fishing hook** (`registry.ts`) | **Still the older style** (steel shank, torus bend, red bead, line). From level 2, not in top-down. |
| **Seaweed** (`tank/Seaweed.ts`) | High detail. About 800 instanced 3D blades in one draw call (kelp, seagrass, sea lettuce, red algae) that sway on the GPU and lean with the current. They turn to face the camera in rear view and have correct depth of field. |
| **Tank backdrop / sand / glass** | Mid detail (painted canvas textures). Could use a pass: sand ripples, rock outcrops, god rays, particulate. |

## 9. Gameplay systems

- **Scoring:** 1 point per metre. Speed ramps from 240 to 620 units/s. A new level every 300 m, each triggering a turn.
- **Lives:** 3, with 1.6 s of invulnerability after a hit. Game over at 0.
- **Spawning** (`hazards/HazardField.ts`):
  - A weighted pick among hazards unlocked for the level and allowed in the current view, with per-hazard cooldowns.
  - The interval shrinks with each level.
  - In side views, hazards spawn on the fish's depth plane.
- **Current hazard unlocks:**

| Hazard | From level | Views |
|---|---|---|
| Rock | 1 | not top-down |
| Jellyfish | 1 | all |
| Blue fish | 1 | all |
| Pufferfish | 1 | all |
| Eel | 1 (rare) | not top-down |
| Hook | 2 | not top-down |

## 10. Not implemented yet

- **Power-ups:** none (e.g. bubble shield, speed burst, magnet, slow-mo).
- **Health-ups:** none. Lives only go down; there's no way to regain a heart.
- **Collectibles / currency:** none (e.g. food pellets, pearls for score multipliers).
- **Audio:** no sound effects or music.
- **Difficulty tuning:** only a speed ramp and spawn interval. No hazard patterns, waves, or rear-view-specific pacing.
- **Stinging jellyfish tentacles:** optional; currently harmless.
- **Boss or special events:** none (e.g. a shark chase).
- **Leaderboards / accounts:** local high score only.
- **Settings UI:** no quality toggle, volume, or reduced-motion option.
- **Tests / CI:** none.
- **Mobile:** touch steering works, but it hasn't been tuned or performance-tested on phones.

## 11. Known quirks and tech debt

- **In-app preview:** the Claude desktop preview still looked in the old temporary folder after the move, so the dev server was run manually (e.g. `PORT=3517 npx nuxi dev --port 3517`). `.claude/launch.json` is in the repo.
- **Hazard clearing:** hazards on screen are removed at the start of every turn (by design, for now).
- **Rear view readability:** blades turned toward the rear camera mean the side-facing ones appear edge-on in rear view (partly mitigated).
- **Dev-only helpers:** `window.__fishGame` (`.spawn('eel' | 'puffer' | ...)`, `.beginTurn(view)`) and `window.__pipeline`. Keys: T turns the tank, 1–4 force a view, F shows the perf overlay, Q toggles post-processing.

## 12. Suggested next steps

1. Make the first git commit.
2. Detail pass on rocks and hooks.
3. Power-ups and a health pickup (e.g. a rare "anemone" heart that restores a life).
4. Sound: bubbles, hits, the puffer's puff, the turn warning, ambient water.
5. Backdrop and sand detail pass.
6. Difficulty pacing and hazard patterns per view.
