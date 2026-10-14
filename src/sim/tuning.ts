// Every number that shapes how riding feels lives here, so feel changes stay in one place.
// Phase 0 values are placeholders; Phase 1 replaces the model and retunes all of these.
export const TUNING = {
  stepHz: 120,
  gravity: 9.81,
  snowFriction: 0.05,
  brakeFriction: 0.45,
  airDrag: 0.0028,
  tuckDragFactor: 0.45,
  turnRate: 1.9, // rad/s at low speed
  turnRateHighSpeed: 0.9, // rad/s at maxTurnSpeed and above
  maxTurnSpeed: 25, // m/s
  edgeGrip: 6.0, // how fast sideways sliding is scrubbed off (1/s)
  airSpinRate: 4.0, // rad/s
  jumpImpulse: 5.5, // m/s along the surface normal
  groundSnap: 0.12, // m: stay glued to the snow over small dips
};
