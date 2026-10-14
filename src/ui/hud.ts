import type { Trick } from '../sim/tricks';
import type { AssistLevel, Sport } from '../sim/tuning';

const QUALITY_LABEL: Record<Trick['quality'], string> = { clean: 'Clean', solid: '', sketchy: 'Sketchy' };

// Plain text over the scene, no panels: speed, mode, and trick callouts that fade out.
export class Hud {
  private readonly speed = document.getElementById('speed')!;
  private readonly mode = document.getElementById('mode')!;
  private readonly trick = document.getElementById('trick')!;
  private trickTimer = 0;
  private lastLanding = -1;

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
