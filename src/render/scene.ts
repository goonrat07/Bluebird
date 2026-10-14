import * as THREE from 'three';
import { SLOPE, heightAt, isNearLip, snowAt } from '../sim/terrain';
import { TREES, treeBaseY } from '../sim/trees';
import type { SnowType } from '../sim/tuning';
import type { Vec3 } from '../sim/vec';
import { RiderModel, type RiderPose } from './riderModel';
import { Spray } from './spray';

export interface FrameView extends RiderPose {
  pos: Vec3;
  vel: Vec3;
  skidding: boolean;
  /** True on the frame the rider touched down. */
  justLanded: boolean;
}

const SNOW_COLORS: Record<SnowType, THREE.Color> = {
  groomed: new THREE.Color(0xe6eaf0),
  powder: new THREE.Color(0xf7fbff),
  ice: new THREE.Color(0xb9cde0),
};
const KICKER_TINT = new THREE.Color(0xc9d6e8);

export const CAMERA = {
  /** Metres behind the rider at a standstill, plus more with speed. */
  distance: 7,
  speedDistance: 0.07,
  speedDistanceMax: 3,
  /** Metres above the rider. */
  height: 7.5,
  lookHeight: 0.6,
  /** Look this far ahead of the rider, so more of the run below is in view. */
  lookAhead: 2,
};

const lerpAngle = (a: number, b: number, t: number): number => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

// Gray-box look for the feel prototype; the real art direction arrives in Phase 2.
export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2000);
  private readonly rider = new RiderModel();
  private readonly spray = new Spray();
  private readonly sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private camYaw = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const sky = new THREE.Color(0x9fb8d6);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 120, 650);

    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x8a8f99, 1.1));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -40;
    sc.right = sc.top = 40;
    sc.far = 250;
    this.scene.add(this.sun, this.sun.target);

    this.scene.add(buildSlope(), ...buildTrees(), this.rider.root, this.spray.points);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Draws one frame. `snap` jumps the camera into place instead of easing (used after a reset). */
  render(v: FrameView, dt: number, snap = false): void {
    this.rider.root.position.set(v.pos.x, v.pos.y, v.pos.z);
    this.rider.update(v, dt);
    this.emitSpray(v);
    this.spray.update(dt);
    this.updateCamera(v, dt, snap);

    this.sun.position.set(v.pos.x - 40, v.pos.y + 80, v.pos.z - 30);
    this.sun.target.position.set(v.pos.x, v.pos.y, v.pos.z);
    this.renderer.render(this.scene, this.camera);
  }

  private emitSpray(v: FrameView): void {
    const at = new THREE.Vector3(v.pos.x, v.pos.y, v.pos.z);
    // Spray flies out sideways from the edge, away from the turn.
    const side = new THREE.Vector3(Math.cos(v.heading), 0, -Math.sin(v.heading)).multiplyScalar(-Math.sign(v.edge) || 1);
    if (v.justLanded) this.spray.emit(at, side, 40, 1.5);
    if (!v.grounded || v.crashed || v.speed < 3) return;
    const intensity = v.skidding ? 1 : Math.abs(v.edge) > 0.6 && v.speed > 10 ? 0.4 : 0;
    if (intensity > 0) this.spray.emit(at, side, Math.ceil(intensity * 6), 2 + v.speed * 0.15 * intensity);
  }

  private updateCamera(v: FrameView, dt: number, snap: boolean): void {
    // Follow the direction of travel, not the way the rider faces, so spins don't whip the camera around.
    const hSpeed = Math.hypot(v.vel.x, v.vel.z);
    const travelYaw = hSpeed > 1.5 ? Math.atan2(v.vel.x, v.vel.z) : this.camYaw;
    const k = snap ? 1 : 1 - Math.exp(-4 * dt);
    this.camYaw = snap ? v.heading : lerpAngle(this.camYaw, travelYaw, k);

    // Higher than a classic chase cam, looking down the hill: between Riders Republic and Grand Mountain Adventure.
    const back = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
    const distance = CAMERA.distance + Math.min(CAMERA.speedDistanceMax, v.speed * CAMERA.speedDistance);
    const desired = new THREE.Vector3(v.pos.x, v.pos.y, v.pos.z).addScaledVector(back, distance);
    desired.y = Math.max(v.pos.y + CAMERA.height, heightAt(desired.x, desired.z) + 2);
    const look = new THREE.Vector3(v.pos.x, v.pos.y + CAMERA.lookHeight, v.pos.z).addScaledVector(back, -CAMERA.lookAhead);
    const kp = snap ? 1 : 1 - Math.exp(-7 * dt);
    this.camPos.lerp(desired, kp);
    this.camLook.lerp(look, kp);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    const fov = 62 + Math.min(16, v.speed * 0.35);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-3 * dt));
      this.camera.updateProjectionMatrix();
    }
  }
}

function buildSlope(): THREE.Mesh {
  const width = SLOPE.halfWidth * 2;
  const geo = new THREE.PlaneGeometry(width, SLOPE.length + 100, 140, 650);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, SLOPE.length / 2);
  const p = geo.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    p.setY(i, heightAt(x, z));
    c.copy(SNOW_COLORS[snowAt(x, z)]);
    if (heightAt(x, z) - heightAt(x + 8, z) > 0.5 && Math.abs(x) < 8) c.lerp(KICKER_TINT, 0.5);
    if (isNearLip(x, z)) c.set(0x7f97b8); // mark the lip so it's easy to time the pop
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  mesh.receiveShadow = true;
  return mesh;
}

function buildTrees(): THREE.Object3D[] {
  const crownGeo = new THREE.ConeGeometry(1.4, 5, 7);
  crownGeo.translate(0, 3.5, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.28, 1.2, 6);
  trunkGeo.translate(0, 0.6, 0);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x3f5a4a, flatShading: true }), TREES.length);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a4636 }), TREES.length);
  crowns.castShadow = true;
  const m = new THREE.Matrix4();
  TREES.forEach((t, i) => {
    m.makeScale(t.scale, t.scale, t.scale).setPosition(t.x, treeBaseY(t), t.z);
    crowns.setMatrixAt(i, m);
    trunks.setMatrixAt(i, m);
  });
  return [crowns, trunks];
}
