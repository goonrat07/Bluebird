import { describe, expect, it } from 'vitest';
import { PRESETS, blendPresets } from '../../src/render/presets';
import { WEATHERS, withWeather } from '../../src/render/weather';

describe('time of day and weather', () => {
  it('runs through the day from golden hour', () => {
    expect(PRESETS.map((p) => p.name)).toEqual(['Golden hour', 'Blue hour', 'Night', 'Dawn', 'Morning', 'Bluebird noon']);
  });

  it('only turns the night lights on when it gets dark', () => {
    const lamps = Object.fromEntries(PRESETS.map((p) => [p.name, p.lamps]));
    expect(lamps['Bluebird noon']).toBe(0);
    expect(lamps['Golden hour']).toBe(0);
    expect(lamps['Night']).toBe(1);
  });

  it('eases from one look to the next', () => {
    const [a, b] = PRESETS;
    expect(blendPresets(a, b, 0).sunIntensity).toBeCloseTo(a.sunIntensity);
    expect(blendPresets(a, b, 1).sunIntensity).toBeCloseTo(b.sunIntensity);
    expect(blendPresets(a, b, 1).skyZenith).toBe(b.skyZenith);
    const mid = blendPresets(a, b, 0.5).sunIntensity;
    expect(mid).toBeGreaterThan(Math.min(a.sunIntensity, b.sunIntensity));
    expect(mid).toBeLessThan(Math.max(a.sunIntensity, b.sunIntensity));
  });

  it('clouds hide the sun and thicken the haze; clear skies change nothing', () => {
    const noon = PRESETS.find((p) => p.name === 'Bluebird noon')!;
    expect(withWeather(noon, WEATHERS[0])).toBe(noon);
    for (const w of WEATHERS.slice(1)) {
      const look = withWeather(noon, w);
      expect(look.sunIntensity).toBeLessThan(noon.sunIntensity * 0.5);
      expect(look.fogDensity).toBeGreaterThan(noon.fogDensity);
      expect(look.sparkle).toBeLessThan(noon.sparkle);
    }
  });
});
