import type { SnowType } from './tuning';
import { type Vec3, normalize, vec } from './vec';

// Kettle Run: one top-to-bottom run of Kettle Peak, heading downhill toward +z.
// It winds gently from the top station, past a glade on the skier's left, through a straight
// park line of kickers, down a steeper pitch and out onto the flats at the base.
// Everything across the run is measured from its centerline, so features follow the curves.

/** Pitch of the run (degrees) at points down the hill; smoothly blended in between. */
const PROFILE: [z: number, gradeDeg: number][] = [
  [0, 13],
  [60, 16],
  [160, 16],
  [440, 15],
  [500, 12], // glade entrance eases off
  [760, 13],
  [800, 10], // park line: steady and readable
  [1060, 11],
  [1110, 20], // the Kettle Wall
  [1330, 19],
  [1400, 8],
  [1480, 3], // base area flats
  [1700, 2],
];

/** Centerline x at points down the hill; smoothly blended so the run curves without kinks. */
const CENTER: [z: number, x: number][] = [
  [0, 0],
  [220, -14],
  [460, 8],
  [700, 4],
  [800, 10],
  [1060, 10], // straight through the park
  [1280, -18],
  [1500, -8],
  [1700, -8],
];

export const RUN = {
  length: 1520,
  /** Rideable corridor half-width; past it the banks rise into the forest. */
  halfWidth: 46,
  groomedHalfWidth: 22,
  /** The glade sits in the powder on the skier's left between these distances from the centerline. */
  glade: { u0: 24, u1: 44, z0: 470, z1: 770 },
  /** The finish line, at the bottom of the Kettle Wall run-out. */
  finishZ: 1450,
};

/** Where riders start, just below the top station. */
export const START = vec(0, 0, 10);
const ZMIN = -100;
const ZMAX = 1800;

const smooth = (t: number): number => t * t * (3 - 2 * t);

function blend(table: [number, number][], z: number): number {
  if (z <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [z1, v1] = table[i];
    if (z <= z1) {
      const [z0, v0] = table[i - 1];
      return v0 + (v1 - v0) * smooth((z - z0) / (z1 - z0));
    }
  }
  return table[table.length - 1][1];
}

/** Centerline of the run at distance z down the hill. */
export const centerX = (z: number): number => blend(CENTER, z);

/** Distance across the run from its centerline (positive = skier's left, +x). */
export const lateral = (x: number, z: number): number => x - centerX(z);

// The run's height down its centerline, integrated from the pitch profile once at load (1 m steps).
const PROFILE_HEIGHT = (() => {
  const n = ZMAX - ZMIN;
  const h = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) {
    const z = ZMIN + i - 0.5;
    h[i] = h[i - 1] - Math.tan((blend(PROFILE, z) * Math.PI) / 180);
  }
  const offset = h[-ZMIN]; // height 0 at z = 0
  return h.map((v) => v - offset);
})();

function profileHeight(z: number): number {
  const f = Math.min(Math.max(z - ZMIN, 0), ZMAX - ZMIN - 1e-6);
  const i = Math.floor(f);
  return PROFILE_HEIGHT[i] + (PROFILE_HEIGHT[i + 1] - PROFILE_HEIGHT[i]) * (f - i);
}

interface Kicker {
  z: number;
  u: number;
  length: number;
  halfWidth: number;
  height: number;
}

/** The kickers: a small warm-up on the upper groomer, then three of rising size down the park line. */
export const KICKERS: readonly Kicker[] = [
  { z: 300, u: -9, length: 12, halfWidth: 5, height: 2.0 },
  { z: 830, u: 0, length: 14, halfWidth: 6, height: 2.6 },
  { z: 910, u: 0, length: 18, halfWidth: 7, height: 3.4 },
  { z: 1000, u: 0, length: 20, halfWidth: 7, height: 4.2 },
];

/** The kicker under (u, z) and the distance into its ramp, or null. */
function kickerAt(u: number, z: number): { k: Kicker; d: number } | null {
  for (const k of KICKERS) {
    const d = z - k.z;
    if (d >= 0 && d <= k.length && Math.abs(u - k.u) <= k.halfWidth) return { k, d };
  }
  return null;
}

export function heightAt(x: number, z: number): number {
  const u = lateral(x, z);
  const base = profileHeight(z);
  // A gentle dish across the run, so riders drift back toward the middle rather than off the side.
  const dish = 0.0018 * Math.min(u * u, RUN.halfWidth * RUN.halfWidth);
  const rollers = 1.1 * Math.sin(z * 0.045) * Math.cos(u * 0.03) + 0.45 * Math.sin(z * 0.11 + u * 0.07);
  // Kicker ramps curve up steeper toward the lip, then drop away to the landing.
  const hit = kickerAt(u, z);
  let kicker = 0;
  if (hit) {
    const t = hit.d / hit.k.length;
    const shoulder = Math.min(1, (hit.k.halfWidth - Math.abs(u - hit.k.u)) / 1.5);
    kicker = hit.k.height * t * t * shoulder;
  }
  // Banks rise beyond the corridor and keep riders on the mountain.
  const edge = Math.max(0, Math.abs(u) - RUN.halfWidth);
  const walls = edge * edge * 0.03;
  return base + dish + rollers + kicker + walls;
}

export function normalAt(x: number, z: number): Vec3 {
  const e = 0.25;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return normalize(vec(-dx, 2 * e, -dz));
}

/** True inside the glade (with a little margin), where the camera tucks in closer. */
export function inGlade(x: number, z: number): boolean {
  const u = lateral(x, z);
  const g = RUN.glade;
  return z > g.z0 - 10 && z < g.z1 + 10 && u > g.u0 - 2 && u < g.u1 + 8;
}

/** True anywhere on a kicker ramp. */
export const onKicker = (x: number, z: number): boolean => kickerAt(lateral(x, z), z) !== null;

/** True on the last stretch of a kicker, where releasing a pop earns the lip bonus. */
export function isNearLip(x: number, z: number): boolean {
  const hit = kickerAt(lateral(x, z), z);
  return hit !== null && hit.d >= hit.k.length - 2.5;
}

export function snowAt(x: number, z: number): SnowType {
  const u = lateral(x, z);
  if (Math.abs(u) > RUN.groomedHalfWidth) return 'powder';
  // Icy patches on the skier's right of the groomer, scraped off on the steeper pitches.
  if (u < -6 && u > -20 && Math.sin(z * 0.021) > 0.8) return 'ice';
  return 'groomed';
}

START.x = centerX(START.z);
START.y = heightAt(START.x, START.z);
