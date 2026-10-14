import * as THREE from 'three';

// A ring of distant low-poly peaks around the run. Fog fades them toward the sky, which gives the mountain scale.
export function buildPeaks(center: THREE.Vector3): THREE.Mesh {
  const ringSegments = 96;
  const rows = 6;
  const inner = 900;
  const outer = 1700;
  const positions: number[] = [];
  const height = (a: number, r: number): number => {
    const ridge =
      Math.abs(Math.sin(a * 3.1 + 0.6)) * 260 + Math.abs(Math.sin(a * 7.3 + 2.1)) * 120 + Math.abs(Math.sin(a * 17.7)) * 50;
    const fall = Math.sin(((r - inner) / (outer - inner)) * Math.PI); // rises from the inner edge, falls off behind
    return ridge * fall - 120;
  };
  const point = (i: number, j: number): [number, number, number] => {
    const a = (i / ringSegments) * Math.PI * 2;
    const r = inner + ((outer - inner) * j) / rows;
    return [center.x + Math.sin(a) * r, center.y + height(a, r), center.z + Math.cos(a) * r];
  };
  for (let i = 0; i < ringSegments; i++) {
    for (let j = 0; j < rows; j++) {
      const a = point(i, j), b = point(i + 1, j), c = point(i, j + 1), d = point(i + 1, j + 1);
      positions.push(...a, ...c, ...b, ...b, ...c, ...d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  // No scene fog: the far peaks get their own haze (see tintPeaks) so they stay readable as silhouettes.
  const mat = new THREE.MeshStandardMaterial({ color: 0xeef0f4, roughness: 1, flatShading: true, side: THREE.DoubleSide, fog: false });
  return new THREE.Mesh(geo, mat);
}

/** Blends the peaks toward the haze color so they sit far back without vanishing. */
export function tintPeaks(peaks: THREE.Mesh, fogColor: number): void {
  (peaks.material as THREE.MeshStandardMaterial).color.set(0xf4f2f2).lerp(new THREE.Color(fogColor), 0.55);
}
