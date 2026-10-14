import type { LightPreset } from './types';

// Late afternoon: low warm sun from the skier's left, long lavender shadows, peach haze on the horizon.
export const golden: LightPreset = {
  name: 'Golden hour',
  sunAzimuth: 1.35,
  sunElevation: 0.32,
  sunColor: 0xffe0b4,
  sunIntensity: 3.1,
  skyLight: 0x8e9fe0,
  groundLight: 0xc9c4d4,
  ambientIntensity: 0.8,
  skyHorizon: 0xf3d2b0,
  skyZenith: 0x5f7fc4,
  sunGlow: 0xffd8a0,
  fogColor: 0xd6cad0,
  fogDensity: 0.0012,
  snow: 0xf4f1ee,
  exposure: 0.95,
  lamps: 0,
  sparkle: 1,
};
