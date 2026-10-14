import { describe, expect, it } from 'vitest';
import { createRider, speedOf, stepRider, type RiderState } from '../../src/sim/rider';
import { heightAt } from '../../src/sim/terrain';
import { noInput, type RideInput } from '../../src/sim/input';
import { WORLD, type Sport } from '../../src/sim/tuning';
import { vec } from '../../src/sim/vec';
import { TREES } from '../../src/sim/trees';

const STEP = 1 / WORLD.stepHz;
type Script = (t: number, r: RiderState) => Partial<RideInput>;

function ride(seconds: number, script: Script = () => ({}), r: RiderState = createRider()) {
  let minClearance = Infinity;
  const start = r.time;
  while (r.time - start < seconds - 1e-9) {
    stepRider(r, { ...noInput(), ...script(r.time - start, r) }, STEP);
    minClearance = Math.min(minClearance, r.pos.y - heightAt(r.pos.x, r.pos.z));
  }
  return { r, minClearance };
}

/** A rider already moving downhill at a steady speed on the groomer. */
function cruising(sport: Sport = 'board', seconds = 4): RiderState {
  return ride(seconds, () => ({}), createRider(sport)).r;
}

/** Puts the rider in the air high above the slope, moving downhill. */
function launched(sport: Sport = 'board', height = 14): RiderState {
  const r = cruising(sport);
  r.pos.y += height;
  r.vel = vec(0, 2, 12);
  r.heading = 0;
  r.grounded = false;
  return r;
}

describe('riding', () => {
  it('picks up speed going downhill from a standstill', () => {
    const { r } = ride(4);
    expect(speedOf(r)).toBeGreaterThan(8);
    expect(r.pos.z).toBeGreaterThan(20);
  });

  it('slows down when braking', () => {
    const free = ride(6).r;
    const braking = ride(6, (t) => ({ down: t > 2 })).r;
    expect(speedOf(braking)).toBeLessThan(speedOf(free) * 0.5);
  });

  it('goes faster in a tuck', () => {
    const upright = ride(12).r;
    const tucked = ride(12, () => ({ up: true })).r;
    expect(speedOf(tucked)).toBeGreaterThan(speedOf(upright));
  });

  it('holding a turn longer turns harder', () => {
    const tap = ride(1.2, (t) => ({ left: t < 0.1 }), cruising()).r;
    const hold = ride(1.2, (t) => ({ left: t < 0.6 }), cruising()).r;
    expect(Math.abs(hold.heading)).toBeGreaterThan(Math.abs(tap.heading) * 2);
  });

  it('a clean carve keeps more speed than a skid', () => {
    const carve = ride(1.5, () => ({ left: true }), cruising()).r;
    const skid = ride(1.5, () => ({ left: true, down: true }), cruising()).r;
    expect(speedOf(carve)).toBeGreaterThan(speedOf(skid) * 1.3);
  });

  it('travel follows the equipment through a carve', () => {
    const { r } = ride(1.5, () => ({ right: true }), cruising());
    const travel = Math.atan2(r.vel.x, r.vel.z);
    expect(r.heading).toBeLessThan(-0.4);
    expect(Math.abs(travel - r.heading)).toBeLessThan(0.35);
  });

  it('powder is slower than groomed snow', () => {
    const groomed = ride(6).r;
    const start = createRider();
    start.pos = vec(30, heightAt(30, 300), 300);
    const before = start.pos.z;
    const powder = ride(6, () => ({}), start).r;
    expect(powder.snow).toBe('powder');
    expect(powder.pos.z - before).toBeLessThan(groomed.pos.z - 10);
  });

  it('skis can skate on the flats', () => {
    const r = createRider('ski');
    r.pos = vec(0, heightAt(0, 10), 10);
    const pushed = ride(1, () => ({ up: true }), r).r;
    const coasted = ride(1, () => ({}), createRider('ski')).r;
    expect(speedOf(pushed)).toBeGreaterThan(speedOf(coasted));
  });

  it('keeps cruising speed believable: about 60-80 km/h, 90-ish in a tuck', () => {
    for (const sport of ['board', 'ski'] as const) {
      let top = 0;
      let topTuck = 0;
      ride(60, (_t, s) => ((top = Math.max(top, speedOf(s))), {}), createRider(sport));
      ride(60, (_t, s) => ((topTuck = Math.max(topTuck, speedOf(s))), { up: true }), createRider(sport));
      expect(top * 3.6).toBeLessThan(85);
      expect(topTuck * 3.6).toBeLessThan(105);
      expect(topTuck).toBeGreaterThan(top);
    }
  });

  it('left turns the direction of travel left even when riding switch', () => {
    for (const startHeading of [0, Math.PI]) {
      const r = cruising();
      r.heading = startHeading; // pi = board pointing uphill while sliding down (switch)
      const before = Math.atan2(r.vel.x, r.vel.z);
      ride(0.6, () => ({ left: true }), r);
      expect(Math.atan2(r.vel.x, r.vel.z)).toBeGreaterThan(before + 0.1);
    }
  });

  it('never sinks below the snow', () => {
    const { minClearance } = ride(25, (t) => ({ left: t % 4 < 1.5, right: t % 4 > 2.5, jump: t % 3 < 0.3 }));
    expect(minClearance).toBeGreaterThanOrEqual(-1e-9);
  });

  it('is deterministic: the same inputs give the same ride', () => {
    const script: Script = (t) => ({ left: t % 5 < 2, up: t > 3, jump: t % 4 < 0.3, grab: t % 4 > 0.6 && t % 4 < 1 });
    expect(ride(20, script).r).toEqual(ride(20, script).r);
  });
});

describe('jumping and tricks', () => {
  it('loading the pop longer jumps higher', () => {
    const peak = (hold: number) => {
      const r = cruising();
      const base = r.pos.y - heightAt(r.pos.x, r.pos.z);
      let best = base;
      ride(1.5, (t, s) => {
        best = Math.max(best, s.pos.y - heightAt(s.pos.x, s.pos.z));
        return { jump: t < hold };
      }, r);
      return best;
    };
    expect(peak(0.45)).toBeGreaterThan(peak(0.05) + 0.3);
  });

  it('finishes a nearly complete 360 by itself on the normal setting', () => {
    const r = launched();
    // Let go of the spin key a bit early; the finish-assist completes the rotation.
    ride(4, (t) => ({ left: t < 0.8 }), r);
    expect(r.crashed).toBe(false);
    expect(r.lastTrick?.name).toMatch(/360/);
  });

  it('names a grab held through the air', () => {
    const r = launched('ski');
    ride(4, (t) => ({ grab: t > 0.1 && t < 0.9, right: t > 0.1 && t < 0.9 }), r);
    expect(r.lastTrick?.name).toBe('Safety');
  });

  it('holding a tuck off a jump does not start a flip', () => {
    const r = cruising();
    ride(0.5, () => ({ up: true, jump: true }), r);
    ride(3, () => ({ up: true }), r);
    expect(r.lastTrick?.name ?? 'Air').not.toMatch(/flip|Bail/);
  });

  it('lands a backflip', () => {
    const r = launched('board', 18);
    const flipTime = (2 * Math.PI) / 5.2;
    ride(5, (t) => ({ down: t < flipTime - 0.08 }), r);
    expect(r.crashed).toBe(false);
    expect(r.lastTrick?.name).toMatch(/Backflip/);
  });

  it('crashes landing sideways, and rides away on the relaxed setting if it is close', () => {
    const sideways = launched();
    sideways.assist = 'real'; // no rotation finish-assist
    ride(4, (t) => ({ left: t < 0.27 }), sideways); // about 90 degrees
    expect(sideways.lastTrick?.name).toBe('Bail');

    const relaxed = launched();
    relaxed.assist = 'relaxed';
    const normal = launched();
    // About 45 degrees off: too much for normal, fine for relaxed.
    ride(4, (t) => ({ left: t < 0.13 }), relaxed);
    ride(4, (t) => ({ left: t < 0.13 }), normal);
    expect(relaxed.lastTrick?.name).not.toBe('Bail');
    expect(normal.lastTrick?.name).toBe('Bail');
  });

  it('puts the rider back on the slope after a crash', () => {
    const r = launched();
    r.assist = 'real';
    ride(1.5, (t) => ({ left: t < 0.27 }), r);
    ride(3, () => ({}), r);
    expect(r.crashed).toBe(false);
    expect(r.grounded).toBe(true);
  });
});

describe('trees', () => {
  it('riding straight into a trunk is a crash', () => {
    const r = createRider();
    // The glade starts around z = 260; aim straight at a known tree from 12 m uphill.
    const tree = { x: 30, z: 400 };
    const target = TREES.reduce((best, t) =>
      Math.hypot(t.x - tree.x, t.z - tree.z) < Math.hypot(best.x - tree.x, best.z - tree.z) ? t : best,
    );
    r.pos = vec(target.x, heightAt(target.x, target.z - 12), target.z - 12);
    r.vel = vec(0, 0, 14);
    ride(1.5, () => ({}), r);
    expect(r.lastTrick?.name).toBe('Bail');
  });
});
