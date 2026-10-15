import type { LightPreset } from './types';

// Night riding: a cold moon, navy sky, warm park lights and your headlamp doing the work.
export const night: LightPreset = {
  name: 'Night',
  sunAzimuth: 2.2,
  sunElevation: 0.6,
  sunColor: 0x8fa2d8,
  sunIntensity: 0.45,
  skyLight: 0x2c3654,
  groundLight: 0x3a4058,
  ambientIntensity: 0.15,
  skyHorizon: 0x2a3350,
  skyZenith: 0x070b18,
  sunGlow: 0x8a9ad0,
  fogColor: 0x1e2438,
  fogDensity: 0.0022,
  snow: 0xdde3ee,
  exposure: 1.9,
  sparkle: 0.15,
  lamps: 1,
  turbidity: 2,
  rayleigh: 1,
  clouds: 0.4,
  night: 1,
  envIntensity: 1.0,
};
