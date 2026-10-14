import { describe, expect, it } from 'vitest';
import { createRider, stepRider, type RiderState } from '../../src/sim/rider';
import { RAILS, railPoint } from '../../src/sim/rails';
import { heightAt } from '../../src/sim/terrain';
import { noInput, type RideInput } from '../../src/sim/input';
import { WORLD, type AssistLevel } from '../../src/sim/tuning';
import { scale, sub } from '../../src/sim/vec';

const STEP = 1 / WORLD.stepHz;
const box = RAILS.find((r) => r.kind === 'box')!;
const rail = RAILS.find((r) => r.kind === 'rail')!;
const longRail = RAILS[RAILS.length - 1];

/** Keeps the rider balanced by leaning back toward the middle, the way a player would. */
const balance = (r: RiderState): Partial<RideInput> => {
  if (!r.rail) return {};
  const tip = r.rail.balance + 0.25 * r.rail.balanceVel;
  return { left: tip < -0.08, right: tip > 0.08 };
};

function ride(r: RiderState, seconds: number, script: (r: RiderState) => Partial<RideInput> = () => ({})) {
  let grinds = 0;
  let wasOn = false;
  for (let t = 0; t < seconds; t += STEP) {
    stepRider(r, { ...noInput(), ...script(r) }, STEP);
    if (r.rail && !wasOn) grinds++;
    wasOn = r.rail !== null;
  }
  return grinds;
}

/** On the snow a few metres before a rail's start, heading straight down it. */
function approaching(target = box, assist: AssistLevel = 'normal', speed = 8): RiderState {
  const r = createRider('board', assist);
  const back = sub(target.start, scale(target.dir, 4));
  r.pos = { x: back.x, y: heightAt(back.x, back.z), z: back.z };
  r.heading = target.heading;
  r.vel = scale(target.dir, speed);
  return r;
}

/** Dropping onto a rail's top from just above it, halfway along. */
function droppingOnto(target = rail, assist: AssistLevel = 'normal', headingOffset = 0): RiderState {
  const r = createRider('board', assist);
  const p = railPoint(target, target.length * 0.3);
  r.pos = { ...p, y: p.y + 0.6 };
  r.grounded = false;
  r.heading = target.heading + headingOffset;
  r.vel = { ...scale(target.dir, 9), y: -1 };
  return r;
}

describe('rails and boxes', () => {
  it('rides straight onto a box and scores a 50-50 off the end', () => {
    const r = approaching();
    const grinds = ride(r, 4, balance);
    expect(grinds).toBe(1);
    expect(r.crashed).toBe(false);
    expect(r.lastTrick?.name).toBe('50-50');
    expect(r.lastTrick!.score).toBeGreaterThan(0);
  });

  it('locks on when landing on a rail, straight or sideways', () => {
    const straight = droppingOnto();
    ride(straight, 0.4);
    expect(straight.rail?.slide).toBe(false);
    const sideways = droppingOnto(rail, 'normal', Math.PI / 2 + 0.2);
    ride(sideways, 0.4);
    expect(sideways.rail?.slide).toBe(true);
    ride(sideways, 4, balance);
    expect(sideways.lastTrick?.name).toBe('Boardslide');
  });

  it('does not lock on at an angle that is neither straight nor sideways', () => {
    const r = droppingOnto(rail, 'normal', Math.PI / 4);
    ride(r, 0.4);
    expect(r.rail).toBeNull();
  });

  it('a rail can only be ridden onto by popping; it is too tall to roll onto', () => {
    const r = approaching(rail);
    expect(ride(r, 3)).toBe(0);
  });

  it('without balancing the rider slips off; on real assist that is a crash', () => {
    const normal = droppingOnto(longRail, 'normal');
    ride(normal, 3);
    expect(normal.rail).toBeNull();
    expect(normal.crashed).toBe(false);
    expect(normal.lastTrick?.name ?? null).not.toBe('50-50');

    const real = droppingOnto(longRail, 'real');
    let crashed = false;
    for (let t = 0; t < 3; t += STEP) {
      stepRider(real, noInput(), STEP);
      crashed ||= real.crashed;
    }
    expect(crashed).toBe(true);
  });

  it('popping off mid-rail spins into a combined trick', () => {
    const r = droppingOnto(rail, 'relaxed');
    ride(r, 0.6, balance);
    expect(r.rail).not.toBeNull();
    let t = 0;
    ride(r, 2.5, (s) => {
      t += STEP;
      if (s.rail) return t < 0.3 ? { ...balance(s), jump: true } : balance(s);
      return { left: !s.grounded && Math.abs(s.air.spin) < Math.PI * 0.8 };
    });
    expect(r.lastTrick?.name).toMatch(/^50-50 to /);
  });

  it('grinds the same way every time', () => {
    const a = droppingOnto();
    const b = droppingOnto();
    ride(a, 2, balance);
    ride(b, 2, balance);
    expect(a.pos).toEqual(b.pos);
    expect(a.rail?.balance).toEqual(b.rail?.balance);
  });
});
