import * as THREE from 'three';
import { SPOTS, type Spot, insideOf } from '../sim/village';
import { heightAt } from '../sim/terrain';
import { PALETTE } from './toon';
import { painted, villagerPart } from './characterAssets';

// Villagers: people modelled in Blender (tools/blender/characters.py) after the Tiny Bookshop look,
// sitting at the tables and standing in little groups, dressed for winter. Every body pose, hair or hat
// style, beard, pair of glasses and bag is one instanced mesh per material, recoloured per person. They
// chat (a gentle sway), and cheer when you land something big near them.

const P = PALETTE;
const SHIRTS = [P.terracotta, P.mustard, P.pine, P.denim, P.raspberry, P.sage, P.coral, P.plum, P.sky, 0xf2ece0];
const PANTS = [P.denim, P.oat, P.plum, P.ink, P.pine, 0x9a8a7a, 0xc8c2b8];
const HATS = [P.oat, P.terracotta, P.mustard, P.raspberry, P.pine, P.sky, 0x9a7a5a];
const HAIR = [P.hairDark, P.hairBrown, P.hairGinger, P.hairBlond, P.hairDark, 0x9a9590];
const BOOTS = [P.ink, 0x6a4a3a, 0x8a6a4a, 0xe8e0d0, 0x5a5560];
const SKIN = [P.skinLight, P.skinMid, P.skinDeep, 0x7a4e35, 0xe0a889];
const BAGS = [P.pine, 0x9a7a4a, P.denim, P.terracotta, P.mustard];

/** What a villager wears on their head; each is its own piece of the Blender file. */
export const TOPS = ['short', 'bun', 'long', 'curly', 'ponytail', 'beanie', 'cap'] as const;
export type Top = (typeof TOPS)[number];
const HEADWEAR: Record<'m' | 'f', Top[]> = {
  m: ['short', 'beanie', 'curly', 'cap', 'short', 'long', 'beanie'],
  f: ['ponytail', 'bun', 'long', 'beanie', 'curly', 'short', 'cap'],
};

/** Body poses in the Blender file. Seated bodies sit lower, so everything on the head and back drops by this much. */
const POSES = ['stand', 'sit', 'cheer', 'sitcheer'] as const;
type Pose = (typeof POSES)[number];
export const SIT_DROP = 0.45;
/** Two builds of body, a man's and a woman's, both in every pose. */
const BUILDS = ['m', 'f'] as const;
type Build = (typeof BUILDS)[number];
type Body = `${Build}_${Pose}`;
/** Things a villager can carry; bags are fitted to each build, and put down when sitting. */
type Carry = 'none' | 'backpack' | 'bag';

export interface Look {
  build: Build;
  shirt: number;
  pants: number;
  skin: number;
  boots: number;
  /** Mittens, or bare hands (the skin colour). */
  hands: number;
  /** Hair, brows and beard. */
  hair: number;
  top: Top;
  hat: number;
  beard: boolean;
  glasses: boolean;
  carry: Carry;
  bag: number;
}

/** The look of villager i, picked from the palettes so neighbours differ. */
export function villagerLook(i: number): Look {
  const build = BUILDS[(i * 5 + 1) % 2];
  const skin = SKIN[(i * 3 + 2) % SKIN.length];
  return {
    build,
    shirt: SHIRTS[(i * 7 + 3) % SHIRTS.length],
    pants: PANTS[(i * 3 + 2) % PANTS.length],
    skin,
    boots: BOOTS[i % BOOTS.length],
    hands: i % 3 === 0 ? skin : HATS[(i * 2 + 3) % HATS.length],
    hair: HAIR[(i * 5 + 1) % HAIR.length],
    top: HEADWEAR[build][Math.floor(i / 2) % HEADWEAR[build].length],
    hat: HATS[(i * 4 + 1) % HATS.length],
    beard: build === 'm' && i % 3 !== 1,
    glasses: i % 4 === 2,
    carry: (['none', 'backpack', 'none', 'bag', 'none'] as const)[i % 5],
    bag: BAGS[(i * 3) % BAGS.length],
  };
}

/** The colour of each material of the Blender pieces, for one villager. */
function colourOf(look: Look, mat: string): number {
  switch (mat) {
    case 'shirt':
      return look.shirt;
    case 'pants':
      return look.pants;
    case 'shoes':
      return look.boots;
    case 'skin':
      return look.skin;
    case 'hands':
      return look.hands;
    case 'hat':
      return look.hat;
    case 'bag':
      return look.bag;
    case 'strap':
      return 0x5a3e2e;
    case 'glasses':
      return 0x3a2e2c;
    default:
      return look.hair; // hair, brows
  }
}

/** The pieces worn on top of the body: hair or a hat, a beard, glasses, and (standing) a bag. */
function wornBy(look: Look, sitting: boolean): string[] {
  const out: string[] = [look.top];
  if (look.beard) out.push('beard');
  if (look.glasses) out.push('glasses');
  if (look.carry !== 'none' && !sitting) out.push(`${look.carry}_${look.build}`);
  return out;
}

/** Every piece name in the Blender file besides the bodies. */
const PIECES = [...TOPS, 'beard', 'glasses', ...BUILDS.flatMap((b) => [`backpack_${b}`, `bag_${b}`])];

/** Softly painted, like the rider; the nose's redder skin is in the vertex colours. */
function villagerMaterial(color: number, geo: THREE.BufferGeometry): THREE.MeshLambertMaterial {
  const m = painted(color);
  m.vertexColors = !!geo.getAttribute('color');
  return m;
}

/** One villager as plain meshes (for the character sheet), standing or sitting. */
export function villagerMeshes(look: Look, pose: Pose = 'stand'): THREE.Group {
  const g = new THREE.Group();
  const sitting = pose.startsWith('sit');
  const add = (name: string, y: number): void => {
    for (const [mat, geo] of villagerPart(name)) {
      const m = new THREE.Mesh(geo, villagerMaterial(colourOf(look, mat), geo));
      m.position.y = y;
      m.castShadow = true;
      g.add(m);
    }
  };
  add(`body_${look.build}_${pose}`, 0);
  for (const piece of wornBy(look, sitting)) add(piece, sitting ? -SIT_DROP : 0);
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
  /** Per pose, one instanced mesh per material. Each frame every person is packed into the pose they
   * are in (count shrinks to fit), so nobody's other poses or hair styles cost anything to draw. */
  private readonly bodies = new Map<Body, { mesh: THREE.InstancedMesh; mat: string }[]>();
  private readonly pieces = new Map<string, { mesh: THREE.InstancedMesh; mat: string }[]>();
  private time = 0;
  /** The middle of the crowd, and how far from it they're still worth drawing (m). */
  private readonly center = new THREE.Vector2();
  private static readonly DRAW_RANGE = 450;

  constructor() {
    const n = SPOTS.length;
    this.people = SPOTS.map((spot, i) => {
      const indoor = insideOf(spot.x, spot.z);
      const y = indoor ? indoor.floor : heightAt(spot.x, spot.z);
      return { spot, y, sway: i * 1.7, cheer: 0, delay: 0, look: villagerLook(i) };
    });
    const instanced = (name: string, count: number): { mesh: THREE.InstancedMesh; mat: string }[] =>
      [...villagerPart(name)].map(([mat, geo]) => ({ mesh: new THREE.InstancedMesh(geo, villagerMaterial(0xffffff, geo), Math.max(1, count)), mat }));
    for (const build of BUILDS) {
      for (const pose of POSES) this.bodies.set(`${build}_${pose}`, instanced(`body_${build}_${pose}`, n));
    }
    for (const piece of PIECES) {
      // Hair, hats and the rest never change, so each piece holds only the people who wear it.
      const wearers = this.people.filter((p) => wornBy(p.look, false).includes(piece)).length;
      this.pieces.set(piece, instanced(piece, wearers));
    }
    for (const p of this.people) this.center.add(new THREE.Vector2(p.spot.x, p.spot.z));
    this.center.divideScalar(Math.max(1, this.people.length));
    for (const mesh of this.meshes()) {
      mesh.setColorAt(0, new THREE.Color(0xffffff)); // every mesh carries instance colours from the start
      mesh.castShadow = true;
      mesh.frustumCulled = false; // instances spread across the village, beyond the mesh's own bounds
      this.root.add(mesh);
    }
    this.update(0);
  }

  private meshes(): THREE.InstancedMesh[] {
    return [...this.bodies.values(), ...this.pieces.values()].flat().map((b) => b.mesh);
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

  /** `x, z`: where the viewer is; from far up the mountain the crowd isn't drawn at all. */
  update(dt: number, x = this.center.x, z = this.center.y): void {
    this.time += dt;
    this.root.visible = Math.hypot(x - this.center.x, z - this.center.y) < CrowdView.DRAW_RANGE;
    if (!this.root.visible) return;
    const m = new THREE.Matrix4();
    const lifted = new THREE.Matrix4();
    const c = new THREE.Color();
    const used = new Map<THREE.InstancedMesh, number>();
    const put = (mesh: THREE.InstancedMesh, mat: THREE.Matrix4, color: number): void => {
      const k = used.get(mesh) ?? 0;
      mesh.setMatrixAt(k, mat);
      mesh.setColorAt(k, c.set(color));
      used.set(mesh, k + 1);
    };
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    this.people.forEach((p) => {
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
      for (const b of this.bodies.get(`${p.look.build}_${pose}`)!) put(b.mesh, m, colourOf(p.look, b.mat));
      lifted.makeTranslation(0, sitting ? -SIT_DROP : 0, 0).premultiply(m);
      for (const piece of wornBy(p.look, sitting)) {
        for (const b of this.pieces.get(piece)!) put(b.mesh, lifted, colourOf(p.look, b.mat));
      }
    });
    for (const mesh of this.meshes()) {
      mesh.count = used.get(mesh) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
