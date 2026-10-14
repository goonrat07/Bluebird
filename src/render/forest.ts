import * as THREE from 'three';
import { heightAt } from '../sim/terrain';
import { TREES, type Tree, treeBaseY } from '../sim/trees';
import { merge, outlineMaterial } from './toon';

// Storybook evergreens: stacked tiers of foliage with snow painted onto them, in a few shades of
// green, softly lit with a thin ink outline up close. One geometry for every tree;
// each one is stretched and squashed so the forest mixes broad spruces with slim firs.

/** Foliage tiers, bottom up: base height, height and radius (m, at scale 1). */
const TIERS: [number, number, number][] = [
  [1.0, 2.4, 1.5],
  [2.25, 2.2, 1.2],
  [3.4, 2.0, 0.92],
  [4.5, 1.8, 0.62],
  [5.5, 1.3, 0.34],
];
const NEEDLES = new THREE.Color(0x3d6a56);
const SNOW_COLOR = new THREE.Color(0xeef0f2);
/** Per-tree tints over the needle colour, so the forest isn't one green. */
const TINTS = [0xffffff, 0xe2eee4, 0xd2e0d8, 0xf2f0dc, 0xc8d8d0, 0xe8e4d4];
const TRUNK_COLOR = 0x6a4a3a;

/** Size (m) of each square patch of forest drawn together. */
export const TREE_PATCH = 120;
/** Forest is drawn out to about this far from the camera (m). */
export const FOREST_DRAW = 450;
/** Outlines are drawn on patches within this distance (m); beyond it they'd only be noise. */
const OUTLINE_DRAW = 160;

const hash = (x: number, z: number, k: number): number => {
  const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * The crown: each tier a cone with a ragged, drooping rim. Snow is painted on in vertex colour:
 * the tip of each tier is white, the middle ring catches clumps of it, the rim stays green, and
 * the colours blend softly across each face, like brushwork.
 */
function crownGeometry(): THREE.BufferGeometry {
  return merge(
    TIERS.map(([y0, h, r], tier) => {
      const g = new THREE.ConeGeometry(r, h, 11, 2, true);
      g.translate(0, y0 + h / 2 - 0.15, 0);
      const apex = y0 + h - 0.15;
      const pos = g.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const t = (apex - y) / h; // 0 at the tip, 1 at the rim
        // Seam vertices share a position, so hashing the position keeps them together.
        const k = hash(Math.round(x * 100), Math.round(z * 100), tier);
        let snow: number;
        if (t > 0.9) {
          const grow = 1 + (k - 0.5) * 0.22;
          pos.setXYZ(i, x * grow, y - k * 0.14 * h, z * grow);
          snow = k > 0.7 ? 0.5 : 0;
        } else if (t > 0.4) {
          const grow = 1 + (k - 0.5) * 0.12;
          pos.setXYZ(i, x * grow, y + (k - 0.5) * 0.1, z * grow);
          snow = k > 0.2 ? 1 : 0.6;
        } else snow = 1;
        c.copy(NEEDLES).lerp(SNOW_COLOR, snow);
        colors.set([c.r, c.g, c.b], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      g.computeVertexNormals();
      return g;
    }),
  );
}

export interface Forest {
  root: THREE.Group;
  /** Shows patches near the camera, and outlines on the nearest. */
  cull(camera: THREE.Vector3): void;
}

export function buildForest(): Forest {
  const crownGeo = crownGeometry();
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.28, 1.4, 6).translate(0, 0.7, 0);
  // Soft, smooth light rather than hard toon steps: the painted look, not a cartoon one.
  const crownMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  // A little fill light of their own, so the shaded side reads as soft colour rather than a dark hole.
  crownMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight += diffuseColor.rgb * 0.22;\n#include <opaque_fragment>');
  };
  const trunkMat = new THREE.MeshLambertMaterial({ color: TRUNK_COLOR });
  const line = outlineMaterial(0.045);

  const patches = new Map<string, Tree[]>();
  for (const t of TREES) {
    const key = `${Math.floor(t.x / TREE_PATCH)},${Math.floor(t.z / TREE_PATCH)}`;
    const list = patches.get(key);
    if (list) list.push(t);
    else patches.set(key, [t]);
  }
  const root = new THREE.Group();
  const outlines: THREE.Object3D[] = [];
  const m = new THREE.Matrix4();
  const spin = new THREE.Matrix4();
  const c = new THREE.Color();
  for (const [key, trees] of patches) {
    // Each patch is a group placed at its centre, so it can be shown or hidden by distance.
    const [px, pz] = key.split(',').map((n) => (Number(n) + 0.5) * TREE_PATCH);
    const patch = new THREE.Group();
    patch.position.set(px, heightAt(px, pz), pz);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, trees.length);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
    crowns.castShadow = true;
    trees.forEach((t, i) => {
      // Broad or slim, tall or squat, turned at random, so the forest doesn't look stamped.
      const wide = 0.75 + hash(t.x, t.z, 1) * 0.4;
      const tall = 0.85 + hash(t.x, t.z, 2) * 0.45;
      spin.makeRotationY(hash(t.x, t.z, 3) * Math.PI * 2);
      m.makeScale(t.scale * wide, t.scale * tall, t.scale * wide).premultiply(spin).setPosition(t.x - px, treeBaseY(t) - patch.position.y, t.z - pz);
      crowns.setMatrixAt(i, m);
      trunks.setMatrixAt(i, m);
      crowns.setColorAt(i, c.set(TINTS[Math.floor(hash(t.x, t.z, 4) * TINTS.length)]));
    });
    const outline = new THREE.Group();
    for (const mesh of [crowns]) {
      const o = new THREE.InstancedMesh(mesh.geometry, line, trees.length);
      o.instanceMatrix = mesh.instanceMatrix;
      o.userData.outline = true;
      outline.add(o);
    }
    for (const mesh of [crowns, trunks, ...(outline.children as THREE.InstancedMesh[])]) mesh.computeBoundingSphere();
    patch.add(crowns, trunks, outline);
    outlines.push(outline);
    root.add(patch);
  }
  return {
    root,
    cull(camera) {
      root.children.forEach((patch, i) => {
        const d = patch.position.distanceTo(camera);
        patch.visible = d < FOREST_DRAW + TREE_PATCH;
        outlines[i].visible = d < OUTLINE_DRAW + TREE_PATCH * 0.7;
      });
    },
  };
}
