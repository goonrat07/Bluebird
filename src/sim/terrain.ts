import { type Vec3, normalize, vec } from './vec';

// A long gray test slope running downhill toward +z, with rolling bumps and raised sides.
export const SLOPE = {
  length: 1200,
  halfWidth: 70,
  grade: Math.tan((18 * Math.PI) / 180),
  start: vec(0, 0, 10),
};

export function heightAt(x: number, z: number): number {
  const base = -z * SLOPE.grade;
  const rollers = 1.2 * Math.sin(z * 0.045) * Math.cos(x * 0.03) + 0.5 * Math.sin(z * 0.11 + x * 0.07);
  // Kicker every 150 m down the middle so jumping has something to do.
  const kz = ((z % 150) + 150) % 150;
  const kicker = kz > 110 && kz < 122 && Math.abs(x) < 6 ? (kz - 110) * 0.18 : 0;
  // Sides rise like a gully so the rider stays on the slope.
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
