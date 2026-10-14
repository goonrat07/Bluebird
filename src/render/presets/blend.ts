import * as THREE from 'three';
import type { LightPreset } from './types';

const a = new THREE.Color();
const b = new THREE.Color();
const mixHex = (x: number, y: number, t: number): number => a.set(x).lerp(b.set(y), t).getHex();
const COLORS = new Set<keyof LightPreset>(['sunColor', 'skyLight', 'groundLight', 'skyHorizon', 'skyZenith', 'sunGlow', 'fogColor', 'snow']);
const lerp = (x: number, y: number, t: number): number => x + (y - x) * t;

/** A look partway between two presets, for easing from one time of day to the next. */
export function blendPresets(p: LightPreset, q: LightPreset, t: number): LightPreset {
  const out = { ...q };
  for (const key of Object.keys(q) as (keyof LightPreset)[]) {
    const x = p[key];
    const y = q[key];
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    (out[key] as number) = COLORS.has(key) ? mixHex(x, y, t) : lerp(x, y, t);
  }
  // Swing the sun the short way round.
  out.sunAzimuth = p.sunAzimuth + Math.atan2(Math.sin(q.sunAzimuth - p.sunAzimuth), Math.cos(q.sunAzimuth - p.sunAzimuth)) * t;
  return out;
}
