import * as THREE from 'three';
import { Sky as PhysicalSky } from 'three/addons/objects/Sky.js';
import type { LightPreset } from './presets';

// A physically based sky (Preetham scattering with drifting clouds) that follows the camera. After dark a
// moonlit gradient with stars takes over, the clouds still drifting across it as dim grey shapes.
// The same sky also lights the scene: see SceneView, which renders it into an environment map.

const NIGHT_GLSL = /* glsl */ `
  uniform float night;
  uniform float skyGain;
  uniform float stars;
  uniform vec3 nightHorizon;
  uniform vec3 nightZenith;
  float starHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
`;

// Preetham radiance is in physical units, far brighter than the sunlit snow at the same exposure; this brings
// the scattered daylight into the snow's range so one exposure suits both.
const SKY_GAIN = 0.1;

export class Sky {
  readonly mesh: PhysicalSky;
  private readonly u: Record<string, THREE.IUniform>;
  private readonly sunPos = new THREE.Vector3();

  constructor() {
    this.mesh = new PhysicalSky();
    const m = this.mesh.material as THREE.ShaderMaterial;
    this.u = m.uniforms;
    Object.assign(this.u, {
      night: { value: 0 },
      skyGain: { value: SKY_GAIN },
      stars: { value: 0 },
      nightHorizon: { value: new THREE.Color() },
      nightZenith: { value: new THREE.Color() },
    });
    m.fragmentShader = m.fragmentShader
      .replace('void main() {', `${NIGHT_GLSL}\nvoid main() {\nfloat cloudA = 0.0;`)
      .replace('texColor = mix( texColor, cloudAerial, alpha );', 'texColor = mix( texColor, cloudAerial, alpha );\ncloudA = alpha;')
      .replace(
        'gl_FragColor = vec4( texColor, 1.0 );',
        `texColor *= skyGain;
        if ( night > 0.0 ) {
          vec3 d = normalize( vWorldPosition - cameraPosition );
          vec3 nightCol = mix( nightHorizon, nightZenith, pow( clamp( d.y, 0.0, 1.0 ), 0.5 ) );
          vec3 cell = floor( d * 300.0 );
          float star = step( 0.9978, starHash( cell ) ) * ( 0.4 + 0.6 * starHash( cell + 3.1 ) );
          nightCol += vec3( star * stars * smoothstep( 0.04, 0.3, d.y ) ) * ( 1.0 - cloudA );
          // Clouds at night: dim, faintly lit by the moon.
          nightCol = mix( nightCol, nightHorizon * 1.25, cloudA * 0.85 );
          texColor = mix( texColor, nightCol, night );
        }
        gl_FragColor = vec4( texColor, 1.0 );`,
      );
    m.fog = false;
    this.mesh.scale.setScalar(1500);
    this.mesh.frustumCulled = false;
    // Drawn after the opaque world: its vertices sit on the far plane, so the depth test skips every pixel the
    // mountain already covers instead of running the scattering and cloud shader under it.
    this.mesh.renderOrder = 1000;
  }

  apply(p: LightPreset, sunDir: THREE.Vector3, stars: number, overcast: number): void {
    const u = this.u;
    u.turbidity.value = p.turbidity + overcast * 8;
    u.rayleigh.value = p.rayleigh * (1 - 0.6 * overcast);
    u.mieCoefficient.value = 0.004 + overcast * 0.02;
    u.mieDirectionalG.value = 0.82;
    u.cloudCoverage.value = Math.min(1, p.clouds + overcast * 0.9);
    u.cloudDensity.value = 0.45 + overcast * 0.5;
    u.cloudElevation.value = 0.55;
    u.showSunDisc.value = p.night > 0.5 ? 0 : 1 - overcast;
    this.sunPos.copy(sunDir).multiplyScalar(1000);
    u.sunPosition.value.copy(this.sunPos);
    u.night.value = p.night;
    u.stars.value = stars;
    u.nightHorizon.value.set(p.skyHorizon);
    u.nightZenith.value.set(p.skyZenith);
  }

  tick(time: number): void {
    this.u.time.value = time;
  }

  follow(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }
}
