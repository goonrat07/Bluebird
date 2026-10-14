import { centerX, heightAt } from './terrain';
import { type Vec3, length, normalize, scale, sub, add, vec } from './vec';

// The park line's rails and boxes, in a lane on the skier's left of the kickers.
// Each one is a straight bar between two points a set height above the snow.

export interface RailDef {
  name: string;
  /** Distance down the run where it starts and ends. */
  z0: number;
  z1: number;
  /** Distance across the run from the centerline. */
  u: number;
  /** Height of the top above the snow (m). Boxes sit low enough to ride straight onto. */
  height: number;
  kind: 'box' | 'rail';
}

export interface Rail extends RailDef {
  start: Vec3;
  end: Vec3;
  /** Unit vector from start to end. */
  dir: Vec3;
  length: number;
  /** Heading (rad) of the rail, measured the same way as the rider's. */
  heading: number;
}

export const RAIL_DEFS: readonly RailDef[] = [
  { name: 'Box', z0: 850, z1: 866, u: 13, height: 0.35, kind: 'box' },
  { name: 'Flat rail', z0: 936, z1: 956, u: 13, height: 0.75, kind: 'rail' },
  { name: 'Long rail', z0: 1018, z1: 1048, u: 13, height: 0.85, kind: 'rail' },
];

function build(d: RailDef): Rail {
  const x0 = centerX(d.z0) + d.u;
  const x1 = centerX(d.z1) + d.u;
  const start = vec(x0, heightAt(x0, d.z0) + d.height, d.z0);
  const end = vec(x1, heightAt(x1, d.z1) + d.height, d.z1);
  const span = sub(end, start);
  return { ...d, start, end, dir: normalize(span), length: length(span), heading: Math.atan2(span.x, span.z) };
}

export const RAILS: readonly Rail[] = RAIL_DEFS.map(build);

/** Point on a rail's top at distance t from its start. */
export const railPoint = (rail: Rail, t: number): Vec3 => add(rail.start, scale(rail.dir, t));

/** Where a point sits relative to a rail: distance along it, sideways from it (horizontal), and height above its top. */
export function railOffset(rail: Rail, p: Vec3): { t: number; side: number; above: number } {
  const d = sub(p, rail.start);
  const flat = Math.hypot(rail.dir.x, rail.dir.z);
  const hx = rail.dir.x / flat;
  const hz = rail.dir.z / flat;
  const along = d.x * hx + d.z * hz;
  const t = along / flat;
  const side = d.x * hz - d.z * hx;
  const above = p.y - railPoint(rail, t).y;
  return { t, side, above };
}
