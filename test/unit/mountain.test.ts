import { describe, expect, it } from 'vitest';
import { RUNS, centerX, heightAt, kettleSurface, runAt } from '../../src/sim/terrain';

describe('Kettle Peak', () => {
  it("leaves Kettle Run's snow exactly as it was", () => {
    for (let z = 0; z <= 1700; z += 5) {
      for (let u = -36; u <= 36; u += 3) {
        const x = centerX(z) + u;
        expect(heightAt(x, z)).toBeCloseTo(kettleSurface(x, z), 9);
      }
    }
  });

  it('every new run keeps going downhill along its centerline', () => {
    // (Kettle's own centerline climbs its kickers.)
    for (const run of RUNS.filter((r) => r.id !== 'kettle')) {
      let prev = Infinity;
      for (let z = run.z0; z <= Math.min(run.z1, 1450); z += 10) {
        const x = run.centerX(z);
        const h = heightAt(x, z);
        expect(h, `${run.name} at z=${z}`).toBeLessThan(prev + 0.5);
        prev = h;
      }
    }
  });

  it('the other runs meet Kettle without a step', () => {
    for (const run of RUNS.filter((r) => r.id !== 'kettle')) {
      const z = run.z1;
      const x = run.centerX(z);
      // Coming off the end of the run, the snow carries on smoothly.
      expect(Math.abs(heightAt(x, z + 4) - heightAt(x, z) - (heightAt(x, z) - heightAt(x, z - 4))), run.name).toBeLessThan(1.5);
    }
  });

  it('finds the run under a point', () => {
    for (const run of RUNS) {
      const z = (run.z0 + run.z1) / 2;
      expect(runAt(run.centerX(z), z).run.id).toBe(run.id);
    }
  });
});
