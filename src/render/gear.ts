import * as THREE from 'three';

// Snowboards and skis: a plank with sidecut (narrower at the waist), rounded ends and a nose (and tail) that
// turn up, built as a strip along its length so the bend is smooth. A coloured top sheet over a dark base and
// edges. Lies along z (nose at +z), its base at y = 0.

interface Plank {
  length: number;
  /** Widest (at the ends) and narrowest (at the waist) width. */
  width: number;
  waist: number;
  thick: number;
  /** How far the nose and the tail rise, and over how much of each end. */
  noseRise: number;
  tailRise: number;
  kick: number;
}

const SNOWBOARD: Plank = { length: 1.55, width: 0.3, waist: 0.25, thick: 0.016, noseRise: 0.07, tailRise: 0.06, kick: 0.2 };
const SKI: Plank = { length: 1.75, width: 0.11, waist: 0.075, thick: 0.018, noseRise: 0.09, tailRise: 0.03, kick: 0.22 };

function plankGeometry(p: Plank): THREE.BufferGeometry {
  const rows = 48;
  const half = p.length / 2;
  const pos: number[] = [];
  const top: number[] = [];
  const rest: number[] = [];
  // Each row: top-left, top-right, bottom-left, bottom-right.
  for (let i = 0; i <= rows; i++) {
    const t = i / rows; // 0 tail, 1 nose
    const z = -half + t * p.length;
    const fromEnd = Math.min(z + half, half - z); // distance to the nearer end
    // Sidecut: a smooth curve from the ends in to the waist; the last few cm round off.
    const s = Math.sin(t * Math.PI);
    let w = (p.width - (p.width - p.waist) * s) / 2;
    const round = p.width * 0.5;
    if (fromEnd < round) w *= Math.sqrt(Math.max(0.02, 1 - ((round - fromEnd) / round) ** 2));
    const kick = Math.max(0, 1 - fromEnd / p.kick);
    const y = (z > 0 ? p.noseRise : p.tailRise) * kick * kick;
    pos.push(-w, y + p.thick, z, w, y + p.thick, z, -w, y, z, w, y, z);
  }
  for (let i = 0; i < rows; i++) {
    const a = i * 4;
    const b = a + 4;
    top.push(a, b, a + 1, a + 1, b, b + 1);
    rest.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2); // base
    rest.push(a, a + 2, b, a + 2, b + 2, b); // left edge
    rest.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3); // right edge
  }
  const last = rows * 4;
  rest.push(0, 1, 2, 1, 3, 2, last, last + 2, last + 1, last + 1, last + 2, last + 3); // end caps
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  indexed.setIndex([...top, ...rest]);
  // The top sheet is material 0, the base and edges material 1. Unshared vertices keep the edges crisp.
  indexed.addGroup(0, top.length, 0);
  indexed.addGroup(top.length, rest.length, 1);
  const geo = indexed.toNonIndexed();
  geo.computeVertexNormals();
  return geo;
}

const base = new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.45, metalness: 0.2 });

function plank(p: Plank, top: number): THREE.Mesh {
  const m = new THREE.Mesh(plankGeometry(p), [new THREE.MeshStandardMaterial({ color: top, roughness: 0.35 }), base]);
  m.castShadow = true;
  return m;
}

export const snowboard = (top: number): THREE.Mesh => plank(SNOWBOARD, top);
export const ski = (top: number): THREE.Mesh => plank(SKI, top);
