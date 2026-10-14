import * as THREE from 'three';
import type { Dog } from '../sim/dogs';

// Two chunky low-poly dogs: Bowie in his red patrol vest, and scruffy Pepper.

const LOOK: Record<string, { coat: number; ears: number; vest: number | null }> = {
  Bowie: { coat: 0xd9a35a, ears: 0xa8703a, vest: 0xd9553a },
  Pepper: { coat: 0x8a8278, ears: 0x5a4f46, vest: null },
};

const box = (w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.95 }));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
};

class DogModel {
  readonly root = new THREE.Group();
  private readonly tail = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legs: THREE.Mesh[] = [];
  private phase = 0;
  private wag = 0;

  constructor(name: string) {
    const look = LOOK[name] ?? LOOK.Pepper;
    this.root.add(box(0.36, 0.34, 0.8, look.coat, 0, 0.55, 0));
    if (look.vest) this.root.add(box(0.4, 0.22, 0.42, look.vest, 0, 0.66, 0.05));
    this.head.position.set(0, 0.78, 0.42);
    this.head.add(box(0.3, 0.28, 0.3, look.coat), box(0.16, 0.13, 0.2, look.coat, 0, -0.06, 0.22), box(0.07, 0.06, 0.05, 0x2b2b38, 0, -0.02, 0.33));
    for (const s of [-1, 1]) this.head.add(box(0.08, 0.16, 0.06, look.ears, s * 0.14, 0.06, -0.04));
    this.root.add(this.head);
    this.tail.position.set(0, 0.66, -0.4);
    const t = box(0.07, 0.07, 0.34, look.coat, 0, 0.06, -0.15);
    t.rotation.x = -0.6;
    this.tail.add(t);
    this.root.add(this.tail);
    for (const [x, z] of [[-0.12, 0.28], [0.12, 0.28], [-0.12, -0.28], [0.12, -0.28]]) {
      const leg = box(0.1, 0.4, 0.1, look.coat, x, 0.2, z);
      this.legs.push(leg);
      this.root.add(leg);
    }
  }

  update(d: Dog, dt: number): void {
    this.root.position.set(d.x, d.y, d.z);
    this.root.rotation.y = d.heading;
    this.wag += dt * d.wag * 12;
    this.tail.rotation.y = Math.sin(this.wag) * (0.3 + 0.2 * d.wag);
    // Trot: diagonal pairs of legs swing together.
    this.phase += dt * d.speed * 4;
    const swing = d.speed > 0 ? 0.6 : 0;
    this.legs.forEach((leg, i) => (leg.rotation.x = Math.sin(this.phase + (i === 0 || i === 3 ? 0 : Math.PI)) * swing));
    // A happy dog bounces and looks up at you.
    this.head.rotation.x = d.happy > 0 ? -0.35 + Math.sin(this.wag * 0.5) * 0.1 : 0;
    this.root.position.y += d.happy > 0 ? Math.abs(Math.sin(this.wag * 0.4)) * 0.12 : 0;
  }
}

export class DogsView {
  readonly root = new THREE.Group();
  private readonly models = new Map<string, DogModel>();

  update(dogs: Dog[], dt: number): void {
    for (const d of dogs) {
      let m = this.models.get(d.name);
      if (!m) {
        m = new DogModel(d.name);
        this.models.set(d.name, m);
        this.root.add(m.root);
      }
      m.update(d, dt);
    }
  }
}
