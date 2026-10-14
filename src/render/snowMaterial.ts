import * as THREE from 'three';

/**
 * Snow: a standard material lit by a warm sun and a cool sky, so it reads cream in sun and lavender in shade,
 * plus glitter that catches the sun and twinkles as the camera moves.
 */
export function createSnowMaterial(): { material: THREE.MeshStandardMaterial; setSparkle: (s: number) => void } {
  const uniforms = { sparkle: { value: 1 } };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.sparkle = uniforms.sparkle;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSnowWorld;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvSnowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float sparkle;
        varying vec3 vSnowWorld;
        float snowHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          // Each small cell of snow has a crystal; it flashes only from certain viewing angles.
          vec3 cell = floor(vSnowWorld * 7.0);
          vec3 view = normalize(cameraPosition - vSnowWorld);
          float facet = snowHash(cell + floor(view * 24.0));
          float lit = smoothstep(0.75, 1.1, dot(outgoingLight, vec3(0.333)));
          float fade = 1.0 - smoothstep(25.0, 70.0, length(cameraPosition - vSnowWorld));
          outgoingLight += vec3(step(0.985, facet) * lit * fade * sparkle * 2.5);
        }
        #include <opaque_fragment>`,
      );
  };
  return { material, setSparkle: (s) => (uniforms.sparkle.value = s) };
}
