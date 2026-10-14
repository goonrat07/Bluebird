import { CAT_TRACKS, MOUNTAIN_BOUNDS, RUN, RUNS, type Difficulty, heightAt } from '../sim/terrain';
import { LIFTS } from '../sim/lifts';
import { TREES } from '../sim/trees';
import type { Vec3 } from '../sim/vec';

// The trail map (Tab): a poster of Kettle Peak looking up from the base, summit at the top.
// Like resort maps it's stretched sideways a little so the runs have room to read.

const INK = '#2b2b38';
const PAPER = '#f4ecdc';
const DIFFICULTY: Record<Difficulty, { color: string; label: string }> = {
  green: { color: '#2f8f5b', label: 'Easier' },
  blue: { color: '#2d6cc0', label: 'More difficult' },
  black: { color: INK, label: 'Expert' },
};
const YOU = '#e4572e';
/** Map is drawn this many times wider than true scale. */
const STRETCH = 3;
/** Hillshade sample spacing (m). */
const SHADE_STEP = 6;

export class TrailMap {
  private readonly canvas = document.getElementById('map') as HTMLCanvasElement;
  private readonly ctx = this.canvas.getContext('2d')!;
  private base: HTMLCanvasElement | null = null;
  private shade: HTMLCanvasElement | null = null;
  private layout = { x: 0, y: 0, sx: 1, sy: 1, w: 0, h: 0 };
  private time = 0;

  constructor() {
    window.addEventListener('resize', () => this.open && this.resize());
  }

  get open(): boolean {
    return !this.canvas.hidden;
  }

  toggle(): void {
    this.canvas.hidden = !this.canvas.hidden;
    if (this.open) this.resize();
  }

  /** Redraws the "you are here" marker; cheap, so it runs every frame while the map is open. */
  update(pos: Vec3, heading: number, onLift: string | null): void {
    if (!this.open || !this.base) return;
    this.time += 1 / 60;
    const ctx = this.ctx;
    ctx.drawImage(this.base, 0, 0);
    const [x, y] = this.toMap(pos.x, pos.z);
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 5);
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = `rgba(228, 87, 46, ${0.25 * pulse})`;
    ctx.beginPath();
    ctx.arc(0, 0, 10 + 6 * pulse, 0, Math.PI * 2);
    ctx.fill();
    // Heading: +z (downhill) is down the page, +x to the right.
    ctx.rotate(-heading);
    ctx.fillStyle = YOU;
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 11);
    ctx.lineTo(6, -5);
    ctx.lineTo(-6, -5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillStyle = YOU;
    ctx.textAlign = 'left';
    ctx.fillText(onLift ? 'You (on the lift)' : 'You are here', x + 14, y + 4);
  }

  private toMap(x: number, z: number): [number, number] {
    const B = MOUNTAIN_BOUNDS;
    const l = this.layout;
    return [l.x + (x - B.x0) * l.sx, l.y + (z - B.z0) * l.sy];
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth;
    const H = window.innerHeight;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const B = MOUNTAIN_BOUNDS;
    const top = 70;
    const bottom = 70;
    const sy = (H - top - bottom) / (B.z1 - B.z0);
    const sx = Math.min(sy * STRETCH, (W - 40) / (B.x1 - B.x0));
    const w = (B.x1 - B.x0) * sx;
    this.layout = { x: (W - w) / 2, y: top, sx, sy, w, h: (B.z1 - B.z0) * sy };
    this.drawBase(W, H, dpr);
  }

  /** Hillshade of the mountain, lit from the upper left like a painted map. Built once. */
  private hillshade(): HTMLCanvasElement {
    if (this.shade) return this.shade;
    const B = MOUNTAIN_BOUNDS;
    const cols = Math.ceil((B.x1 - B.x0) / SHADE_STEP);
    const rows = Math.ceil((B.z1 - B.z0) / SHADE_STEP);
    const c = document.createElement('canvas');
    c.width = cols;
    c.height = rows;
    const img = c.getContext('2d')!.createImageData(cols, rows);
    const lit = [246, 239, 226];
    const dark = [150, 148, 186];
    const h = (i: number, j: number) => heightAt(B.x0 + i * SHADE_STEP, B.z0 + j * SHADE_STEP);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const dx = (h(i + 1, j) - h(i - 1, j)) / (2 * SHADE_STEP);
        const dz = (h(i, j + 1) - h(i, j - 1)) / (2 * SHADE_STEP);
        // Light from the upper left of the page: from -x and from up the mountain (-z), and above.
        const n = [-dx, 1, -dz];
        const len = Math.hypot(n[0], n[1], n[2]);
        const l = [-0.55, 0.65, -0.52];
        const d = Math.max(0, (n[0] * l[0] + n[1] * l[1] + n[2] * l[2]) / len);
        const t = Math.min(1, Math.max(0, (d - 0.15) / 0.65));
        const k = (j * cols + i) * 4;
        for (let ch = 0; ch < 3; ch++) img.data[k + ch] = dark[ch] + (lit[ch] - dark[ch]) * t;
        img.data[k + 3] = 255;
      }
    }
    c.getContext('2d')!.putImageData(img, 0, 0);
    this.shade = c;
    return c;
  }

  private drawBase(W: number, H: number, dpr: number): void {
    const base = document.createElement('canvas');
    base.width = Math.round(W * dpr);
    base.height = Math.round(H * dpr);
    const ctx = base.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const l = this.layout;

    // Poster sheet, then the painted mountain on it.
    ctx.fillStyle = 'rgba(30, 34, 52, 0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = PAPER;
    ctx.fillRect(l.x - 18, 14, l.w + 36, H - 28);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.hillshade(), l.x, l.y, l.w, l.h);

    // The forest, as a scatter of small dark-green flecks.
    ctx.fillStyle = 'rgba(52, 92, 76, 0.55)';
    for (const t of TREES) {
      const [x, y] = this.toMap(t.x, t.z);
      ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
    }

    // Runs: a pale corridor, then a colored centerline.
    for (const run of RUNS) {
      const z1 = run.id === 'kettle' ? RUN.length : run.z1;
      const pts: [number, number][] = [];
      for (let z = run.z0; z <= z1; z += 8) pts.push(this.toMap(run.centerX(z), z));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255, 252, 245, 0.75)';
      ctx.lineWidth = Math.max(4, run.halfWidth * 1.6 * l.sx);
      this.path(ctx, pts);
      ctx.strokeStyle = DIFFICULTY[run.difficulty].color;
      ctx.lineWidth = 2.5;
      this.path(ctx, pts);
    }

    // Cat tracks, dashed.
    for (const t of CAT_TRACKS) {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = DIFFICULTY.green.color;
      ctx.lineWidth = 2;
      this.path(ctx, t.points.map(([x, z]) => this.toMap(x, z)));
      ctx.setLineDash([]);
    }

    // Lifts: a fine ink line with a tick at every tower and a block at each station.
    for (const lift of LIFTS) {
      const a = this.toMap(...lift.bottom);
      const b = this.toMap(...lift.top);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      this.path(ctx, [a, b]);
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      for (const t of lift.towers) {
        const [x, y] = this.toMap(t.top.x, t.top.z);
        ctx.beginPath();
        ctx.moveTo(x - 4 * Math.sin(ang), y + 4 * Math.cos(ang));
        ctx.lineTo(x + 4 * Math.sin(ang), y - 4 * Math.cos(ang));
        ctx.stroke();
      }
      ctx.fillStyle = INK;
      for (const [x, y] of [a, b]) ctx.fillRect(x - 4, y - 4, 8, 8);
      // Name along the line, reading upward.
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      ctx.save();
      ctx.translate(mid[0] - 8, mid[1]);
      ctx.rotate(ang + Math.PI);
      ctx.font = 'italic 600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(lift.name, 0, -4);
      ctx.restore();
    }

    // Run names with their difficulty symbol.
    for (const run of RUNS) {
      const z = { kettle: 640, raven: 560, fernwood: 1200, cornice: -330, couloir: -150 }[run.id] ?? run.z0 + 60;
      const [x, y] = this.toMap(run.centerX(z), z);
      this.label(ctx, run.name, run.difficulty, x + (run.id === 'couloir' ? -10 : 10), y, run.id === 'couloir' ? 'right' : 'left');
    }
    for (const t of CAT_TRACKS) {
      const [px, pz] = t.points[t.points.length - 2];
      const [x, y] = this.toMap(px, pz);
      ctx.font = 'italic 600 11px system-ui, sans-serif';
      ctx.fillStyle = DIFFICULTY.green.color;
      ctx.textAlign = 'left';
      ctx.fillText(t.name, x + 6, y - 6);
    }

    // Title and legend, poster style.
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.font = '800 26px system-ui, sans-serif';
    ctx.fillText('K E T T L E   P E A K', W / 2, 46);
    ctx.font = '500 12px system-ui, sans-serif';
    ctx.fillText('Trail map · Tab to close', W / 2, 62);
    let lx = l.x;
    const ly = H - 32;
    ctx.textAlign = 'left';
    for (const d of ['green', 'blue', 'black'] as Difficulty[]) {
      this.symbol(ctx, d, lx + 6, ly - 4);
      ctx.fillStyle = INK;
      ctx.font = '500 11px system-ui, sans-serif';
      ctx.fillText(DIFFICULTY[d].label, lx + 16, ly);
      lx += ctx.measureText(DIFFICULTY[d].label).width + 30;
    }
    this.base = base;
  }

  private path(ctx: CanvasRenderingContext2D, pts: [number, number][]): void {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }

  /** The usual trail-map signs: green circle, blue square, black diamond. */
  private symbol(ctx: CanvasRenderingContext2D, d: Difficulty, x: number, y: number): void {
    ctx.fillStyle = DIFFICULTY[d].color;
    ctx.beginPath();
    if (d === 'green') ctx.arc(x, y, 5, 0, Math.PI * 2);
    else if (d === 'blue') ctx.rect(x - 4.5, y - 4.5, 9, 9);
    else {
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x + 5, y);
      ctx.lineTo(x, y + 6);
      ctx.lineTo(x - 5, y);
      ctx.closePath();
    }
    ctx.fill();
  }

  private label(ctx: CanvasRenderingContext2D, text: string, d: Difficulty, x: number, y: number, align: 'left' | 'right'): void {
    ctx.font = '700 12px system-ui, sans-serif';
    const w = ctx.measureText(text).width + 20;
    const left = align === 'left' ? x : x - w;
    ctx.fillStyle = 'rgba(244, 236, 220, 0.85)';
    ctx.fillRect(left - 3, y - 10, w + 6, 18);
    this.symbol(ctx, d, left + 6, y - 1);
    ctx.fillStyle = INK;
    ctx.textAlign = 'left';
    ctx.fillText(text, left + 16, y + 3);
  }
}
