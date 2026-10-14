import * as THREE from 'three';
import { LIFT, LIFTS, type Lift, cablePoint } from '../sim/lifts';
import { heightAt } from '../sim/terrain';

// Chairlifts in the poster style: chunky stations with a warm roof, slim steel towers,
// a cable up each side, and chairs that keep circulating whether or not you're on one.

const STEEL = 0x5d6878;
const ROOF = 0xc2543a;
const WALL = 0xe9dcc4;
const CHAIR = 0x3a4a63;
/** Gap between the up and down cables, and between chairs on a cable (m). */
const GAUGE = 4.6;
const CHAIR_GAP = 24;

const flat = (color: number) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8 });

/** A chair: hanger bar, seat and backrest, hanging from its grip at y = 0, facing +z. */
export function chairGeometry(): THREE.BufferGeometry {
  const parts = [
    new THREE.BoxGeometry(0.08, LIFT.hang, 0.08).translate(0, -LIFT.hang / 2, 0),
    new THREE.BoxGeometry(1.8, 0.1, 0.6).translate(0, -LIFT.hang - 0.05, 0.1),
    new THREE.BoxGeometry(1.8, 0.7, 0.08).translate(0, -LIFT.hang + 0.35, -0.2),
    new THREE.BoxGeometry(1.8, 0.06, 0.06).translate(0, -LIFT.hang + 0.55, 0.55), // safety bar
  ].map((g) => g.toNonIndexed());
  const count = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array as Float32Array, o);
    o += g.attributes.position.array.length;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.computeVertexNormals();
  return merged;
}

export const chairMaterial = (): THREE.Material => flat(CHAIR);

/** Up-line (+1) or down-line (-1) cable point, offset to that side of the lift's centerline. */
function sidePoint(lift: Lift, s: number, side: 1 | -1, out: THREE.Vector3): THREE.Vector3 {
  const p = cablePoint(lift, s);
  // Riders go up on the right-hand cable looking up the line.
  return out.set(p.x - lift.dir.z * side * (GAUGE / 2), p.y, p.z + lift.dir.x * side * (GAUGE / 2));
}

function station(lift: Lift, end: 'bottom' | 'top'): THREE.Group {
  const g = new THREE.Group();
  const [x, z] = lift[end];
  const y = heightAt(x, z);
  const hut = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 4), flat(WALL));
  hut.position.set(0, 1.5, 0);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(4.4, 2, 4), flat(ROOF));
  roof.rotation.y = Math.PI / 4;
  roof.position.set(0, 4, 0);
  // The bullwheel's housing: a long box over the line, wide enough to carry both cables.
  const wheel = new THREE.Mesh(new THREE.BoxGeometry(GAUGE + 0.8, 0.9, 3.2), flat(STEEL));
  wheel.position.set(0, LIFT.stationHeight + 0.2, 0);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, LIFT.stationHeight, 0.6), flat(STEEL));
  post.position.set(0, LIFT.stationHeight / 2, 0);
  // The hut sits beside the line, on the downhill-right of the wheel.
  hut.position.x = GAUGE + 1.5;
  roof.position.x = GAUGE + 1.5;
  for (const m of [hut, roof, wheel, post]) {
    m.castShadow = true;
    g.add(m);
  }
  g.position.set(x, y, z);
  g.rotation.y = lift.heading;
  return g;
}

export class LiftsView {
  readonly root = new THREE.Group();
  private readonly chairs: { lift: Lift; mesh: THREE.InstancedMesh; count: number }[] = [];
  private time = 0;

  constructor() {
    const towerGeo = new THREE.CylinderGeometry(0.28, 0.4, 1, 6).translate(0, 0.5, 0);
    const armGeo = new THREE.BoxGeometry(GAUGE + 1, 0.3, 0.3);
    const steel = flat(STEEL);
    const chairGeo = chairGeometry();
    const chairMat = chairMaterial();
    for (const lift of LIFTS) {
      const mid = lift.towers.slice(1, -1);
      const towers = new THREE.InstancedMesh(towerGeo, steel, mid.length);
      const arms = new THREE.InstancedMesh(armGeo, steel, mid.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), lift.heading);
      mid.forEach((t, i) => {
        const h = t.top.y - t.ground + 0.6;
        m.compose(new THREE.Vector3(t.top.x, t.ground - 0.5, t.top.z), q, new THREE.Vector3(1, h, 1));
        towers.setMatrixAt(i, m);
        m.compose(new THREE.Vector3(t.top.x, t.top.y + 0.1, t.top.z), q, new THREE.Vector3(1, 1, 1));
        arms.setMatrixAt(i, m);
      });
      towers.castShadow = arms.castShadow = true;
      this.root.add(towers, arms, station(lift, 'bottom'), station(lift, 'top'));

      // Cables up and down, each a polyline over the tower tops.
      const pts: THREE.Vector3[] = [];
      for (const side of [1, -1] as const) {
        for (let i = 1; i < lift.towers.length; i++) {
          pts.push(sidePoint(lift, lift.towers[i - 1].s, side, new THREE.Vector3()), sidePoint(lift, lift.towers[i].s, side, new THREE.Vector3()));
        }
      }
      const cable = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x3a3f4c }));
      this.root.add(cable);

      const count = Math.floor((2 * lift.length) / CHAIR_GAP);
      const mesh = new THREE.InstancedMesh(chairGeo, chairMat, count);
      mesh.castShadow = true;
      mesh.frustumCulled = false; // chairs move every frame; the line is long
      this.root.add(mesh);
      this.chairs.push({ lift, mesh, count });
    }
  }

  /** Moves the circulating chairs along; `skip` hides the one under a rider who is riding. */
  update(dt: number): void {
    this.time += dt;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    for (const { lift, mesh, count } of this.chairs) {
      const loop = 2 * lift.length;
      for (let i = 0; i < count; i++) {
        const d = (this.time * LIFT.speed + i * CHAIR_GAP) % loop;
        const goingUp = d < lift.length;
        const s = goingUp ? d : loop - d;
        sidePoint(lift, s, goingUp ? 1 : -1, p);
        q.setFromAxisAngle(up, goingUp ? lift.heading : lift.heading + Math.PI);
        mesh.setMatrixAt(i, m.compose(p, q, one));
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
