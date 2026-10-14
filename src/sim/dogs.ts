import { heightAt } from './terrain';
import { groundAt, pushOutOfWalls } from './village';

// The mountain's two dogs. Bowie, the patrol's avalanche dog, sits by the patrol hut at the
// summit. Pepper, scruffier, roams the village, and follows you about for a while once petted.

export interface Dog {
  name: string;
  x: number;
  z: number;
  y: number;
  heading: number;
  /** Tail wag rate (0 = still); petting makes it frantic for a bit. */
  wag: number;
  happy: number;
  /** Seconds left following you. */
  follow: number;
  speed: number;
  /** Where a roaming dog is headed next, and how long until it picks somewhere new. */
  target: [number, number];
  wait: number;
  /** Bowie stays home; Pepper roams these points. */
  home: [number, number];
  roams: boolean;
  seed: number;
}

export const DOG = {
  petReach: 2.4,
  followTime: 45,
  /** Stays this far behind you when following. */
  heel: 2.2,
  trot: 2.6,
  run: 6,
  roamRadius: 26,
  happyTime: 3,
};

function make(name: string, home: [number, number], roams: boolean, seed: number): Dog {
  const [x, z] = home;
  return { name, x, z, y: heightAt(x, z), heading: Math.PI, wag: 1, happy: 0, follow: 0, speed: 0, target: home, wait: 2, home, roams, seed };
}

export function createDogs(): Dog[] {
  return [make('Bowie', [24, -446], false, 3), make('Pepper', [10, 1612], true, 7)];
}

const rand = (d: Dog): number => (d.seed = (d.seed * 16807) % 2147483647) / 2147483647;

/** The dog close enough to pet, if any. */
export function dogToPet(dogs: Dog[], x: number, z: number): Dog | null {
  return dogs.find((d) => Math.hypot(d.x - x, d.z - z) < DOG.petReach) ?? null;
}

export function pet(d: Dog): void {
  d.happy = DOG.happyTime;
  if (d.roams) d.follow = DOG.followTime;
}

/** Moves the dogs on one step, given where you are. */
export function stepDogs(dogs: Dog[], you: { x: number; z: number }, dt: number): void {
  for (const d of dogs) {
    d.happy = Math.max(0, d.happy - dt);
    d.follow = Math.max(0, d.follow - dt);
    let goal: [number, number] | null = null;
    let pace = DOG.trot;
    if (d.follow > 0) {
      // Trot along behind you, and run to catch up if you get away.
      const gap = Math.hypot(you.x - d.x, you.z - d.z);
      if (gap > DOG.heel) goal = [you.x, you.z];
      if (gap > 12) pace = DOG.run;
      // Lost you (you rode off): head home.
      if (gap > 80) d.follow = 0;
    } else if (d.roams) {
      d.wait -= dt;
      if (d.wait <= 0 && Math.hypot(d.target[0] - d.x, d.target[1] - d.z) < 1) {
        const a = rand(d) * Math.PI * 2;
        const r = rand(d) * DOG.roamRadius;
        d.target = [d.home[0] + Math.sin(a) * r, d.home[1] + Math.cos(a) * r];
        d.wait = 3 + rand(d) * 6;
      }
      goal = d.target;
    }
    d.speed = 0;
    if (goal) {
      const dx = goal[0] - d.x;
      const dz = goal[1] - d.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.5) {
        const step = Math.min(dist, pace * dt);
        d.x += (dx / dist) * step;
        d.z += (dz / dist) * step;
        d.heading = Math.atan2(dx, dz);
        d.speed = step / dt;
      }
    }
    const hit = pushOutOfWalls(d.x, d.z, 0.4);
    if (hit) {
      d.x = hit.x;
      d.z = hit.z;
    }
    d.y = groundAt(d.x, d.z);
    d.wag = d.happy > 0 ? 3 : d.speed > 0 ? 1.6 : 1;
  }
}
