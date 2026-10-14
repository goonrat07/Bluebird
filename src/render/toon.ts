import * as THREE from 'three';

// Soft storybook shading for people and dogs: three close tone steps, so shadows are gentle and
// tinted by the sky light rather than dark. Shapes are rounded (capsules, spheres), no textures.

/** The character palette: dusty pastels that read as the brightest things on cream and lavender snow. */
export const PALETTE = {
  terracotta: 0xe2725b,
  mustard: 0xf2b544,
  pine: 0x4f8f7a,
  denim: 0x3e5c8a,
  raspberry: 0xd9637e,
  sage: 0x8db5a3,
  oat: 0xf4d6a0,
  plum: 0x6b4e71,
  blush: 0xf2a0a0,
  skinLight: 0xe9b796,
  skinMid: 0xc98e6a,
  skinDeep: 0xa86f4c,
  ink: 0x3b3350,
};

let ramp: THREE.DataTexture | null = null;
/** A three-step light ramp with the steps close together (soft, low-contrast shade). */
function gradient(): THREE.DataTexture {
  if (ramp) return ramp;
  ramp = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255, 205, 205, 205, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}

const cache = new Map<number, THREE.MeshToonMaterial>();
/** A shared toon material per colour. */
export function toon(color: number): THREE.MeshToonMaterial {
  let m = cache.get(color);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: gradient() });
    cache.set(color, m);
  }
  return m;
}

/** A toon material of its own, for a part whose colour changes (the rider's jacket). */
export function toonOwn(color: number): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradient() });
}

/** A capsule standing on its base end: from y = 0 up to y = length. */
export function capsule(radius: number, length: number, radial = 8): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(radius, Math.max(0.001, length - 2 * radius), 3, radial).translate(0, length / 2, 0);
}

/** A capsule hanging down from its top end: from y = 0 down to y = -length (arms, legs from the hip). */
export function hanging(radius: number, length: number, radial = 8): THREE.BufferGeometry {
  return capsule(radius, length, radial).translate(0, -length, 0);
}

/** A soft rounded block w x h x d, centred: a capsule along the longest side, squashed to fit the others. */
export function rounded(w: number, h: number, d: number, radial = 8): THREE.BufferGeometry {
  const long = Math.max(w, h, d);
  const [a, b] = long === w ? [h, d] : long === h ? [w, d] : [w, h];
  const r = Math.max(a, b) / 2;
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, long - 2 * r), 2, radial);
  // The capsule runs along y; turn it onto the long side, then squash the short sides.
  if (long === w) g.rotateZ(Math.PI / 2).scale(1, h / (2 * r), d / (2 * r));
  else if (long === d) g.rotateX(Math.PI / 2).scale(w / (2 * r), h / (2 * r), 1);
  else g.scale(w / (2 * r), 1, d / (2 * r));
  return g;
}
