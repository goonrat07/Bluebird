import { TUNING } from './tuning';
import { SLOPE, heightAt, normalAt } from './terrain';
import type { RideInput } from './input';
import { type Vec3, add, dot, length, normalize, projectOnPlane, scale, sub, vec } from './vec';

export interface RiderState {
  pos: Vec3;
  vel: Vec3;
  /** Facing direction in radians around the vertical axis; 0 faces downhill (+z). */
  heading: number;
  grounded: boolean;
  airTime: number;
  jumpHeld: boolean;
}

export function createRider(): RiderState {
  const { x, z } = SLOPE.start;
  return { pos: vec(x, heightAt(x, z), z), vel: vec(), heading: 0, grounded: true, airTime: 0, jumpHeld: false };
}

export const speedOf = (r: RiderState): number => length(r.vel);

/** Advances the rider by one fixed step. Pure apart from mutating `r`, so the same inputs always give the same ride. */
export function stepRider(r: RiderState, input: RideInput, dt: number): void {
  const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);

  if (r.grounded) {
    const n = normalAt(r.pos.x, r.pos.z);
    const speed = length(r.vel);

    // Steering slows down as speed rises.
    const t = Math.min(1, speed / TUNING.maxTurnSpeed);
    const turnRate = TUNING.turnRate + (TUNING.turnRateHighSpeed - TUNING.turnRate) * t;
    r.heading -= steer * turnRate * dt;

    // Split velocity into along-the-board and sideways; edges scrub the sideways part (a crude skid).
    const facing = normalize(projectOnPlane(vec(Math.sin(r.heading), 0, Math.cos(r.heading)), n));
    const along = dot(r.vel, facing);
    const sideways = sub(r.vel, scale(facing, along));
    r.vel = add(scale(facing, along), scale(sideways, Math.exp(-TUNING.edgeGrip * dt)));

    // Snow friction and air drag oppose motion.
    const mu = input.brake ? TUNING.brakeFriction : TUNING.snowFriction;
    const drag = TUNING.airDrag * (input.tuck ? TUNING.tuckDragFactor : 1) * speed * speed;
    const decel = mu * TUNING.gravity * n.y + drag;
    const s = length(r.vel);
    if (s > 1e-6) r.vel = scale(r.vel, Math.max(0, s - decel * dt) / s);

    // Load on press, pop on release.
    if (input.jump) r.jumpHeld = true;
    else if (r.jumpHeld) {
      r.jumpHeld = false;
      r.vel = add(r.vel, scale(n, TUNING.jumpImpulse));
      r.grounded = false;
    }
  } else {
    r.heading -= steer * TUNING.airSpinRate * dt;
    r.airTime += dt;
    r.jumpHeld = input.jump;
  }

  r.vel = add(r.vel, vec(0, -TUNING.gravity * dt, 0));
  r.pos = add(r.pos, scale(r.vel, dt));

  const ground = heightAt(r.pos.x, r.pos.z);
  const n = normalAt(r.pos.x, r.pos.z);
  const intoGround = dot(r.vel, n);
  const wasGrounded = r.grounded;
  if (r.pos.y <= ground || (wasGrounded && r.pos.y - ground < TUNING.groundSnap && intoGround < 1.5)) {
    r.pos.y = ground;
    if (intoGround < 0) r.vel = sub(r.vel, scale(n, intoGround));
    if (!r.grounded) r.airTime = 0;
    r.grounded = true;
  } else {
    r.grounded = false;
  }
}
