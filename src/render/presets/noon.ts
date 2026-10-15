import type { LightPreset } from './types';

// Bluebird day: high bright sun, deep blue sky, crisp short shadows, pale blue haze.
export const noon: LightPreset = {
  name: 'Bluebird noon',
  sunAzimuth: 2.6,
  sunElevation: 0.95,
  sunColor: 0xfff4e6,
  sunIntensity: 1.7,
  skyLight: 0x9db4dc,
  groundLight: 0xd8dade,
  ambientIntensity: 0.1,
  skyHorizon: 0xcfe0f2,
  skyZenith: 0x3f74c8,
  sunGlow: 0xffffff,
  fogColor: 0xbccadb,
  fogDensity: 0.0008,
  snow: 0xf3f4f6,
  exposure: 1.0,
  lamps: 0,
  sparkle: 0.7,
  turbidity: 2.2,
  rayleigh: 1.2,
  clouds: 0.25,
  night: 0,
  envIntensity: 0.3,
};
