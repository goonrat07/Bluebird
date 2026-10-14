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
  /** W when slow: speed added per push (m/s): a double-pole on skis, a back-foot scoot on a board. */
  skatePush: number;
  /** Pushing works below this speed (m/s); above it W tucks. */
  pushMaxSpeed: number;
  /** Seconds per push, start to start. */
  pushInterval: number;
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
    skatePush: 0.7,
    pushMaxSpeed: 3.5,
    pushInterval: 0.7,
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
    skatePush: 1.2,
    pushMaxSpeed: 6,
    pushInterval: 0.6,
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
  /** How hard gap sense nudges you toward the open gap you're heading for (rad/s at full strength; 0 = off). */
  gapSense: number;
  /** How far beside a rail (m) you can be and still lock on. */
  railSnap: number;
  /** How far off straight or sideways (degrees) you can be and still lock on. */
  railAngleDeg: number;
  /** Strength of the wobble you balance against on a rail, and how fast an off-centre lean grows (1 = full). */
  railWobble: number;
  /** Losing balance on a rail is a crash rather than slipping off. */
  railFallCrash: boolean;
}

export const ASSIST: Record<AssistLevel, AssistTuning> = {
  relaxed: { surviveDeg: 55, cleanDeg: 25, grabLandingOk: true, rotationSnapDeg: 100, gapSense: 1.4, railSnap: 1.1, railAngleDeg: 50, railWobble: 0.45, railFallCrash: false },
  normal: { surviveDeg: 35, cleanDeg: 15, grabLandingOk: false, rotationSnapDeg: 70, gapSense: 1.1, railSnap: 0.8, railAngleDeg: 38, railWobble: 0.75, railFallCrash: false },
  real: { surviveDeg: 20, cleanDeg: 8, grabLandingOk: false, rotationSnapDeg: 0, gapSense: 0, railSnap: 0.5, railAngleDeg: 25, railWobble: 1, railFallCrash: true },
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

/** Flow: riding close past trees without touching them fills a meter that pays back in speed and points. */
export const FLOW = {
  /** Passing a trunk closer than this (m, edge to edge) builds Flow; closer builds faster. */
  nearDist: 2.4,
  /** Flow gained per second while skimming a trunk at the closest distance. */
  gainRate: 1.6,
  /** Riders slower than this (m/s) don't build Flow. */
  minSpeed: 6,
  /** Seconds after the last near miss before Flow starts draining. */
  grace: 1.4,
  /** Flow lost per second once draining. */
  decay: 0.22,
  /** At full Flow, drag and snow friction drop by this share. */
  speedBoost: 0.3,
  /** At full Flow, trick scores go up by this share. */
  trickBonus: 0.5,
  /** Clipping branches within this distance of a trunk (m, edge to edge, scaled with the tree) costs speed and Flow. */
  branchDist: 0.4,
  branchSlow: 0.96,
  branchFlowLoss: 0.25,
  /** Share of Flow kept after glancing off a trunk. */
  glanceFlowKeep: 0.3,
};

/** Gap sense: how far ahead it looks for the trunk you're about to hit. */
export const GAP = {
  /** Look-ahead time (s) and its limits (m). */
  lookTime: 0.8,
  lookMin: 4,
  lookMax: 16,
  /** Extra clearance (m) it aims to leave beside a trunk. */
  margin: 0.6,
};

/** Rails and boxes: lock on by landing or riding onto them, then balance with A/D. */
export const RAIL = {
  /** Friction along a rail (boxes are a bit grabbier). */
  railFriction: 0.05,
  boxFriction: 0.08,
  /** How far below a rail's top you can ride onto it without popping (m): boxes only. */
  stepUp: 0.45,
  /** How fast leaning off-centre grows on its own (1/s²): the instability you correct for. */
  tip: 6,
  /** Push from A/D to correct balance (balance units/s²). */
  correct: 8,
  /** Damping of the balance wobble (1/s). */
  damping: 1.5,
  /** Size of the wobble you fight at 10 m/s; it grows with speed. */
  wobble: 1.6,
  /** Little hop (m/s) off the end of a rail, so the rider clears it instead of scraping off. */
  exitPop: 1.6,
  /** Sideways speed (m/s) when slipping off a rail after losing balance. */
  slipSpeed: 2.5,
  /** Shortest grind (s) that scores. */
  minTime: 0.25,
  /** Extra friction on a sideways slide compared with a 50-50. */
  slideFriction: 1.5,
  /** Points per second of grinding, and the multiplier for sideways slides. */
  pointsPerSecond: 160,
  slideBonus: 1.4,
  /** Below this speed you stall on the rail and drop off. */
  stallSpeed: 1.2,
};
