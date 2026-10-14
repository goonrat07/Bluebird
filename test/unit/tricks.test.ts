import { describe, expect, it } from 'vitest';
import { scoreTrick, type AirLog } from '../../src/sim/tricks';

const log = (over: Partial<AirLog>): AirLog => ({ spin: 0, flip: 0, grab: null, grabTime: 0, airTime: 1, switchTakeoff: false, rail: null, ...over });

describe('trick names', () => {
  it('rounds spins to the nearest 180', () => {
    expect(scoreTrick('board', log({ spin: Math.PI * 2.1 }), 'clean')?.name).toBe('Frontside 360');
    expect(scoreTrick('board', log({ spin: -Math.PI * 2.9 }), 'clean')?.name).toBe('Backside 540');
    expect(scoreTrick('ski', log({ spin: -Math.PI * 4 }), 'clean')?.name).toBe('Right 720');
  });

  it('combines flips, spins, grabs and switch', () => {
    expect(scoreTrick('board', log({ flip: -Math.PI * 2, grab: 'Indy', grabTime: 0.5 }), 'solid')?.name).toBe('Backflip Indy');
    expect(scoreTrick('ski', log({ flip: Math.PI * 4, spin: Math.PI, switchTakeoff: true }), 'solid')?.name).toBe('Switch Double Frontflip 180');
  });

  it('ignores tiny hops but names real air', () => {
    expect(scoreTrick('board', log({ airTime: 0.3 }), 'clean')).toBeNull();
    expect(scoreTrick('board', log({ airTime: 1.2 }), 'clean')?.name).toBe('Air');
  });

  it('pays more for clean landings and bigger tricks', () => {
    const clean = scoreTrick('board', log({ spin: Math.PI * 2 }), 'clean')!.score;
    const sketchy = scoreTrick('board', log({ spin: Math.PI * 2 }), 'sketchy')!.score;
    const bigger = scoreTrick('board', log({ spin: Math.PI * 4 }), 'clean')!.score;
    expect(clean).toBeGreaterThan(sketchy);
    expect(bigger).toBeGreaterThan(clean);
  });
});
