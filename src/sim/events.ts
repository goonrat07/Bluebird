import { type RiderState, createRider, stepRider } from './rider';
import { RUN, RUNS, centerX, heightAt, lateral } from './terrain';
import { WORLD, type AssistLevel, type Sport } from './tuning';
import type { RideInput } from './input';
import { type Recording, decodeInput, encodeInput, physicsVersion } from './replay';

// Events dropped on Kettle Run. Each has a start, a finish line and medal targets.
// Everything here is simulation, so a recorded run replays to the same result.

export type EventId = 'slopestyle' | 'treeRun';
export type Medal = 'bronze' | 'silver' | 'gold' | 'platinum';
const MEDALS: Medal[] = ['bronze', 'silver', 'gold', 'platinum'];

export interface EventDef {
  id: EventId;
  name: string;
  /** One line shown under the name at the start. */
  blurb: string;
  start: { z: number; u: number; speed: number };
  finishZ: number;
  /** Points: highest score wins. Time: fastest wins. */
  scoring: 'points' | 'time';
  /** Targets for bronze, silver, gold and platinum: points to reach, or seconds to beat. */
  medals: [number, number, number, number];
  timeLimit: number;
  /** For time runs: the course you must stay on. Leaving it ends the run. */
  inBounds?: (u: number, z: number) => boolean;
}

/** Repeating a trick in one run scores less each time, so variety pays. */
export const REPEAT_FACTOR = 0.5;
export const COUNTDOWN = 3;

export const EVENTS: Record<EventId, EventDef> = {
  slopestyle: {
    id: 'slopestyle',
    name: 'Kettle Slopestyle',
    blurb: 'Kickers and rails down the park line. Mix it up: repeats score half.',
    start: { z: 785, u: 4, speed: 9 },
    finishZ: 1062,
    scoring: 'points',
    medals: [400, 900, 1600, 2500],
    timeLimit: 90,
  },
  treeRun: {
    id: 'treeRun',
    name: 'Glade Dash',
    blurb: 'Fastest line through the glade. Stay in the trees to the end.',
    start: { z: 474, u: 33, speed: 8 },
    finishZ: 768,
    scoring: 'time',
    medals: [36, 28, 22, 19],
    timeLimit: 90,
    inBounds: (u, z) => z < RUN.glade.z0 + 6 || (u > RUN.glade.u0 - 4 && u < RUN.glade.u1 + 6),
  },
};

export interface EventResult {
  finished: boolean;
  /** Points, or seconds. */
  value: number;
  medal: Medal | null;
  /** Why an unfinished run ended. */
  reason: string;
}

export interface EventRun {
  def: EventDef;
  phase: 'countdown' | 'running' | 'done';
  countdown: number;
  clock: number;
  score: number;
  /** How many times each trick has been landed this run. */
  seen: Record<string, number>;
  landings: number;
  result: EventResult | null;
}

/** Puts a rider at distance z down the run, u metres off the centerline, moving downhill along the snow. */
export function placeRider(r: RiderState, z: number, u: number, speed: number, run = 'kettle'): void {
  const line = RUNS.find((r) => r.id === run);
  const x = (line ? line.centerX(z) : centerX(z)) + u;
  r.pos = { x, y: heightAt(x, z), z };
  const drop = heightAt(x, z + 1) - heightAt(x, z);
  const along = Math.hypot(1, drop);
  r.vel = { x: 0, y: (speed * drop) / along, z: speed / along };
  r.heading = 0;
  r.safeSpots = [{ pos: { ...r.pos }, heading: 0 }];
}

/** A fresh rider standing at an event's start gate, and the run waiting on its countdown. */
export function startEvent(def: EventDef, sport: Sport, assist: AssistLevel): { rider: RiderState; run: EventRun } {
  const rider = createRider(sport, assist);
  placeRider(rider, def.start.z, def.start.u, def.start.speed);
  const run: EventRun = {
    def,
    phase: 'countdown',
    countdown: COUNTDOWN,
    clock: 0,
    score: 0,
    seen: {},
    landings: rider.landings,
    result: null,
  };
  return { rider, run };
}

export function medalFor(def: EventDef, value: number): Medal | null {
  let medal: Medal | null = null;
  def.medals.forEach((target, i) => {
    if (def.scoring === 'points' ? value >= target : value <= target) medal = MEDALS[i];
  });
  return medal;
}

/** True when a result beats another (higher points or lower time; finishing beats not finishing). */
export function beats(def: EventDef, a: EventResult, b: EventResult | null): boolean {
  if (!a.finished) return false;
  if (!b || !b.finished) return true;
  return def.scoring === 'points' ? a.value > b.value : a.value < b.value;
}

function finish(run: EventRun, finished: boolean, reason = ''): void {
  run.phase = 'done';
  const value = run.def.scoring === 'points' ? run.score : run.clock;
  run.result = { finished, value, medal: finished ? medalFor(run.def, value) : null, reason };
}

/** Counts down before the start; returns true on the step the run starts. */
export function stepCountdown(run: EventRun, dt: number): boolean {
  if (run.phase !== 'countdown') return false;
  run.countdown -= dt;
  if (run.countdown > 0) return false;
  run.phase = 'running';
  return true;
}

/** Scores and times a run; call after each rider step while running. */
export function stepEvent(run: EventRun, r: RiderState, dt: number): void {
  if (run.phase !== 'running') return;
  run.clock += dt;
  if (r.landings !== run.landings) {
    run.landings = r.landings;
    const trick = r.lastTrick;
    if (trick && trick.name !== 'Bail' && trick.score > 0) {
      const times = run.seen[trick.name] ?? 0;
      run.seen[trick.name] = times + 1;
      run.score += Math.round(trick.score * REPEAT_FACTOR ** times);
    }
  }
  const u = lateral(r.pos.x, r.pos.z);
  if (run.def.inBounds && !run.def.inBounds(u, r.pos.z)) finish(run, false, 'Left the course');
  else if (r.pos.z >= run.def.finishZ && !r.crashed) finish(run, true);
  else if (run.clock >= run.def.timeLimit) finish(run, false, 'Out of time');
}

/** A rider following a recording: the same start, the same inputs, so the same ride. */
export interface Ghost {
  rider: RiderState;
  inputs: number[];
  step: number;
}

export function ghostFrom(def: EventDef, rec: Recording): Ghost {
  return { rider: startEvent(def, rec.sport, rec.assist).rider, inputs: rec.inputs, step: 0 };
}

/** Advances a ghost one simulation step; it stops at the end of its recording. */
export function stepGhost(g: Ghost, dt: number): void {
  if (g.step >= g.inputs.length) return;
  stepRider(g.rider, decodeInput(g.inputs[g.step++]), dt);
}

/** Rides a whole event with a scripted rider, recording it: used for the rival ghost and for tests. */
export function rideEvent(
  def: EventDef,
  sport: Sport,
  assist: AssistLevel,
  bot: (r: RiderState) => RideInput,
): { result: EventResult; recording: Recording } {
  const dt = 1 / WORLD.stepHz;
  const { rider, run } = startEvent(def, sport, assist);
  run.phase = 'running';
  const inputs: number[] = [];
  while (run.phase === 'running') {
    const input = bot(rider);
    inputs.push(encodeInput(input));
    stepRider(rider, input, dt);
    stepEvent(run, rider, dt);
  }
  return { result: run.result!, recording: { physics: physicsVersion(), sport, assist, inputs } };
}
