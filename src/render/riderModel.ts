import * as THREE from 'three';
import type { Sport } from '../sim/tuning';
import { SPORTS } from '../sim/tuning';
import { PALETTE, addOutlines, capsule, hanging, rounded, toon, toonOwn } from './toon';

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
};

const follow = (current: number, target: number, rate: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
};
const box = (w: number, h: number, d: number, color: number): THREE.Mesh => part(new THREE.BoxGeometry(w, h, d), toon(color));

// A storybook rider in the Tiny Bookshop manner: slim and naturally proportioned, flat colour, ink outline. Nested groups do the posing:
// yaw (heading) -> flip (pitch) -> lean (edge) -> stance (sideways for a board) -> body parts.
export class RiderModel {
  readonly root = new THREE.Group();
  private readonly flip = new THREE.Group();
  private readonly lean = new THREE.Group();
  private readonly stance = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly armLeft = new THREE.Group();
  private readonly armRight = new THREE.Group();
  private readonly legs: THREE.Mesh[] = [];
  private readonly board = box(0.3, 0.05, 1.55, PALETTE.plum);
  private readonly skis = new THREE.Group();
  /** Ski poles, one in each hand. */
  private readonly poles: THREE.Mesh[] = [];
  /** Gear over the shoulder while walking. */
  private readonly carried = new THREE.Group();
  private readonly carriedBoard = box(0.3, 1.55, 0.05, PALETTE.plum);
  private readonly carriedSkis = new THREE.Group();
  private readonly jacketMat: THREE.MeshToonMaterial;
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
    const jacket = PALETTE.terracotta;

    // Flip around the rider's middle, not their feet.
    this.flip.position.y = 0.9;
    this.lean.position.y = -0.9;
    this.root.add(this.flip);
    this.flip.add(this.lean);
    this.lean.add(this.stance);
    this.stance.add(this.hips);

    // Legs are centred capsules 0.8 m long, so the crouch can squash them about their middle.
    const legGeo = capsule(0.075, 0.8).translate(0, -0.4, 0);
    for (const side of [-1, 1]) {
      const leg = part(legGeo, toon(PALETTE.denim), side * 0.1, 0.4, 0);
      this.legs.push(leg);
      this.hips.add(leg);
      this.hips.add(part(rounded(0.13, 0.12, 0.27), toon(PALETTE.ink), side * 0.1, 0.06, 0.03));
    }
    this.torso.position.y = 0.8;
    this.hips.add(this.torso);
    // A slim, natural figure about seven heads tall: a long jacket over the hips, a scarf, a small head
    // with hair showing under the helmet and goggles pushed up. No face details; colour and shape carry it.
    this.jacketMat = toonOwn(jacket);
    const chest = part(capsule(0.17, 0.64, 12).scale(1, 1, 0.72), this.jacketMat, 0, -0.1, 0);
    const scarf = part(new THREE.TorusGeometry(0.075, 0.035, 6, 14).rotateX(Math.PI / 2), toon(PALETTE.mustard), 0, 0.53, 0.005);
    const neck = part(capsule(0.045, 0.12), toon(PALETTE.skinLight), 0, 0.52, 0);
    const head = part(new THREE.SphereGeometry(0.11, 16, 12).scale(0.95, 1.08, 1), toon(PALETTE.skinLight), 0, 0.69, 0.005);
    const hair = part(new THREE.SphereGeometry(0.1, 12, 8).scale(1.2, 0.85, 0.75), toon(PALETTE.hairBrown), 0, 0.655, -0.055);
    const helmet = part(new THREE.SphereGeometry(0.125, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), toon(PALETTE.pine), 0, 0.705, -0.005);
    const goggles = part(rounded(0.17, 0.055, 0.05), toon(PALETTE.ink), 0, 0.79, 0.075);
    goggles.rotation.x = -0.6;
    const lens = part(rounded(0.14, 0.036, 0.014), toon(0x8fc3c8), 0, 0.792, 0.097);
    lens.rotation.x = -0.6;
    lens.userData.noOutline = true;
    this.torso.add(chest, scarf, neck, head, hair, helmet, goggles, lens);
    for (const [arm, side] of [[this.armLeft, 1], [this.armRight, -1]] as const) {
      arm.position.set(side * 0.2, 0.46, 0);
      const sleeve = part(hanging(0.055, 0.5), this.jacketMat);
      arm.add(sleeve);
      arm.add(part(new THREE.SphereGeometry(0.05, 10, 8), toon(PALETTE.mustard), 0, -0.52, 0));
      // A pole in the hand, basket end trailing down and back.
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.2, 5), toon(PALETTE.ink));
      pole.castShadow = true;
      pole.userData.noOutline = true;
      pole.geometry.translate(0, -0.6, 0);
      pole.position.set(0, -0.54, 0.03);
      pole.rotation.x = 0.45;
      arm.add(pole);
      this.poles.push(pole);
      this.torso.add(arm);
    }

    this.board.position.y = 0.03;
    for (const side of [-1, 1]) {
      const ski = box(0.1, 0.04, 1.75, PALETTE.plum);
      ski.position.set(side * 0.16, 0.02, 0.1);
      this.skis.add(ski);
    }
    this.lean.add(this.board, this.skis);

    // Board slung on the back; skis together over the right shoulder.
    this.carriedBoard.position.set(0, 0.3, -0.15);
    this.carriedBoard.rotation.z = 0.5;
    for (const side of [-1, 1]) {
      const ski = box(0.08, 0.04, 1.75, PALETTE.plum);
      ski.position.set(-0.2 + side * 0.05, 0.6, 0.03);
      ski.rotation.x = -0.35;
      this.carriedSkis.add(ski);
    }
    this.carried.add(this.carriedBoard, this.carriedSkis);
    this.carried.visible = false;
    this.torso.add(this.carried);
    addOutlines(this.root);
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
      this.torso.rotation.y = 0;
      this.setCrouch(0);
      // Legs and arms swing in opposition with each step.
      const stride = Math.min(1, (p.walkSpeed ?? 0) / 1.5) * 0.55;
      const s = Math.sin(p.walk!) * stride;
      this.legs[0].rotation.x = s;
      this.legs[1].rotation.x = -s;
      this.armLeft.rotation.set(-s * 0.8, 0, 0.12);
      this.armRight.rotation.set(s * 0.8, 0, -0.12);
      return;
    }
    for (const leg of this.legs) leg.rotation.x = leg.rotation.z = 0;
    this.armLeft.rotation.x = this.armRight.rotation.x = 0;

    if (p.crashed) {
      // Tumble while crashed: a loose spin that slows as the timer runs out.
      const t = 1.3 - p.crashTimer;
      this.flip.rotation.set(Math.sin(t * 7) * 1.2, 0, t * 6);
      this.lean.rotation.z = this.leanNow = 0;
      this.setCrouch(0.5);
      this.setArms(1.2, 1.2);
      this.wasGrounded = p.grounded;
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
    this.torso.rotation.y = this.leadNow - (p.grounded ? dir * p.edge * 0.6 * p.charge : 0);

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
  }

  /** Pushing along: a double-pole plant and drive on skis, a back-foot scoot on a board. */
  private pushPose(sport: Sport, t: number): void {
    // The drive is quick (first third), the recovery slower.
    const drive = t < 0.35 ? t / 0.35 : 1 - (t - 0.35) / 0.65;
    if (sport === 'ski') {
      // Arms reach forward, plant, and drive back past the hips; the body crunches over them.
      const swing = -1.1 + 1.8 * drive;
      this.armLeft.rotation.x = this.armRight.rotation.x = swing;
      this.setCrouch(0.15 + 0.35 * Math.sin(Math.min(1, t / 0.35) * Math.PI));
    } else {
      // Back foot out of the binding, kicking back along the board; the front knee bends with it.
      this.legs[0].rotation.z = -0.7 * Math.sin(t * Math.PI);
      this.setCrouch(0.2 + 0.15 * Math.sin(t * Math.PI));
    }
  }

  /** 0 = standing tall, 1 = deep crouch. */
  private setCrouch(c: number): void {
    const legLen = 0.8 * (1 - 0.45 * c);
    for (const leg of this.legs) {
      leg.scale.y = 1 - 0.45 * c;
      leg.position.y = legLen / 2;
    }
    this.torso.position.y = legLen;
    this.torso.rotation.x = c * 0.6;
  }

  private setArms(left: number, right: number): void {
    this.armLeft.rotation.z = left;
    this.armRight.rotation.z = -right;
  }
}
