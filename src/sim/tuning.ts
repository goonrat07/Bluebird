// Every number that shapes how riding feels lives here, so feel changes stay in one place.
// The live tuning panel (backtick key) edits these objects in place.

export type Sport = 'board' | 'ski';
export type SnowType = 'groomed' | 'powder' | 'ice';
export type AssistLevel = 'relaxed' | 'normal' | 'real';

export const WORLD = {
  stepHz: 120,
  gravity: 9.81,
};

/** Per-sport equipment feel. */
export interface SportTuning {
  /** Seconds for the edge to go from flat to fully on edge while a key is held. */
  edgeRampTime: number;
  /** Seconds for the edge to flatten back out when no key is held. */
  edgeReleaseTime: number;
  /** Deepest edge angle in degrees. */
  maxEdgeDeg: number;
  /** Sidecut radius in metres: smaller carves tighter turns. */
  sidecutRadius: number;
  /** Turn rate (rad/s) available at a standstill, so slow riders can still pivot. */
  pivotRate: number;
  /** Fastest the rider can ever turn (rad/s). */
  maxTurnRate: number;
  /** Share of speed kept when sideways motion is carved into forward motion (1 = lossless). */
  carveEfficiency: number;
  /** Air drag coefficient (per metre). */
  airDrag: number;
  /** Drag multiplier while tucked. */
  tuckDrag: number;
  /** Extra snow friction multiplier on top of the snow type. */
  frictionScale: number;
  /** How well the equipment floats in powder (0 = sinks, 1 = floats). */
  powderFloat: number;
  /** Skis only: push speed added by skating on flats (m/s per push). */
  skatePush: number;
}

export const SPORTS: Record<Sport, SportTuning> = {
  board: {
    edgeRampTime: 0.32,
    edgeReleaseTime: 0.22,
    maxEdgeDeg: 62,
    sidecutRadius: 8,
    pivotRate: 1.4,
    maxTurnRate: 2.6,
    carveEfficiency: 0.985,
    airDrag: 0.007,
    tuckDrag: 0.55,
    frictionScale: 1.1,
    powderFloat: 0.8,
    skatePush: 0,
  },
  ski: {
    edgeRampTime: 0.22,
    edgeReleaseTime: 0.16,
    maxEdgeDeg: 60,
    sidecutRadius: 13,
    pivotRate: 1.2,
    maxTurnRate: 2.4,
    carveEfficiency: 0.99,
    airDrag: 0.0065,
    tuckDrag: 0.5,
    frictionScale: 1.0,
    powderFloat: 0.55,
    skatePush: 1.1,
  },
};

/** Per-snow-type surface feel. */
export interface SnowTuning {
  /** Rolling friction coefficient. */
  friction: number;
  /** Sideways grip as a multiple of gravity before the edge lets go and skids. */
  grip: number;
  /** Extra drag (per metre) from ploughing through deep snow, reduced by float and speed. */
  sinkDrag: number;
}

export const SNOW: Record<SnowType, SnowTuning> = {
  groomed: { friction: 0.04, grip: 1.6, sinkDrag: 0 },
  powder: { friction: 0.07, grip: 1.25, sinkDrag: 0.05 },
  ice: { friction: 0.02, grip: 0.55, sinkDrag: 0 },
};

export const RIDE = {
  /** Friction coefficient while braking (skidding sideways to slow down). */
  brakeFriction: 0.55,
  /** Below this speed (m/s), skis can skate with W. */
  skateMaxSpeed: 4,
  /** Seconds between skate pushes. */
  skateInterval: 0.45,
  /** Stay glued to the snow over small dips (m). */
  groundSnap: 0.12,
  /** Seconds of holding Space for a full-strength pop. */
  popChargeTime: 0.45,
  popMin: 3.2,
  popMax: 6.6,
  /** Bonus pop (m/s) for releasing right at a jump's lip. */
  lipBonus: 2.2,
  /** How long after leaving the lip a release still counts (s). */
  lipWindow: 0.12,
};

export const AIR = {
  /** Spin speed in rad/s (a 360 takes 2π / spinRate seconds). */
  spinRate: 7.0,
  /** How fast spin speeds up and settles (1/s). */
  spinResponse: 9,
  /** Flip speed in rad/s. */
  flipRate: 5.2,
  flipResponse: 7,
  /** Spin carried into the air from the edge you were on at takeoff (rad/s per unit edge). */
  prewind: 2.5,
};

export interface AssistTuning {
  /** Largest landing error (degrees) you ride away from. */
  surviveDeg: number;
  /** Error under which a landing counts as clean. */
  cleanDeg: number;
  /** Whether landing while still grabbing is allowed. */
  grabLandingOk: boolean;
  /** When you let go of a spin or flip within this many degrees of a landable angle, it finishes itself. */
  rotationSnapDeg: number;
}

export const ASSIST: Record<AssistLevel, AssistTuning> = {
  relaxed: { surviveDeg: 55, cleanDeg: 25, grabLandingOk: true, rotationSnapDeg: 100 },
  normal: { surviveDeg: 35, cleanDeg: 15, grabLandingOk: false, rotationSnapDeg: 70 },
  real: { surviveDeg: 20, cleanDeg: 8, grabLandingOk: false, rotationSnapDeg: 0 },
};

export const CRASH = {
  /** Seconds of tumbling before the rider is put back on the slope. */
  tumbleTime: 1.3,
  /** Friction while tumbling. */
  tumbleFriction: 0.9,
  /** Speed (m/s) into a tree trunk above which it is a crash, not a stumble. */
  treeCrashSpeed: 6,
  /** Share of speed kept after glancing off a tree. */
  glanceKeep: 0.6,
  /** Rider collision radius (m). */
  riderRadius: 0.35,
};
