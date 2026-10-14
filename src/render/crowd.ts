import * as THREE from 'three';
import { SPOTS, type Spot, insideOf } from '../sim/village';
import { heightAt } from '../sim/terrain';
import { PALETTE } from './toon';
import { painted, villagerPart } from './characterAssets';

// Villagers: people modelled in Blender (tools/blender/characters.py) after the Tiny Bookshop look,
// sitting at the tables and standing in little groups. Every body pose and every hair or hat style is
// one instanced mesh per material, recoloured per person. They chat (a gentle sway), and cheer when
// you land something big near them.

const P = PALETTE;
const SHIRTS = [P.terracotta, P.mustard, P.pine, P.denim, P.raspberry, P.sage, P.coral, P.plum, P.sky, 0xf2ece0];
const PANTS = [P.denim, P.oat, P.plum, P.ink, P.pine, 0x9a8a7a, 0x8db56a];
const HATS = [P.oat, P.terracotta, P.mustard, P.raspberry, P.pine, P.sky, 0x9a7a5a];
const HAIR = [P.hairDark, P.hairBrown, P.hairGinger, P.hairBlond, P.hairDark, 0x9a9590];
const SHOES = [P.ink, 0x6a4a3a, P.terracotta, 0xe8e0d0];
const SKIN = [P.skinLight, P.skinMid, P.skinDeep, 0x7a4e35, 0xe0a889];

/** What a villager wears on their head; each is its own piece of the Blender file. */
export const TOPS = ['short', 'bun', 'long', 'curly', 'beanie', 'sunhat', 'cap'] as const;
export type Top = (typeof TOPS)[number];
const HATTED: Top[] = ['beanie', 'sunhat', 'cap'];

/** Body poses in the Blender file. Seated bodies sit lower, so their hair and hats drop by this much. */
const POSES = ['stand', 'sit', 'cheer', 'sitcheer'] as const;
type Pose = (typeof POSES)[number];
export const SIT_DROP = 0.45;
type BodyMat = 'shirt' | 'forearm' | 'pants' | 'skin' | 'shoes';

export interface Look {
  shirt: number;
  /** Long sleeves (the shirt colour) or short (skin). */
  forearm: number;
  pants: number;
  skin: number;
  shoes: number;
  top: Top;
  topColor: number;
}

/** The look of villager i, picked from the palettes so neighbours differ. */
export function villagerLook(i: number): Look {
  const top = TOPS[(i * 3 + 1) % TOPS.length];
  const shirt = SHIRTS[(i * 7 + 3) % SHIRTS.length];
  const skin = SKIN[(i * 3 + 2) % SKIN.length];
  return {
    shirt,
    forearm: i % 3 === 1 ? skin : shirt,
    pants: PANTS[(i * 3 + 2) % PANTS.length],
    skin,
    shoes: SHOES[i % SHOES.length],
    top,
    topColor: HATTED.includes(top) ? HATS[(i * 4 + 1) % HATS.length] : HAIR[(i * 5 + 1) % HAIR.length],
  };
}

/** One villager as plain meshes (for the character sheet), standing or sitting. */
export function villagerMeshes(look: Look, pose: Pose = 'stand'): THREE.Group {
  const g = new THREE.Group();
  for (const [mat, geo] of villagerPart(`body_${pose}`)) {
    const m = new THREE.Mesh(geo, painted(look[mat as BodyMat]));
    m.castShadow = true;
    g.add(m);
  }
  for (const geo of villagerPart(look.top).values()) {
    const m = new THREE.Mesh(geo, painted(look.topColor));
    m.position.y = pose.startsWith('sit') ? -SIT_DROP : 0;
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

interface Person {
  spot: Spot;
  y: number;
  sway: number;
  cheer: number;
  delay: number;
  look: Look;
}

export class CrowdView {
  readonly root = new THREE.Group();
  private readonly people: Person[];
  /** Per pose, one instanced mesh per material; a person shows in exactly one pose at a time. */
  private readonly bodies = new Map<Pose, THREE.InstancedMesh[]>();
  private readonly tops = new Map<Top, THREE.InstancedMesh>();
  private time = 0;

  constructor() {
    const n = SPOTS.length;
    this.people = SPOTS.map((spot, i) => {
      const indoor = insideOf(spot.x, spot.z);
      const y = indoor ? indoor.floor : heightAt(spot.x, spot.z);
      return { spot, y, sway: i * 1.7, cheer: 0, delay: 0, look: villagerLook(i) };
    });
    const c = new THREE.Color();
    const white = painted(0xffffff);
    for (const pose of POSES) {
      const meshes: THREE.InstancedMesh[] = [];
      for (const [mat, geo] of villagerPart(`body_${pose}`)) {
        const mesh = new THREE.InstancedMesh(geo, white, n);
        this.people.forEach((p, i) => mesh.setColorAt(i, c.set(p.look[mat as BodyMat])));
        meshes.push(mesh);
      }
      this.bodies.set(pose, meshes);
    }
    for (const top of TOPS) {
      const geo = [...villagerPart(top).values()][0];
      const mesh = new THREE.InstancedMesh(geo, white, n);
      this.people.forEach((p, i) => mesh.setColorAt(i, c.set(p.look.topColor)));
      this.tops.set(top, mesh);
    }
    for (const mesh of this.meshes()) {
      mesh.castShadow = true;
      mesh.frustumCulled = false; // instances spread across the village, beyond the mesh's own bounds
      this.root.add(mesh);
    }
    this.update(0);
  }

  private meshes(): THREE.InstancedMesh[] {
    return [...[...this.bodies.values()].flat(), ...this.tops.values()];
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
    const lifted = new THREE.Matrix4();
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    this.people.forEach((p, i) => {
      p.delay = Math.max(0, p.delay - dt);
      if (p.delay === 0) p.cheer = Math.max(0, p.cheer - dt);
      const cheering = p.cheer > 0 && p.delay === 0;
      const sitting = p.spot.pose === 'sit';
      // Chatting: a slow sway. Cheering: hop with arms up (seated people just throw their arms up).
      const sway = Math.sin(this.time * 1.3 + p.sway) * 0.06;
      const hop = cheering && !sitting ? Math.abs(Math.sin(this.time * 9 + p.sway)) * 0.25 : 0;
      q.setFromAxisAngle(up, p.spot.heading + sway);
      pos.set(p.spot.x, p.y + hop, p.spot.z);
      m.compose(pos, q, one);
      const pose: Pose = sitting ? (cheering ? 'sitcheer' : 'sit') : cheering ? 'cheer' : 'stand';
      for (const [name, meshes] of this.bodies) for (const mesh of meshes) mesh.setMatrixAt(i, name === pose ? m : hidden);
      lifted.makeTranslation(0, sitting ? -SIT_DROP : 0, 0).premultiply(m);
      for (const [top, mesh] of this.tops) mesh.setMatrixAt(i, top === p.look.top ? lifted : hidden);
    });
    for (const mesh of this.meshes()) mesh.instanceMatrix.needsUpdate = true;
  }
}
