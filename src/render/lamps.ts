import * as THREE from 'three';
import { BASE_AREA, RUN, centerX, heightAt, normalAt } from '../sim/terrain';

/** Night-skiing lights down Kettle Run and round the village. */
export const LAMPS = {
  /** Spacing down the run (m), alternating sides. */
  spacing: 55,
  /** Distance from the centerline, out on the bank past the rideable corridor. */
  side: RUN.halfWidth + 3,
  height: 9,
  /** Radius of the pool of light thrown on the snow. */
  pool: 11,
};

/** Every lamp position: down Kettle Run, then round the village plaza. */
export function lampSpots(): { x: number; z: number; lean: number }[] {
  const spots: { x: number; z: number; lean: number }[] = [];
  let side = 1;
  for (let z = 30; z < BASE_AREA.z0; z += LAMPS.spacing, side = -side) {
    spots.push({ x: centerX(z) + side * LAMPS.side, z, lean: -side });
  }
  for (const [x, z] of [[-30, 1560], [20, 1560], [-60, 1620], [26, 1630], [-20, 1680], [60, 1660]]) {
    spots.push({ x, z, lean: 0 });
  }
  return spots;
}

/** Poles, glowing heads and soft pools of light on the snow: three instanced draws, no real lights. */
export class Lamps {
  readonly root = new THREE.Group();
  private readonly headMat = new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffc070, emissiveIntensity: 0, flatShading: true });
  private readonly poolMat = new THREE.MeshBasicMaterial({
    color: 0xffb860,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    map: poolTexture(),
  });

  constructor() {
    const spots = lampSpots();
    const pole = new THREE.CylinderGeometry(0.12, 0.16, LAMPS.height, 6);
    pole.translate(0, LAMPS.height / 2, 0);
    const poles = new THREE.InstancedMesh(pole, new THREE.MeshStandardMaterial({ color: 0x3b4152, flatShading: true }), spots.length);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.3, 0.5), this.headMat, spots.length);
    const disc = new THREE.CircleGeometry(LAMPS.pool, 24);
    disc.rotateX(-Math.PI / 2);
    const pools = new THREE.InstancedMesh(disc, this.poolMat, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    spots.forEach((s, i) => {
      const y = heightAt(s.x, s.z);
      poles.setMatrixAt(i, m.makeTranslation(s.x, y - 0.3, s.z));
      // Heads lean out over the run.
      heads.setMatrixAt(i, m.makeTranslation(s.x + s.lean * 1.2, y + LAMPS.height, s.z));
      const px = s.x + s.lean * 6;
      const n = normalAt(px, s.z);
      q.setFromUnitVectors(up, new THREE.Vector3(n.x, n.y, n.z));
      pools.setMatrixAt(i, m.compose(new THREE.Vector3(px, heightAt(px, s.z) + 0.12, s.z), q, new THREE.Vector3(1, 1, 1)));
    });
    poles.castShadow = true;
    pools.renderOrder = 1;
    this.root.add(poles, heads, pools);
  }

  /** 0 by day, 1 at night. */
  setGlow(l: number): void {
    this.headMat.emissiveIntensity = l * 3;
    this.poolMat.opacity = l * 0.5;
    this.poolMat.visible = l > 0.01;
  }
}

function poolTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}
