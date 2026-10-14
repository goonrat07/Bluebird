import * as THREE from 'three';
import { BUILDINGS, type Building, COUNTERS, PARKING, POND, TABLES } from '../sim/village';
import { heightAt } from '../sim/terrain';

// The base village in the poster style: warm timber walls, red and slate roofs, glowing windows,
// with the inside of each shop furnished so walking in feels like somewhere.

const flat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra });

const MAT = {
  timber: flat(0xc98f5e),
  timberDark: flat(0x8a5a3c),
  plaster: flat(0xeadfc8),
  roofRed: flat(0xc2543a),
  roofSlate: flat(0x56607a),
  window: flat(0xffd59a, { emissive: 0xffb45e, emissiveIntensity: 0.55 }),
  floor: flat(0xb98a62),
  stone: flat(0x8d8a96),
  fire: flat(0xffb347, { emissive: 0xff7a1a, emissiveIntensity: 1.4 }),
  table: flat(0x7a5236),
  umbrella: flat(0x2d6cc0),
  ice: flat(0xc9e2f0, { roughness: 0.25, metalness: 0.05 }),
  asphalt: flat(0x6c6f7d),
  line: flat(0xe8e4da),
  orange: flat(0xe08a3c),
};

const ROOF_MAT: Record<Building['id'], THREE.Material> = {
  lodge: MAT.roofRed,
  rental: MAT.roofSlate,
  outfitter: MAT.roofRed,
  cafe: MAT.roofSlate,
  patrol: MAT.roofRed,
};
const WALL_MAT: Record<Building['id'], THREE.Material> = {
  lodge: MAT.timber,
  rental: MAT.plaster,
  outfitter: MAT.timber,
  cafe: MAT.plaster,
  patrol: MAT.plaster,
};

const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

/** A sign with the shop's name painted on, from a canvas. */
function sign(text: string, width: number): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2b2b38';
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = '#f4ecdc';
  ctx.font = '700 52px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.toUpperCase(), 256, 50, 480);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(width, width * (96 / 512)), new THREE.MeshBasicMaterial({ map: tex }));
}

export interface BuildingView {
  building: Building;
  /** Roof and upper walls, hidden while you're inside so the camera can see in. */
  lid: THREE.Group;
}

function buildBuilding(b: Building): { group: THREE.Group; view: BuildingView } {
  const g = new THREE.Group();
  const lid = new THREE.Group();
  const y = b.floor;
  const wall = WALL_MAT[b.id];
  const t = 0.3;
  // A plinth down into the snow so the building sits on the slope without gaps.
  const low = Math.min(
    heightAt(b.x - b.w / 2, b.z - b.d / 2),
    heightAt(b.x + b.w / 2, b.z - b.d / 2),
    heightAt(b.x - b.w / 2, b.z + b.d / 2),
    heightAt(b.x + b.w / 2, b.z + b.d / 2),
  );
  g.add(mesh(new THREE.BoxGeometry(b.w + 0.4, y - low + 0.6, b.d + 0.4), MAT.stone, b.x, (y + low) / 2 - 0.3, b.z));

  if (b.door === null) {
    g.add(mesh(new THREE.BoxGeometry(b.w, b.height, b.d), wall, b.x, y + b.height / 2, b.z));
  } else {
    const h = b.height;
    const front = b.z - b.d / 2;
    const side = (b.w - b.door) / 2;
    // Walls to door height stay; above that is part of the lid.
    const doorH = 2.4;
    for (const s of [-1, 1]) {
      g.add(mesh(new THREE.BoxGeometry(side, doorH, t), wall, b.x + s * (b.door / 2 + side / 2), y + doorH / 2, front));
      g.add(mesh(new THREE.BoxGeometry(t, doorH, b.d), wall, b.x + s * (b.w / 2), y + doorH / 2, b.z));
    }
    g.add(mesh(new THREE.BoxGeometry(b.w, doorH, t), wall, b.x, y + doorH / 2, b.z + b.d / 2));
    lid.add(mesh(new THREE.BoxGeometry(b.w + t, h - doorH, b.d + t), wall, b.x, y + doorH + (h - doorH) / 2, b.z));
    g.add(mesh(new THREE.BoxGeometry(b.w - t, 0.1, b.d - t), MAT.floor, b.x, y + 0.05, b.z));
  }
  // Pitched roof, ridge running across the hill.
  const roofH = Math.min(3.2, b.d * 0.35);
  // A four-sided cone turned square to the walls, then stretched to the building: eaves 0.6 m out all round.
  const roofGeo = new THREE.CylinderGeometry(0.01, (b.d / 2 + 0.6) * Math.SQRT2, roofH, 4, 1);
  roofGeo.rotateY(Math.PI / 4);
  const roof = new THREE.Mesh(roofGeo, ROOF_MAT[b.id]);
  roof.scale.set((b.w + 1.2) / (b.d + 1.2), 1, 1);
  roof.position.set(b.x, y + b.height + roofH / 2, b.z);
  roof.castShadow = true;
  lid.add(roof);
  // Warm windows on the uphill and side faces.
  const winGeo = new THREE.BoxGeometry(1.2, 1, 0.08);
  for (let wx = b.x - b.w / 2 + 2; wx <= b.x + b.w / 2 - 2; wx += 3.2) {
    if (b.door !== null && Math.abs(wx - b.x) < b.door / 2 + 0.8) continue;
    lid.add(mesh(winGeo, MAT.window, wx, y + b.height - 1.1, b.z - b.d / 2 - 0.17));
  }
  const s = sign(b.name, Math.min(b.w * 0.8, 9));
  // Hung out past the eave (0.6 m) and above the windows, so the roof never cuts through it.
  const signH = Math.min(b.w * 0.8, 9) * (96 / 512);
  s.position.set(b.x, y + b.height - 0.35 + signH / 2, b.z - b.d / 2 - 0.85);
  s.rotation.y = Math.PI; // faces uphill, toward riders coming down
  lid.add(s);
  g.add(lid);
  return { group: g, view: { building: b, lid } };
}

/** Furniture inside the walk-in shops and the lodge. */
function interiors(): THREE.Group {
  const g = new THREE.Group();
  for (const c of COUNTERS) {
    const b = BUILDINGS.find((b) => b.id === c.building)!;
    const y = b.floor;
    if (c.action === 'warmUp') {
      // A stone fireplace on the back wall with a fire you can stand by.
      g.add(mesh(new THREE.BoxGeometry(3, 2.6, 1), MAT.stone, c.x, y + 1.3, b.z + b.d / 2 - 0.6));
      const fire = mesh(new THREE.ConeGeometry(0.45, 0.9, 6), MAT.fire, c.x, y + 0.6, b.z + b.d / 2 - 1);
      fire.castShadow = false;
      g.add(fire);
      const glow = new THREE.PointLight(0xff9a4a, 6, 12, 1.6);
      glow.position.set(c.x, y + 1.2, b.z + b.d / 2 - 1.6);
      glow.userData.building = b.id;
      g.add(glow);
    } else {
      // A warm lamp over the shop floor.
      const lamp = new THREE.PointLight(0xffd29a, 5, 14, 1.4);
      lamp.position.set(b.x, y + b.height - 0.6, b.z);
      lamp.userData.building = b.id;
      g.add(lamp);
      // A counter across the back with goods behind it.
      g.add(mesh(new THREE.BoxGeometry(4, 1.05, 0.7), MAT.timberDark, c.x, y + 0.52, c.z + 1.2));
      const rack = c.action === 'swapGear' ? [0x2a3a55, 0xe0563b, 0x2f8f5b, 0x5b8fd6, 0xe0b13b] : [0xe2725b, 0x3e5c8a, 0x4f8f7a, 0xf2b544, 0xd9637e];
      rack.forEach((color, i) => {
        const x = b.x - b.w / 2 + 1.2 + i * ((b.w - 2.4) / (rack.length - 1));
        const item =
          c.action === 'swapGear'
            ? mesh(new THREE.BoxGeometry(0.3, 1.6, 0.06), flat(color), x, y + 0.9, b.z + b.d / 2 - 0.4)
            : mesh(new THREE.BoxGeometry(0.55, 0.65, 0.2), flat(color), x, y + 1.5, b.z + b.d / 2 - 0.4);
        item.rotation.z = c.action === 'swapGear' ? 0.12 : 0;
        g.add(item);
      });
    }
  }
  return g;
}

function tables(): THREE.Group {
  const g = new THREE.Group();
  const top = new THREE.CylinderGeometry(0.7, 0.7, 0.08, 10);
  const leg = new THREE.CylinderGeometry(0.08, 0.1, 0.72, 6);
  const pole = new THREE.CylinderGeometry(0.04, 0.04, 2.4, 5);
  const shade = new THREE.ConeGeometry(1.5, 0.6, 8);
  for (const t of TABLES) {
    const y = t.indoor ? BUILDINGS[0].floor : heightAt(t.x, t.z);
    g.add(mesh(top, MAT.table, t.x, y + 0.75, t.z), mesh(leg, MAT.table, t.x, y + 0.36, t.z));
    if (!t.indoor) g.add(mesh(pole, MAT.line, t.x, y + 1.2, t.z), mesh(shade, MAT.umbrella, t.x, y + 2.5, t.z));
  }
  return g;
}

function pondAndParking(): THREE.Group {
  const g = new THREE.Group();
  const ice = new THREE.Mesh(new THREE.CircleGeometry(POND.r, 28), MAT.ice);
  ice.rotation.x = -Math.PI / 2;
  ice.position.set(POND.x, heightAt(POND.x, POND.z) + 0.06, POND.z);
  ice.receiveShadow = true;
  g.add(ice);

  const P = PARKING;
  const lot = new THREE.Mesh(new THREE.PlaneGeometry(P.w, P.d), MAT.asphalt);
  lot.rotation.x = -Math.PI / 2;
  // Tilt with the slope so it doesn't float or sink.
  const fall = (heightAt(P.x, P.z + P.d / 2) - heightAt(P.x, P.z - P.d / 2)) / P.d;
  lot.rotation.x = -Math.PI / 2 - Math.atan(fall);
  lot.position.set(P.x, heightAt(P.x, P.z) + 0.08, P.z);
  lot.receiveShadow = true;
  g.add(lot);
  // A few chunky cars in the bays.
  const body = new THREE.BoxGeometry(1.9, 0.8, 4.2);
  const cab = new THREE.BoxGeometry(1.7, 0.6, 2.2);
  const colors = [0xd9553a, 0x2d6cc0, 0xe8e4da, 0x2f8f5b, 0x4a4f63, 0xe0b13b, 0x8b5bc4];
  let i = 0;
  for (let x = P.x - P.w / 2 + 3; x < P.x + P.w / 2 - 2; x += 3.4) {
    for (const z of [P.z - 6, P.z + 6]) {
      if ((i * 7 + 3) % 5 === 0) {
        i++;
        continue; // an empty bay here and there
      }
      const c = flat(colors[i++ % colors.length]);
      const y = heightAt(x, z);
      g.add(mesh(body, c, x, y + 0.6, z), mesh(cab, c, x, y + 1.3, z + 0.3));
    }
  }
  return g;
}

export class VillageView {
  readonly root = new THREE.Group();
  readonly buildings: BuildingView[] = [];
  private readonly lights: THREE.PointLight[] = [];

  constructor() {
    for (const b of BUILDINGS) {
      const { group, view } = buildBuilding(b);
      this.root.add(group);
      this.buildings.push(view);
    }
    const inside = interiors();
    inside.traverse((o) => {
      if (o instanceof THREE.PointLight) this.lights.push(o);
    });
    this.root.add(inside, tables(), pondAndParking());
    this.showInside(null);
  }

  /** Windows glow brighter as the light goes. */
  setLamps(l: number): void {
    (MAT.window as THREE.MeshStandardMaterial).emissiveIntensity = 0.55 + 1.8 * l;
  }

  /** Lifts the lid off whichever building you're standing in. */
  showInside(id: string | null): void {
    for (const v of this.buildings) v.lid.visible = v.building.id !== id;
    // Point lights shade every pixel on screen, so only the room you're in is lit.
    for (const l of this.lights) l.visible = l.userData.building === id;
  }
}
