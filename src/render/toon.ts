import * as THREE from 'three';

// Storybook people and dogs, after Tiny Bookshop: slim, naturally proportioned figures in flat colour
// with a soft shade step and a thin hand-drawn outline. Shapes are rounded (capsules, spheres), no textures.

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
  sky: 0x8fb8d8,
  coral: 0xf08a6c,
  hairDark: 0x3a2a24,
  hairBrown: 0x7a4a2c,
  hairGinger: 0xc4683a,
  hairBlond: 0xe0b870,
};

let ramp: THREE.DataTexture | null = null;
/** A light ramp with the steps close together and the shade light (flat, airy colour). */
function gradient(): THREE.DataTexture {
  if (ramp) return ramp;
  ramp = new THREE.DataTexture(new Uint8Array([178, 178, 178, 255, 225, 225, 225, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
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

/** The outline colour: a warm dark brown-violet, like an ink line. */
const LINE = 0x4a3a40;
const lines = new Map<number, THREE.MeshBasicMaterial>();
/** A back-face shell pushed out along the normals by `width` metres: an inverted-hull outline. */
export function outlineMaterial(width = 0.012): THREE.MeshBasicMaterial {
  let m = lines.get(width);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: LINE, side: THREE.BackSide });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `vec3 transformed = position + normalize(normal) * ${width.toFixed(4)};`,
      );
    };
    m.customProgramCacheKey = () => `outline${width}`;
    lines.set(width, m);
  }
  return m;
}

/** Gives every mesh under `root` an ink outline (meshes marked userData.noOutline are skipped). */
export function addOutlines(root: THREE.Object3D, width = 0.012): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && !o.userData.noOutline && !o.userData.outline) meshes.push(o);
  });
  for (const m of meshes) {
    const line = m instanceof THREE.InstancedMesh ? outlinedInstances(m, width) : new THREE.Mesh(m.geometry, outlineMaterial(width));
    line.userData.outline = true;
    line.castShadow = false;
    if (!(m instanceof THREE.InstancedMesh)) m.add(line);
  }
}

/** An outline for an instanced mesh, sharing its instance matrices (added beside it). */
export function outlinedInstances(m: THREE.InstancedMesh, width = 0.012): THREE.InstancedMesh {
  const line = new THREE.InstancedMesh(m.geometry, outlineMaterial(width), m.count);
  line.instanceMatrix = m.instanceMatrix;
  line.userData.outline = true;
  line.castShadow = false;
  line.frustumCulled = false;
  m.parent?.add(line);
  return line;
}

/** Merges geometries (keeping their smooth normals) into one non-indexed geometry. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flatParts = parts.map((g) => {
    const n = g.toNonIndexed();
    if (!n.attributes.normal) n.computeVertexNormals();
    return n;
  });
  const count = flatParts.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  // Vertex colours come along when every part has them.
  const col = flatParts.every((g) => g.attributes.color) ? new Float32Array(count * 3) : null;
  let o = 0;
  for (const g of flatParts) {
    pos.set(g.attributes.position.array as Float32Array, o);
    nor.set(g.attributes.normal.array as Float32Array, o);
    col?.set(g.attributes.color.array as Float32Array, o);
    o += g.attributes.position.array.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

