import * as THREE from 'three';

const MAX = 600;

// Snow kicked up by skids, hard carves and landings. A fixed pool of points, recycled oldest-first.
export class Spray {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(MAX * 3);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly life = new Float32Array(MAX);
  private next = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.22, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.points.frustumCulled = false;
  }

  /** Emits `count` particles at `at`, thrown roughly along `dir` with some randomness. */
  emit(at: THREE.Vector3, dir: THREE.Vector3, count: number, strength: number): void {
    for (let i = 0; i < count; i++) {
      const k = this.next;
      this.next = (this.next + 1) % MAX;
      this.pos.set([at.x + (Math.random() - 0.5) * 0.4, at.y + 0.05, at.z + (Math.random() - 0.5) * 0.4], k * 3);
      this.vel.set(
        [
          dir.x * strength + (Math.random() - 0.5) * 2,
          1.5 + Math.random() * 2.5 * strength * 0.3,
          dir.z * strength + (Math.random() - 0.5) * 2,
        ],
        k * 3,
      );
      this.life[k] = 0.5 + Math.random() * 0.5;
    }
  }

  update(dt: number): void {
    for (let k = 0; k < MAX; k++) {
      if (this.life[k] <= 0) {
        this.pos[k * 3 + 1] = -1e6; // park dead particles out of sight
        continue;
      }
      this.life[k] -= dt;
      this.vel[k * 3 + 1] -= 9.8 * dt;
      for (let a = 0; a < 3; a++) this.pos[k * 3 + a] += this.vel[k * 3 + a] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
