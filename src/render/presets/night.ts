import type { LightPreset } from './types';

// Night riding: a cold moon, navy sky, warm park lights and your headlamp doing the work.
export const night: LightPreset = {
  name: 'Night',
  sunAzimuth: 2.2,
  sunElevation: 0.6,
  sunColor: 0x9fb0e8,
  sunIntensity: 0.35,
  skyLight: 0x34407a,
  groundLight: 0x4c5070,
  ambientIntensity: 0.9,
  skyHorizon: 0x2e3866,
  skyZenith: 0x0d1430,
  sunGlow: 0x8a9ad0,
  fogColor: 0x2a3058,
  fogDensity: 0.0022,
  snow: 0xdfe4f4,
  exposure: 1.5,
  sparkle: 0.15,
  lamps: 1,
};
