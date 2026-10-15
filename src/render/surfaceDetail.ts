import * as THREE from 'three';
import snowNormalUrl from '../assets/textures/snow-normal.webp';
import rockAlbedoUrl from '../assets/textures/rock-albedo.webp';
import rockNormalUrl from '../assets/textures/rock-normal.webp';

// Fine surface detail from scanned snow and rock (CC0, see src/assets/textures/CREDITS.md), laid on in world space
// so no mesh needs UVs: snow relief projected from above, and rock projected from the three axes on the faces
// a mesh marks as rock through its `rock` vertex attribute (0 snow, 1 bare rock).

export interface DetailScale {
  /** Size of one snow tile and of the larger tile laid over it to hide repeats (m). */
  snow: [number, number];
  /** The same for rock. */
  rock: [number, number];
  /** How strongly the snow relief and the rock relief bend the light. */
  snowRelief: number;
  rockRelief: number;
  /** Snow relief fades out over this distance band (m), where it would only shimmer. */
  fade: [number, number];
}

/** Off on software renderers, where the extra texture reads per pixel cost too much; set before the first frame. */
export const surfaceDetail = { enabled: true };

let textures: { snowNormal: THREE.Texture; rockAlbedo: THREE.Texture; rockNormal: THREE.Texture } | null = null;

function load(): NonNullable<typeof textures> {
  if (textures) return textures;
  const loader = new THREE.TextureLoader();
  const tex = (url: string, srgb: boolean): THREE.Texture => {
    const t = loader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  textures = { snowNormal: tex(snowNormalUrl, false), rockAlbedo: tex(rockAlbedoUrl, true), rockNormal: tex(rockNormalUrl, false) };
  return textures;
}

/** Adds the snow and rock detail to a standard material. `extra` lets the caller patch the same shader further. */
export function addSurfaceDetail(material: THREE.MeshStandardMaterial, scale: DetailScale, extra?: (shader: THREE.WebGLProgramParametersWithUniforms) => void): void {
  const t = load();
  const uniforms = {
    snowNormal: { value: t.snowNormal },
    rockAlbedo: { value: t.rockAlbedo },
    rockNormal: { value: t.rockNormal },
    snowTile: { value: new THREE.Vector2(1 / scale.snow[0], 1 / scale.snow[1]) },
    rockTile: { value: new THREE.Vector2(1 / scale.rock[0], 1 / scale.rock[1]) },
    relief: { value: new THREE.Vector2(scale.snowRelief, scale.rockRelief) },
    reliefFade: { value: new THREE.Vector2(scale.fade[0], scale.fade[1]) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float rock;\nvarying float vRock;\nvarying vec3 vDetailWorld;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvRock = rock;\nvDetailWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D snowNormal;
        uniform sampler2D rockAlbedo;
        uniform sampler2D rockNormal;
        uniform vec2 snowTile;
        uniform vec2 rockTile;
        uniform vec2 relief;
        uniform vec2 reliefFade;
        varying float vRock;
        varying vec3 vDetailWorld;
        vec3 detailWorldNormal;
        vec3 rockWeights() {
          vec3 w = pow(abs(detailWorldNormal), vec3(4.0));
          return w / (w.x + w.y + w.z);
        }
        vec3 rockSample(sampler2D map, vec3 p, vec3 w, float tile) {
          return texture2D(map, p.zy * tile).rgb * w.x + texture2D(map, p.xz * tile).rgb * w.y + texture2D(map, p.xy * tile).rgb * w.z;
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        #ifndef NO_SURFACE_DETAIL
        {
          // View space to world space and back: the view matrix is a rotation, so its transpose undoes it.
          detailWorldNormal = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          vec3 p = vDetailWorld;
          float dist = length(cameraPosition - p);
          float near = 1.0 - smoothstep(reliefFade.x, reliefFade.y, dist);
          vec3 bend = vec3(0.0);
          if (near > 0.0 && vRock < 0.99) {
            vec2 a = texture2D(snowNormal, p.xz * snowTile.x).xy * 2.0 - 1.0;
            vec2 b = texture2D(snowNormal, p.xz * snowTile.y + 0.37).xy * 2.0 - 1.0;
            vec2 s = (a * 0.7 + b * 0.5) * relief.x * near * (1.0 - vRock);
            bend += vec3(s.x, 0.0, s.y);
          }
          if (vRock > 0.01) {
            vec3 w = rockWeights();
            float r = relief.y * vRock;
            vec2 x = (texture2D(rockNormal, p.zy * rockTile.x).xy * 2.0 - 1.0) + 0.6 * (texture2D(rockNormal, p.zy * rockTile.y).xy * 2.0 - 1.0);
            vec2 y = (texture2D(rockNormal, p.xz * rockTile.x).xy * 2.0 - 1.0) + 0.6 * (texture2D(rockNormal, p.xz * rockTile.y).xy * 2.0 - 1.0);
            vec2 z = (texture2D(rockNormal, p.xy * rockTile.x).xy * 2.0 - 1.0) + 0.6 * (texture2D(rockNormal, p.xy * rockTile.y).xy * 2.0 - 1.0);
            bend += r * (vec3(0.0, x.y, x.x) * w.x + vec3(y.x, 0.0, y.y) * w.y + vec3(z.x, z.y, 0.0) * w.z);
          }
          normal = normalize((viewMatrix * vec4(normalize(detailWorldNormal + bend), 0.0)).xyz);
        }
        #endif`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        #ifndef NO_SURFACE_DETAIL
        if (vRock > 0.01) {
          // Rock grain: the scan's light and dark around the mesh's own rock colour, at two sizes.
          detailWorldNormal = normalize(vNormal * (gl_FrontFacing ? 1.0 : -1.0));
          detailWorldNormal = normalize((vec4(detailWorldNormal, 0.0) * viewMatrix).xyz);
          vec3 w = rockWeights();
          float g = rockSample(rockAlbedo, vDetailWorld, w, rockTile.x).r * 0.65 + rockSample(rockAlbedo, vDetailWorld, w, rockTile.y).r * 0.35;
          diffuseColor.rgb *= mix(1.0, 0.35 + 1.3 * g, vRock);
        }
        #endif`,
      );
    if (!surfaceDetail.enabled) shader.fragmentShader = '#define NO_SURFACE_DETAIL\n' + shader.fragmentShader;
    extra?.(shader);
  };
}

/** The per-vertex `rock` attribute for a geometry, filled by the caller. */
export function rockAttribute(geo: THREE.BufferGeometry, weights: Float32Array): void {
  geo.setAttribute('rock', new THREE.BufferAttribute(weights, 1));
}
