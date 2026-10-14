import { AIR, ASSIST, CRASH, FLOW, GAP, RIDE, SNOW, SPORTS, WORLD, type AssistLevel, type SnowType, type Sport } from './tuning';
import { START, heightAt, isNearLip, normalAt, snowAt } from './terrain';
import { TRUNK_RADIUS, treesNear, treesWithin } from './trees';
import { type AirLog, type GrabDir, type LandingQuality, type Trick, grabName, scoreTrick } from './tricks';
import type { RideInput } from './input';
import { type Vec3, add, dot, length, normalize, projectOnPlane, scale, sub, vec } from './vec';

interface SafeSpot {
  pos: Vec3;
  heading: number;
}

export interface RiderState {
  sport: Sport;
  assist: AssistLevel;
  pos: Vec3;
  vel: Vec3;
  /** Which way the equipment points, in radians around the vertical axis; 0 faces downhill (+z). */
  heading: number;
  /** -1..1: how far the rider is on edge; positive turns left. */
  edge: number;
  grounded: boolean;
  snow: SnowType;
  skidding: boolean;
  braking: boolean;
  tucking: boolean;

  /** 0..1 while Space is held on the snow. */
  charge: number;
  jumpHeld: boolean;
  /** Counts down after passing a kicker lip; a pop released while positive gets the lip bonus. */
  lipTimer: number;
  skateTimer: number;

  /** Flip angle (rad) for drawing; 0 = upright. */
  pitch: number;
  spinVel: number;
  flipVel: number;
  grab: string | null;
  air: AirLog;

  crashed: boolean;
  crashTimer: number;
  safeSpots: SafeSpot[];
  safeTimer: number;

  lastTrick: Trick | null;
  /** Increments every time a jump ends (trick, bail or nothing), so the HUD can spot new results. */
  landings: number;
  /** 0..1 Flow meter from near misses with trees. */
  flow: number;
  /** Seconds since the last near miss (Flow drains once this passes the grace time). */
  flowIdle: number;
  /** Increments every time the rider clips branches (the camera gets a face full of snow). */
  branchHits: number;
  /** The tree whose branches were last clipped, so one tree only counts once per pass. */
  lastBranchTree: number;
  time: number;
}

const emptyAirLog = (): AirLog => ({ spin: 0, flip: 0, grab: null, grabTime: 0, airTime: 0, switchTakeoff: false });

export function createRider(sport: Sport = 'board', assist: AssistLevel = 'normal'): RiderState {
  const { x, z } = START;
  const pos = vec(x, heightAt(x, z), z);
  return {
    sport,
    assist,
    pos,
    vel: vec(),
    heading: 0,
    edge: 0,
    grounded: true,
    snow: snowAt(x, z),
    skidding: false,
    braking: false,
    tucking: false,
    charge: 0,
    jumpHeld: false,
    lipTimer: 0,
    skateTimer: 0,
    pitch: 0,
    spinVel: 0,
    flipVel: 0,
    grab: null,
    air: emptyAirLog(),
    crashed: false,
    crashTimer: 0,
    safeSpots: [{ pos: { ...pos }, heading: 0 }],
    safeTimer: 0,
    lastTrick: null,
    landings: 0,
    flow: 0,
    flowIdle: 0,
    branchHits: 0,
    lastBranchTree: -1,
    time: 0,
  };
}

export const speedOf = (r: RiderState): number => length(r.vel);

const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const facingOf = (heading: number): Vec3 => vec(Math.sin(heading), 0, Math.cos(heading));
const approach = (v: number, target: number, maxDelta: number): number =>
  v < target ? Math.min(target, v + maxDelta) : Math.max(target, v - maxDelta);

/** Heading of horizontal travel, or the current heading when barely moving. */
function travelHeading(r: RiderState): number {
  return Math.hypot(r.vel.x, r.vel.z) > 0.5 ? Math.atan2(r.vel.x, r.vel.z) : r.heading;
}

/** True when moving backwards relative to where the equipment points. */
export function isSwitch(r: RiderState): boolean {
  return dot(r.vel, facingOf(r.heading)) < -0.5;
}

/** Advances the rider by one fixed step. Deterministic: the same inputs always give the same ride. */
export function stepRider(r: RiderState, input: RideInput, dt: number): void {
  r.time += dt;
  if (r.crashed) stepCrashed(r, dt);
  else if (r.grounded) stepGround(r, input, dt);
  else stepAir(r, input, dt);

  r.vel = add(r.vel, vec(0, -WORLD.gravity * dt, 0));
  r.pos = add(r.pos, scale(r.vel, dt));
  collideTrees(r);
  updateFlow(r, dt);
  resolveGround(r);
}

function stepGround(r: RiderState, input: RideInput, dt: number): void {
  const sport = SPORTS[r.sport];
  const n = normalAt(r.pos.x, r.pos.z);
  const snow = SNOW[r.snow];
  const speed = length(r.vel);

  // Edge builds up while a key is held and flattens when released: holding longer turns harder.
  const target = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const rampTime = target !== 0 && Math.sign(target) === Math.sign(r.edge || target) ? sport.edgeRampTime : sport.edgeReleaseTime;
  r.edge = approach(r.edge, target, dt / rampTime);

  // Carved turn radius shrinks with edge angle; at low speed the rider can pivot instead.
  const edgeRad = (Math.abs(r.edge) * sport.maxEdgeDeg * Math.PI) / 180;
  const carveRate = (speed * Math.sin(edgeRad)) / sport.sidecutRadius;
  const pivot = sport.pivotRate * Math.abs(r.edge) * Math.max(0, 1 - speed / 8);
  r.tucking = input.up && !(r.sport === 'ski' && speed < RIDE.skateMaxSpeed);
  let turnRate = Math.min(sport.maxTurnRate, Math.max(carveRate, pivot));
  if (r.tucking) turnRate *= 0.6;
  r.heading = wrapAngle(r.heading + Math.sign(r.edge) * turnRate * dt);

  // Split velocity into along-the-equipment and sideways (riding switch counts as along).
  const facing = normalize(projectOnPlane(facingOf(r.heading), n));
  const along = dot(r.vel, facing);
  const travel = along >= 0 ? facing : scale(facing, -1);
  const alongMag = Math.abs(along);
  const lateral = sub(projectOnPlane(r.vel, n), scale(facing, along));
  const latMag = length(lateral);

  // Edges grip up to a limit; within it sideways motion is carved into forward motion
  // (keeping speed), past it the rider skids and scrubs speed.
  const gripLimit = snow.grip * WORLD.gravity * n.y * (0.35 + 0.65 * Math.abs(r.edge));
  const removed = Math.min(latMag, gripLimit * dt);
  const latLeft = latMag - removed;
  const newAlong = Math.sqrt(alongMag * alongMag + (latMag * latMag - latLeft * latLeft) * sport.carveEfficiency);
  const normalPart = scale(n, dot(r.vel, n));
  const newLat = latMag > 1e-9 ? scale(lateral, latLeft / latMag) : vec();
  r.vel = add(add(scale(travel, newAlong), newLat), normalPart);
  r.braking = input.down;
  r.skidding = r.braking || latLeft > 1.0;

  // Friction, air drag and powder all slow the rider down.
  const sink = snow.sinkDrag * (1.5 - sport.powderFloat * Math.min(1, speed / 12));
  const mu = r.braking ? RIDE.brakeFriction : snow.friction * sport.frictionScale + sink;
  const flowEase = 1 - FLOW.speedBoost * r.flow;
  const drag = sport.airDrag * (r.tucking ? sport.tuckDrag : 1) * speed * speed * flowEase;
  const scrub = latLeft * 1.5;
  const decel = mu * flowEase * WORLD.gravity * n.y + drag + scrub;
  const s = length(r.vel);
  if (s > 1e-6) r.vel = scale(r.vel, Math.max(0, s - decel * dt) / s);

  gapSense(r, dt);

  // Skiers skate on the flats with W.
  r.skateTimer -= dt;
  if (r.sport === 'ski' && input.up && speed < RIDE.skateMaxSpeed && r.skateTimer <= 0) {
    r.vel = add(r.vel, scale(travel, sport.skatePush));
    r.skateTimer = RIDE.skateInterval;
  }

  // Hold Space to load up, release to pop; releasing right at a kicker lip pops higher.
  r.lipTimer = isNearLip(r.pos.x, r.pos.z) ? RIDE.lipWindow : r.lipTimer - dt;
  if (input.jump) {
    r.jumpHeld = true;
    r.charge = Math.min(1, r.charge + dt / RIDE.popChargeTime);
  } else if (r.jumpHeld) {
    const pop = RIDE.popMin + (RIDE.popMax - RIDE.popMin) * r.charge + (r.lipTimer > 0 ? RIDE.lipBonus : 0);
    r.vel = add(r.vel, scale(n, pop));
    r.jumpHeld = false;
    r.charge = 0;
    takeOff(r);
  }

  // Remember recent safe spots to reset to.
  r.safeTimer += dt;
  if (r.safeTimer >= 1 && speed > 2) {
    r.safeTimer = 0;
    r.safeSpots.push({ pos: { ...r.pos }, heading: travelHeading(r) });
    if (r.safeSpots.length > 3) r.safeSpots.shift();
  }
}

function takeOff(r: RiderState): void {
  r.grounded = false;
  r.air = emptyAirLog();
  r.air.switchTakeoff = isSwitch(r);
  r.spinVel = r.edge * AIR.prewind;
  r.edge = 0;
  r.flipVel = 0;
  r.grab = null;
  r.charge = 0;
}

function grabDirection(input: RideInput): GrabDir {
  if (input.up) return 'up';
  if (input.down) return 'down';
  if (input.left) return 'left';
  if (input.right) return 'right';
  return 'none';
}

function stepAir(r: RiderState, input: RideInput, dt: number): void {
  r.air.airTime += dt;
  const airSpeed = length(r.vel);
  const airDrag = SPORTS[r.sport].airDrag * airSpeed * airSpeed;
  if (airSpeed > 1e-6) r.vel = scale(r.vel, Math.max(0, airSpeed - airDrag * dt) / airSpeed);
  r.jumpHeld = false;
  if (input.grab) {
    // Grabbing locks in whatever rotation is already going; direction keys pick the grab.
    const name = grabName(r.sport, grabDirection(input));
    if (r.grab !== name) r.air.grabTime = 0;
    r.grab = name;
    r.air.grab = name;
    r.air.grabTime += dt;
  } else {
    r.grab = null;
    const spinKey = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const flipKey = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    const snap = (ASSIST[r.assist].rotationSnapDeg * Math.PI) / 180;
    // Let go near a landable angle and the rotation finishes itself; otherwise it settles to a stop.
    const travel = travelHeading(r);
    const spinLeft = remainingToward(r.heading, r.spinVel, [travel, travel + Math.PI]);
    const flipLeft = remainingToward(r.pitch, r.flipVel, [0]);
    const spinTarget = spinKey !== 0 ? spinKey * AIR.spinRate : finishRate(r.spinVel, spinLeft, snap, AIR.spinRate);
    const flipTarget = flipKey !== 0 ? flipKey * AIR.flipRate : finishRate(r.flipVel, flipLeft, snap, AIR.flipRate);
    r.spinVel = approach(r.spinVel, spinTarget, AIR.spinResponse * AIR.spinRate * dt);
    r.flipVel = approach(r.flipVel, flipTarget, AIR.flipResponse * AIR.flipRate * dt);
  }
  r.heading = wrapAngle(r.heading + r.spinVel * dt);
  r.pitch += r.flipVel * dt;
  r.air.spin += r.spinVel * dt;
  r.air.flip += r.flipVel * dt;
}

/** Angle still to turn, in the direction of `vel`, to reach the nearest of `targets` (mod 2π). */
function remainingToward(angle: number, vel: number, targets: number[]): number {
  if (Math.abs(vel) < 0.3) return Infinity;
  const dir = Math.sign(vel);
  let best = Infinity;
  for (const t of targets) {
    const d = (((dir * (t - angle)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    best = Math.min(best, d);
  }
  return best;
}

function finishRate(vel: number, remaining: number, snap: number, maxRate: number): number {
  if (remaining > snap || remaining < 0.02) return 0;
  // Slow down as the landable angle approaches so it settles instead of overshooting.
  return Math.sign(vel) * Math.min(maxRate, Math.max(1.5, remaining * 6));
}

function stepCrashed(r: RiderState, dt: number): void {
  r.crashTimer -= dt;
  if (r.grounded) {
    const s = length(r.vel);
    if (s > 1e-6) r.vel = scale(r.vel, Math.max(0, s - CRASH.tumbleFriction * WORLD.gravity * dt) / s);
  }
  if (r.crashTimer <= 0) resetToSafeSpot(r);
}

function crash(r: RiderState): void {
  r.crashed = true;
  r.crashTimer = CRASH.tumbleTime;
  r.grab = null;
  r.edge = 0;
  r.skidding = false;
  r.lastTrick = { name: 'Bail', score: 0, quality: 'sketchy' };
  r.flow = 0;
  r.landings++;
}

function land(r: RiderState, n: Vec3): void {
  const assist = ASSIST[r.assist];
  const travel = travelHeading(r);
  const toForward = wrapAngle(r.heading - travel);
  const toSwitch = wrapAngle(r.heading - travel - Math.PI);
  const yawErr = Math.min(Math.abs(toForward), Math.abs(toSwitch));
  const pitchErr = Math.abs(wrapAngle(r.pitch));
  const errDeg = (Math.max(yawErr, pitchErr) * 180) / Math.PI;
  const air = r.air;
  r.grounded = true;
  r.pitch = 0;
  r.spinVel = r.flipVel = 0;

  if (errDeg > assist.surviveDeg || (r.grab !== null && !assist.grabLandingOk)) {
    crash(r);
    return;
  }

  // Straighten out to whichever way (regular or switch) is closer, losing a little speed for sloppy landings.
  r.heading = wrapAngle(Math.abs(toForward) <= Math.abs(toSwitch) ? travel : travel + Math.PI);
  r.edge = 0;
  r.grab = null;
  const loss = 0.5 * (errDeg / assist.surviveDeg) ** 2;
  r.vel = scale(r.vel, 1 - loss);
  // A hard landing on steep ground is fine; one on flat ground at speed bleeds more speed into the snow.
  const into = dot(r.vel, n);
  if (into < 0) r.vel = sub(r.vel, scale(n, into));

  const quality: LandingQuality =
    errDeg <= assist.cleanDeg ? 'clean' : errDeg <= (assist.cleanDeg + assist.surviveDeg) / 2 ? 'solid' : 'sketchy';
  const trick = scoreTrick(r.sport, air, quality);
  if (trick) trick.score = Math.round(trick.score * (1 + FLOW.trickBonus * r.flow));
  if (trick) {
    r.lastTrick = trick;
    r.landings++;
  }
}

function resolveGround(r: RiderState): void {
  const ground = heightAt(r.pos.x, r.pos.z);
  const n = normalAt(r.pos.x, r.pos.z);
  const intoGround = dot(r.vel, n);
  const wasGrounded = r.grounded;

  if (r.pos.y <= ground || (wasGrounded && r.pos.y - ground < RIDE.groundSnap && intoGround < 1.5)) {
    r.pos.y = ground;
    if (!wasGrounded && !r.crashed) land(r, n);
    else r.grounded = true;
    const into = dot(r.vel, n);
    if (into < 0) r.vel = sub(r.vel, scale(n, into));
    r.snow = snowAt(r.pos.x, r.pos.z);
  } else if (wasGrounded) {
    // Ground fell away (off a lip or a roller): airborne without a pop.
    if (r.crashed) r.grounded = false;
    else takeOff(r);
  }
}

function collideTrees(r: RiderState): void {
  const ground = heightAt(r.pos.x, r.pos.z);
  for (const t of treesNear(r.pos.x, r.pos.z)) {
    // Trees are about 6 m tall at scale 1; flying over the top is fine.
    if (r.pos.y - ground > 5.5 * t.scale) continue;
    const dx = r.pos.x - t.x;
    const dz = r.pos.z - t.z;
    const dist = Math.hypot(dx, dz);
    const minDist = TRUNK_RADIUS * t.scale + CRASH.riderRadius;
    if (dist >= minDist || dist < 1e-6) continue;
    const away = vec(dx / dist, 0, dz / dist);
    const into = -dot(r.vel, away);
    r.pos = add(r.pos, scale(away, minDist - dist));
    if (into <= 0) continue;
    if (!r.crashed && into > CRASH.treeCrashSpeed) crash(r);
    else r.flow *= FLOW.glanceFlowKeep;
    // Glancing blow: lose the into-the-trunk part and some speed, keep riding.
    r.vel = scale(add(r.vel, scale(away, into)), r.crashed ? 0.3 : CRASH.glanceKeep);
  }
}

/** Near misses build Flow, clipped branches cost it, and it drains when you leave the trees. */
function updateFlow(r: RiderState, dt: number): void {
  r.flowIdle += dt;
  const speed = length(r.vel);
  if (!r.crashed && speed > FLOW.minSpeed) {
    const ground = heightAt(r.pos.x, r.pos.z);
    for (const t of treesNear(r.pos.x, r.pos.z)) {
      if (r.pos.y - ground > 5.5 * t.scale) continue;
      const gap = Math.hypot(r.pos.x - t.x, r.pos.z - t.z) - TRUNK_RADIUS * t.scale - CRASH.riderRadius;
      if (gap < 0 || gap > FLOW.nearDist) continue;
      if (gap < FLOW.branchDist * t.scale) {
        // Too close: you clip the branches. Once per tree per pass.
        if (r.lastBranchTree !== t.id) {
          r.lastBranchTree = t.id;
          r.branchHits++;
          r.vel = scale(r.vel, FLOW.branchSlow);
          r.flow = Math.max(0, r.flow - FLOW.branchFlowLoss);
        }
        continue;
      }
      // Closer is worth more, and so is speed.
      const closeness = 1 - gap / FLOW.nearDist;
      r.flow = Math.min(1, r.flow + FLOW.gainRate * closeness * Math.min(1.5, speed / 12) * dt);
      r.flowIdle = 0;
    }
  }
  if (r.flowIdle > FLOW.grace) r.flow = Math.max(0, r.flow - FLOW.decay * dt);
}

/**
 * Gap sense: look down the line you're riding and, if a trunk is in the way, ease the direction of travel
 * toward the nearer open side. Strength depends on the assist setting; you still choose the line.
 */
function gapSense(r: RiderState, dt: number): void {
  const strength = ASSIST[r.assist].gapSense;
  const speed = Math.hypot(r.vel.x, r.vel.z);
  if (strength <= 0 || speed < 3) return;
  const dirX = r.vel.x / speed;
  const dirZ = r.vel.z / speed;
  const look = Math.min(GAP.lookMax, Math.max(GAP.lookMin, speed * GAP.lookTime));
  let best: { along: number; side: number; clear: number } | null = null;
  for (const t of treesWithin(r.pos.x, r.pos.z, look)) {
    const dx = t.x - r.pos.x;
    const dz = t.z - r.pos.z;
    const along = dx * dirX + dz * dirZ;
    if (along <= 0 || along > look) continue;
    const side = dx * dirZ - dz * dirX; // positive: trunk is toward +x of the line of travel (the rider's left)
    const clear = TRUNK_RADIUS * t.scale + CRASH.riderRadius + GAP.margin;
    if (Math.abs(side) >= clear) continue;
    if (!best || along < best.along) best = { along, side, clear };
  }
  if (!best) return;
  // Steer away from the trunk, harder when it's close ahead and dead center.
  const urgency = (1 - best.along / look) * (1 - Math.abs(best.side) / best.clear);
  const away = best.side >= 0 ? -1 : 1; // positive yaw turns toward +x, so turn the other way from the trunk
  const turn = away * strength * (0.4 + 0.6 * urgency) * dt;
  const c = Math.cos(turn);
  const sn = Math.sin(turn);
  r.vel = vec(r.vel.x * c + r.vel.z * sn, r.vel.y, -r.vel.x * sn + r.vel.z * c);
  r.heading = wrapAngle(r.heading + turn);
}

export function resetToSafeSpot(r: RiderState): void {
  const spot = r.safeSpots[0];
  const fresh = createRider(r.sport, r.assist);
  fresh.pos = { ...spot.pos, y: heightAt(spot.pos.x, spot.pos.z) };
  fresh.heading = spot.heading;
  fresh.vel = scale(facingOf(spot.heading), 4);
  fresh.safeSpots = [{ pos: { ...fresh.pos }, heading: spot.heading }];
  fresh.lastTrick = r.lastTrick;
  fresh.landings = r.landings;
  fresh.branchHits = r.branchHits;
  fresh.time = r.time;
  Object.assign(r, fresh);
}

export function restart(r: RiderState): void {
  const fresh = createRider(r.sport, r.assist);
  fresh.time = r.time;
  Object.assign(r, fresh);
}

export function swapSport(r: RiderState): void {
  r.sport = r.sport === 'board' ? 'ski' : 'board';
}
