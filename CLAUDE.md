# Bluebird

A skiing and snowboarding game that runs in the browser and is published on GitHub Pages.
The full design plan lives in the project's "Bluebird: Full Design & Build Plan" doc; build in its phase order.

## Commands
- `npm run dev` – local dev server
- `npm run typecheck` – TypeScript check
- `npm test` – unit tests (Vitest, `test/unit`)
- `npm run test:e2e` – browser play test (Playwright, `test/e2e`); screenshots land in `test/artifacts/`.
  In cloud sessions use the preinstalled Chromium: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e` (never `playwright install` there).
  On a machine with a graphics card, `PW_GPU=1` (PowerShell: `$env:PW_GPU=1`) runs it on the GPU: much faster, and it shows the full lighting.

## Layout
- `src/sim/` – simulation only, no three.js: terrain, rider physics, input, tuning. Must stay deterministic
  (same inputs give the same ride) because ghosts, replays and leaderboard checks depend on it.
- `src/sim/tuning.ts` – every number that shapes riding feel. No magic numbers in rider code.
- `src/render/` – three.js drawing only; reads sim state, never changes it.
- `src/game.ts` – fixed 120 Hz step with interpolated rendering.
- `window.__game` – debug hook for play tests (`ready`, `telemetry()`, `command()`, `setAssist()`, `teleport(z, u)`, `placeAt(x, z)`, `liftProgress(f)`, `setSky(time, weather)`).
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
- `src/render/presets/` – time-of-day light presets (T steps through the day, easing between them).
  `src/render/weather.ts` lays clear, flat light or snowstorm over any of them (Y), plus the falling snow;
  `src/render/lamps.ts` lights Kettle Run and the village after dark. Purely visual: the sim never sees the sky.
- Characters are modelled in Blender by script: `tools/blender/characters.py` writes `src/assets/models/rider.glb`
  (rigged; `riderModel.ts` poses it bone by bone) and `villager.glb` (two builds of body in four poses, plus hair, hats,
  beards, glasses and bags, instanced by `crowd.ts`). Bodies come from MakeHuman's CC0 base mesh (`tools/blender/human.py`,
  assets in `tools/blender/makehuman`) for their proportions, melted into smooth simple forms (`human.simplify`); clothes are
  grown from a softened copy of that body in its A pose (thin, close-fitting, straight hems), posed with it, then smoothed
  again (`human.refine`) so they fit without showing its anatomy; mittens and the villagers' boots are simple egg shapes.
  Rebuild with Blender's Python module (`pip install bpy`, then `python tools/blender/characters.py`). The look follows the Tiny Bookshop references in the project files: real proportions,
  an egg for a head with an egg nose and two brows (no eyes, mouth or ears), mitten hands, one flat colour per garment,
  softly painted (`painted()` in `characterAssets.ts`). The board and skis are
  `src/render/gear.ts`. With `npm run dev`, `/characters.html` shows everyone side by side (`?cam=x,y,z,tx,ty,tz` for a close-up).
- `src/render/forest.ts` – the trees (tiered, snow painted on in vertex colour, ink outline up close); `peaks.ts` – the far peaks.
- `src/sim/rails.ts` – park rails and boxes; grinding lives in `rider.ts`.
- `src/sim/events.ts` – events (start, finish, scoring, medals); `src/sim/replay.ts` records rides as one input mask per step.
  Ghosts replay those inputs, so anything that changes a ride must go through `RideInput`, never a side command.
- `src/sim/bots.ts` – scripted riders for rival ghosts and tests; medal targets are set from their runs.
- `src/audio/sound.ts` – synthesized WebAudio, no audio files.

## Skills (goonrat07/claude-skills)
Miguel keeps Claude skills in the `goonrat07/claude-skills` repo. At the start of any visual, modelling or riding-feel
work, attach and clone it (it's in this project's repo list) and follow the matching skill's SKILL.md:
- Characters, props or any Blender model: `blender-art-director` (it drives `inspo-analysis`, `blender-taste`,
  `blender-build` and `render-critique`). Use it with `tools/blender/characters.py` and the Tiny Bookshop references.
- Any visual change: `snow-game-style-guide` for the look and its review checklist.
- Checking a change in the browser: `snow-game-playtest`. Changing how riding feels: `ride-feel-tuning`.
When a skill and this file disagree on the game's own layout or commands, this file wins.

## Conventions
- Keyboard only. Tricks must never need more than two keys at once.
- Every change that affects riding or visuals gets a play test run and a look at the screenshots before it's called done.
- Deploys happen from `main` via `.github/workflows/deploy.yml` (skipped while the repo is private).
