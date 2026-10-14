import * as THREE from 'three';

const PEAKS = { lift: 1.5, sink: 300 };

/** Snow holds where the face is gentler than this (normal's up component), fading out by `bare`. */
const HOLD = { snow: 0.36, bare: 0.16 };
const SNOW = new THREE.Color(0xf4f1ef);
/** Rock in two tones, laid down in strata so the cliffs read as layered stone. */
const ROCK_A = new THREE.Color(0xa69cab);
const ROCK_B = new THREE.Color(0x8a8396);

// A ring of distant peaks around the mountain: craggy ridgelines, snow on the ledges and gentler
// faces, layered rock on the steep ones, cut in crisp facets like a travel poster. Their own haze (tintPeaks) fades them toward
// the sky, which gives the mountain scale.
export function buildPeaks(center: THREE.Vector3): THREE.Mesh {
  const ringSegments = 220;
  const rows = 14;
  const inner = 900;
  const outer = 1700;
  const height = (a: number, r: number): number => {
    const ridge =
      Math.abs(Math.sin(a * 3.1 + 0.6)) * 260 +
      Math.abs(Math.sin(a * 7.3 + 2.1)) * 120 +
      Math.abs(Math.sin(a * 17.7)) * 50 +
      // Crags: small sharp bumps along the ridge and down the faces.
      Math.abs(Math.sin(a * 41 + r * 0.011)) * 22 +
      Math.sin(a * 93 + r * 0.03) * 9;
    const fall = Math.sin(((r - inner) / (outer - inner)) * Math.PI); // rises from the inner edge, falls off behind
    // Tall enough to stand over Kettle Peak's summit, and sunk at the inner edge so no sky shows beneath.
    return ridge * PEAKS.lift * fall - 120 - PEAKS.sink * (1 - fall);
  };
  const positions: number[] = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= ringSegments; i++) {
      // The last column repeats the first exactly, so the ring closes without a crack.
      const a = ((i % ringSegments) / ringSegments) * Math.PI * 2;
      const r = inner + ((outer - inner) * j) / rows;
      positions.push(center.x + Math.sin(a) * r, center.y + height(a, r), center.z + Math.cos(a) * r);
    }
  }
  const index: number[] = [];
  const w = ringSegments + 1;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < ringSegments; i++) {
      const a = j * w + i;
      index.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  // The ring closes on itself: give the seam's twin vertices one shared normal so no line shows.
  const n = geo.attributes.normal;
  for (let j = 0; j <= rows; j++) {
    const a = j * w;
    const b = a + ringSegments;
    const v = new THREE.Vector3(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, v.x, v.y, v.z);
    n.setXYZ(b, v.x, v.y, v.z);
  }
  // Paint snow and rock from each vertex's own slope.
  const normals = geo.attributes.normal;
  const colors = new Float32Array(normals.count * 3);
  const c = new THREE.Color();
  for (let v = 0; v < normals.count; v++) {
    const up = Math.abs(normals.getY(v));
    const y = positions[v * 3 + 1] - center.y;
    const strata = 0.5 + 0.5 * Math.sin(y * 0.045 + Math.sin(v * 0.37) * 0.8);
    c.copy(ROCK_A).lerp(ROCK_B, strata);
    // Higher up, more of the face holds snow; a little noise breaks the snowline into gullies.
    const high = Math.min(1, Math.max(0, (y - 150) / 300)) * 0.12;
    const noise = (Math.sin(v * 1.7) * Math.sin(v * 0.23)) * 0.08;
    const snow = Math.min(1, Math.max(0, (up + high + noise - HOLD.bare) / (HOLD.snow - HOLD.bare)));
    c.lerp(SNOW, snow);
    colors.set([c.r, c.g, c.b], v * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // No scene fog: the far peaks get their own haze (see tintPeaks) so they stay readable as silhouettes.
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, side: THREE.DoubleSide, fog: false });
  return new THREE.Mesh(geo, mat);
}

/** Blends the peaks toward the haze color so they sit far back without vanishing. */
export function tintPeaks(peaks: THREE.Mesh, fogColor: number): void {
  (peaks.material as THREE.MeshStandardMaterial).color.set(0xffffff).lerp(new THREE.Color(fogColor), 0.5);
}
