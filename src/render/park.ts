import * as THREE from 'three';
import { RAILS, railPoint, type Rail } from '../sim/rails';
import { heightAt } from '../sim/terrain';

// Rails and boxes on the park line: a steel bar on posts, or a low box with a slick top.
const flat = (color: number, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: metalness ? 0.35 : 0.8, metalness });

const STEEL = flat(0xc4d0dc, 0.6);
const POST = flat(0x2f3b4c);
const BOX_SIDE = flat(0x3f7f86);
const BOX_TOP = flat(0xdfe4ea, 0.2);

/** Turns a mesh built along +z so it runs from the rail's start to its end, centred between them. */
function alongRail(mesh: THREE.Object3D, rail: Rail, drop = 0): THREE.Object3D {
  const mid = railPoint(rail, rail.length / 2);
  mesh.position.set(mid.x, mid.y - drop, mid.z);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(rail.dir.x, rail.dir.y, rail.dir.z));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildRail(rail: Rail): THREE.Group {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, rail.length, 8).rotateX(Math.PI / 2), STEEL);
  g.add(alongRail(bar, rail, 0.07));
  const posts = Math.max(2, Math.round(rail.length / 5) + 1);
  for (let i = 0; i < posts; i++) {
    const p = railPoint(rail, (rail.length * i) / (posts - 1));
    const ground = heightAt(p.x, p.z) - 0.3;
    const h = p.y - 0.1 - ground;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, h, 0.12), POST);
    post.position.set(p.x, ground + h / 2, p.z);
    post.castShadow = true;
    g.add(post);
  }
  return g;
}

function buildBox(rail: Rail): THREE.Group {
  const g = new THREE.Group();
  const depth = rail.height + 0.4; // sunk into the snow so it never floats over a dip
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, depth, rail.length), BOX_SIDE);
  g.add(alongRail(body, rail, depth / 2 + 0.03));
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.06, rail.length), BOX_TOP);
  g.add(alongRail(top, rail, 0.03));
  return g;
}

export function buildPark(): THREE.Group {
  const g = new THREE.Group();
  for (const rail of RAILS) g.add(rail.kind === 'box' ? buildBox(rail) : buildRail(rail));
  return g;
}
