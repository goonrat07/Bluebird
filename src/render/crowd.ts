import * as THREE from 'three';
import { SPOTS, type Spot, insideOf } from '../sim/village';
import { heightAt } from '../sim/terrain';
import { PALETTE, capsule, hanging, merge, outlinedInstances, rounded, toon } from './toon';

export { merge };

// Villagers: slim storybook people (after Tiny Bookshop) at the tables and in little groups, drawn
// instanced with a palette of jackets, trousers, hair and hats, and a thin ink outline. They chat
// (a gentle sway), and cheer when you land something big near them.

const P = PALETTE;
const JACKETS = [P.terracotta, P.mustard, P.pine, P.denim, P.raspberry, P.sage, P.coral, P.plum, P.sky];
const PANTS = [P.denim, P.oat, P.plum, P.ink, P.pine, 0x9a8a7a];
const HATS = [P.oat, P.terracotta, P.mustard, P.raspberry, P.pine, P.sky];
const HAIR = [P.hairDark, P.hairBrown, P.hairGinger, P.hairBlond, P.hairDark, 0x9a9590];
const SHOES = [P.ink, 0x6a4a3a, P.terracotta, 0xe8e0d0];
const SKIN = [P.skinLight, P.skinMid, P.skinDeep, 0x7a4e35];

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);
/** A cap of hair (or a hat crown) over the top of the head, `cover` of the way down. */
const cap = (r: number, cover: number, y: number, z = 0) =>
  new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI * cover).scale(1, 1.1, 1).translate(0, y, z);

/** Hip height standing and seated. */
export const HIPS = { stand: 0.85, sit: 0.48 };

/** What a villager wears on their head; each is its own instanced mesh. */
export const TOPS = ['beanie', 'bun', 'short', 'puff', 'sunhat'] as const;
export type Top = (typeof TOPS)[number];

/** Person parts, feet at y = 0 when standing, facing +z: slim, about seven heads tall. */
export const PERSON = {
  legsStand: () => merge([at(capsule(0.065, HIPS.stand, 6), -0.08, 0, 0), at(capsule(0.065, HIPS.stand, 6), 0.08, 0, 0)]),
  // Seated: thighs forward, shins down.
  legsSit: () => {
    const thigh = (x: number) => capsule(0.065, 0.42, 6).rotateX(Math.PI / 2).translate(x, HIPS.sit - 0.02, -0.02);
    const shin = (x: number) => at(capsule(0.06, HIPS.sit, 6), x, 0, 0.38);
    return merge([thigh(-0.08), thigh(0.08), shin(-0.08), shin(0.08)]);
  },
  /** Shoes under standing feet, and under seated ones (forward of the hips). */
  shoesStand: () => merge([-0.08, 0.08].map((x) => rounded(0.09, 0.08, 0.17).translate(x, 0.04, 0.03))),
  shoesSit: () => merge([-0.08, 0.08].map((x) => rounded(0.09, 0.08, 0.17).translate(x, 0.04, 0.41))),
  /** Torso, hips at y = 0: a jacket that comes down over the hips. */
  torso: () => capsule(0.155, 0.6, 10).scale(1, 1, 0.72).translate(0, -0.06, 0),
  /** Arms hanging. */
  armsDown: () => merge([at(hanging(0.05, 0.5, 6), -0.19, 0.47, 0), at(hanging(0.05, 0.5, 6), 0.19, 0.47, 0)]),
  /** Arms up, for cheering. */
  arms: () => merge([at(capsule(0.05, 0.5, 6).rotateZ(0.25), -0.19, 0.47, 0), at(capsule(0.05, 0.5, 6).rotateZ(-0.25), 0.19, 0.47, 0)]),
  /** Neck and a small head (hips at y = 0). */
  head: () => merge([at(capsule(0.04, 0.12, 6), 0, 0.5, 0), new THREE.SphereGeometry(0.105, 12, 9).scale(0.95, 1.08, 1).translate(0, 0.66, 0)]),
  /** Hair and hats. */
  top: (t: Top): THREE.BufferGeometry => {
    switch (t) {
      case 'beanie':
        return merge([cap(0.122, 0.5, 0.675), new THREE.SphereGeometry(0.04, 8, 6).translate(0, 0.82, 0)]);
      case 'bun':
        return merge([cap(0.118, 0.55, 0.662, -0.008), new THREE.SphereGeometry(0.055, 10, 8).translate(0, 0.76, -0.08)]);
      case 'short':
        return cap(0.118, 0.45, 0.662, -0.01);
      case 'puff':
        return new THREE.SphereGeometry(0.15, 14, 10).scale(1, 0.88, 0.95).translate(0, 0.71, -0.03);
      case 'sunhat':
        return merge([new THREE.CylinderGeometry(0.19, 0.19, 0.015, 16).translate(0, 0.73, 0), cap(0.118, 0.5, 0.7)]);
    }
  },
};

const flat = (color = 0xffffff) => toon(color);

interface Person {
  spot: Spot;
  y: number;
  hips: number;
  sway: number;
  cheer: number;
  delay: number;
  top: Top;
}

/** The look of villager i: jacket, trousers, skin, what's on their head and its colour. */
export function villagerLook(i: number): { jacket: number; pants: number; skin: number; top: Top; topColor: number } {
  const top = TOPS[(i * 3 + 1) % TOPS.length];
  const hat = top === 'beanie' || top === 'sunhat';
  return {
    jacket: JACKETS[(i * 5 + 3) % JACKETS.length],
    pants: PANTS[(i * 7 + 2) % PANTS.length],
    skin: SKIN[(i * 3 + 1) % SKIN.length],
    top,
    topColor: hat ? HATS[(i * 7 + 2) % HATS.length] : HAIR[(i * 5 + 1) % HAIR.length],
  };
}

export class CrowdView {
  readonly root = new THREE.Group();
  private readonly people: Person[];
  private readonly torso: THREE.InstancedMesh;
  private readonly arms: THREE.InstancedMesh;
  private readonly armsDown: THREE.InstancedMesh;
  private readonly head: THREE.InstancedMesh;
  private readonly tops: Record<Top, THREE.InstancedMesh>;
  private time = 0;

  constructor() {
    const n = SPOTS.length;
    this.people = SPOTS.map((spot, i) => {
      const indoor = insideOf(spot.x, spot.z);
      const y = indoor ? indoor.floor : heightAt(spot.x, spot.z);
      return { spot, y, hips: spot.pose === 'sit' ? HIPS.sit : HIPS.stand, sway: i * 1.7, cheer: 0, delay: 0, top: villagerLook(i).top };
    });
    const stand = this.people.filter((p) => p.spot.pose === 'stand');
    const sit = this.people.filter((p) => p.spot.pose === 'sit');
    const legsStand = new THREE.InstancedMesh(PERSON.legsStand(), flat(), stand.length);
    const legsSit = new THREE.InstancedMesh(PERSON.legsSit(), flat(), sit.length);
    this.torso = new THREE.InstancedMesh(PERSON.torso(), flat(), n);
    this.arms = new THREE.InstancedMesh(PERSON.arms(), flat(), n);
    this.armsDown = new THREE.InstancedMesh(PERSON.armsDown(), flat(), n);
    this.head = new THREE.InstancedMesh(PERSON.head(), flat(), n);
    this.tops = {} as Record<Top, THREE.InstancedMesh>;
    for (const t of TOPS) this.tops[t] = new THREE.InstancedMesh(PERSON.top(t), flat(), n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const c = new THREE.Color();
    const place = (list: Person[], mesh: THREE.InstancedMesh) =>
      list.forEach((p, i) => {
        mesh.setMatrixAt(i, m.compose(new THREE.Vector3(p.spot.x, p.y, p.spot.z), q.setFromAxisAngle(up, p.spot.heading), one));
        mesh.setColorAt(i, c.set(villagerLook(this.people.indexOf(p)).pants));
      });
    const shoesStand = new THREE.InstancedMesh(PERSON.shoesStand(), flat(), stand.length);
    const shoesSit = new THREE.InstancedMesh(PERSON.shoesSit(), flat(), sit.length);
    place(stand, legsStand);
    place(sit, legsSit);
    place(stand, shoesStand);
    place(sit, shoesSit);
    stand.forEach((p, i) => shoesStand.setColorAt(i, c.set(SHOES[this.people.indexOf(p) % SHOES.length])));
    sit.forEach((p, i) => shoesSit.setColorAt(i, c.set(SHOES[this.people.indexOf(p) % SHOES.length])));
    this.people.forEach((_, i) => {
      const look = villagerLook(i);
      this.torso.setColorAt(i, c.set(look.jacket));
      this.arms.setColorAt(i, c.set(look.jacket));
      this.armsDown.setColorAt(i, c.set(look.jacket));
      this.head.setColorAt(i, c.set(look.skin));
      for (const t of TOPS) this.tops[t].setColorAt(i, c.set(look.topColor));
    });
    const meshes = [legsStand, legsSit, shoesStand, shoesSit, this.torso, this.arms, this.armsDown, this.head, ...Object.values(this.tops)];
    for (const mesh of meshes) {
      mesh.castShadow = true;
      this.root.add(mesh);
      outlinedInstances(mesh);
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
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
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
      for (const t of TOPS) this.tops[t].setMatrixAt(i, t === p.top ? m : hidden);
      this.arms.setMatrixAt(i, cheering ? m : hidden);
      this.armsDown.setMatrixAt(i, cheering ? hidden : m);
    });
    for (const mesh of [this.torso, this.arms, this.armsDown, this.head, ...Object.values(this.tops)]) mesh.instanceMatrix.needsUpdate = true;
  }
}
