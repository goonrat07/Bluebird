import type { RideInput } from './input';
import { groundAt, pushOutOfWalls } from './village';

// On foot: out of your bindings, gear over your shoulder. A/D turn, W walks, S steps back.

export const WALK = {
  speed: 1.8,
  backSpeed: 0.9,
  turnRate: 2.6,
  /** Shoulder width, for bumping into walls. */
  radius: 0.35,
  /** Steps per metre, for the walk cycle. */
  stride: 1.4,
};

export interface WalkState {
  x: number;
  z: number;
  y: number;
  heading: number;
  /** Walk-cycle phase (rad); advances only while moving. */
  phase: number;
  speed: number;
}

export function startWalking(x: number, z: number, heading: number): WalkState {
  return { x, z, y: groundAt(x, z), heading, phase: 0, speed: 0 };
}

export function stepWalk(w: WalkState, input: RideInput, dt: number): void {
  w.heading += ((input.left ? 1 : 0) - (input.right ? 1 : 0)) * WALK.turnRate * dt;
  w.speed = input.up ? WALK.speed : input.down ? -WALK.backSpeed : 0;
  w.x += Math.sin(w.heading) * w.speed * dt;
  w.z += Math.cos(w.heading) * w.speed * dt;
  const hit = pushOutOfWalls(w.x, w.z, WALK.radius);
  if (hit) {
    w.x = hit.x;
    w.z = hit.z;
  }
  w.y = groundAt(w.x, w.z);
  w.phase += Math.abs(w.speed) * dt * WALK.stride * Math.PI;
}
