import * as THREE from 'three';
import type { LightPreset } from './presets';

// A gradient sky dome with a soft glow around the sun. It follows the camera, so it never gets closer.
export class Sky {
  readonly mesh: THREE.Mesh;
  private readonly uniforms = {
    horizon: { value: new THREE.Color() },
    zenith: { value: new THREE.Color() },
    glow: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    stars: { value: 0 },
  };

  constructor() {
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww; // always at the far plane
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 horizon;
        uniform vec3 zenith;
        uniform vec3 glow;
        uniform vec3 sunDir;
        uniform float stars;
        varying vec3 vDir;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.1, 1.0);
          vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.55));
          float s = max(dot(d, sunDir), 0.0);
          col += glow * (pow(s, 8.0) * 0.35 + pow(s, 600.0) * 1.5);
          // A scatter of stars on clear nights, fading out toward the horizon haze.
          if (stars > 0.0) {
            vec3 cell = floor(d * 260.0);
            float star = step(0.9975, hash(cell)) * (0.5 + 0.5 * hash(cell + 3.1));
            col += vec3(star * stars * smoothstep(0.05, 0.35, d.y));
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1500, 64, 32), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  apply(p: LightPreset, sunDir: THREE.Vector3, stars = 0): void {
    this.uniforms.stars.value = stars;
    this.uniforms.horizon.value.set(p.skyHorizon);
    this.uniforms.zenith.value.set(p.skyZenith);
    this.uniforms.glow.value.set(p.sunGlow);
    this.uniforms.sunDir.value.copy(sunDir);
  }

  follow(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }
}
