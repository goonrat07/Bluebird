import type { Sport } from './tuning';

export type GrabDir = 'none' | 'up' | 'down' | 'left' | 'right';
export type LandingQuality = 'clean' | 'solid' | 'sketchy';

const GRABS: Record<Sport, Record<GrabDir, string>> = {
  board: { none: 'Mute', up: 'Nose Grab', down: 'Tail Grab', left: 'Melon', right: 'Indy' },
  ski: { none: 'Mute', up: 'Tip Grab', down: 'Tail Grab', left: 'Japan', right: 'Safety' },
};

export const grabName = (sport: Sport, dir: GrabDir): string => GRABS[sport][dir];

/** Everything the rider did during one jump. */
export interface AirLog {
  /** Signed rotation around the vertical axis (rad); positive = to the left. */
  spin: number;
  /** Signed flip rotation (rad); positive = front flip. */
  flip: number;
  grab: string | null;
  grabTime: number;
  airTime: number;
  switchTakeoff: boolean;
}

export interface Trick {
  name: string;
  score: number;
  quality: LandingQuality;
}

const QUALITY_MULT: Record<LandingQuality, number> = { clean: 1.5, solid: 1, sketchy: 0.6 };

/** Names and scores a landed jump; returns null for a hop too small to count. */
export function scoreTrick(sport: Sport, log: AirLog, quality: LandingQuality): Trick | null {
  const halfTurns = Math.round(Math.abs(log.spin) / Math.PI);
  const spinDeg = halfTurns * 180;
  const flips = Math.round(Math.abs(log.flip) / (2 * Math.PI));
  const grabbed = log.grab !== null && log.grabTime >= 0.15;

  const parts: string[] = [];
  if (log.switchTakeoff && (spinDeg > 0 || flips > 0)) parts.push('Switch');
  if (flips > 0) {
    const count = flips === 1 ? '' : flips === 2 ? 'Double ' : 'Triple ';
    parts.push(`${count}${log.flip > 0 ? 'Frontflip' : 'Backflip'}`);
  }
  if (spinDeg > 0) {
    // Regular-stance snowboarders call a left spin frontside; skiers just say left or right.
    const dir = sport === 'board' ? (log.spin > 0 ? 'Frontside' : 'Backside') : log.spin > 0 ? 'Left' : 'Right';
    parts.push(flips > 0 ? `${spinDeg}` : `${dir} ${spinDeg}`);
  }
  if (grabbed) parts.push(log.grab!);

  if (parts.length === 0) {
    if (log.airTime < 0.7) return null;
    parts.push('Air');
  }

  const base = 100 * halfTurns + 450 * flips + (grabbed ? Math.min(600, 150 + log.grabTime * 300) : 0) + 60 * log.airTime;
  return { name: parts.join(' '), score: Math.round(base * QUALITY_MULT[quality]), quality };
}
