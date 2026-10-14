import { describe, expect, it } from 'vitest';
import { BUILDINGS, COUNTERS, SPOTS, insideOf, pushOutOfWalls } from '../../src/sim/village';
import { WALK, startWalking, stepWalk } from '../../src/sim/walk';
import { DOG, createDogs, dogToPet, pet, stepDogs } from '../../src/sim/dogs';
import { noInput } from '../../src/sim/input';
import { createRider, stepRider } from '../../src/sim/rider';
import { heightAt } from '../../src/sim/terrain';
import { TREES } from '../../src/sim/trees';
import { WORLD } from '../../src/sim/tuning';

const DT = 1 / WORLD.stepHz;
const walkFor = (w: ReturnType<typeof startWalking>, seconds: number, input = { ...noInput(), up: true }) => {
  for (let i = 0; i < seconds * WORLD.stepHz; i++) stepWalk(w, input, DT);
};

describe('the village', () => {
  it('lets you walk in through the door of each shop and reach its counter', () => {
    for (const c of COUNTERS) {
      const b = BUILDINGS.find((b) => b.id === c.building)!;
      // Start outside the doorway, facing in (downhill, +z).
      const w = startWalking(b.x, b.z - b.d / 2 - 2, 0);
      walkFor(w, (c.z - w.z) / WALK.speed);
      expect(insideOf(w.x, w.z)?.id, b.name).toBe(b.id);
      expect(Math.hypot(w.x - c.x, w.z - c.z)).toBeLessThan(0.5);
      expect(w.y).toBeCloseTo(b.floor, 6);
    }
  });

  it('walls stop you walking through them', () => {
    const b = BUILDINGS.find((b) => b.id === 'cafe')!;
    const w = startWalking(b.x, b.z - b.d / 2 - 3, 0);
    walkFor(w, 10);
    expect(w.z).toBeLessThan(b.z - b.d / 2);
  });

  it('a rider coasting into a wall stops at it', () => {
    const b = BUILDINGS.find((b) => b.id === 'lodge')!;
    const r = createRider();
    const z = b.z + b.d / 2 + 4;
    r.pos = { x: b.x + 3, y: heightAt(b.x + 3, z), z };
    r.heading = Math.PI;
    r.vel = { x: 0, y: 0, z: -3 };
    for (let i = 0; i < 4 * WORLD.stepHz; i++) stepRider(r, noInput(), DT);
    expect(r.pos.z).toBeGreaterThan(b.z + b.d / 2);
    expect(pushOutOfWalls(r.pos.x, r.pos.z, 0.2)).toBeNull();
  });

  it('keeps trees and crowds out of the buildings', () => {
    for (const b of BUILDINGS) {
      expect(TREES.some((t) => Math.abs(t.x - b.x) < b.w / 2 + 2 && Math.abs(t.z - b.z) < b.d / 2 + 2), b.name).toBe(false);
    }
    for (const s of SPOTS) expect(pushOutOfWalls(s.x, s.z, 0.3), `${s.group} at ${s.x.toFixed(1)},${s.z.toFixed(1)}`).toBeNull();
  });
});

describe('the dogs', () => {
  it('Pepper follows you for a while once petted, then goes back to roaming', () => {
    const dogs = createDogs();
    const pepper = dogs.find((d) => d.name === 'Pepper')!;
    const you = { x: pepper.x + 1, z: pepper.z };
    expect(dogToPet(dogs, you.x, you.z)).toBe(pepper);
    pet(pepper);
    // Walk away down the plaza; she keeps up.
    for (let i = 0; i < 10 * WORLD.stepHz; i++) {
      you.z += 1.5 * DT;
      stepDogs(dogs, you, DT);
    }
    expect(Math.hypot(pepper.x - you.x, pepper.z - you.z)).toBeLessThan(DOG.heel + 1);
    for (let i = 0; i < DOG.followTime * WORLD.stepHz; i++) stepDogs(dogs, you, DT);
    expect(pepper.follow).toBe(0);
  });

  it('Bowie stays at the patrol hut', () => {
    const dogs = createDogs();
    const bowie = dogs.find((d) => d.name === 'Bowie')!;
    const home = [bowie.x, bowie.z];
    pet(bowie);
    for (let i = 0; i < 20 * WORLD.stepHz; i++) stepDogs(dogs, { x: 0, z: 0 }, DT);
    expect(Math.hypot(bowie.x - home[0], bowie.z - home[1])).toBeLessThan(0.01);
  });
});
