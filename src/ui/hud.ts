import type { Trick } from '../sim/tricks';
import type { AssistLevel, Sport } from '../sim/tuning';

const QUALITY_LABEL: Record<Trick['quality'], string> = { clean: 'Clean', solid: '', sketchy: 'Sketchy' };

// Plain text over the scene, no panels: speed, mode, and trick callouts that fade out.
export class Hud {
  private readonly speed = document.getElementById('speed')!;
  private readonly mode = document.getElementById('mode')!;
  private readonly trick = document.getElementById('trick')!;
  private readonly flowBar = document.getElementById('flow')!;
  private readonly flowFill = document.getElementById('flow-fill')!;
  private readonly splat = document.getElementById('splat')!;
  private trickTimer = 0;
  private lastLanding = -1;
  private flowShown = 0;
  private splatLeft = 0;
  private lastBranchHits = 0;

  /** Flow meter (fades away when empty) and a face full of snow when you clip branches. */
  updateFlow(dt: number, flow: number, branchHits: number): void {
    this.flowShown += (flow - this.flowShown) * (1 - Math.exp(-8 * dt));
    this.flowFill.style.transform = `scaleX(${this.flowShown.toFixed(3)})`;
    this.flowBar.style.opacity = String(Math.min(1, this.flowShown * 6));
    this.flowBar.classList.toggle('full', flow > 0.97);
    if (branchHits !== this.lastBranchHits) {
      if (branchHits > this.lastBranchHits) this.splatLeft = 0.7;
      this.lastBranchHits = branchHits;
    }
    this.splatLeft = Math.max(0, this.splatLeft - dt);
    this.splat.style.opacity = String(Math.min(0.85, this.splatLeft * 1.6));
  }

  update(dt: number, speedKmh: number, sport: Sport, assist: AssistLevel, trick: Trick | null, landings: number): void {
    this.speed.textContent = `${Math.round(speedKmh)} km/h`;
    this.mode.textContent = `${sport === 'board' ? 'Snowboard' : 'Skis'} · ${assist[0].toUpperCase()}${assist.slice(1)} landings`;

    if (landings !== this.lastLanding) {
      if (this.lastLanding >= 0 && trick) {
        const quality = QUALITY_LABEL[trick.quality];
        this.trick.innerHTML =
          trick.name === 'Bail'
            ? '<span class="trick-name bail">Bail</span>'
            : `<span class="trick-name">${trick.name}</span><span class="trick-score">${quality ? `${quality} · ` : ''}+${trick.score}</span>`;
        this.trickTimer = 2.5;
      }
      this.lastLanding = landings;
    }
    this.trickTimer -= dt;
    this.trick.style.opacity = String(Math.max(0, Math.min(1, this.trickTimer / 0.5)));
  }
}
