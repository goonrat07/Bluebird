import type { LightPreset } from './types';

// Mid-morning: clean pale sun from the east, crisp blue shade, the corduroy still fresh.
export const morning: LightPreset = {
  name: 'Morning',
  sunAzimuth: -0.9,
  sunElevation: 0.5,
  sunColor: 0xfff1e0,
  sunIntensity: 1.6,
  skyLight: 0x9ab0d8,
  groundLight: 0xd0d2d8,
  ambientIntensity: 0.1,
  skyHorizon: 0xd9e4f0,
  skyZenith: 0x4a7cc8,
  sunGlow: 0xfff2dc,
  fogColor: 0xb8c6d6,
  fogDensity: 0.0009,
  snow: 0xf3f4f6,
  exposure: 1.05,
  sparkle: 0.85,
  lamps: 0,
  turbidity: 2.6,
  rayleigh: 1.4,
  clouds: 0.3,
  night: 0,
  envIntensity: 0.3,
};
