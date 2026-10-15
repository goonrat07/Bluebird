import type { LightPreset } from './types';

// First light: the sun just over the eastern ridge, rose on the snow, cold violet in every hollow.
export const dawn: LightPreset = {
  name: 'Dawn',
  sunAzimuth: -1.2,
  sunElevation: 0.12,
  sunColor: 0xffbb90,
  sunIntensity: 1.0,
  skyLight: 0x7f8ab8,
  groundLight: 0xa8a4b0,
  ambientIntensity: 0.12,
  skyHorizon: 0xf4bfae,
  skyZenith: 0x48568f,
  sunGlow: 0xffb79a,
  fogColor: 0xb8aab0,
  fogDensity: 0.0013,
  snow: 0xf1f1f3,
  exposure: 1.6,
  sparkle: 0.8,
  lamps: 0.35,
  turbidity: 5,
  rayleigh: 2,
  clouds: 0.3,
  night: 0,
  envIntensity: 0.4,
};
