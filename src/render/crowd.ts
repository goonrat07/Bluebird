import * as THREE from 'three';
import { SPOTS, type Spot, insideOf } from '../sim/village';
import { heightAt } from '../sim/terrain';
import { PALETTE, capsule, hanging, toon } from './toon';

// Villagers: chunky low-poly people at the tables and in little groups, drawn instanced
// with a palette of jackets and hats. They chat (a gentle sway), and cheer when you land
// something big near them.

const P = PALETTE;
const JACKETS = [P.terracotta, P.mustard, P.pine, P.denim, P.raspberry, P.sage, P.oat, P.plum];
const HATS = [P.oat, P.terracotta, P.mustard, P.raspberry, P.pine, P.blush];
const SKIN = [P.skinLight, P.skinMid, P.skinDeep, 0x7a4e35];
const PANTS = P.denim;

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
  let o = 0;
  for (const g of flatParts) {
    pos.set(g.attributes.position.array as Float32Array, o);
    nor.set(g.attributes.normal.array as Float32Array, o);
    o += g.attributes.position.array.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);
/** A limb from (y0) along +z or down, as a capsule. */
const thigh = (x: number) => capsule(0.09, 0.45, 6).rotateX(Math.PI / 2).translate(x, 0.47, -0.02);

/** Person parts, feet at y = 0 when standing, facing +z: round heads, bean bodies, capsule limbs. */
export const PERSON = {
  legsStand: () => merge([at(capsule(0.09, 0.8, 6), -0.1, 0, 0), at(capsule(0.09, 0.8, 6), 0.1, 0, 0)]),
  // Seated: thighs forward, shins down, hips 0.45 up.
  legsSit: () => merge([thigh(-0.1), thigh(0.1), at(capsule(0.085, 0.47, 6), -0.1, 0, 0.4), at(capsule(0.085, 0.47, 6), 0.1, 0, 0.4)]),
  /** Torso, hips at y = 0: a puffy bean. */
  torso: () => capsule(0.23, 0.62, 10).scale(1, 1, 0.8).translate(0, -0.02, 0),
  /** Arms hanging. */
  armsDown: () => merge([at(hanging(0.07, 0.5, 6), -0.28, 0.55, 0), at(hanging(0.07, 0.5, 6), 0.28, 0.55, 0)]),
  /** Arms up, for cheering. */
  arms: () => merge([at(capsule(0.07, 0.55, 6), -0.3, 0.52, 0), at(capsule(0.07, 0.55, 6), 0.3, 0.52, 0)]),
  /** Head (hips at y = 0): big and round. */
  head: () => new THREE.SphereGeometry(0.2, 12, 9).translate(0, 0.8, 0),
  /** Dot eyes on the front of the head. */
  eyes: () => merge([-1, 1].map((x) => new THREE.SphereGeometry(0.026, 6, 5).scale(1, 1.3, 0.5).translate(x * 0.07, 0.82, 0.19))),
  /** Rosy cheeks under the eyes. */
  cheeks: () => merge([-1, 1].map((x) => new THREE.SphereGeometry(0.04, 6, 5).scale(1, 0.7, 0.35).translate(x * 0.115, 0.76, 0.165))),
  /** A beanie with a pom-pom. */
  hat: () => merge([new THREE.SphereGeometry(0.21, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.45).translate(0, 0.83, 0), new THREE.SphereGeometry(0.06, 8, 6).translate(0, 1.04, 0)]),
};

const flat = (color = 0xffffff) => toon(color);

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
  private readonly eyes: THREE.InstancedMesh;
  private readonly cheeks: THREE.InstancedMesh;
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
    this.eyes = new THREE.InstancedMesh(PERSON.eyes(), flat(P.ink), n);
    this.cheeks = new THREE.InstancedMesh(PERSON.cheeks(), flat(P.blush), n);
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
    this.root.add(this.eyes, this.cheeks);
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
      this.eyes.setMatrixAt(i, m);
      this.cheeks.setMatrixAt(i, m);
      this.arms.setMatrixAt(i, cheering ? m : m.clone().scale(hide));
      this.armsDown.setMatrixAt(i, cheering ? m.clone().scale(hide) : m);
    });
    for (const mesh of [this.torso, this.arms, this.armsDown, this.head, this.hat, this.eyes, this.cheeks]) mesh.instanceMatrix.needsUpdate = true;
  }
}
