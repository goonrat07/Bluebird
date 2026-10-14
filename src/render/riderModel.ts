import * as THREE from 'three';
import type { Sport } from '../sim/tuning';
import { SPORTS } from '../sim/tuning';
import { heightAt, normalAt } from '../sim/terrain';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { PALETTE } from './toon';
import { painted, riderAsset } from './characterAssets';

/** What the renderer needs to pose the rider for one frame. */
export interface RiderPose {
  heading: number;
  pitch: number;
  edge: number;
  speed: number;
  sport: Sport;
  grounded: boolean;
  crashed: boolean;
  crashTimer: number;
  charge: number;
  tucking: boolean;
  braking: boolean;
  grab: string | null;
  /** Riding backwards relative to the equipment. */
  switch: boolean;
  /** On foot: the walk-cycle phase (rad), or null when clipped in. */
  walk?: number | null;
  /** Walking speed (m/s), so the stride stops when you stand still. */
  walkSpeed?: number;
  /** Pushing along (W when slow): 0..1 through the push, or null. */
  push?: number | null;
  /** Sideways g of the turn (positive turning left), for leaning and balance. */
  turnG?: number;
}

/** How quickly the body catches up with the equipment (1/s). Lower = more weight and lag. */
export const BODY = {
  lean: 9,
  /** Lean = atan(sideways g) times this, plus a little from the edge so slow pivots still read. */
  leanFromG: 0.6,
  leanFromEdge: 0.12,
  /** Crouch spring: natural frequency (Hz) and damping ratio, so landings compress and rebound. */
  crouchHz: 7,
  crouchDamping: 0.65,
  /** The outside arm lifts for balance in a turn (rad per g), the inside one drops. */
  balanceArms: 0.55,
  arms: 10,
  /** Upper body turns ahead into the turn by this much at full edge (rad). */
  leadYaw: 0.35,
  lead: 7,
  /** Extra crouch on touchdown, recovering over about a third of a second. */
  landingSquash: 0.6,
  landingRecover: 6,
  /** The equipment lies flat on the snow underfoot, settling at this rate (1/s), and eases level in the air. */
  ground: 14,
  groundAir: 3,
  /** The body stays nearer upright than the slope: it leans back this share of the pitch on steeps,
   * and keeps this share of upright when traversing (angulating into the hill). */
  slopeLeanBack: 0.15,
  slopeAngulate: 0.6,
};

const UP = new THREE.Vector3(0, 1, 0);
const groundN = new THREE.Vector3();
const groundQ = new THREE.Quaternion();

const follow = (current: number, target: number, rate: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
};
const box = (w: number, h: number, d: number, color: number): THREE.Mesh => part(new THREE.BoxGeometry(w, h, d), painted(color));

/** How far the arms hang out from the body in the model's rest pose (rad); arm angles are measured from straight down. */
const REST_ARM_OUT = 0.15;
/** Leg length hip to ankle (m), and how much a full crouch lowers the hips. */
const LEG = { length: 0.83, drop: 0.36 };

/** The joints the pose code drives, before they're written to the skeleton. Index 0 is the right side, 1 the left. */
interface Joints {
  /** Leg swing forward/back (rad, positive swings the foot back) and out to the side. */
  legX: [number, number];
  legZ: [number, number];
  /** Arm swing (positive back) and how far each arm is raised out to its side. */
  armX: [number, number];
  armOut: [number, number];
  /** Elbow bend (rad, forward). */
  elbow: number;
  /** Upper body turn. */
  torsoYaw: number;
  /** 0 = standing tall, 1 = deep crouch. */
  crouch: number;
}

/** A bone with what's needed to turn it about axes fixed in the model's rest pose. */
interface Joint {
  bone: THREE.Bone;
  rest: THREE.Quaternion;
  /** The parent's rest orientation in model space, and its inverse. */
  frame: THREE.Quaternion;
  unframe: THREE.Quaternion;
}

const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

// The rider modelled in Blender (tools/blender/characters.py) after the Tiny Bookshop look: natural
// proportions, softly painted, posed bone by bone. Nested groups do the big moves:
// yaw (heading) -> ground (the slope underfoot) -> flip (pitch) -> lean (edge) -> equipment, and
// -> upright (the body standing back from the slope) -> stance (sideways for a board) -> the rigged body.
export class RiderModel {
  readonly root = new THREE.Group();
  private readonly ground = new THREE.Group();
  private readonly upright = new THREE.Group();
  private readonly flip = new THREE.Group();
  private readonly lean = new THREE.Group();
  private readonly stance = new THREE.Group();
  private readonly model: THREE.Object3D;
  private readonly joints = new Map<string, Joint>();
  private readonly hipsRest: THREE.Vector3;
  private readonly j: Joints = { legX: [0, 0], legZ: [0, 0], armX: [0, 0], armOut: [0.35, 0.35], elbow: 0.3, torsoYaw: 0, crouch: 0.15 };
  private readonly board = box(0.3, 0.05, 1.55, PALETTE.plum);
  private readonly skis = new THREE.Group();
  /** Ski poles, one in each hand (right, left). */
  private readonly poles: THREE.Mesh[] = [];
  /** Gear over the shoulder while walking. */
  private readonly carried = new THREE.Group();
  private readonly carriedBoard = box(0.3, 1.55, 0.05, PALETTE.plum);
  private readonly carriedSkis = new THREE.Group();
  private readonly jacketMat: THREE.MeshLambertMaterial;
  private walking = false;
  private sport: Sport | null = null;
  private leanNow = 0;
  private crouchNow = 0.15;
  private crouchVel = 0;
  private armL = 0.35;
  private armR = 0.35;
  private leadNow = 0;
  private squash = 0;
  private wasGrounded = true;

  constructor() {
    // Flip around the rider's middle, not their feet.
    this.flip.position.y = 0.9;
    this.lean.position.y = -0.9;
    this.root.add(this.ground);
    this.ground.add(this.flip);
    this.flip.add(this.lean);
    this.lean.add(this.upright);
    this.upright.add(this.stance);

    this.model = cloneSkinned(riderAsset().scene);
    this.model.position.y = 0.05; // boots on top of the board
    this.model.updateMatrixWorld(true);
    // This rider's own jacket, so the outfitters can recolour it.
    let jacket: THREE.MeshLambertMaterial | null = null;
    this.model.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.frustumCulled = false; // the posed body leaves its rest bounds
        if ((o.material as THREE.Material).name === 'jacket') o.material = jacket ??= (o.material as THREE.MeshLambertMaterial).clone();
      }
      if (o instanceof THREE.Bone) {
        const frame = new THREE.Quaternion();
        o.parent?.getWorldQuaternion(frame);
        this.joints.set(o.name, { bone: o, rest: o.quaternion.clone(), frame, unframe: frame.clone().invert() });
      }
    });
    this.jacketMat = jacket ?? painted(PALETTE.terracotta);
    this.hipsRest = this.bone('hips').position.clone();
    this.stance.add(this.model);

    for (const side of ['R', 'L']) {
      // A pole in each hand; its direction is set every frame (see placePoles).
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.15, 5).translate(0, -0.575, 0), painted(PALETTE.ink));
      pole.castShadow = true;
      pole.position.y = 0.05;
      this.bone(`hand${side}`).add(pole);
      this.poles.push(pole);
    }

    this.board.position.y = 0.03;
    for (const side of [-1, 1]) {
      const ski = box(0.1, 0.04, 1.75, PALETTE.plum);
      ski.position.set(side * 0.12, 0.02, 0.1);
      this.skis.add(ski);
    }
    this.lean.add(this.board, this.skis);

    // Board slung on the back; skis together over the right shoulder. Laid out in model space, then
    // hung on the chest bone so they move with the body.
    this.carriedBoard.position.set(0, 0.3, -0.2);
    this.carriedBoard.rotation.z = 0.5;
    for (const side of [-1, 1]) {
      const ski = box(0.08, 0.04, 1.75, PALETTE.plum);
      ski.position.set(-0.24 + side * 0.05, 0.5, 0.04);
      ski.rotation.x = -0.35;
      this.carriedSkis.add(ski);
    }
    this.carried.add(this.carriedBoard, this.carriedSkis);
    this.carried.visible = false;
    const chest = this.bone('chest');
    const chestQ = new THREE.Quaternion();
    chest.getWorldQuaternion(chestQ);
    this.carried.quaternion.copy(chestQ.invert());
    this.carried.position.copy(chest.worldToLocal(new THREE.Vector3(0, 1.0, 0)));
    chest.add(this.carried);
  }

  private bone(name: string): THREE.Bone {
    const j = this.joints.get(name);
    if (!j) throw new Error(`rider has no bone ${name}`);
    return j.bone;
  }

  /** Turns a bone by Euler angles about the model's rest-pose axes (x across, y up, z forward). */
  private turn(name: string, x: number, y = 0, z = 0): void {
    const j = this.joints.get(name)!;
    tmpQ.setFromEuler(tmpE.set(x, y, z, 'YXZ'));
    j.bone.quaternion.copy(j.unframe).multiply(tmpQ).multiply(j.frame).multiply(j.rest);
  }

  /** Writes the joint state to the skeleton. */
  private applyPose(): void {
    const { j } = this;
    const drop = LEG.drop * j.crouch;
    const a = Math.acos(Math.max(0.2, 1 - drop / LEG.length));
    this.bone('hips').position.set(this.hipsRest.x, this.hipsRest.y - drop, this.hipsRest.z);
    (['R', 'L'] as const).forEach((side, i) => {
      // Thigh forward, shin back twice as far, foot level again: the feet stay under the hips.
      this.turn(`thigh${side}`, -a + j.legX[i], 0, j.legZ[i]);
      this.turn(`shin${side}`, 2 * a + Math.max(0, j.legX[i]) * 0.9);
      this.turn(`foot${side}`, -a);
      const out = j.armOut[i] - REST_ARM_OUT;
      this.turn(`upperarm${side}`, j.armX[i], 0, side === 'L' ? out : -out);
      this.turn(`forearm${side}`, -j.elbow);
    });
    // Lean the chest over the knees as you crouch; the head stays looking ahead.
    this.turn('spine', j.crouch * 0.45, j.torsoYaw);
    this.turn('chest', j.crouch * 0.15);
    this.turn('head', -j.crouch * 0.45);
  }

  /** Points each pole down and a little back from the hand, swinging with the arm. */
  private placePoles(): void {
    this.model.updateMatrixWorld(true);
    const modelQ = new THREE.Quaternion();
    this.stance.getWorldQuaternion(modelQ);
    const handQ = new THREE.Quaternion();
    this.poles.forEach((pole, i) => {
      if (!pole.visible) return;
      (pole.parent as THREE.Object3D).getWorldQuaternion(handQ);
      const want = new THREE.Quaternion().setFromEuler(tmpE.set(0.45 + this.j.armX[i] * 0.7, 0, 0));
      pole.quaternion.copy(handQ.invert().multiply(modelQ).multiply(want));
    });
  }

  /** Jacket colour from the outfitters. */
  setJacket(color: number): void {
    this.jacketMat.color.set(color);
  }

  /** Turns this model into a see-through ghost that casts no shadow. */
  makeGhost(): void {
    const ghost = new THREE.MeshStandardMaterial({
      color: 0xdfe6ff,
      emissive: 0x3a4466,
      flatShading: true,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    this.root.traverse((o) => {
      if (o.userData.outline) o.visible = false;
      else if (o instanceof THREE.Mesh) {
        o.material = ghost;
        o.castShadow = false;
      }
    });
  }

  /** Lays the equipment on the slope underfoot, and stands the body back toward upright. */
  private followGround(p: RiderPose, dt: number): void {
    const { x, y, z } = this.root.position;
    // Only on the snow itself: not on a chair, a rail or a box, nor walking or tumbling.
    const onSnow = p.grounded && !p.crashed && !(p.walk !== undefined && p.walk !== null) && y - heightAt(x, z) < 0.2;
    if (onSnow) {
      const n = normalAt(x, z);
      // The normal in the rider's own frame (turned by heading).
      groundN.set(n.x, n.y, n.z).applyAxisAngle(UP, -this.root.rotation.y);
      groundQ.setFromUnitVectors(UP, groundN);
    } else groundQ.identity();
    this.ground.quaternion.slerp(groundQ, 1 - Math.exp(-(onSnow ? BODY.ground : BODY.groundAir) * dt));
    // How far the snow underfoot pitches (nose down, +) and rolls, from the settled ground tilt.
    groundN.copy(UP).applyQuaternion(this.ground.quaternion);
    const pitch = Math.atan2(groundN.z, groundN.y);
    const roll = Math.atan2(-groundN.x, groundN.y);
    this.upright.rotation.set(-pitch * BODY.slopeLeanBack, 0, -roll * BODY.slopeAngulate);
  }

  update(p: RiderPose, dt: number): void {
    if (p.sport !== this.sport) {
      this.sport = p.sport;
      this.board.visible = !this.walking && p.sport === 'board';
      this.skis.visible = !this.walking && p.sport === 'ski';
      for (const pole of this.poles) pole.visible = !this.walking && p.sport === 'ski';
      // Snowboarders stand sideways to the board; skiers face forward (and everyone walks forward).
      this.stance.rotation.y = !this.walking && p.sport === 'board' ? -Math.PI / 2 : 0;
    }

    this.root.rotation.y = p.heading;
    this.followGround(p, dt);

    const walking = p.walk !== undefined && p.walk !== null;
    if (walking !== this.walking) {
      this.walking = walking;
      this.board.visible = !walking && p.sport === 'board';
      this.skis.visible = !walking && p.sport === 'ski';
      this.carried.visible = walking;
      for (const pole of this.poles) pole.visible = !walking && p.sport === 'ski';
      this.stance.rotation.y = !walking && p.sport === 'board' ? -Math.PI / 2 : 0;
    }
    if (walking) {
      this.carriedBoard.visible = p.sport === 'board';
      this.carriedSkis.visible = p.sport === 'ski';
      this.flip.rotation.set(0, 0, 0);
      this.lean.rotation.z = this.leanNow = 0;
      const { j } = this;
      j.torsoYaw = 0;
      j.crouch = 0;
      j.elbow = 0.15;
      // Legs and arms swing in opposition with each step.
      const stride = Math.min(1, (p.walkSpeed ?? 0) / 1.5) * 0.55;
      const s = Math.sin(p.walk!) * stride;
      j.legX = [s, -s];
      j.legZ = [0, 0];
      j.armX = [s * 0.8, -s * 0.8];
      j.armOut = [0.12, 0.12];
      this.applyPose();
      return;
    }
    this.j.legX = [0, 0];
    this.j.legZ = [0, 0];
    this.j.armX = [0, 0];
    this.j.elbow = 0.35;

    if (p.crashed) {
      // Tumble while crashed: a loose spin that slows as the timer runs out.
      const t = 1.3 - p.crashTimer;
      this.flip.rotation.set(Math.sin(t * 7) * 1.2, 0, t * 6);
      this.lean.rotation.z = this.leanNow = 0;
      this.setCrouch(0.5);
      this.setArms(1.2, 1.2);
      this.wasGrounded = p.grounded;
      this.applyPose();
      this.placePoles();
      return;
    }

    if (p.grounded && !this.wasGrounded) {
      this.squash = BODY.landingSquash;
      // Kick the crouch spring down on touchdown, harder the faster you land.
      this.crouchVel += 2 + Math.min(4, p.speed * 0.15);
    }
    this.wasGrounded = p.grounded;
    this.squash = follow(this.squash, 0, BODY.landingRecover, dt);

    this.flip.rotation.set(p.pitch, 0, 0);
    // Lean into the turn. Riding switch the body faces the other way, so the lean flips with it.
    const maxEdge = (SPORTS[p.sport].maxEdgeDeg * Math.PI) / 180;
    const dir = p.switch ? -1 : 1;
    // Lean into the turn you're actually making: measured sideways g, capped at the equipment's edge angle.
    const g = p.turnG ?? 0;
    const lean = Math.atan(Math.abs(g)) * BODY.leanFromG * Math.sign(g) + p.edge * BODY.leanFromEdge;
    const leanTarget = p.grounded ? dir * Math.max(-maxEdge * 0.6, Math.min(maxEdge * 0.6, lean)) : 0;
    this.leanNow = follow(this.leanNow, leanTarget, BODY.lean, dt);
    this.lean.rotation.z = -this.leanNow;

    // The upper body looks into the turn a moment before the legs follow.
    const leadTarget = p.grounded ? dir * p.edge * BODY.leadYaw : 0;
    this.leadNow = follow(this.leadNow, leadTarget, BODY.lead, dt);
    // Loading a pop with a key held: the shoulders wind up against the spin that's coming.
    this.j.torsoYaw = this.leadNow - (p.grounded ? dir * p.edge * 0.6 * p.charge : 0);

    let crouch = p.grounded ? Math.max(p.charge * 0.6, p.tucking ? 0.55 : 0.15, p.braking ? 0.3 : 0) : 0.25;
    if (p.grab) crouch = 0.75;
    // A damped spring rather than a plain ease, so the body compresses and rebounds.
    const w = 2 * Math.PI * BODY.crouchHz;
    const h = Math.min(dt, 1 / 30);
    this.crouchVel += (w * w * (crouch - this.crouchNow) - 2 * BODY.crouchDamping * w * this.crouchVel) * h;
    this.crouchNow = Math.max(0, Math.min(1, this.crouchNow + this.crouchVel * h));
    this.setCrouch(Math.min(1, this.crouchNow + this.squash * 0.5));

    // Arms out for balance: the outside arm rises through a turn and the inside one drops.
    const bal = p.grounded ? Math.max(-1, Math.min(1, g)) * BODY.balanceArms * dir : 0;
    const [l, r] = p.grab ? [-0.4, -2.3] : p.tucking ? [-1.0, -1.0] : [0.35 - 0.6 * bal, 0.35 + bal];
    this.armL = follow(this.armL, l, BODY.arms, dt);
    this.armR = follow(this.armR, r, BODY.arms, dt);
    this.setArms(this.armL, this.armR);
    if (p.push !== null && p.push !== undefined && p.grounded) this.pushPose(p.sport, p.push);
    this.applyPose();
    this.placePoles();
  }

  /** Pushing along: a double-pole plant and drive on skis, a back-foot scoot on a board. */
  private pushPose(sport: Sport, t: number): void {
    // The drive is quick (first third), the recovery slower.
    const drive = t < 0.35 ? t / 0.35 : 1 - (t - 0.35) / 0.65;
    if (sport === 'ski') {
      // Arms reach forward, plant, and drive back past the hips; the body crunches over them.
      const swing = -1.1 + 1.8 * drive;
      this.j.armX = [swing, swing];
      this.setCrouch(0.15 + 0.35 * Math.sin(Math.min(1, t / 0.35) * Math.PI));
    } else {
      // Back foot out of the binding, kicking back along the board; the front knee bends with it.
      this.j.legZ[0] = -0.7 * Math.sin(t * Math.PI);
      this.setCrouch(0.2 + 0.15 * Math.sin(t * Math.PI));
    }
  }

  /** 0 = standing tall, 1 = deep crouch. */
  private setCrouch(c: number): void {
    this.j.crouch = c;
  }

  /** How far each arm is raised out to its side (rad from hanging straight down). */
  private setArms(left: number, right: number): void {
    this.j.armOut = [right, left];
  }
}
