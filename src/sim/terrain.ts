import type { SnowType } from './tuning';
import { type Vec3, normalize, vec } from './vec';

// A long test slope running downhill toward +z: groomed down the middle, powder on the sides,
// icy patches, rolling bumps, a line of kickers, and raised sides so the rider stays on the hill.
export const SLOPE = {
  length: 1200,
  halfWidth: 70,
  grade: Math.tan((18 * Math.PI) / 180),
  start: vec(0, 0, 10),
  groomedHalfWidth: 22,
};

const KICKER = { spacing: 150, start: 104, length: 18, halfWidth: 7, height: 3.4 };

/** Distance into the current kicker ramp (0..length), or -1 when not on one. */
function kickerProgress(x: number, z: number): number {
  if (Math.abs(x) > KICKER.halfWidth) return -1;
  const kz = ((z % KICKER.spacing) + KICKER.spacing) % KICKER.spacing;
  const d = kz - KICKER.start;
  return d >= 0 && d <= KICKER.length ? d : -1;
}

export function heightAt(x: number, z: number): number {
  const base = -z * SLOPE.grade;
  const rollers = 1.2 * Math.sin(z * 0.045) * Math.cos(x * 0.03) + 0.5 * Math.sin(z * 0.11 + x * 0.07);
  // Kicker ramps curve up steeper toward the lip, then drop away to the landing.
  const k = kickerProgress(x, z);
  const t = k >= 0 ? k / KICKER.length : 0;
  const shoulder = Math.min(1, (KICKER.halfWidth - Math.abs(x)) / 1.5);
  const kicker = k >= 0 ? KICKER.height * t * t * shoulder : 0;
  const edge = Math.max(0, Math.abs(x) - 40);
  const walls = edge * edge * 0.02;
  return base + rollers + kicker + walls;
}

export function normalAt(x: number, z: number): Vec3 {
  const e = 0.25;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return normalize(vec(-dx, 2 * e, -dz));
}

/** True on the last stretch of a kicker, where releasing a pop earns the lip bonus. */
export function isNearLip(x: number, z: number): boolean {
  const k = kickerProgress(x, z);
  return k >= KICKER.length - 2.5;
}

export function snowAt(x: number, z: number): SnowType {
  if (Math.abs(x) > SLOPE.groomedHalfWidth) return 'powder';
  // Icy patches on the skier's right of the groomer.
  if (x < -6 && x > -20 && Math.sin(z * 0.021) > 0.8) return 'ice';
  return 'groomed';
}
