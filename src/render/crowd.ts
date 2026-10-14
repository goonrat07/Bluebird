import * as THREE from 'three';
import { SPOTS, type Spot, insideOf } from '../sim/village';
import { heightAt } from '../sim/terrain';

// Villagers: chunky low-poly people at the tables and in little groups, drawn instanced
// with a palette of jackets and hats. They chat (a gentle sway), and cheer when you land
// something big near them.

const JACKETS = [0xd9553a, 0x2d6cc0, 0x2f8f5b, 0xe0b13b, 0x8b5bc4, 0xe8e4da, 0x3f6f86, 0xc76a9a];
const HATS = [0xe8e4da, 0xd9553a, 0x2b2b38, 0xe0b13b, 0x5b8fd6];
const SKIN = [0xf0c8a0, 0xd9a47a, 0xa8714f, 0x7a4e35];
const PANTS = 0x2f3b4c;

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** Merges box geometries into one non-indexed geometry. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flatParts = parts.map((g) => g.toNonIndexed());
  const count = flatParts.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3);
  let o = 0;
  for (const g of flatParts) {
    pos.set(g.attributes.position.array as Float32Array, o);
    o += g.attributes.position.array.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}

/** Person parts, feet at y = 0 when standing, facing +z. */
export const PERSON = {
  legsStand: () => merge([box(0.17, 0.78, 0.2, -0.11, 0.39, 0), box(0.17, 0.78, 0.2, 0.11, 0.39, 0)]),
  // Seated: thighs forward, shins down, hips 0.45 up.
  legsSit: () =>
    merge([box(0.17, 0.17, 0.45, -0.11, 0.47, 0.2), box(0.17, 0.17, 0.45, 0.11, 0.47, 0.2), box(0.17, 0.45, 0.17, -0.11, 0.22, 0.4), box(0.17, 0.45, 0.17, 0.11, 0.22, 0.4)]),
  /** Torso, hips at y = 0. */
  torso: () => box(0.46, 0.58, 0.28, 0, 0.29, 0),
  /** Arms hanging. */
  armsDown: () => merge([box(0.13, 0.55, 0.15, -0.3, 0.3, 0), box(0.13, 0.55, 0.15, 0.3, 0.3, 0)]),
  /** Arms up, for cheering. */
  arms: () => merge([box(0.13, 0.55, 0.15, -0.32, 0.85, 0), box(0.13, 0.55, 0.15, 0.32, 0.85, 0)]),
  /** Head (hips at y = 0). */
  head: () => box(0.28, 0.28, 0.28, 0, 0.74, 0),
  hat: () => box(0.31, 0.13, 0.31, 0, 0.93, 0),
};

const flat = (color = 0xffffff) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9 });

interface Person {
  spot: Spot;
  y: number;
  hips: number;
  sway: number;
  cheer: number;
  delay: number;
}

export class CrowdView {
  readonly root = new THREE.Group();
  private readonly people: Person[];
  private readonly torso: THREE.InstancedMesh;
  private readonly arms: THREE.InstancedMesh;
  private readonly armsDown: THREE.InstancedMesh;
  private readonly head: THREE.InstancedMesh;
  private readonly hat: THREE.InstancedMesh;
  private time = 0;

  constructor() {
    const n = SPOTS.length;
    this.people = SPOTS.map((spot, i) => {
      const indoor = insideOf(spot.x, spot.z);
      const y = indoor ? indoor.floor : heightAt(spot.x, spot.z);
      return { spot, y, hips: spot.pose === 'sit' ? 0.5 : 0.8, sway: i * 1.7, cheer: 0, delay: 0 };
    });
    const stand = this.people.filter((p) => p.spot.pose === 'stand');
    const sit = this.people.filter((p) => p.spot.pose === 'sit');
    const legsStand = new THREE.InstancedMesh(PERSON.legsStand(), flat(PANTS), stand.length);
    const legsSit = new THREE.InstancedMesh(PERSON.legsSit(), flat(PANTS), sit.length);
    this.torso = new THREE.InstancedMesh(PERSON.torso(), flat(), n);
    this.arms = new THREE.InstancedMesh(PERSON.arms(), flat(), n);
    this.armsDown = new THREE.InstancedMesh(PERSON.armsDown(), flat(), n);
    this.head = new THREE.InstancedMesh(PERSON.head(), flat(), n);
    this.hat = new THREE.InstancedMesh(PERSON.hat(), flat(), n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const place = (list: Person[], mesh: THREE.InstancedMesh) =>
      list.forEach((p, i) => mesh.setMatrixAt(i, m.compose(new THREE.Vector3(p.spot.x, p.y, p.spot.z), q.setFromAxisAngle(up, p.spot.heading), one)));
    place(stand, legsStand);
    place(sit, legsSit);
    const c = new THREE.Color();
    this.people.forEach((_, i) => {
      const jacket = JACKETS[(i * 5 + 3) % JACKETS.length];
      this.torso.setColorAt(i, c.set(jacket));
      this.arms.setColorAt(i, c.set(jacket));
      this.armsDown.setColorAt(i, c.set(jacket));
      this.head.setColorAt(i, c.set(SKIN[(i * 3 + 1) % SKIN.length]));
      this.hat.setColorAt(i, c.set(HATS[(i * 7 + 2) % HATS.length]));
    });
    for (const mesh of [legsStand, legsSit, this.torso, this.arms, this.armsDown, this.head, this.hat]) {
      mesh.castShadow = true;
      this.root.add(mesh);
    }
    this.update(0);
  }

  /** Everyone within earshot of (x, z) cheers for a moment. */
  cheer(x: number, z: number, reach = 70): void {
    this.people.forEach((p, i) => {
      if (Math.hypot(p.spot.x - x, p.spot.z - z) > reach) return;
      p.cheer = 2.4;
      p.delay = ((i * 37) % 10) * 0.04;
    });
  }

  get cheering(): number {
    return this.people.filter((p) => p.cheer > 0).length;
  }

  update(dt: number): void {
    this.time += dt;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const hide = new THREE.Vector3(0, 0, 0);
    const pos = new THREE.Vector3();
    this.people.forEach((p, i) => {
      p.delay = Math.max(0, p.delay - dt);
      if (p.delay === 0) p.cheer = Math.max(0, p.cheer - dt);
      const cheering = p.cheer > 0 && p.delay === 0;
      // Chatting: a slow sway and the odd nod. Cheering: hop, arms up (seated people just throw their arms up).
      const sway = Math.sin(this.time * 1.3 + p.sway) * 0.06;
      const hop = cheering && p.spot.pose === 'stand' ? Math.abs(Math.sin(this.time * 9 + p.sway)) * 0.25 : 0;
      q.setFromAxisAngle(up, p.spot.heading + sway);
      pos.set(p.spot.x, p.y + p.hips + hop, p.spot.z);
      m.compose(pos, q, one);
      this.torso.setMatrixAt(i, m);
      this.head.setMatrixAt(i, m);
      this.hat.setMatrixAt(i, m);
      this.arms.setMatrixAt(i, cheering ? m : m.clone().scale(hide));
      this.armsDown.setMatrixAt(i, cheering ? m.clone().scale(hide) : m);
    });
    for (const mesh of [this.torso, this.arms, this.armsDown, this.head, this.hat]) mesh.instanceMatrix.needsUpdate = true;
  }
}
