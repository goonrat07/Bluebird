import * as THREE from 'three';
import { MOUNTAIN_BOUNDS, RUNS, type RunInfo, heightAt, isNearLip, onKicker, snowAt } from '../sim/terrain';
import type { SnowType } from '../sim/tuning';

// Kettle Peak's snow, built in chunks so the parts behind the camera are culled.
// Each run gets a fine grid laid along its own centerline, so its curves, kickers and banks
// stay crisp; a coarser grid covers the forest and rock between them, sitting just under the
// runs so the two never fight where they overlap.

// Per-snow-type tint on top of the preset's snow color: ice is glassy blue-gray, groomed a touch duller than powder.
const SNOW_TINTS: Record<SnowType, THREE.Color> = {
  groomed: new THREE.Color(0.95, 0.95, 0.96),
  powder: new THREE.Color(1, 1, 1),
  ice: new THREE.Color(0.78, 0.85, 0.95),
};
const KICKER_TINT = new THREE.Color(0.86, 0.89, 0.97);
const LIP_TINT = new THREE.Color(0.55, 0.65, 0.88);
/** Wind-scoured rock showing through on the steepest faces: a cool gray-lavender, never black. */
const ROCK_TINT = new THREE.Color(0.52, 0.5, 0.58);

const GRID = {
  /** Spacing of the ribbon grid down and across a run (m). */
  along: 1.5,
  across: 1.27,
  /** How far past a run's edges and ends its ribbon reaches. */
  margin: 24,
  /** Rows per ribbon chunk. */
  chunkRows: 160,
  /** The forest grid: spacing, chunk size, and how far it sits below the runs. */
  world: 4,
  worldChunk: 320,
  worldSink: 0.3,
  /** A coarse apron reaching out under the far peaks, so the mountain never ends at a visible edge. */
  apron: 24,
  apronReach: 900,
  apronSink: 2.5,
};

/** Rock starts to show above this steepness (normal's up component), and is bare by `bare`. */
const ROCK = { from: 0.8, bare: 0.68 };

function tint(x: number, z: number, c: THREE.Color): THREE.Color {
  c.copy(SNOW_TINTS[snowAt(x, z)]);
  // Soft wind-carved variation so big sunlit faces aren't one flat color.
  const wind = 1 - 0.035 * (Math.sin(x * 0.21 + z * 0.13) * Math.sin(z * 0.37 - x * 0.05) + 1);
  c.multiplyScalar(wind);
  if (onKicker(x, z)) c.multiply(KICKER_TINT);
  if (isNearLip(x, z)) c.copy(LIP_TINT); // mark the lip so it's easy to time the pop
  return c;
}

/** A grid mesh from a function giving each vertex's (x, z). */
function grid(rows: number, cols: number, place: (r: number, k: number) => [number, number], sink = 0): THREE.Mesh['geometry'] {
  const positions = new Float32Array((rows + 1) * (cols + 1) * 3);
  const colors = new Float32Array((rows + 1) * (cols + 1) * 3);
  const c = new THREE.Color();
  for (let r = 0; r <= rows; r++) {
    for (let k = 0; k <= cols; k++) {
      const [x, z] = place(r, k);
      const i = (r * (cols + 1) + k) * 3;
      positions[i] = x;
      positions[i + 1] = heightAt(x, z) - sink;
      positions[i + 2] = z;
      tint(x, z, c);
      colors[i] = c.r;
      colors[i + 1] = c.g;
      colors[i + 2] = c.b;
    }
  }
  const index: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const a = r * (cols + 1) + k;
      const b = a + 1;
      const d = a + cols + 1;
      const e = d + 1;
      index.push(a, d, b, b, d, e); // counter-clockwise from above, so normals face up
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  // Bare rock where it's too steep to hold snow, from the mesh's own normals (cheaper than sampling).
  const normals = geo.attributes.normal.array;
  for (let i = 0; i < colors.length; i += 3) {
    const up = normals[i + 1];
    if (up >= ROCK.from) continue;
    c.setRGB(colors[i], colors[i + 1], colors[i + 2]).lerp(ROCK_TINT, Math.min(1, (ROCK.from - up) / (ROCK.from - ROCK.bare)));
    colors[i] = c.r;
    colors[i + 1] = c.g;
    colors[i + 2] = c.b;
  }
  return geo;
}

/** A run's ribbon, in chunks down the hill. Kettle keeps its original wide ribbon. */
function ribbon(run: RunInfo, material: THREE.Material): THREE.Mesh[] {
  const kettle = run.id === 'kettle';
  const W = kettle ? 95 : run.halfWidth + GRID.margin;
  const z0 = kettle ? -120 : run.z0 - GRID.margin;
  const z1 = kettle ? 1780 : run.z1 + GRID.margin;
  const rows = Math.ceil((z1 - z0) / GRID.along);
  const cols = Math.ceil((2 * W) / GRID.across);
  const meshes: THREE.Mesh[] = [];
  for (let r0 = 0; r0 < rows; r0 += GRID.chunkRows) {
    const n = Math.min(GRID.chunkRows, rows - r0);
    const geo = grid(n, cols, (r, k) => {
      const z = z0 + ((z1 - z0) * (r0 + r)) / rows;
      return [run.centerX(z) - W + (2 * W * k) / cols, z];
    });
    meshes.push(new THREE.Mesh(geo, material));
  }
  return meshes;
}

/** The forest and rock between the runs, as square chunks. */
function world(material: THREE.Material): THREE.Mesh[] {
  const B = MOUNTAIN_BOUNDS;
  const meshes: THREE.Mesh[] = [];
  const step = GRID.world;
  for (let cz = B.z0; cz < B.z1; cz += GRID.worldChunk) {
    for (let cx = B.x0; cx < B.x1; cx += GRID.worldChunk) {
      const rows = Math.ceil(Math.min(GRID.worldChunk, B.z1 - cz) / step);
      const cols = Math.ceil(Math.min(GRID.worldChunk, B.x1 - cx) / step);
      const geo = grid(rows, cols, (r, k) => [cx + k * step, cz + r * step], GRID.worldSink);
      meshes.push(new THREE.Mesh(geo, material));
    }
  }
  return meshes;
}

/** One coarse grid, well below the detailed ones, carrying the mountain out toward the horizon. */
function apron(material: THREE.Material): THREE.Mesh {
  const B = MOUNTAIN_BOUNDS;
  const x0 = B.x0 - GRID.apronReach;
  const z0 = B.z0 - GRID.apronReach;
  const cols = Math.ceil((B.x1 - B.x0 + 2 * GRID.apronReach) / GRID.apron);
  const rows = Math.ceil((B.z1 - B.z0 + 2 * GRID.apronReach) / GRID.apron);
  return new THREE.Mesh(grid(rows, cols, (r, k) => [x0 + k * GRID.apron, z0 + r * GRID.apron], GRID.apronSink), material);
}

export function buildMountain(material: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  for (const m of [...RUNS.flatMap((r) => ribbon(r, material)), ...world(material), apron(material)]) {
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}
