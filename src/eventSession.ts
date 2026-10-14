import { slopestyleBot, treeRunBot } from './sim/bots';
import {
  type EventDef,
  type EventResult,
  type EventRun,
  type Ghost,
  beats,
  ghostFrom,
  rideEvent,
  startEvent,
  stepCountdown,
  stepEvent,
  stepGhost,
} from './sim/events';
import type { RideInput } from './sim/input';
import { encodeInput, packInputs, physicsVersion, unpackInputs, type Recording } from './sim/replay';
import { type RiderState, stepRider } from './sim/rider';
import type { AssistLevel, Sport } from './sim/tuning';

/** A personal best kept in the browser: the result and the inputs to replay it as a ghost. */
interface SavedBest {
  physics: string;
  sport: Sport;
  assist: AssistLevel;
  inputs: string;
  result: EventResult;
}

const storageKey = (def: EventDef) => `bluebird.best.${def.id}`;

function loadBest(def: EventDef): SavedBest | null {
  try {
    const text = localStorage.getItem(storageKey(def));
    return text ? (JSON.parse(text) as SavedBest) : null;
  } catch {
    return null;
  }
}

function saveBest(def: EventDef, best: SavedBest): void {
  try {
    localStorage.setItem(storageKey(def), JSON.stringify(best));
  } catch {
    // Private browsing or full storage: the best just isn't kept.
  }
}

/** One go at an event: countdown, the run itself with a ghost alongside, then the result. */
export class EventSession {
  readonly run: EventRun;
  readonly rider: RiderState;
  readonly ghost: Ghost | null;
  readonly ghostLabel: string;
  /** The best before this run (so the HUD can show what you're chasing). */
  readonly best: SavedBest | null;
  newBest = false;
  private readonly inputs: number[] = [];
  private readonly physics = physicsVersion();

  constructor(
    readonly def: EventDef,
    sport: Sport,
    assist: AssistLevel,
  ) {
    const start = startEvent(def, sport, assist);
    this.run = start.run;
    this.rider = start.rider;
    this.best = loadBest(def);
    // Chase your own best when it was ridden on these physics; otherwise a rival ridden by a bot.
    if (this.best && this.best.physics === this.physics) {
      const rec: Recording = { ...this.best, inputs: unpackInputs(this.best.inputs) };
      this.ghost = ghostFrom(def, rec);
      this.ghostLabel = 'Your best';
    } else {
      const bot = def.id === 'slopestyle' ? slopestyleBot() : treeRunBot();
      this.ghost = ghostFrom(def, rideEvent(def, sport, 'normal', bot).recording);
      this.ghostLabel = 'Rival';
    }
  }

  get active(): boolean {
    return this.run.phase !== 'done';
  }

  /** One simulation step: frozen during the countdown, recorded while running, free riding after. */
  step(input: RideInput, dt: number): void {
    if (this.run.phase === 'countdown') {
      stepCountdown(this.run, dt);
      return;
    }
    const running = this.run.phase === 'running';
    if (running) this.inputs.push(encodeInput(input));
    stepRider(this.rider, input, dt);
    if (this.ghost) stepGhost(this.ghost, dt);
    if (!running) return;
    stepEvent(this.run, this.rider, dt);
    if (this.run.phase === 'done') this.finish();
  }

  private finish(): void {
    const result = this.run.result!;
    const previous = this.best && this.best.physics === this.physics ? this.best.result : null;
    if (!beats(this.def, result, previous)) return;
    this.newBest = true;
    saveBest(this.def, {
      physics: this.physics,
      sport: this.rider.sport,
      assist: this.rider.assist,
      inputs: packInputs(this.inputs),
      result,
    });
  }
}
