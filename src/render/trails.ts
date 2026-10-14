import * as THREE from 'three';

const SEGMENTS = 2000;
const SPACING = 0.35;

// Tracks left in the snow behind the rider: a flat ribbon just above the surface, deeper-looking in powder.
// Old segments are recycled, so the most recent run of tracks stays visible.
export class Trails {
  readonly mesh: THREE.Mesh;
  private readonly positions = new Float32Array(SEGMENTS * 6 * 3);
  private readonly colors = new Float32Array(SEGMENTS * 6 * 3);
  private next = 0;
  private last: { left: THREE.Vector3; right: THREE.Vector3; center: THREE.Vector3 } | null = null;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
  }

  /** Call every frame. `onSnow` false (air, crash) breaks the ribbon. */
  update(pos: THREE.Vector3, heading: number, width: number, deep: boolean, onSnow: boolean): void {
    if (!onSnow) {
      this.last = null;
      return;
    }
    // The ribbon runs across the direction of travel of the equipment.
    const side = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading)).multiplyScalar(width / 2);
    const center = pos.clone().add(new THREE.Vector3(0, 0.03, 0));
    const left = center.clone().add(side);
    const right = center.clone().sub(side);
    if (!this.last) {
      this.last = { left, right, center };
      return;
    }
    if (center.distanceTo(this.last.center) < SPACING) return;

    const k = this.next;
    this.next = (this.next + 1) % SEGMENTS;
    const a = this.last.left, b = this.last.right;
    this.positions.set([a.x, a.y, a.z, b.x, b.y, b.z, left.x, left.y, left.z, left.x, left.y, left.z, b.x, b.y, b.z, right.x, right.y, right.z], k * 18);
    // Groomed tracks are a faint cut; powder tracks are a deep lavender trench.
    const c = deep ? [0.62, 0.64, 0.82] : [0.82, 0.84, 0.92];
    for (let v = 0; v < 6; v++) this.colors.set(c, k * 18 + v * 3);
    this.last = { left, right, center };
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  clear(): void {
    this.positions.fill(0);
    this.last = null;
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}
