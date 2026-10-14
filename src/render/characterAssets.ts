import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import riderUrl from '../assets/models/rider.glb?url';
import villagerUrl from '../assets/models/villager.glb?url';

// The characters modelled in Blender (tools/blender/characters.py), loaded once before the game starts.

let rider: GLTF | null = null;
let villager: GLTF | null = null;

/** Soft painted light: smooth Lambert shading with a little fill so shade stays colourful, not dark. */
export function painted(color: THREE.ColorRepresentation, fill = 0.18): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `outgoingLight += diffuseColor.rgb * ${fill.toFixed(3)};\n#include <opaque_fragment>`,
    );
  };
  m.customProgramCacheKey = () => `painted${fill}`;
  return m;
}

/** Swaps each glTF material for a painted one of the same name and colour. */
function repaint(root: THREE.Object3D): void {
  const made = new Map<string, THREE.MeshLambertMaterial>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const src = o.material as THREE.MeshStandardMaterial;
    let m = made.get(src.name);
    if (!m) {
      m = painted(src.color);
      m.name = src.name;
      made.set(src.name, m);
    }
    o.material = m;
    o.castShadow = true;
  });
}

export async function loadCharacters(): Promise<void> {
  const loader = new GLTFLoader();
  [rider, villager] = await Promise.all([loader.loadAsync(riderUrl), loader.loadAsync(villagerUrl)]);
  repaint(rider.scene);
}

export function riderAsset(): GLTF {
  if (!rider) throw new Error('loadCharacters() first');
  return rider;
}

export function villagerAsset(): GLTF {
  if (!villager) throw new Error('loadCharacters() first');
  return villager;
}

/** The geometry of each material in a villager piece (body_stand, beanie, ...), in its own frame. */
export function villagerPart(name: string): Map<string, THREE.BufferGeometry> {
  const node = villagerAsset().scene.getObjectByName(name);
  if (!node) throw new Error(`no villager part ${name}`);
  const out = new Map<string, THREE.BufferGeometry>();
  node.updateWorldMatrix(true, true);
  node.traverse((o) => {
    if (o instanceof THREE.Mesh) out.set((o.material as THREE.Material).name, o.geometry.clone().applyMatrix4(o.matrixWorld));
  });
  return out;
}
