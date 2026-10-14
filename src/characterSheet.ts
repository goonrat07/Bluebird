import * as THREE from 'three';
import { RiderModel, type RiderPose } from './render/riderModel';
import { DogModel } from './render/dogs';
import { PERSON } from './render/crowd';
import { PALETTE, toon } from './render/toon';
import { golden } from './render/presets/golden';

// A dev-only character sheet (npm run dev, then /characters.html): everyone front-on in golden-hour
// light on a patch of snow, for judging the character style without a chase camera in the way.

const canvas = document.getElementById('sheet') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = golden.exposure;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(golden.skyHorizon);
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
camera.position.set(0, 1.6, 9.5);
camera.lookAt(0, 0.85, 0);

const sun = new THREE.DirectionalLight(golden.sunColor, golden.sunIntensity);
sun.position.set(-4, 5, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun, new THREE.HemisphereLight(golden.skyLight, golden.groundLight, golden.ambientIntensity));
const snow = new THREE.Mesh(new THREE.CircleGeometry(12, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: golden.snow, roughness: 1 }));
snow.receiveShadow = true;
scene.add(snow);

const pose = (sport: 'board' | 'ski', walk: number | null): RiderPose => ({
  heading: 0, pitch: 0, edge: 0, speed: 0, sport, grounded: true, crashed: false, crashTimer: 0, charge: 0,
  tucking: false, braking: false, grab: null, switch: false, walk, walkSpeed: 0,
});
const riders: [RiderModel, RiderPose][] = [];
const add = (x: number, sport: 'board' | 'ski', walk: number | null, jacket?: number) => {
  const r = new RiderModel();
  if (jacket) r.setJacket(jacket);
  r.root.position.x = x;
  scene.add(r.root);
  riders.push([r, pose(sport, walk)]);
};
add(-2.6, 'board', null);
add(-1.3, 'ski', null, PALETTE.denim);
add(0, 'board', 0, PALETTE.mustard);

// Villagers built from the same parts the instanced crowd uses.
const villager = (x: number, jacket: number, skin: number, hat: number) => {
  const g = new THREE.Group();
  const parts: [THREE.BufferGeometry, number, number][] = [
    [PERSON.legsStand(), PALETTE.denim, 0],
    [PERSON.torso(), jacket, 0.8],
    [PERSON.armsDown(), jacket, 0.8],
    [PERSON.head(), skin, 0.8],
    [PERSON.hat(), hat, 0.8],
    [PERSON.eyes(), PALETTE.ink, 0.8],
    [PERSON.cheeks(), PALETTE.blush, 0.8],
  ];
  for (const [geo, color, y] of parts) {
    const m = new THREE.Mesh(geo, toon(color));
    m.position.y = y;
    m.castShadow = true;
    g.add(m);
  }
  g.position.x = x;
  scene.add(g);
};
villager(1.3, PALETTE.raspberry, PALETTE.skinMid, PALETTE.oat);
villager(2.4, PALETTE.sage, PALETTE.skinDeep, PALETTE.mustard);
villager(3.4, PALETTE.plum, PALETTE.skinLight, PALETTE.terracotta);

const dogs = ['Bowie', 'Pepper'].map((name, i) => {
  const d = new DogModel(name);
  scene.add(d.root);
  return { d, x: -3.6 + i * 7.9 };
});

function frame(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  for (const [r, p] of riders) r.update(p, 1 / 60);
  for (const { d, x } of dogs) d.update({ x, y: 0, z: 0.6, heading: 0, speed: 0, wag: 0.5, happy: 0 } as never, 1 / 60);
  renderer.render(scene, camera);
  (window as unknown as { sheetFrames: number }).sheetFrames = ((window as unknown as { sheetFrames?: number }).sheetFrames ?? 0) + 1;
  requestAnimationFrame(frame);
}
frame();
