import * as THREE from 'three';
import { addSurfaceDetail, type DetailScale } from './surfaceDetail';

/** Snow relief in 2 m and 9 m tiles, fading out by 140 m; rock in 4 m and 23 m tiles. */
const TERRAIN_DETAIL: DetailScale = { snow: [2, 9], rock: [4, 23], snowRelief: 0.35, rockRelief: 0.8, fade: [40, 140] };

/**
 * Snow: a standard material lit by a warm sun and a cool sky, so it reads cream in sun and lavender in shade,
 * fine relief from a scanned snow surface and scanned rock on the steep faces (see surfaceDetail.ts),
 * plus glitter that catches the sun and twinkles as the camera moves.
 */
export function createSnowMaterial(): { material: THREE.MeshStandardMaterial; setSparkle: (s: number) => void } {
  const uniforms = { sparkle: { value: 1 } };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  addSurfaceDetail(material, TERRAIN_DETAIL, (shader) => {
    shader.uniforms.sparkle = uniforms.sparkle;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float sparkle;
        float snowHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          // Each small cell of snow has a crystal; it flashes only from certain viewing angles.
          vec3 cell = floor(vDetailWorld * 7.0);
          vec3 view = normalize(cameraPosition - vDetailWorld);
          float facet = snowHash(cell + floor(view * 24.0));
          float lit = smoothstep(0.75, 1.1, dot(outgoingLight, vec3(0.333)));
          float fade = 1.0 - smoothstep(25.0, 70.0, length(cameraPosition - vDetailWorld));
          outgoingLight += vec3(step(0.985, facet) * lit * fade * sparkle * 2.5 * (1.0 - vRock));
        }
        #include <opaque_fragment>`,
      );
  });
  return { material, setSparkle: (s) => (uniforms.sparkle.value = s) };
}
