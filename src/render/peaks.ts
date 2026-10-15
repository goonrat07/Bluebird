import * as THREE from 'three';
import { addSurfaceDetail, rockAttribute } from './surfaceDetail';

/** `floor` keeps even the lowest cols high enough that the ring always closes the horizon. */
const PEAKS = { lift: 1.3, sink: 300, floor: 130 };
const RING = { segments: 640, rows: 48, inner: 900, outer: 1700 };

/** Snow holds where the face is gentler than this (normal's up component), fading out by `bare`. */
const HOLD = { snow: 0.74, bare: 0.55 };
const SNOW = new THREE.Color(0xf2f3f5);
/** Rock in two greys, laid down in strata so the cliffs read as layered stone. */
const ROCK_A = new THREE.Color(0x77736f);
const ROCK_B = new THREE.Color(0x5c5a5a);
/** The peaks take the scene's haze at this fraction of its density, so they fade toward the sky without vanishing. */
const HAZE = 0.35;

// Hash-based value noise, enough for ridges and gullies; the ring is sampled in world x/z, so it closes on itself.
function hash(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash(xi, zi);
  const b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1);
  const d = hash(xi + 1, zi + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
/**
 * Ridged multifractal: sharp crests where the noise crosses zero, and each octave weighted by the one above,
 * so detail gathers on the ridges and the valleys between stay smooth, like ground worn down by ice and water.
 */
function ridged(x: number, z: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let weight = 1;
  for (let o = 0; o < 6; o++) {
    let s = 1 - Math.abs(noise(x * freq + o * 17.3, z * freq - o * 9.1));
    s *= s * weight;
    weight = Math.min(1, s * 2);
    sum += s * amp;
    freq *= 2.05;
    amp *= 0.5;
  }
  return sum;
}

// A ring of distant peaks around the mountain: eroded ridgelines with gullies, snow on the gentler faces and
// ledges, layered rock on the steep ones, fading into the haze so the mountain has scale.
export function buildPeaks(center: THREE.Vector3): THREE.Mesh {
  const { segments, rows, inner, outer } = RING;
  const positions: number[] = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= segments; i++) {
      // The last column repeats the first exactly, so the ring closes without a crack.
      const a = ((i % segments) / segments) * Math.PI * 2;
      const r = inner + ((outer - inner) * j) / rows;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      // The massifs: a few broad mountains around the ring (whole-number frequencies, so it closes).
      const massif = Math.abs(Math.sin(a * 3 + 0.6)) * 200 + Math.abs(Math.sin(a * 7 + 2.1)) * 100 + 60;
      const relief = ridged(x / 360, z / 360);
      const fall = Math.sin(((r - inner) / (outer - inner)) * Math.PI); // rises from the inner edge, falls off behind
      // Tall enough to stand over Kettle Peak's summit, and sunk at the inner edge so no sky shows beneath.
      const h = (massif * (0.25 + 1.1 * relief) + relief * 180 + PEAKS.floor) * PEAKS.lift * fall - 120 - PEAKS.sink * (1 - fall);
      positions.push(center.x + x, center.y + h, center.z + z);
    }
  }
  const index: number[] = [];
  const w = segments + 1;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * w + i;
      index.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  // The ring closes on itself: give the seam's twin vertices one shared normal so no line shows.
  const n = geo.attributes.normal;
  for (let j = 0; j <= rows; j++) {
    const a = j * w;
    const b = a + segments;
    const v = new THREE.Vector3(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, v.x, v.y, v.z);
    n.setXYZ(b, v.x, v.y, v.z);
  }
  // Paint snow and rock from each vertex's own slope and height.
  const colors = new Float32Array(n.count * 3);
  const rock = new Float32Array(n.count);
  const c = new THREE.Color();
  for (let v = 0; v < n.count; v++) {
    const up = Math.abs(n.getY(v));
    const px = positions[v * 3] - center.x;
    const y = positions[v * 3 + 1] - center.y;
    const pz = positions[v * 3 + 2] - center.z;
    const strata = 0.5 + 0.5 * Math.sin(y * 0.06 + noise(px / 90, pz / 90) * 2);
    c.copy(ROCK_A).lerp(ROCK_B, strata);
    // Higher up, more of the face holds snow; noise breaks the snowline into gullies and wind-scoured ribs.
    const high = Math.min(1, Math.max(0, (y - 100) / 300)) * 0.15;
    const breakup = noise(px / 35, pz / 35) * 0.1 + noise(px / 9, pz / 9) * 0.05;
    const snow = Math.min(1, Math.max(0, (up + high + breakup - HOLD.bare) / (HOLD.snow - HOLD.bare)));
    c.lerp(SNOW, snow);
    colors.set([c.r, c.g, c.b], v * 3);
    rock[v] = 1 - snow;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  rockAttribute(geo, rock);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  // Rock grain in 40 m and 170 m tiles; no snow relief this far away.
  addSurfaceDetail(mat, { snow: [8, 30], rock: [40, 170], snowRelief: 0, rockRelief: 0.7, fade: [0, 1] }, (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_fragment>',
      `#ifdef USE_FOG
        float peakHaze = 1.0 - exp(-fogDensity * fogDensity * ${(HAZE * HAZE).toFixed(4)} * vFogDepth * vFogDepth);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, peakHaze);
      #endif`,
    );
  });
  return new THREE.Mesh(geo, mat);
}
