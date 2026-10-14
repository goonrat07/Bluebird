import { describe, expect, it } from 'vitest';
import { LIFT, LIFTS, boardLift, liftToBoard, loadingSpot, seatPoint, stepLift, unloadRider } from '../../src/sim/lifts';
import { createRider } from '../../src/sim/rider';
import { CAT_TRACKS, heightAt, nearTrack, snowAt } from '../../src/sim/terrain';
import { WORLD } from '../../src/sim/tuning';

describe('lifts', () => {
  it('chairs clear the snow all the way up', () => {
    for (const lift of LIFTS) {
      for (let s = 0; s <= lift.length; s += 2) {
        const p = seatPoint(lift, s);
        const margin = s < 15 || s > lift.length - 15 ? 0.5 : LIFT.clearance - 0.01;
        expect(p.y - heightAt(p.x, p.z), `${lift.name} at ${s.toFixed(0)} m`).toBeGreaterThanOrEqual(margin);
      }
    }
  });

  it('you can only get on slowly, at the loading spot', () => {
    for (const lift of LIFTS) {
      const p = loadingSpot(lift);
      expect(liftToBoard(p, 2)?.id).toBe(lift.id);
      expect(liftToBoard(p, LIFT.boardSpeed + 1)).toBeNull();
      expect(liftToBoard({ ...p, z: p.z - 40 }, 1)).toBeNull();
    }
  });

  it('carries a rider to the top and sets them down on the snow', () => {
    for (const lift of LIFTS) {
      const r = createRider();
      const ride = boardLift(lift);
      let steps = 0;
      while (!stepLift(ride, r, true, 1 / WORLD.stepHz)) steps++;
      expect(steps / WORLD.stepHz).toBeLessThan(lift.length / (LIFT.speed * LIFT.hurry) + 1);
      unloadRider(r, lift);
      expect(r.pos.y).toBeCloseTo(heightAt(r.pos.x, r.pos.z), 6);
      expect(r.grounded).toBe(true);
    }
  });
});

describe('Summit Road', () => {
  const road = CAT_TRACKS[0];
  it('is groomed and runs downhill all the way', () => {
    let prev = Infinity;
    for (let i = 1; i < road.points.length; i++) {
      const [a, b] = [road.points[i - 1], road.points[i]];
      for (let f = 0; f < 1; f += 0.05) {
        const x = a[0] + (b[0] - a[0]) * f;
        const z = a[1] + (b[1] - a[1]) * f;
        expect(snowAt(x, z)).toBe('groomed');
        const h = heightAt(x, z);
        expect(h).toBeLessThan(prev + 1.5); // the odd flat bit, never a climb
        expect(h).toBeCloseTo(nearTrack(road, x, z).h, 0);
        prev = h;
      }
    }
  });
});
