import * as THREE from 'three';
import type { Sport } from '../sim/tuning';
import { SPORTS } from '../sim/tuning';

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
}

/** How quickly the body catches up with the equipment (1/s). Lower = more weight and lag. */
export const BODY = {
  lean: 9,
  crouch: 12,
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

const box = (w: number, h: number, d: number, color: number): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, flatShading: true }));
  m.castShadow = true;
  return m;
};

// A chunky low-poly placeholder rider. Nested groups do the posing:
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
  private readonly board = box(0.3, 0.05, 1.55, 0x2a3a55);
  private readonly skis = new THREE.Group();
  private sport: Sport | null = null;
  private leanNow = 0;
  private crouchNow = 0.15;
  private armL = 0.35;
  private armR = 0.35;
  private leadNow = 0;
  private squash = 0;
  private wasGrounded = true;

  constructor() {
    const jacket = 0xe0563b;
    const pants = 0x2f3b4c;
    const skin = 0xf0c8a0;

    // Flip around the rider's middle, not their feet.
    this.flip.position.y = 0.9;
    this.lean.position.y = -0.9;
    this.root.add(this.flip);
    this.flip.add(this.lean);
    this.lean.add(this.stance);
    this.stance.add(this.hips);

    for (const side of [-1, 1]) {
      const leg = box(0.2, 0.8, 0.22, pants);
      leg.position.set(side * 0.14, 0.4, 0);
      this.legs.push(leg);
      this.hips.add(leg);
    }
    this.torso.position.y = 0.8;
    this.hips.add(this.torso);
    const chest = box(0.5, 0.62, 0.3, jacket);
    chest.position.y = 0.31;
    const head = box(0.3, 0.3, 0.3, skin);
    head.position.y = 0.82;
    const goggles = box(0.31, 0.09, 0.05, 0x1b2230);
    goggles.position.set(0, 0.85, 0.16);
    const helmet = box(0.33, 0.14, 0.33, 0x5b8fd6);
    helmet.position.y = 1.0;
    this.torso.add(chest, head, goggles, helmet);
    for (const [arm, side] of [[this.armLeft, 1], [this.armRight, -1]] as const) {
      arm.position.set(side * 0.33, 0.56, 0);
      const sleeve = box(0.14, 0.6, 0.16, jacket);
      sleeve.position.y = -0.28;
      arm.add(sleeve);
      this.torso.add(arm);
    }

    this.board.position.y = 0.03;
    for (const side of [-1, 1]) {
      const ski = box(0.1, 0.04, 1.75, 0x2a3a55);
      ski.position.set(side * 0.16, 0.02, 0.1);
      this.skis.add(ski);
    }
    this.lean.add(this.board, this.skis);
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
      if (o instanceof THREE.Mesh) {
        o.material = ghost;
        o.castShadow = false;
      }
    });
  }

  update(p: RiderPose, dt: number): void {
    if (p.sport !== this.sport) {
      this.sport = p.sport;
      this.board.visible = p.sport === 'board';
      this.skis.visible = p.sport === 'ski';
      // Snowboarders stand sideways to the board; skiers face forward.
      this.stance.rotation.y = p.sport === 'board' ? -Math.PI / 2 : 0;
    }

    this.root.rotation.y = p.heading;

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

    if (p.grounded && !this.wasGrounded) this.squash = BODY.landingSquash;
    this.wasGrounded = p.grounded;
    this.squash = follow(this.squash, 0, BODY.landingRecover, dt);

    this.flip.rotation.set(p.pitch, 0, 0);
    // Lean into the turn. Riding switch the body faces the other way, so the lean flips with it.
    const maxEdge = (SPORTS[p.sport].maxEdgeDeg * Math.PI) / 180;
    const dir = p.switch ? -1 : 1;
    const leanTarget = p.grounded ? dir * p.edge * maxEdge * 0.6 * Math.min(1, p.speed / 8) : 0;
    this.leanNow = follow(this.leanNow, leanTarget, BODY.lean, dt);
    this.lean.rotation.z = -this.leanNow;

    // The upper body looks into the turn a moment before the legs follow.
    const leadTarget = p.grounded ? dir * p.edge * BODY.leadYaw : 0;
    this.leadNow = follow(this.leadNow, leadTarget, BODY.lead, dt);
    this.torso.rotation.y = this.leadNow;

    let crouch = p.grounded ? Math.max(p.charge * 0.6, p.tucking ? 0.55 : 0.15, p.braking ? 0.3 : 0) : 0.25;
    if (p.grab) crouch = 0.75;
    this.crouchNow = follow(this.crouchNow, crouch, BODY.crouch, dt);
    this.setCrouch(Math.min(1, this.crouchNow + this.squash));

    const [l, r] = p.grab ? [-0.4, -2.3] : p.tucking ? [-1.0, -1.0] : [0.35, 0.35];
    this.armL = follow(this.armL, l, BODY.arms, dt);
    this.armR = follow(this.armR, r, BODY.arms, dt);
    this.setArms(this.armL, this.armR);
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
