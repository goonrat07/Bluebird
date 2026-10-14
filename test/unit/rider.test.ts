import { describe, expect, it } from 'vitest';
import { createRider, speedOf, stepRider } from '../../src/sim/rider';
import { heightAt } from '../../src/sim/terrain';
import { noInput, type RideInput } from '../../src/sim/input';
import { TUNING } from '../../src/sim/tuning';

const STEP = 1 / TUNING.stepHz;

function ride(seconds: number, input: (t: number) => Partial<RideInput> = () => ({})) {
  const r = createRider();
  let minClearance = Infinity;
  for (let i = 0; i < seconds * TUNING.stepHz; i++) {
    stepRider(r, { ...noInput(), ...input(i * STEP) }, STEP);
    minClearance = Math.min(minClearance, r.pos.y - heightAt(r.pos.x, r.pos.z));
  }
  return { r, minClearance };
}

describe('rider', () => {
  it('picks up speed going downhill from a standstill', () => {
    const { r } = ride(4);
    expect(speedOf(r)).toBeGreaterThan(8);
    expect(r.pos.z).toBeGreaterThan(20);
  });

  it('slows down when braking', () => {
    const free = ride(5).r;
    const braking = ride(5, (t) => ({ brake: t > 2 })).r;
    expect(speedOf(braking)).toBeLessThan(speedOf(free) * 0.6);
  });

  it('goes faster in a tuck', () => {
    const upright = ride(12).r;
    const tucked = ride(12, () => ({ tuck: true })).r;
    expect(speedOf(tucked)).toBeGreaterThan(speedOf(upright));
  });

  it('never sinks below the snow', () => {
    const { minClearance } = ride(20, (t) => ({ left: t % 4 < 1.5, right: t % 4 > 2.5, jump: t % 3 < 0.3 }));
    expect(minClearance).toBeGreaterThanOrEqual(-1e-9);
  });

  it('steering turns the rider', () => {
    const { r } = ride(3, () => ({ right: true }));
    expect(r.heading).toBeLessThan(-0.5);
  });

  it('pops into the air when jump is released', () => {
    const r = createRider();
    for (let i = 0; i < 240; i++) stepRider(r, noInput(), STEP);
    stepRider(r, { ...noInput(), jump: true }, STEP);
    stepRider(r, noInput(), STEP);
    stepRider(r, noInput(), STEP);
    expect(r.grounded).toBe(false);
  });

  it('is deterministic: the same inputs give the same ride', () => {
    const script = (t: number) => ({ left: t % 5 < 2, tuck: t > 3, jump: t % 4 < 0.2 });
    const a = ride(15, script).r;
    const b = ride(15, script).r;
    expect(a).toEqual(b);
  });
});
