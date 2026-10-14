import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Gentle bloom on bright snow and sun glints, a light vignette and a little film grain.
const FinishShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, vignette: { value: 0.28 }, grain: { value: 0.025 }, frost: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float vignette;
    uniform float grain;
    uniform float frost;
    varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5));
      c.rgb *= 1.0 - vignette * (1.0 - frost) * smoothstep(0.35, 0.85, d);
      // Goggles fogging up round the edges in a storm.
      float fr = frost * smoothstep(0.32, 0.78, d + sin(vUv.x * 37.0) * sin(vUv.y * 29.0) * 0.03);
      c.rgb = mix(c.rgb, vec3(0.86, 0.89, 0.94), fr * 0.75);
      c.rgb += (rand(vUv * 1000.0 + time) - 0.5) * grain;
      gl_FragColor = c;
    }`,
};

export class PostEffects {
  private readonly composer: EffectComposer;
  private readonly finish: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.5, 0.92));
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  /** Goggle frost at the screen edges, 0..1. */
  setFrost(f: number): void {
    this.finish.uniforms.frost.value = f;
  }

  render(time: number): void {
    this.finish.uniforms.time.value = time % 100;
    this.composer.render();
  }
}
