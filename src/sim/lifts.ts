import type { RiderState } from './rider';
import { heightAt, snowAt } from './terrain';
import { type Vec3, vec } from './vec';

// Chairlifts: a straight cable between a bottom and a top station, carried on towers.
// Riding one is a little state machine stepped with the simulation, so it's deterministic too.

export interface LiftDef {
  id: string;
  name: string;
  /** Bottom and top bullwheels (x, z). */
  bottom: [number, number];
  top: [number, number];
  /** Where riders step off at the top, and which way they face (rad, like the rider's heading). */
  unload: [number, number];
  unloadHeading: number;
}

export interface Lift extends LiftDef {
  /** Horizontal length of the line (m). */
  length: number;
  /** Horizontal unit direction from bottom to top. */
  dir: { x: number; z: number };
  /** Heading of a chair going up the line. */
  heading: number;
  /** Tops of the towers (stations included at each end), by distance along the line. */
  towers: { s: number; top: Vec3; ground: number }[];
}

export const LIFT = {
  /** Cable speed (m/s); holding W hurries it along (the game skips the dull part of the ride). */
  speed: 6,
  hurry: 5,
  /** How close (m) and how slow (m/s) to be at the loading spot to get on. */
  boardRadius: 9,
  boardSpeed: 6,
  loadAhead: 7,
  /** Chair seat below the cable, and the least clearance over the snow between towers. */
  hang: 2.4,
  clearance: 5,
  towerHeight: 11,
  towerSpacing: 110,
  stationHeight: 5,
  /** Speed riders leave the top with. */
  unloadSpeed: 3,
};

const DEFS: LiftDef[] = [
  {
    id: 'express',
    name: 'Kettle Express',
    // Up the skier's right of Kettle Run, clear of the glade on the left.
    bottom: [-46, 1500],
    top: [-42, -8],
    unload: [-30, 2],
    unloadHeading: 0.35,
  },
  {
    id: 'summit',
    name: 'Summit Chair',
    // Loads just below where the Express drops you off.
    bottom: [-30, 34],
    top: [8, -462],
    unload: [0, -450],
    unloadHeading: -0.4,
  },
];

function build(d: LiftDef): Lift {
  const dx = d.top[0] - d.bottom[0];
  const dz = d.top[1] - d.bottom[1];
  const length = Math.hypot(dx, dz);
  const dir = { x: dx / length, z: dz / length };
  const at = (s: number): [number, number] => [d.bottom[0] + dir.x * s, d.bottom[1] + dir.z * s];
  const ground = (s: number) => heightAt(...at(s));
  const n = Math.max(1, Math.round(length / LIFT.towerSpacing));
  const towers = Array.from({ length: n + 1 }, (_, i) => {
    const s = (length * i) / n;
    const end = i === 0 || i === n;
    const [x, z] = at(s);
    const g = heightAt(x, z);
    return { s, ground: g, top: vec(x, g + (end ? LIFT.stationHeight : LIFT.towerHeight), z) };
  });
  // Raise towers until the seats clear the snow everywhere along the span.
  for (let pass = 0; pass < 20; pass++) {
    let lifted = false;
    for (let i = 1; i < towers.length; i++) {
      const a = towers[i - 1];
      const b = towers[i];
      let need = 0;
      for (let s = a.s; s <= b.s; s += 2) {
        const y = a.top.y + ((b.top.y - a.top.y) * (s - a.s)) / (b.s - a.s) - LIFT.hang;
        need = Math.max(need, ground(s) + LIFT.clearance - y);
      }
      if (need > 0) {
        // Lift whichever end isn't a station (or both, if neither is).
        if (i - 1 > 0) a.top.y += need;
        if (i < towers.length - 1) b.top.y += need;
        lifted = true;
      }
    }
    if (!lifted) break;
  }
  return { ...d, length, dir, heading: Math.atan2(dir.x, dir.z), towers };
}

export const LIFTS: readonly Lift[] = DEFS.map(build);

/** Point on the cable at distance s up the line. */
export function cablePoint(lift: Lift, s: number): Vec3 {
  const t = lift.towers;
  let i = 1;
  while (i < t.length - 1 && t[i].s < s) i++;
  const a = t[i - 1];
  const b = t[i];
  const f = Math.min(1, Math.max(0, (s - a.s) / (b.s - a.s)));
  return vec(a.top.x + (b.top.x - a.top.x) * f, a.top.y + (b.top.y - a.top.y) * f, a.top.z + (b.top.z - a.top.z) * f);
}

/** Where a rider sits on a chair at distance s up the line. */
export const seatPoint = (lift: Lift, s: number): Vec3 => {
  const p = cablePoint(lift, s);
  return vec(p.x, p.y - LIFT.hang, p.z);
};

/** Where riders get on: under the cable just up the line from the bottom station, so they arrive from above. */
export const loadingSpot = (lift: Lift): Vec3 => {
  const x = lift.bottom[0] + lift.dir.x * LIFT.loadAhead;
  const z = lift.bottom[1] + lift.dir.z * LIFT.loadAhead;
  return vec(x, heightAt(x, z), z);
};

/** The lift a rider could get on right now, if any. */
export function liftToBoard(pos: Vec3, speed: number): Lift | null {
  if (speed > LIFT.boardSpeed) return null;
  for (const lift of LIFTS) {
    const p = loadingSpot(lift);
    if (Math.hypot(pos.x - p.x, pos.z - p.z) < LIFT.boardRadius) return lift;
  }
  return null;
}

export interface LiftRide {
  lift: Lift;
  /** Distance up the line (m). */
  s: number;
}

export const boardLift = (lift: Lift): LiftRide => ({ lift, s: LIFT.loadAhead });

/** Moves a rider up the line one step; returns true once they've reached the top. */
export function stepLift(ride: LiftRide, r: RiderState, hurry: boolean, dt: number): boolean {
  ride.s = Math.min(ride.lift.length, ride.s + LIFT.speed * (hurry ? LIFT.hurry : 1) * dt);
  r.pos = seatPoint(ride.lift, ride.s);
  r.vel = vec();
  r.heading = ride.lift.heading;
  r.grounded = false;
  return ride.s >= ride.lift.length;
}

/** Sets a rider down on the snow at the top of a lift, gliding away from the station. */
export function unloadRider(r: RiderState, lift: Lift): void {
  const [x, z] = lift.unload;
  r.pos = vec(x, heightAt(x, z), z);
  r.heading = lift.unloadHeading;
  const v = LIFT.unloadSpeed;
  r.vel = vec(Math.sin(r.heading) * v, 0, Math.cos(r.heading) * v);
  r.grounded = true;
  r.crashed = false;
  r.snow = snowAt(x, z);
  r.safeSpots = [{ pos: { ...r.pos }, heading: r.heading }];
}
