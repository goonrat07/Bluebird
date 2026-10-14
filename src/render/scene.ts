import * as THREE from 'three';
import { SLOPE, heightAt } from '../sim/terrain';
import type { Vec3 } from '../sim/vec';

// Placeholder look for Phase 0: gray-box slope, cone trees, capsule rider. Art direction arrives in Phase 2.
export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(65, 1, 0.1, 2000);
  private readonly rider = new THREE.Group();
  private readonly sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const sky = new THREE.Color(0x9fb8d6);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 120, 650);

    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x8a8f99, 1.1));
    this.sun.position.set(-40, 80, -30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -40;
    sc.right = sc.top = 40;
    sc.far = 250;
    this.scene.add(this.sun, this.sun.target);

    this.scene.add(buildSlope(), buildTrees());
    this.buildRider();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private buildRider(): void {
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 0.9, 4, 12),
      new THREE.MeshStandardMaterial({ color: 0xe0563b, flatShading: true }),
    );
    body.position.y = 0.85;
    body.castShadow = true;
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.05, 1.5),
      new THREE.MeshStandardMaterial({ color: 0x223044 }),
    );
    board.position.y = 0.03;
    board.castShadow = true;
    this.rider.add(body, board);
    this.scene.add(this.rider);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Draws one frame. `snap` jumps the camera into place instead of easing (used after a reset). */
  render(pos: Vec3, heading: number, dt: number, snap = false): void {
    this.rider.position.set(pos.x, pos.y, pos.z);
    this.rider.rotation.y = heading;

    const back = new THREE.Vector3(-Math.sin(heading), 0, -Math.cos(heading));
    const desired = new THREE.Vector3(pos.x, pos.y, pos.z).addScaledVector(back, 7).add(new THREE.Vector3(0, 3.2, 0));
    const look = new THREE.Vector3(pos.x, pos.y + 1, pos.z).addScaledVector(back, -4);
    const k = snap ? 1 : 1 - Math.exp(-6 * dt);
    this.camPos.lerp(desired, k);
    this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    this.sun.position.set(pos.x - 40, pos.y + 80, pos.z - 30);
    this.sun.target.position.set(pos.x, pos.y, pos.z);

    this.renderer.render(this.scene, this.camera);
  }
}

function buildSlope(): THREE.Mesh {
  const width = SLOPE.halfWidth * 2;
  const geo = new THREE.PlaneGeometry(width, SLOPE.length + 100, 140, 650);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, SLOPE.length / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.9 }));
  mesh.receiveShadow = true;
  return mesh;
}

function buildTrees(): THREE.InstancedMesh {
  const count = 900;
  const geo = new THREE.ConeGeometry(1.4, 6, 7);
  geo.translate(0, 3, 0);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x3f5a4a, flatShading: true }), count);
  mesh.castShadow = true;
  // Fixed-seed scatter so every load looks the same (and screenshots compare cleanly).
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    const x = side * (32 + rand() * 36);
    const z = rand() * SLOPE.length;
    const s = 0.7 + rand() * 0.8;
    m.makeScale(s, s, s).setPosition(x, heightAt(x, z), z);
    mesh.setMatrixAt(i, m);
  }
  return mesh;
}
