import type { RiderState } from './rider';
import { KICKERS, centerX, isNearLip } from './terrain';
import { RAILS, railOffset } from './rails';
import { noInput, type RideInput } from './input';

// Scripted riders: they read the rider's state and press keys, exactly like a player.
// They ride the rival ghosts in events and drive the tests that check events can be won.

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const travel = (r: RiderState): number => (Math.hypot(r.vel.x, r.vel.z) > 0.5 ? Math.atan2(r.vel.x, r.vel.z) : r.heading);

/** Steers toward a point `ahead` metres down the hill, `u` metres off the centerline. */
function steer(r: RiderState, u: number, ahead = 14): Pick<RideInput, 'left' | 'right'> {
  const z = r.pos.z + ahead;
  const want = Math.atan2(centerX(z) + u - r.pos.x, ahead);
  const err = wrap(want - travel(r));
  return { left: err > 0.04, right: err < -0.04 };
}

/** Keeps balance on a rail by leaning back toward the middle. */
function balance(r: RiderState): Pick<RideInput, 'left' | 'right'> {
  const tip = r.rail!.balance + 0.25 * r.rail!.balanceVel;
  return { left: tip < -0.08, right: tip > 0.08 };
}

/**
 * Slopestyle: a 360 off the first kicker, across to the flat rail for a 50-50, back for a 540
 * with a grab off the big kicker. Spins alternate direction so nothing repeats.
 */
export function slopestyleBot(): (r: RiderState) => RideInput {
  const flatRail = RAILS.find((x) => x.name === 'Flat rail')!;
  // The features in order: kickers by index, then the rail between them.
  const plan: ({ kicker: number; turns: number; grab?: boolean } | { rail: typeof flatRail })[] = [
    { kicker: 1, turns: 2 },
    { rail: flatRail },
    { kicker: 3, turns: 3, grab: true },
  ];
  let step = 0;
  let spinning = false;
  let dir = 1;
  let target = 0;
  let grab = false;
  return (r) => {
    const input = noInput();
    if (r.rail) return { ...input, ...balance(r) };
    if (!r.grounded) {
      if (!spinning && r.air.airTime < 0.05) {
        // In the air off the feature we were riding at (dropping off a rail: no spin).
        spinning = true;
        const now = plan[step];
        const kicker = now && 'kicker' in now && !r.air.rail;
        target = kicker ? now.turns * Math.PI - 0.5 : 0;
        grab = kicker && !!now.grab;
        if (kicker) dir = -dir;
      }
      if (spinning && Math.abs(r.air.spin) < target) {
        if (dir > 0) input.left = true;
        else input.right = true;
      } else if (grab && r.vel.y > 1) {
        // Spin's done before the peak: a quick grab, let go well before landing.
        input.grab = true;
      }
      return input;
    }
    spinning = false;
    // Move on once a feature is behind us.
    const feature = plan[step];
    if (feature && 'kicker' in feature && r.pos.z > KICKERS[feature.kicker].z + KICKERS[feature.kicker].length + 1) step++;
    if (feature && 'rail' in feature && railOffset(feature.rail, r.pos).t > 2) step++;
    const now = plan[step];
    if (!now) return { ...input, ...steer(r, 0) };
    if ('kicker' in now) {
      const k = KICKERS[now.kicker];
      Object.assign(input, steer(r, k.u));
      // Load the pop on the ramp and let go at the lip.
      input.jump = r.pos.z > k.z + 2 && r.pos.z < k.z + k.length + 1 && !isNearLip(r.pos.x, r.pos.z);
      return input;
    }
    const o = railOffset(now.rail, r.pos);
    Object.assign(input, steer(r, now.rail.u, 12));
    // Ride in square to the rail and pop just before it.
    input.jump = o.t > -7 && o.t < -2.4;
    return input;
  };
}

/** Glade dash: aims down the middle of the glade and tucks; gap sense threads the trunks. */
export function treeRunBot(lane = 36): (r: RiderState) => RideInput {
  return (r) => ({ ...noInput(), ...steer(r, lane, 12), up: true });
}
