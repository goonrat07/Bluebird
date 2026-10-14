import * as THREE from 'three';
import { RUN, centerX, heightAt, inGlade } from '../sim/terrain';
import { buildMountain } from './mountain';
import { LIFT } from '../sim/lifts';
import { VillageView } from './village';
import { CrowdView } from './crowd';
import { DogsView } from './dogs';
import type { Dog } from '../sim/dogs';
import { LiftsView, chairGeometry, chairMaterial } from './lifts';
import { TREES, type Tree, treeBaseY } from '../sim/trees';
import type { Vec3 } from '../sim/vec';
import { RiderModel, type RiderPose } from './riderModel';
import { buildPark } from './park';
import { Spray } from './spray';
import { PRESETS, blendPresets, type LightPreset } from './presets';
import { WEATHERS, Snowfall, withWeather, type Weather } from './weather';
import { Lamps } from './lamps';
import { Sky } from './sky';
import { buildPeaks, tintPeaks } from './peaks';
import { createSnowMaterial } from './snowMaterial';
import { Trails } from './trails';
import { PostEffects } from './post';

export interface FrameView extends RiderPose {
  pos: Vec3;
  vel: Vec3;
  skidding: boolean;
  /** Heading of the chairlift the rider is sitting on, or null. */
  chair: number | null;
  /** The building you're standing in on foot, if any. */
  inside: string | null;
  /** True on the frame the rider touched down. */
  justLanded: boolean;
  /** Riding through powder, where tracks are deeper. */
  deepSnow: boolean;
  /** 0..1 Flow meter; widens the view a little. */
  flow: number;
  /** On a rail or box: no tracks or spray in the snow. */
  grinding: boolean;
}

export const CAMERA = {
  /** Metres behind the rider at a standstill, plus more with speed. */
  distance: 7,
  speedDistance: 0.07,
  speedDistanceMax: 3,
  /** Metres above the rider. */
  height: 7.5,
  lookHeight: 0.6,
  /** Look this far ahead of the rider, so more of the run below is in view. */
  lookAhead: 2,
  /** In the glade the camera drops lower and tighter. */
  gladeHeight: 4,
  gladeDistance: 5.5,
  gladeLookAhead: 5,
  /** On foot, and indoors. */
  walkDistance: 4.5,
  walkHeight: 2.8,
  insideDistance: 2.6,
  insideHeight: 5,
};

const lerpAngle = (a: number, b: number, t: number): number => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

// Mid-century ski poster meets low-poly: low warm sun, lavender shade, haze on distant peaks.
export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2000);
  private readonly rider = new RiderModel();
  private readonly ghost = new RiderModel();
  private readonly lifts = new LiftsView();
  private readonly village = new VillageView();
  private readonly crowd = new CrowdView();
  private readonly dogs = new DogsView();
  /** The chair under the player while they ride a lift. */
  private readonly seat = new THREE.Mesh(chairGeometry(), chairMaterial());
  private readonly spray = new Spray();
  private readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  private readonly sunDir = new THREE.Vector3();
  private readonly sky = new Sky();
  private readonly snow = createSnowMaterial();
  private readonly peaks: THREE.Mesh;
  private readonly trails = new Trails();
  private readonly post: PostEffects;
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private camYaw = 0;
  private glade = 0;
  private presetIndex = 0;
  private weatherIndex = 0;
  private readonly snowfall = new Snowfall();
  private readonly lamps = new Lamps();
  /** The rider's headlamp, on after dark. */
  private readonly headlamp = new THREE.SpotLight(0xfff1d8, 0, 45, 0.55, 0.5, 1.2);
  /** The look on screen, and the one it is easing from toward the chosen time and weather. */
  private look: LightPreset = PRESETS[0];
  private lookFrom: LightPreset = PRESETS[0];
  private lookBlend = 1;
  private time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene.fog = new THREE.FogExp2(0xffffff, 0.001);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -60;
    sc.right = sc.top = 60;
    sc.far = 500;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    const mid = RUN.length / 2;
    this.peaks = buildPeaks(new THREE.Vector3(centerX(mid), heightAt(centerX(mid), mid), mid));
    this.scene.add(this.sky.mesh, this.peaks, buildMountain(this.snow.material), buildFinish(), buildPark(), this.forest, this.trails.mesh, this.lifts.root, this.village.root, this.crowd.root, this.dogs.root, this.seat, this.rider.root, this.ghost.root, this.spray.points, this.snowfall.points, this.lamps.root);
    // The headlamp sits on the helmet and looks a little way down the slope ahead.
    this.headlamp.position.set(0, 1.9, 0.2);
    this.headlamp.target.position.set(0, -1, 14);
    this.rider.root.add(this.headlamp, this.headlamp.target);
    this.ghost.makeGhost();
    this.ghost.root.visible = false;
    this.post = new PostEffects(this.renderer, this.scene, this.camera);
    this.applyPreset(this.targetLook());
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Steps on to the next time of day (T key), easing into it. */
  cycleLight(): string {
    this.presetIndex = (this.presetIndex + 1) % PRESETS.length;
    this.easeToLook();
    return PRESETS[this.presetIndex].name;
  }

  /** Steps on to the next weather (Y key), easing into it. */
  cycleWeather(): string {
    this.weatherIndex = (this.weatherIndex + 1) % WEATHERS.length;
    this.easeToLook();
    return WEATHERS[this.weatherIndex].name;
  }

  /** Jumps straight to a time of day and weather by name (play tests and saved settings). */
  setSky(time: string, weather?: string): void {
    const t = PRESETS.findIndex((p) => p.name === time);
    const w = WEATHERS.findIndex((x) => x.name === weather);
    if (t >= 0) this.presetIndex = t;
    if (w >= 0) this.weatherIndex = w;
    this.lookBlend = 1;
    this.applyPreset(this.targetLook());
  }

  /** The chosen time of day and weather, e.g. "Night" and "Snowstorm". */
  get skyName(): { time: string; weather: string } {
    return { time: PRESETS[this.presetIndex].name, weather: WEATHERS[this.weatherIndex].name };
  }

  get weather(): Weather {
    return WEATHERS[this.weatherIndex];
  }

  private targetLook(): LightPreset {
    return withWeather(PRESETS[this.presetIndex], this.weather);
  }

  private easeToLook(): void {
    this.lookFrom = this.look;
    this.lookBlend = 0;
    this.snowfall.set(this.weather);
  }

  clearTrails(): void {
    this.trails.clear();
  }

  private applyPreset(p: LightPreset): void {
    this.look = p;
    const w = this.weather;
    this.snowfall.set(w);
    this.post?.setFrost(w.frost);
    this.lamps.setGlow(p.lamps);
    this.village.setLamps(p.lamps);
    // Switching a light on or off recompiles shaders, so the headlamp stays on and only its strength changes.
    // Cloud softens shadows away to almost nothing.
    this.sun.shadow.intensity = 1 - 0.9 * w.overcast;
    this.headlamp.intensity = Math.max(0, p.lamps - 0.3) * 30;
    this.sunDir.set(
      Math.sin(p.sunAzimuth) * Math.cos(p.sunElevation),
      Math.sin(p.sunElevation),
      Math.cos(p.sunAzimuth) * Math.cos(p.sunElevation),
    );
    this.sun.color.set(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.hemi.color.set(p.skyLight);
    this.hemi.groundColor.set(p.groundLight);
    this.hemi.intensity = p.ambientIntensity;
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.set(p.fogColor);
    fog.density = p.fogDensity;
    this.snow.material.color.set(p.snow);
    this.snow.setSparkle(p.sparkle);
    this.renderer.toneMappingExposure = p.exposure;
    this.sky.apply(p, this.sunDir, Math.max(0, p.lamps * 2 - 1) * (1 - w.overcast));
    tintPeaks(this.peaks, p.fogColor);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Poses the event ghost for this frame, or hides it. */
  renderGhost(p: (RiderPose & { pos: Vec3 }) | null, dt: number): void {
    this.ghost.root.visible = p !== null;
    if (!p) return;
    this.ghost.root.position.set(p.pos.x, p.pos.y, p.pos.z);
    this.ghost.update(p, dt);
  }

  /** Draws one frame. `snap` jumps the camera into place instead of easing (used after a reset). */
  private readonly forest = buildTrees();

  /** The crowd near (x, z) cheers. */
  cheer(x: number, z: number): void {
    this.crowd.cheer(x, z);
  }

  get cheering(): number {
    return this.crowd.cheering;
  }

  renderDogs(dogs: Dog[], dt: number): void {
    this.dogs.update(dogs, dt);
  }

  setJacket(color: number): void {
    this.rider.setJacket(color);
  }

  render(v: FrameView, dt: number, snap = false): void {
    this.lifts.update(dt);
    this.crowd.update(dt);
    this.village.showInside(v.inside);
    // Seated on a chair: its seat is just under the rider, its grip a hang above that.
    this.seat.visible = v.chair !== null;
    if (v.chair !== null) {
      this.seat.position.set(v.pos.x, v.pos.y + LIFT.hang - 0.1, v.pos.z);
      this.seat.rotation.y = v.chair;
    }
    this.rider.root.position.set(v.pos.x, v.pos.y, v.pos.z);
    this.rider.update(v, dt);
    this.emitSpray(v);
    this.spray.update(dt);
    this.updateCamera(v, dt, snap);
    this.sky.follow(this.camera);
    if (this.lookBlend < 1) {
      // Ease through a change of light over a couple of seconds.
      this.lookBlend = Math.min(1, this.lookBlend + dt / 2);
      const t = this.lookBlend * this.lookBlend * (3 - 2 * this.lookBlend);
      const from = this.lookFrom;
      this.applyPreset(blendPresets(from, this.targetLook(), t));
      this.lookFrom = from;
    }
    this.snowfall.update(this.camera, dt);
    const at = new THREE.Vector3(v.pos.x, v.pos.y, v.pos.z);
    this.trails.update(at, v.heading, v.sport === 'board' ? 0.32 : 0.4, v.deepSnow, v.grounded && !v.grinding && !v.crashed && v.speed > 1);

    // The shadow box follows the rider; the sun keeps its direction.
    this.sun.target.position.copy(at);
    this.sun.position.copy(at).addScaledVector(this.sunDir, 200);
    // Forest patches far past the fog are skipped; the snow beneath them still reads at that distance.
    for (const patch of this.forest.children) patch.visible = patch.position.distanceTo(this.camera.position) < FOREST_DRAW + TREE_PATCH;
    this.time += dt;
    this.post.render(this.time);
  }

  private emitSpray(v: FrameView): void {
    const at = new THREE.Vector3(v.pos.x, v.pos.y, v.pos.z);
    // Spray flies out sideways from the edge, away from the turn.
    const side = new THREE.Vector3(Math.cos(v.heading), 0, -Math.sin(v.heading)).multiplyScalar(-Math.sign(v.edge) || 1);
    if (v.grinding) return;
    if (v.justLanded) this.spray.emit(at, side, 40, 1.5);
    if (!v.grounded || v.crashed || v.speed < 3) return;
    const intensity = v.skidding ? 1 : Math.abs(v.edge) > 0.6 && v.speed > 10 ? 0.4 : 0;
    if (intensity > 0) this.spray.emit(at, side, Math.ceil(intensity * 6), 2 + v.speed * 0.15 * intensity);
  }

  private updateCamera(v: FrameView, dt: number, snap: boolean): void {
    // Follow the direction of travel, not the way the rider faces, so spins don't whip the camera around.
    const hSpeed = Math.hypot(v.vel.x, v.vel.z);
    // On a chair, look up the line with the rider.
    const onFoot = v.walk !== undefined && v.walk !== null;
    const travelYaw = v.chair !== null ? v.chair : onFoot ? v.heading : hSpeed > 1.5 ? Math.atan2(v.vel.x, v.vel.z) : this.camYaw;
    const k = snap ? 1 : 1 - Math.exp(-4 * dt);
    this.camYaw = snap ? v.heading : lerpAngle(this.camYaw, travelYaw, k);

    // Higher than a classic chase cam, looking down the hill: between Riders Republic and Grand Mountain Adventure.
    const back = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
    const gladeTarget = inGlade(v.pos.x, v.pos.z) ? 1 : 0;
    this.glade = snap ? gladeTarget : this.glade + (gladeTarget - this.glade) * (1 - Math.exp(-1.5 * dt));
    const g = this.glade;
    // On foot the camera comes in close; indoors it looks down into the room with the roof off.
    const distance = onFoot
      ? v.inside
        ? CAMERA.insideDistance
        : CAMERA.walkDistance
      : CAMERA.distance + (CAMERA.gladeDistance - CAMERA.distance) * g + Math.min(CAMERA.speedDistanceMax, v.speed * CAMERA.speedDistance);
    const height = onFoot ? (v.inside ? CAMERA.insideHeight : CAMERA.walkHeight) : CAMERA.height + (CAMERA.gladeHeight - CAMERA.height) * g;
    const lookAhead = CAMERA.lookAhead + (CAMERA.gladeLookAhead - CAMERA.lookAhead) * g;
    const desired = new THREE.Vector3(v.pos.x, v.pos.y, v.pos.z).addScaledVector(back, distance);
    desired.y = Math.max(v.pos.y + height, heightAt(desired.x, desired.z) + 2);
    const look = new THREE.Vector3(v.pos.x, v.pos.y + CAMERA.lookHeight, v.pos.z).addScaledVector(back, -lookAhead);
    const kp = snap ? 1 : 1 - Math.exp(-7 * dt);
    this.camPos.lerp(desired, kp);
    this.camLook.lerp(look, kp);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    const fov = 62 + Math.min(16, v.speed * 0.35) + v.flow * 6;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-3 * dt));
      this.camera.updateProjectionMatrix();
    }
  }
}

/** A simple finish banner across the run at the bottom of the Kettle Wall. */
function buildFinish(): THREE.Group {
  const g = new THREE.Group();
  const z = RUN.finishZ;
  const cx = centerX(z);
  const flat = (color: number) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8 });
  for (const side of [-1, 1]) {
    const x = cx + side * 14;
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 0.4), flat(0x2f3b4c));
    pole.position.set(x, heightAt(x, z) + 3, z);
    pole.castShadow = true;
    g.add(pole);
  }
  const bannerMat = flat(0xd9553a);
  bannerMat.emissive.set(0x5a1a10); // reads as red even with the sun behind it
  const banner = new THREE.Mesh(new THREE.BoxGeometry(28, 1.4, 0.2), bannerMat);
  banner.position.set(cx, Math.max(heightAt(cx - 14, z), heightAt(cx + 14, z)) + 5.6, z);
  banner.castShadow = true;
  g.add(banner);
  return g;
}

function buildTrees(): THREE.Group {
  // Dark evergreen crowns carrying a load of snow on each tier.
  const crownGeo = new THREE.ConeGeometry(1.4, 5, 7);
  crownGeo.translate(0, 3.5, 0);
  // Snow sits as a cap on top and in bands on the lower tiers, just outside the crown's surface.
  const capGeo = mergeBands([
    [4.2, 6.05],
    [2.7, 3.0],
  ]);
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.28, 1.2, 6);
  trunkGeo.translate(0, 0.6, 0);
  const flat = (color: number) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.95 });
  const crownMat = flat(0x3f6657);
  const capMat = flat(0xf3f1ef);
  const trunkMat = flat(0x5a4038);
  // The forest is split into square patches so patches out of view (and out of the shadow map) are skipped.
  const patches = new Map<string, Tree[]>();
  for (const t of TREES) {
    const key = `${Math.floor(t.x / TREE_PATCH)},${Math.floor(t.z / TREE_PATCH)}`;
    const list = patches.get(key);
    if (list) list.push(t);
    else patches.set(key, [t]);
  }
  const forest = new THREE.Group();
  const m = new THREE.Matrix4();
  const spin = new THREE.Matrix4();
  for (const [key, trees] of patches) {
    // Each patch is a group placed at its centre, so it can be shown or hidden by distance.
    const [px, pz] = key.split(',').map((n) => (Number(n) + 0.5) * TREE_PATCH);
    const patch = new THREE.Group();
    patch.position.set(px, heightAt(px, pz), pz);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, trees.length);
    const caps = new THREE.InstancedMesh(capGeo, capMat, trees.length);
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
    crowns.castShadow = caps.castShadow = true;
    trees.forEach((t, i) => {
      // A little random rotation and squash so the forest doesn't look stamped.
      spin.makeRotationY((t.x * 12.9898 + t.z * 78.233) % (Math.PI * 2));
      m.makeScale(t.scale, t.scale * (0.9 + ((t.x * 7.1 + t.z) % 1 + 1) % 1 * 0.25), t.scale).premultiply(spin).setPosition(t.x - px, treeBaseY(t) - patch.position.y, t.z - pz);
      crowns.setMatrixAt(i, m);
      caps.setMatrixAt(i, m);
      trunks.setMatrixAt(i, m);
    });
    for (const mesh of [crowns, caps, trunks]) mesh.computeBoundingSphere();
    patch.add(crowns, caps, trunks);
    forest.add(patch);
  }
  return forest;
}

/** Size (m) of each square patch of forest drawn together. */
const TREE_PATCH = 120;
/** Forest is drawn out to about this far from the camera (m). */
const FOREST_DRAW = 450;

/** Crown radius at height y (the crown is a cone from y = 1 to y = 6 with base radius 1.4). */
const crownRadius = (y: number): number => Math.max(0, (1.4 * (6 - y)) / 5);

/** Open bands hugging the crown between pairs of heights, merged into one geometry. */
function mergeBands(bands: [number, number][]): THREE.BufferGeometry {
  const parts = bands.map(([y0, y1]) => {
    const g = new THREE.CylinderGeometry(crownRadius(y1) * 1.06, crownRadius(y0) * 1.06, y1 - y0, 7, 1, true).toNonIndexed();
    g.translate(0, (y0 + y1) / 2, 0);
    return g;
  });
  const count = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array as Float32Array, o);
    o += g.attributes.position.array.length;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.computeVertexNormals();
  return merged;
}
