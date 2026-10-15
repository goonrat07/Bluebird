import type { LightPreset } from './types';

// Late afternoon: low warm sun from the skier's left, long lavender shadows, peach haze on the horizon.
export const golden: LightPreset = {
  name: 'Golden hour',
  sunAzimuth: 1.35,
  sunElevation: 0.32,
  sunColor: 0xffd2a0,
  sunIntensity: 1.5,
  skyLight: 0x8a9cc0,
  groundLight: 0xb8b0a8,
  ambientIntensity: 0.1,
  skyHorizon: 0xf3d2b0,
  skyZenith: 0x5f7fc4,
  sunGlow: 0xffd8a0,
  fogColor: 0xc9b8a8,
  fogDensity: 0.0011,
  snow: 0xf1f2f4,
  exposure: 1.45,
  lamps: 0,
  sparkle: 1,
  turbidity: 4.5,
  rayleigh: 1.6,
  clouds: 0.35,
  night: 0,
  envIntensity: 0.35,
};
