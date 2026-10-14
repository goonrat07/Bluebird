/** One time-of-day look. Colors are hex; the sun direction points from the scene toward the sun. */
export interface LightPreset {
  name: string;
  /** Sun direction: azimuth (radians, 0 = from downhill +z, π/2 = from +x) and elevation above the horizon. */
  sunAzimuth: number;
  sunElevation: number;
  sunColor: number;
  sunIntensity: number;
  /** Sky light from above (tints shade) and bounce light from the snow below. */
  skyLight: number;
  groundLight: number;
  ambientIntensity: number;
  /** Sky gradient, bottom to top, and the glow around the sun. */
  skyHorizon: number;
  skyZenith: number;
  sunGlow: number;
  /** Aerial perspective: distant terrain fades toward this color. */
  fogColor: number;
  fogDensity: number;
  /** Base snow color before lighting; lighting turns it cream in sun and lavender in shade. */
  snow: number;
  /** Tone mapping exposure. */
  exposure: number;
  /** Strength of the glitter on sunlit snow, 0..1. */
  sparkle: number;
  /** How much the night lights are on: lamp posts, lit windows, the headlamp and the stars. 0 by day, 1 at night. */
  lamps: number;
}
