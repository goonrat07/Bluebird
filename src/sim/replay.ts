import type { RideInput } from './input';
import { AIR, ASSIST, CRASH, FLOW, GAP, RAIL, RIDE, SNOW, SPORTS, type AssistLevel, type Sport } from './tuning';

// Rides are recorded as one small number per simulation step (which keys were held), so a run
// replays exactly from its start. Ghosts, replays and later leaderboard checks all use this.

const BITS: (keyof RideInput)[] = ['left', 'right', 'up', 'down', 'jump', 'grab'];

export const encodeInput = (input: RideInput): number => BITS.reduce((m, k, i) => (input[k] ? m | (1 << i) : m), 0);

export function decodeInput(mask: number): RideInput {
  const input = {} as RideInput;
  BITS.forEach((k, i) => (input[k] = (mask & (1 << i)) !== 0));
  return input;
}

export interface Recording {
  /** Which physics the run was ridden with; a run only replays on the same physics. */
  physics: string;
  sport: Sport;
  assist: AssistLevel;
  /** One input mask per simulation step from the start signal. */
  inputs: number[];
}

/** Fingerprint of every tuning number, so a ghost recorded with different physics isn't replayed wrongly. */
export function physicsVersion(): string {
  const text = JSON.stringify({ SPORTS, SNOW, RIDE, AIR, ASSIST, CRASH, FLOW, GAP, RAIL, v: 1 });
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Packs inputs as runs of the same mask ("mask*count,..."): a minute of riding is a few hundred bytes. */
export function packInputs(inputs: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < inputs.length; ) {
    let n = 1;
    while (i + n < inputs.length && inputs[i + n] === inputs[i]) n++;
    parts.push(n === 1 ? `${inputs[i].toString(36)}` : `${inputs[i].toString(36)}*${n.toString(36)}`);
    i += n;
  }
  return parts.join(',');
}

export function unpackInputs(text: string): number[] {
  const out: number[] = [];
  if (!text) return out;
  for (const part of text.split(',')) {
    const [mask, count] = part.split('*');
    const m = parseInt(mask, 36);
    const n = count ? parseInt(count, 36) : 1;
    for (let i = 0; i < n; i++) out.push(m);
  }
  return out;
}
