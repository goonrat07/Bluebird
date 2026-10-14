import type { LightPreset } from './types';

// Blue hour: the sun is down, the snow goes deep periwinkle and the lodge windows glow.
export const blueHour: LightPreset = {
  name: 'Blue hour',
  sunAzimuth: 1.6,
  sunElevation: 0.06,
  sunColor: 0xc6b2e0,
  sunIntensity: 1.1,
  skyLight: 0x7a84cc,
  groundLight: 0xb0a6cc,
  ambientIntensity: 1.3,
  skyHorizon: 0xc59aa8,
  skyZenith: 0x26336e,
  sunGlow: 0xd896a0,
  fogColor: 0x9a8fb8,
  fogDensity: 0.0016,
  snow: 0xe8eaf6,
  exposure: 1.3,
  sparkle: 0.25,
  lamps: 0.6,
};
