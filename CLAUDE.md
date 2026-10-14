# Bluebird

A skiing and snowboarding game that runs in the browser and is published on GitHub Pages.
The full design plan lives in the project's "Bluebird: Full Design & Build Plan" doc; build in its phase order.

## Commands
- `npm run dev` – local dev server
- `npm run typecheck` – TypeScript check
- `npm test` – unit tests (Vitest, `test/unit`)
- `npm run test:e2e` – browser play test (Playwright, `test/e2e`); screenshots land in `test/artifacts/`.
  In cloud sessions use the preinstalled Chromium: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e` (never `playwright install` there).

## Layout
- `src/sim/` – simulation only, no three.js: terrain, rider physics, input, tuning. Must stay deterministic
  (same inputs give the same ride) because ghosts, replays and leaderboard checks depend on it.
- `src/sim/tuning.ts` – every number that shapes riding feel. No magic numbers in rider code.
- `src/render/` – three.js drawing only; reads sim state, never changes it.
- `src/game.ts` – fixed 120 Hz step with interpolated rendering.
- `window.__game` – debug hook for play tests (`ready`, `telemetry()`, `command()`, `setAssist()`, `teleport(z, u)`, `placeAt(x, z)`, `liftProgress(f)`).
- `src/sim/terrain.ts` – Kettle Peak. Kettle Run (pitch profile, winding centerline, kickers; measure across it with `lateral()`)
  plus the other runs in `RUNS` (Cornice Chute, Kettle Couloir, Raven's Drop, Fernwood), each a valley along its own centerline,
  blended into a forested mountain. Kettle's snow inside its corridor must stay exactly as it is; `runAt()` finds the run under a point.
- `CAT_TRACKS` in `terrain.ts` – Summit Road, a groomed bench cut into the mountain; it overrides the snow within its shoulders.
- `src/sim/lifts.ts` – chairlifts (Kettle Express, Summit Chair): towers, cable, boarding (E), riding (hold W to hurry), unloading.
  Lifts are freeride only and never part of an event or replay. Drawn by `src/render/lifts.ts`; `src/ui/trailMap.ts` is the Tab map.
- `src/sim/village.ts` – the base village (`BASE_AREA` in terrain.ts flattens it): buildings with walls and doors, shop counters,
  terrace tables and crowd spots. `src/sim/walk.ts` is walking on foot (B), `src/sim/dogs.ts` is Bowie (summit patrol hut) and
  Pepper (village, follows you once petted with E). Walking and dogs are freeride only, like lifts.
  Drawn by `src/render/village.ts`, `crowd.ts` (instanced, cheers big landings) and `dogs.ts`.
- `src/render/mountain.ts` – the terrain mesh: a fine ribbon per run plus a coarser forest grid and far apron, all in culled chunks.
- `src/render/presets/` – time-of-day light presets (T cycles in game).
- `src/sim/rails.ts` – park rails and boxes; grinding lives in `rider.ts`.
- `src/sim/events.ts` – events (start, finish, scoring, medals); `src/sim/replay.ts` records rides as one input mask per step.
  Ghosts replay those inputs, so anything that changes a ride must go through `RideInput`, never a side command.
- `src/sim/bots.ts` – scripted riders for rival ghosts and tests; medal targets are set from their runs.
- `src/audio/sound.ts` – synthesized WebAudio, no audio files.

## Conventions
- Keyboard only. Tricks must never need more than two keys at once.
- Every change that affects riding or visuals gets a play test run and a look at the screenshots before it's called done.
- Deploys happen from `main` via `.github/workflows/deploy.yml` (skipped while the repo is private).
