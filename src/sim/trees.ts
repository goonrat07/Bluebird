import { SLOPE, heightAt } from './terrain';

export interface Tree {
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
  // Thick forest on both sides of the run.
  for (let i = 0; i < 900; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    trees.push({ x: side * (36 + rand() * 34), z: rand() * SLOPE.length, scale: 0.7 + rand() * 0.8 });
  }
  // A rideable glade in the powder on the skier's left: jittered grid, about 7 m apart.
  for (let z = 260; z < 700; z += 7) {
    for (let x = 24; x < 36; x += 7) {
      if (rand() < 0.25) continue;
      trees.push({ x: x + (rand() - 0.5) * 4, z: z + (rand() - 0.5) * 4, scale: 0.8 + rand() * 0.5 });
    }
  }
  return trees;
}

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

export const treeBaseY = (t: Tree): number => heightAt(t.x, t.z);
