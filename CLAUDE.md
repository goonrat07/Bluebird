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
- `window.__game` – debug hook for play tests (`ready`, `telemetry()`, `reset()`).

## Conventions
- Keyboard only. Tricks must never need more than two keys at once.
- Every change that affects riding or visuals gets a play test run and a look at the screenshots before it's called done.
- Deploys happen from `main` via `.github/workflows/deploy.yml` (skipped while the repo is private).
