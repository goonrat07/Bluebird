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

/** Where Kettle Run begins, just above the top station. */
const KETTLE_TOP = -40;

/** Rise of a run's banks at distance e (m) beyond its edge: curving up, then a steady forest slope. */
const BANK = { curve: 0.03, until: 10 };
const bank = (e: number): number =>
  e < BANK.until
    ? e * e * BANK.curve
    : BANK.until * BANK.until * BANK.curve + 2 * BANK.curve * BANK.until * (e - BANK.until);

/** Kettle Run's snow: its pitch, the dish across it, rollers, the kickers and its banks. */
export function kettleSurface(x: number, z: number): number {
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
  // Banks rise beyond the corridor and keep riders on the mountain; above the top station the
  // mountain climbs on toward the summit chutes.
  const edge = Math.max(0, Math.abs(u) - RUN.halfWidth);
  const above = Math.max(0, KETTLE_TOP - z);
  return base + dish + rollers + kicker + bank(edge) + bank(above) * 2;
}

// ---------------------------------------------------------------------------------------------
// The rest of Kettle Peak: more runs carved into the mountain around Kettle Run.
// Each run is a valley along its own winding centerline with its own pitch; between runs the
// mountain is a smooth forested surface a little above the runs nearby, so you can ride
// from one run through the trees into the next.

export type Difficulty = 'green' | 'blue' | 'black';

interface RunSpec {
  id: string;
  name: string;
  difficulty: Difficulty;
  /** Centerline x at points down the hill. */
  center: [z: number, x: number][];
  /** Pitch (degrees, down the hill) at points, for runs that start on their own. */
  profile?: [z: number, gradeDeg: number][];
  /** For runs that leave and rejoin Kettle Run: height above Kettle's pitch at points down the hill. */
  offset?: [z: number, m: number][];
  z0: number;
  z1: number;
  halfWidth: number;
  groomedHalfWidth: number;
  /** Runs whose snow this one meets at its top and/or bottom. */
  joinStart?: string;
  joinEnd?: string;
}

const SPECS: RunSpec[] = [
  {
    id: 'cornice',
    name: 'Cornice Chute',
    difficulty: 'black',
    center: [[-400, 70], [-250, 55], [-120, 32], [-30, 14]],
    profile: [[-400, 34], [-300, 36], [-170, 32], [-80, 22], [-30, 14]],
    z0: -400,
    z1: -30,
    halfWidth: 16,
    groomedHalfWidth: 0,
    joinEnd: 'kettle',
  },
  {
    id: 'couloir',
    name: 'Kettle Couloir',
    difficulty: 'black',
    center: [[-400, -60], [-260, -52], [-130, -32], [-30, -14]],
    profile: [[-400, 38], [-280, 40], [-150, 33], [-80, 22], [-30, 14]],
    z0: -400,
    z1: -30,
    halfWidth: 12,
    groomedHalfWidth: 0,
    joinEnd: 'kettle',
  },
  {
    id: 'raven',
    name: "Raven's Drop",
    difficulty: 'black',
    // A long traverse holds height while Kettle drops away, then the face falls steeply back down.
    center: [[120, 36], [220, 84], [330, 125], [600, 138], [900, 125], [1040, 75], [1110, 38]],
    offset: [[120, 0], [300, 20], [430, 32], [470, 33], [650, -2], [900, 0], [1110, 0]],
    z0: 120,
    z1: 1110,
    halfWidth: 30,
    groomedHalfWidth: 0,
    joinStart: 'kettle',
    joinEnd: 'kettle',
  },
  {
    id: 'fernwood',
    name: 'Fernwood',
    difficulty: 'green',
    center: [[870, -24], [960, -70], [1080, -120], [1200, -145], [1320, -130], [1440, -95], [1520, -50]],
    offset: [[870, 0], [1000, 6], [1150, 12], [1400, 10], [1520, 0]],
    z0: 870,
    z1: 1520,
    halfWidth: 30,
    groomedHalfWidth: 26,
    joinStart: 'kettle',
    joinEnd: 'kettle',
  },
];

/** A run other than Kettle, with its centerline and pitch baked into 1 m tables. */
class Run {
  readonly id: string;
  readonly name: string;
  readonly difficulty: Difficulty;
  readonly z0: number;
  readonly z1: number;
  readonly halfWidth: number;
  readonly groomedHalfWidth: number;
  private readonly from: number;
  private readonly cx: Float64Array;
  /** cos of the centerline's angle to the fall line, so widths are measured square to the run. */
  private readonly square: Float64Array;
  private readonly hc: Float64Array;

  constructor(spec: RunSpec, surfaceOf: (id: string) => (x: number, z: number) => number) {
    this.id = spec.id;
    this.name = spec.name;
    this.difficulty = spec.difficulty;
    this.z0 = spec.z0;
    this.z1 = spec.z1;
    this.halfWidth = spec.halfWidth;
    this.groomedHalfWidth = spec.groomedHalfWidth;
    this.from = spec.z0 - 1;
    const n = spec.z1 - spec.z0 + 3;
    this.cx = new Float64Array(n);
    this.square = new Float64Array(n);
    this.hc = new Float64Array(n);
    for (let i = 0; i < n; i++) this.cx[i] = blend(spec.center, this.from + i);
    for (let i = 0; i < n; i++) {
      const slope = (this.cx[Math.min(n - 1, i + 1)] - this.cx[Math.max(0, i - 1)]) / 2;
      this.square[i] = 1 / Math.hypot(1, slope);
    }
    if (spec.offset) {
      // Follow Kettle's pitch, offset, then bend the ends to meet Kettle's snow exactly.
      for (let i = 0; i < n; i++) this.hc[i] = profileHeight(this.from + i) + blend(spec.offset, this.from + i);
    } else {
      for (let i = 1; i < n; i++) this.hc[i] = this.hc[i - 1] - Math.tan((blend(spec.profile!, this.from + i - 0.5) * Math.PI) / 180);
    }
    const at = (z: number) => this.hc[Math.round(z - this.from)];
    const target = (id: string, z: number) => surfaceOf(id)(this.centerX(z), z);
    const a = spec.joinStart ? target(spec.joinStart, spec.z0) - at(spec.z0) : null;
    const b = spec.joinEnd ? target(spec.joinEnd, spec.z1) - at(spec.z1) : null;
    for (let i = 0; i < n; i++) {
      const t = Math.min(1, Math.max(0, (this.from + i - spec.z0) / (spec.z1 - spec.z0)));
      this.hc[i] += a !== null && b !== null ? a + (b - a) * t : (a ?? b ?? 0);
    }
  }

  private index(z: number): number {
    return Math.min(this.cx.length - 1, Math.max(0, Math.round(z - this.from)));
  }

  centerX(z: number): number {
    return this.cx[this.index(z)];
  }

  /** Distance across the run from its centerline (positive = skier's left). */
  lateral(x: number, z: number): number {
    const i = this.index(z);
    return (x - this.cx[i]) * this.square[i];
  }

  centerHeight(z: number): number {
    return this.hc[this.index(z)];
  }

  /** How far outside the run's corridor a point is (negative inside), counting past its ends too. */
  outside(x: number, z: number): number {
    const across = Math.abs(this.lateral(x, z)) - this.halfWidth;
    const along = Math.max(this.z0 - z, z - this.z1, 0);
    return along > 0 ? Math.max(across, 0) + along : across;
  }

  surface(x: number, z: number): number {
    const u = this.lateral(x, z);
    const dish = 0.0018 * Math.min(u * u, this.halfWidth * this.halfWidth);
    const rollers = 0.6 * Math.sin(z * 0.05 + this.halfWidth) * Math.cos(u * 0.04);
    const edge = Math.max(0, Math.abs(u) - this.halfWidth);
    // Past its ends the run closes up, so it doesn't carry on as a valley.
    const past = Math.max(this.z0 - z, z - this.z1, 0);
    return this.centerHeight(z) + dish + rollers + bank(edge) + bank(past) * 2;
  }
}

/** Kettle Run, described the same way as the others for the trail map and the forest. */
export interface RunInfo {
  id: string;
  name: string;
  difficulty: Difficulty;
  halfWidth: number;
  groomedHalfWidth: number;
  z0: number;
  z1: number;
  centerX: (z: number) => number;
  lateral: (x: number, z: number) => number;
  centerHeight: (z: number) => number;
  outside: (x: number, z: number) => number;
}

const KETTLE: RunInfo = {
  id: 'kettle',
  name: 'Kettle Run',
  difficulty: 'blue',
  halfWidth: RUN.halfWidth,
  groomedHalfWidth: RUN.groomedHalfWidth,
  z0: KETTLE_TOP,
  z1: 1800,
  centerX,
  lateral,
  centerHeight: profileHeight,
  outside: (x, z) => {
    const across = Math.abs(lateral(x, z)) - RUN.halfWidth;
    const along = KETTLE_TOP - z;
    return along > 0 ? Math.max(across, 0) + along : across;
  },
};

const OTHERS: Run[] = [];
for (const spec of SPECS) {
  OTHERS.push(new Run(spec, (id) => (id === 'kettle' ? kettleSurface : OTHERS.find((r) => r.id === id)!.surface.bind(OTHERS.find((r) => r.id === id)!))));
}

/** Every run on Kettle Peak. */
export const RUNS: readonly RunInfo[] = [KETTLE, ...OTHERS];

/** Height of the mountain between runs above the runs nearby, and how it rises away from them. */
const MOUNTAIN = { lift: 12, rise: 0.3, smooth: 4 };

/** The forested mountain surface: blended from the runs nearby, a little above them. */
function mountain(x: number, z: number): number {
  let sum = 0;
  let weight = 0;
  for (const r of RUNS) {
    const d = Math.max(0, r.outside(x, z));
    const w = 1 / (d * d + 25);
    const zc = Math.min(r.z1, Math.max(r.z0, z));
    sum += w * (r.centerHeight(zc) + MOUNTAIN.lift + MOUNTAIN.rise * d);
    weight += w;
  }
  return sum / weight;
}

/** Smooth minimum: like Math.min, but rounds off the crease where two surfaces meet. */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
}

/** Kettle Run's snow is kept exactly as designed this far in from its edges; the branches open up beyond. */
const KETTLE_KEEP = { inset: 10, below: KETTLE_TOP + 20 };

export function heightAt(x: number, z: number): number {
  const kettle = kettleSurface(x, z);
  let h = kettle;
  for (const r of OTHERS) {
    // Far from a run, its valley can't be the lowest surface; skip the work.
    if (r.outside(x, z) > 90) continue;
    h = smin(h, r.surface(x, z), MOUNTAIN.smooth);
  }
  h = smin(h, mountain(x, z), MOUNTAIN.smooth);
  if (z < KETTLE_KEEP.below) return h;
  const keep = RUN.halfWidth - KETTLE_KEEP.inset;
  const t = Math.min(1, Math.max(0, (Math.abs(lateral(x, z)) - keep) / KETTLE_KEEP.inset));
  return kettle + (h - kettle) * smooth(t);
}

/** The run a point is on or nearest to, and how far across it the point is. */
export function runAt(x: number, z: number): { run: RunInfo; u: number; outside: number } {
  let best = RUNS[0];
  let out = best.outside(x, z);
  for (const r of OTHERS) {
    const o = r.outside(x, z);
    if (o < out) {
      best = r;
      out = o;
    }
  }
  return { run: best, u: best.lateral(x, z), outside: out };
}

/** The whole mountain's extent, for the terrain mesh and the forest. */
export const MOUNTAIN_BOUNDS = { x0: -280, x1: 320, z0: -470, z1: 1760 };

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
  const { run, u } = runAt(x, z);
  if (Math.abs(u) > run.groomedHalfWidth) return 'powder';
  // Icy patches on the skier's right of Kettle Run's groomer, scraped off on the steeper pitches.
  if (run.id === 'kettle' && u < -6 && u > -20 && Math.sin(z * 0.021) > 0.8) return 'ice';
  return 'groomed';
}

START.x = centerX(START.z);
START.y = heightAt(START.x, START.z);
