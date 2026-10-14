import type { LightPreset } from './types';

// First light: the sun just over the eastern ridge, rose on the snow, cold violet in every hollow.
export const dawn: LightPreset = {
  name: 'Dawn',
  sunAzimuth: -1.2,
  sunElevation: 0.12,
  sunColor: 0xffc2a8,
  sunIntensity: 2.0,
  skyLight: 0x7f86c8,
  groundLight: 0xb9aec8,
  ambientIntensity: 0.75,
  skyHorizon: 0xf4bfae,
  skyZenith: 0x48568f,
  sunGlow: 0xffb79a,
  fogColor: 0xc9b6c4,
  fogDensity: 0.0014,
  snow: 0xf2eef0,
  exposure: 1.05,
  sparkle: 0.8,
  lamps: 0.35,
};
