import * as THREE from 'three';
import type { LightPreset } from './presets';

/** A sky condition laid over any time of day. */
export interface Weather {
  name: string;
  /** How much cloud hides the sun, 0..1: kills shadows and sparkle, greys the sky. */
  overcast: number;
  /** Extra haze on top of the time of day's own. */
  fog: number;
  /** Snowfall, 0..1. */
  snowfall: number;
  /** Wind pushing the flakes sideways (m/s). */
  wind: number;
  /** Goggle frost at the edges of the screen, 0..1. */
  frost: number;
}

/** In the order the Y key cycles through them; the first is the default. */
export const WEATHERS: Weather[] = [
  { name: 'Clear', overcast: 0, fog: 0, snowfall: 0, wind: 0, frost: 0 },
  // Flat light: thick low cloud, no shadows, the slope's shape hard to read.
  { name: 'Flat light', overcast: 0.9, fog: 0.009, snowfall: 0.08, wind: 0.5, frost: 0.15 },
  { name: 'Snowstorm', overcast: 0.8, fog: 0.0055, snowfall: 1, wind: 7, frost: 0.55 },
];

const c = new THREE.Color();
const grey = new THREE.Color();
/** Moves a color toward a cloud grey of the same brightness. */
function cloud(hex: number, amount: number, lift = 0): number {
  c.set(hex);
  const l = c.r * 0.3 + c.g * 0.55 + c.b * 0.15;
  grey.setRGB(l * 0.97 + lift, l + lift, l * 1.06 + lift);
  return c.lerp(grey, amount).getHex();
}

/** The time of day's look under this weather. */
export function withWeather(p: LightPreset, w: Weather): LightPreset {
  const o = w.overcast;
  if (o === 0 && w.fog === 0) return p;
  return {
    ...p,
    name: `${p.name} · ${w.name}`,
    sunIntensity: p.sunIntensity * (1 - 0.85 * o),
    sunColor: cloud(p.sunColor, o),
    ambientIntensity: p.ambientIntensity * (1 + 0.6 * o),
    skyLight: cloud(p.skyLight, o * 0.8, 0.05),
    groundLight: cloud(p.groundLight, o * 0.8),
    skyHorizon: cloud(p.skyHorizon, o, 0.04),
    skyZenith: cloud(p.skyZenith, o * 0.9, 0.08),
    sunGlow: cloud(p.sunGlow, o, -0.2),
    fogColor: cloud(p.fogColor, o * 0.9, 0.04),
    fogDensity: p.fogDensity + w.fog,
    sparkle: p.sparkle * (1 - o),
  };
}

const FLAKES = 2600;
/** Half the width of the box of falling snow around the camera. */
const BOX = 32;
const HEIGHT = 26;

function flakeTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}

/** Falling snow in a box that travels with the camera, wrapping flakes round as they leave it. One draw call. */
export class Snowfall {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly drift: Float32Array;
  private readonly material: THREE.PointsMaterial;
  private amount = 0;
  private wind = 0;
  private t = 0;

  constructor() {
    this.positions = new Float32Array(FLAKES * 3);
    this.drift = new Float32Array(FLAKES);
    // A fixed scatter so the look is the same every time.
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < FLAKES; i++) {
      this.positions[i * 3] = (rand() * 2 - 1) * BOX;
      this.positions[i * 3 + 1] = rand() * HEIGHT;
      this.positions[i * 3 + 2] = (rand() * 2 - 1) * BOX;
      this.drift[i] = rand() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.11,
      map: flakeTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  set(w: Weather): void {
    this.amount = w.snowfall;
    this.wind = w.wind;
    this.points.visible = w.snowfall > 0;
    // Light snow just thins out the flakes drawn.
    this.points.geometry.setDrawRange(0, Math.round(FLAKES * w.snowfall));
  }

  update(camera: THREE.Camera, dt: number): void {
    if (!this.points.visible) return;
    this.t += dt;
    const fall = 1.4 + this.amount * 0.8;
    const p = this.positions;
    const cx = camera.position.x;
    const cy = camera.position.y - HEIGHT / 2;
    const cz = camera.position.z;
    const count = Math.round(FLAKES * this.amount);
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      const sway = Math.sin(this.t * 1.3 + this.drift[i]) * 0.6;
      p[k] += (this.wind + sway) * dt;
      p[k + 1] -= fall * dt;
      p[k + 2] += Math.cos(this.t * 1.1 + this.drift[i]) * 0.4 * dt;
      // Wrap each flake back into the box round the camera (world space).
      p[k] = cx + wrap(p[k] - cx, BOX);
      p[k + 1] = cy + wrapUp(p[k + 1] - cy, HEIGHT);
      p[k + 2] = cz + wrap(p[k + 2] - cz, BOX);
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

const wrap = (v: number, half: number): number => ((((v + half) % (2 * half)) + 2 * half) % (2 * half)) - half;
const wrapUp = (v: number, h: number): number => ((v % h) + h) % h;
