import { heightAt } from './terrain';

// Kettle Peak's base village and the patrol hut at the summit: where the buildings stand, where
// people gather, and what you can do inside. Walls are solid to walkers and riders alike.

export type BuildingKind = 'lodge' | 'rental' | 'outfitter' | 'cafe' | 'patrol';

export interface Building {
  id: BuildingKind;
  name: string;
  /** Centre and size on the ground (x across, z down the hill); all buildings are square to the hill. */
  x: number;
  z: number;
  w: number;
  d: number;
  /** Wall height to the eaves. */
  height: number;
  /** Buildings you can walk into have a doorway in the uphill (-z) wall. */
  door: number | null;
  /** Floor height: the snow at the doorway, so you step straight in. */
  floor: number;
}

const WALL = 0.3;

function building(id: BuildingKind, name: string, x: number, z: number, w: number, d: number, height: number, door: number | null): Building {
  return { id, name, x, z, w, d, height, door, floor: heightAt(x, z - d / 2) };
}

export const BUILDINGS: readonly Building[] = [
  building('lodge', 'Kettle Lodge', 48, 1592, 26, 16, 4.2, 4),
  building('rental', 'Rental Shop', -48, 1574, 11, 8, 3.4, 2.4),
  building('outfitter', 'Bluebird Outfitters', -76, 1592, 11, 9, 3.4, 2.4),
  building('cafe', 'Kettle Café', 6, 1664, 9, 7, 3.2, null),
  building('patrol', 'Patrol Hut', 30, -452, 7, 5, 2.8, null),
];

/** The pond (frozen) and the parking lot, for drawing and for keeping crowds off them. */
export const POND = { x: -62, z: 1664, r: 14 };
export const PARKING = { x: 72, z: 1690, w: 44, d: 26 };

/** The solid wall boxes of every building, as axis-aligned rectangles (x0, z0, x1, z1). */
export const WALLS: readonly [number, number, number, number][] = BUILDINGS.flatMap((b) => {
  const x0 = b.x - b.w / 2;
  const x1 = b.x + b.w / 2;
  const z0 = b.z - b.d / 2;
  const z1 = b.z + b.d / 2;
  if (b.door === null) return [[x0, z0, x1, z1]] as [number, number, number, number][];
  const half = b.door / 2;
  return [
    [x0, z0 - WALL / 2, b.x - half, z0 + WALL / 2],
    [b.x + half, z0 - WALL / 2, x1, z0 + WALL / 2],
    [x0, z1 - WALL / 2, x1, z1 + WALL / 2],
    [x0 - WALL / 2, z0, x0 + WALL / 2, z1],
    [x1 - WALL / 2, z0, x1 + WALL / 2, z1],
  ] as [number, number, number, number][];
});

/** Pushes a circle of `radius` at (x, z) out of any wall; returns the corrected point and the push normal, if any. */
export function pushOutOfWalls(x: number, z: number, radius: number): { x: number; z: number; nx: number; nz: number } | null {
  let hit: { x: number; z: number; nx: number; nz: number } | null = null;
  for (const [x0, z0, x1, z1] of WALLS) {
    const cx = Math.min(Math.max(x, x0), x1);
    const cz = Math.min(Math.max(z, z0), z1);
    const dx = x - cx;
    const dz = z - cz;
    const d = Math.hypot(dx, dz);
    if (d >= radius) continue;
    let nx: number;
    let nz: number;
    if (d > 1e-6) {
      nx = dx / d;
      nz = dz / d;
    } else {
      // Inside the box: leave by the nearest side.
      const out = [x - x0, x1 - x, z - z0, z1 - z];
      const i = out.indexOf(Math.min(...out));
      [nx, nz] = [[-1, 0], [1, 0], [0, -1], [0, 1]][i];
      x = [x0, x1, x, x][i];
      z = [z, z, z0, z1][i];
    }
    const push = radius - (d > 1e-6 ? d : 0);
    x += nx * push;
    z += nz * push;
    hit = { x, z, nx, nz };
  }
  return hit;
}

/** The building whose floor a point stands on, if it's indoors. */
export function insideOf(x: number, z: number): Building | null {
  for (const b of BUILDINGS) {
    if (b.door !== null && Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2) return b;
  }
  return null;
}

/** Ground height for someone on foot: the floor indoors, the snow outside. */
export const groundAt = (x: number, z: number): number => insideOf(x, z)?.floor ?? heightAt(x, z);

export type Pose = 'sit' | 'stand';

/** Somewhere a villager hangs out. Groups cheer together. */
export interface Spot {
  x: number;
  z: number;
  heading: number;
  pose: Pose;
  group: string;
}

/** Fixed-seed scatter so every load has the same crowd. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Tables on the lodge terrace and inside, the café's outdoor tables, and people milling about. */
export const TABLES: readonly { x: number; z: number; indoor: boolean }[] = [
  ...[34, 40, 56, 62].flatMap((x) => [1576, 1580].map((z) => ({ x, z, indoor: false }))),
  ...[38, 58].map((x) => ({ x, z: 1591, indoor: true })),
  ...[2, 10].map((x) => ({ x, z: 1657, indoor: false })),
];

export const SPOTS: readonly Spot[] = (() => {
  const rand = seeded(11);
  const spots: Spot[] = [];
  // Two to four people round each table, facing it.
  for (const t of TABLES) {
    const n = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand() * 0.4;
      spots.push({
        x: t.x + Math.sin(a) * 1.1,
        z: t.z + Math.cos(a) * 1.1,
        heading: a + Math.PI,
        pose: 'sit',
        group: t.indoor ? 'lodge-inside' : t.z > 1650 ? 'cafe' : 'terrace',
      });
    }
  }
  // Standing groups chatting: by the lift, at the bottom of the run, and by the pond.
  const groups: [string, number, number, number][] = [
    ['lift', -36, 1506, 6],
    ['finish', -30, 1528, 7],
    ['finish', 18, 1534, 6],
    ['pond', -48, 1650, 5],
    ['plaza', 8, 1600, 6],
  ];
  for (const [group, cx, cz, n] of groups) {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = 1 + rand() * 2.2;
      const x = cx + Math.sin(a) * r;
      const z = cz + Math.cos(a) * r;
      // Facing roughly into the group, with a bit of variety.
      spots.push({ x, z, heading: Math.atan2(cx - x, cz - z) + (rand() - 0.5) * 0.8, pose: 'stand', group });
    }
  }
  return spots;
})();

/** Things you can do with E when you're close enough on foot. */
export interface Counter {
  building: BuildingKind;
  x: number;
  z: number;
  action: 'swapGear' | 'outfit' | 'warmUp';
  label: string;
}

export const COUNTERS: readonly Counter[] = [
  { building: 'rental', x: -48, z: 1576.5, action: 'swapGear', label: 'swap skis and board' },
  { building: 'outfitter', x: -76, z: 1594.5, action: 'outfit', label: 'try on a new jacket' },
  { building: 'lodge', x: 48, z: 1597.5, action: 'warmUp', label: 'warm up by the fire' },
];

export const COUNTER_REACH = 2.2;

export function counterAt(x: number, z: number): Counter | null {
  for (const c of COUNTERS) if (Math.hypot(x - c.x, z - c.z) < COUNTER_REACH) return c;
  return null;
}
