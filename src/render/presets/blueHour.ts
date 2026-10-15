import type { LightPreset } from './types';

// Blue hour: the sun is down, the snow goes deep periwinkle and the lodge windows glow.
export const blueHour: LightPreset = {
  name: 'Blue hour',
  sunAzimuth: 1.6,
  sunElevation: 0.06,
  sunColor: 0x9aa6d8,
  sunIntensity: 0.6,
  skyLight: 0x5a6aa0,
  groundLight: 0x8088a8,
  ambientIntensity: 0.18,
  skyHorizon: 0x6b6f92,
  skyZenith: 0x1c2546,
  sunGlow: 0xd896a0,
  fogColor: 0x5c6488,
  fogDensity: 0.0016,
  snow: 0xe9edf5,
  exposure: 1.6,
  sparkle: 0.25,
  lamps: 0.6,
  turbidity: 3,
  rayleigh: 2.5,
  clouds: 0.3,
  night: 0.35,
  envIntensity: 0.9,
};
