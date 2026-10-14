import { MOUNTAIN_BOUNDS, RUN, RUNS, centerX, heightAt, lateral, normalAt } from './terrain';

export interface Tree {
  /** Index in TREES. */
  id: number;
  x: number;
  z: number;
  /** Overall size multiplier; trunk radius and height scale with it. */
  scale: number;
}

export const TRUNK_RADIUS = 0.28;

// Fixed-seed scatter so every load (and every test) has the same trees.
function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function generate(): Tree[] {
  const rand = seeded(7);
  const trees: Tree[] = [];
  const at = (u: number, z: number, scale: number) => trees.push({ id: trees.length, x: centerX(z) + u, z, scale });
  const { glade } = RUN;
  // Thick forest on both banks, all the way down.
  for (let i = 0; i < 2400; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    const u = side * (38 + rand() * 40);
    const z = -40 + rand() * (RUN.length + 120);
    // The glade side opens up into the glade instead.
    if (side > 0 && z > glade.z0 && z < glade.z1 && u < glade.u1 + 4) continue;
    at(u, z, 0.7 + rand() * 0.8);
  }
  // A few lone trees along the edges of the groomer.
  for (let i = 0; i < 140; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    at(side * (28 + rand() * 9), rand() * RUN.length, 0.6 + rand() * 0.6);
  }
  // The glade: a jittered grid about 7 m apart in the powder on the skier's left.
  for (let z = glade.z0; z < glade.z1; z += 7) {
    for (let u = glade.u0 + 2; u < glade.u1 + 6; u += 7) {
      if (rand() < 0.22) continue;
      at(u + (rand() - 0.5) * 4, z + (rand() - 0.5) * 4, 0.8 + rand() * 0.5);
    }
  }
  // Kettle's banks open where the other runs branch off.
  const open = trees.filter((t) => !RUNS.some((r) => r.id !== 'kettle' && r.outside(t.x, t.z) < -2));
  // Then forest over the rest of the mountain: a jittered grid, thicker near the runs, thinning
  // out farther away, and none on the runs or on rock too steep to hold trees.
  const B = MOUNTAIN_BOUNDS;
  for (let z = B.z0; z < B.z1; z += FOREST.spacing) {
    for (let x = B.x0; x < B.x1; x += FOREST.spacing) {
      const tx = x + (rand() - 0.5) * FOREST.spacing * 0.8;
      const tz = z + (rand() - 0.5) * FOREST.spacing * 0.8;
      const keep = rand();
      const scale = 0.7 + rand() * 0.8;
      // Kettle's own banks were planted above.
      if (Math.abs(lateral(tx, tz)) < 80 && tz > -40) continue;
      let nearest = Infinity;
      for (const r of RUNS) nearest = Math.min(nearest, r.outside(tx, tz));
      if (nearest < FOREST.edge) continue;
      if (keep > (nearest < FOREST.near ? FOREST.nearDensity : FOREST.farDensity)) continue;
      if (normalAt(tx, tz).y < FOREST.steepest) continue;
      open.push({ id: 0, x: tx, z: tz, scale });
    }
  }
  open.forEach((t, i) => (t.id = i));
  return open;
}

/** The forest beyond Kettle Run's banks. */
const FOREST = {
  spacing: 8,
  /** Trees start this far outside a run's edge (negative: a little way into its powder). */
  edge: -6,
  near: 45,
  nearDensity: 0.75,
  farDensity: 0.3,
  /** Snow normal's up component below which it's rock, not forest (about 42 degrees). */
  steepest: 0.74,
};

export const TREES: readonly Tree[] = generate();

// Coarse grid so collision checks only look at nearby trees.
const CELL = 8;
const grid = new Map<string, Tree[]>();
for (const t of TREES) {
  const key = `${Math.floor(t.x / CELL)},${Math.floor(t.z / CELL)}`;
  let cell = grid.get(key);
  if (!cell) grid.set(key, (cell = []));
  cell.push(t);
}

export function treesNear(x: number, z: number): Tree[] {
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  const out: Tree[] = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(...(grid.get(`${cx + i},${cz + j}`) ?? []));
  return out;
}

/** Every tree whose grid cell overlaps a circle of `radius` around (x, z). */
export function treesWithin(x: number, z: number, radius: number): Tree[] {
  const out: Tree[] = [];
  const r = Math.ceil(radius / CELL);
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) out.push(...(grid.get(`${cx + i},${cz + j}`) ?? []));
  return out;
}

export const treeBaseY = (t: Tree): number => heightAt(t.x, t.z);
