import { describe, expect, it } from 'vitest';
import { createRider, speedOf, stepRider, type RiderState } from '../../src/sim/rider';
import { START, centerX, heightAt } from '../../src/sim/terrain';
import { noInput, type RideInput } from '../../src/sim/input';
import { WORLD, type Sport } from '../../src/sim/tuning';
import { vec } from '../../src/sim/vec';
import { TREES } from '../../src/sim/trees';
import { placeRider } from '../../src/sim/events';

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
    const { r } = ride(6);
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
    const { r } = ride(0.8, () => ({ right: true }), cruising());
    const travel = Math.atan2(r.vel.x, r.vel.z);
    expect(r.heading).toBeLessThan(-0.4);
    expect(Math.abs(travel - r.heading)).toBeLessThan(0.35);
  });

  it('powder is slower than groomed snow', () => {
    const groomed = ride(6).r;
    const start = createRider();
    start.assist = 'real'; // keep gap sense from steering it out of the powder
    const x = centerX(300) + 30;
    start.pos = vec(x, heightAt(x, 300), 300);
    const before = start.pos.z;
    const powder = ride(6, () => ({}), start).r;
    expect(powder.snow).toBe('powder');
    expect(powder.pos.z - before).toBeLessThan(groomed.pos.z - 10);
  });

  it('skis can skate on the flats', () => {
    const r = createRider('ski');
    r.pos = vec(START.x, heightAt(START.x, START.z), START.z);
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
    ride(4, (t) => ({ left: t < 0.62 }), r);
    expect(r.crashed).toBe(false);
    expect(r.lastTrick?.name).toMatch(/360/);
  });

  it('names a grab held through the air', () => {
    const r = launched('ski');
    ride(4, (t) => ({ grab: t > 0.1 && t < 0.9, right: t > 0.1 && t < 0.9 }), r);
    expect(r.lastTrick?.name).toBe('Safety');
  });

  it('keys held through takeoff carry straight into a spin', () => {
    const r = cruising();
    const before = r.heading;
    ride(0.5, () => ({ left: true, jump: true }), r);
    ride(0.25, () => ({ left: true }), r);
    expect(r.grounded).toBe(false);
    expect(r.heading - before).toBeGreaterThan(1.5);
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
    ride(4, (t) => ({ left: t < 0.21 }), sideways); // about 90 degrees
    expect(sideways.lastTrick?.name).toBe('Bail');

    const relaxed = launched();
    relaxed.assist = 'relaxed';
    const normal = launched();
    // About 45 degrees off: too much for normal, fine for relaxed.
    ride(4, (t) => ({ left: t < 0.1 }), relaxed);
    ride(4, (t) => ({ left: t < 0.1 }), normal);
    expect(relaxed.lastTrick?.name).not.toBe('Bail');
    expect(normal.lastTrick?.name).toBe('Bail');
  });

  it('puts the rider back on the slope after a crash', () => {
    const r = launched();
    r.assist = 'real';
    ride(1.5, (t) => ({ left: t < 0.21 }), r);
    ride(3, () => ({}), r);
    expect(r.crashed).toBe(false);
    expect(r.grounded).toBe(true);
  });
});

describe('steering control', () => {
  /** A rider on the groomer moving straight downhill at `speed`. */
  const moving = (sport: Sport, speed: number) => {
    const r = createRider(sport);
    placeRider(r, 180, 0, speed);
    return r;
  };
  const travel = (r: RiderState) => Math.atan2(r.vel.x, r.vel.z);

  for (const sport of ['board', 'ski'] as Sport[]) {
    it(`${sport}: no slow-speed dead zone, a quarter turn at 6 m/s takes under a second`, () => {
      const r = moving(sport, 6);
      let t = 0;
      while (travel(r) < Math.PI / 2 && t < 3) {
        stepRider(r, { ...noInput(), left: true }, STEP);
        t += STEP;
      }
      expect(t).toBeLessThan(1);
    });

    it(`${sport}: a full carve at speed on the groomer holds its edge instead of skidding`, () => {
      const r = moving(sport, 16);
      let skids = 0;
      let steps = 0;
      ride(0.8, (_, s) => {
        steps++;
        if (s.skidding) skids++;
        return { right: true };
      }, r);
      expect(skids / steps).toBeLessThan(0.1);
      expect(Math.abs(travel(r) - r.heading)).toBeLessThan(0.15);
    });

    it(`${sport}: pressing the other way snaps straight across to the other edge`, () => {
      const r = moving(sport, 10);
      ride(0.5, () => ({ left: true }), r);
      expect(r.edge).toBeCloseTo(1);
      ride(0.12, () => ({ right: true }), r);
      expect(r.edge).toBeLessThan(-0.5);
    });

    it(`${sport}: S + A/D pivots the equipment round fast and bleeds speed`, () => {
      const r = moving(sport, 12);
      ride(0.5, () => ({ left: true, down: true }), r);
      expect(r.heading).toBeGreaterThan(Math.PI / 2);
      expect(speedOf(r)).toBeLessThan(10);
    });

    it(`${sport}: holding S + A/D stops sideways like a hockey stop instead of spinning round`, () => {
      const r = moving(sport, 14);
      // Add up the heading change step by step, so a full spin can't hide behind angle wrapping.
      let turned = 0;
      let last = r.heading;
      ride(0.8, (_, s) => {
        turned += Math.atan2(Math.sin(s.heading - last), Math.cos(s.heading - last));
        last = s.heading;
        return { left: true, down: true };
      }, r);
      expect(turned).toBeGreaterThan(1.2);
      expect(turned).toBeLessThan(2.6);
    });
  }
});

describe('pushing along', () => {
  // The village floor at the bottom of Kettle Run is near flat: no gravity to help.
  const onTheFlat = (sport: Sport) => {
    const r = createRider(sport);
    r.pos = vec(-10, heightAt(-10, 1610), 1610);
    r.vel = vec(0, 0, 0);
    r.heading = Math.PI / 2;
    return r;
  };

  for (const sport of ['ski', 'board'] as Sport[]) {
    it(`W gets a ${sport === 'ski' ? 'skier' : 'snowboarder'} moving from a standstill on the flat`, () => {
      const still = ride(3, () => ({}), onTheFlat(sport)).r;
      const pushed = ride(3, () => ({ up: true }), onTheFlat(sport)).r;
      expect(speedOf(still)).toBeLessThan(0.3);
      expect(speedOf(pushed)).toBeGreaterThan(1.2);
    });
  }

  it('W tucks instead of pushing once you are moving', () => {
    const r = createRider('ski');
    const fast = ride(4, () => ({ up: true }), r).r;
    expect(speedOf(fast)).toBeGreaterThan(8);
    expect(fast.pushing).toBe(false);
    expect(fast.tucking).toBe(true);
  });
});

describe('trees', () => {
  it('riding straight into a trunk is a crash', () => {
    const r = createRider();
    // Aim straight at a tree in the glade from 12 m uphill.
    const tree = { x: centerX(600) + 30, z: 600 };
    const target = TREES.reduce((best, t) =>
      Math.hypot(t.x - tree.x, t.z - tree.z) < Math.hypot(best.x - tree.x, best.z - tree.z) ? t : best,
    );
    r.assist = 'real'; // no gap sense
    r.pos = vec(target.x, heightAt(target.x, target.z - 12), target.z - 12);
    r.vel = vec(0, 0, 14);
    ride(1.5, () => ({}), r);
    expect(r.lastTrick?.name).toBe('Bail');
  });

  it('gap sense eases you around a trunk you are about to hit', () => {
    const tree = { x: centerX(600) + 30, z: 600 };
    const target = TREES.reduce((best, t) =>
      Math.hypot(t.x - tree.x, t.z - tree.z) < Math.hypot(best.x - tree.x, best.z - tree.z) ? t : best,
    );
    const r = createRider();
    r.assist = 'relaxed';
    // Slightly off-center, at a moderate speed: the nudge should be enough.
    r.pos = vec(target.x + 0.2, heightAt(target.x + 0.2, target.z - 12), target.z - 12);
    r.vel = vec(0, 0, 9);
    ride(1.5, () => ({}), r);
    expect(r.lastTrick?.name ?? 'none').not.toBe('Bail');
  });

  it('gap sense never pulls against the way you are steering', () => {
    const tree = { x: centerX(600) + 30, z: 600 };
    const target = TREES.reduce((best, t) =>
      Math.hypot(t.x - tree.x, t.z - tree.z) < Math.hypot(best.x - tree.x, best.z - tree.z) ? t : best,
    );
    // Left alone, gap sense takes you right of this trunk; you steer left, past its other side.
    const turn = (assist: 'relaxed' | 'real') => {
      const r = createRider();
      r.assist = assist;
      r.pos = vec(target.x + 0.2, heightAt(target.x + 0.2, target.z - 8), target.z - 8);
      r.vel = vec(0, 0, 9);
      ride(0.05, () => ({ left: true }), r);
      return r.heading;
    };
    // It may help the turn along, never hold it back.
    expect(turn('relaxed')).toBeGreaterThanOrEqual(turn('real') - 1e-9);
  });

  it('skimming past trees builds Flow, and it drains in the open', () => {
    const r = createRider();
    r.assist = 'real';
    // A glade tree with a clear lane 1.5 m to one side of it.
    const laneX = (t: (typeof TREES)[number]) => t.x + 1.5 + 0.28 * t.scale + 0.35;
    const t = TREES.find((t) => {
      const u = t.x - centerX(t.z);
      if (t.z < 520 || t.z > 700 || u < 28 || u > 40) return false;
      return !TREES.some((o) => o !== t && Math.abs(o.x - laneX(t)) < 1.6 && o.z > t.z - 14 && o.z < t.z + 4);
    })!;
    const x = laneX(t);
    r.pos = vec(x, heightAt(x, t.z - 10), t.z - 10);
    r.vel = vec(0, 0, 13);
    ride(1.6, () => ({}), r);
    expect(r.flow).toBeGreaterThan(0.05);
    const built = r.flow;
    const open = createRider();
    Object.assign(open, { flow: built, flowIdle: 0 });
    ride(6, () => ({}), open);
    expect(open.flow).toBeLessThan(built);
  });
});

describe('steep runs', () => {
  it.each(['ski', 'board'] as const)('rides Kettle Couloir on %s without hopping off the snow', (sport) => {
    const r = createRider(sport);
    placeRider(r, -390, 0, 5, 'couloir');
    let airborne = 0;
    for (let i = 0; i < 15 * WORLD.stepHz; i++) {
      stepRider(r, noInput(), STEP);
      if (!r.grounded) airborne++;
    }
    expect(airborne).toBe(0);
    expect(r.crashed).toBe(false);
    expect(r.pos.z).toBeGreaterThan(-200); // made it most of the way down, not stuck on a ledge
  });

  it('has no steps in the snow of the side runs', () => {
    // The runs are baked into 1 m tables; reading between entries must stay smooth.
    for (let z = -380; z < -370; z += 0.1) {
      const x = -59.5;
      const drop = heightAt(x, z) - heightAt(x, z + 0.1);
      expect(drop).toBeGreaterThan(0.03);
      expect(drop).toBeLessThan(0.12);
    }
  });
});
