import type { Trick } from '../sim/tricks';
import type { AssistLevel, Sport } from '../sim/tuning';
import type { EventSession } from '../eventSession';
import type { Medal } from '../sim/events';

const MEDAL_LABEL: Record<Medal, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum' };

/** Seconds as 0:21.4. */
const clock = (s: number): string => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const points = (n: number): string => n.toLocaleString('en-US');

const QUALITY_LABEL: Record<Trick['quality'], string> = { clean: 'Clean', solid: '', sketchy: 'Sketchy' };

// Plain text over the scene, no panels: speed, mode, and trick callouts that fade out.
export class Hud {
  private readonly speed = document.getElementById('speed')!;
  private readonly mode = document.getElementById('mode')!;
  private readonly trick = document.getElementById('trick')!;
  private readonly flowBar = document.getElementById('flow')!;
  private readonly flowFill = document.getElementById('flow-fill')!;
  private readonly splat = document.getElementById('splat')!;
  private readonly balance = document.getElementById('balance')!;
  private readonly balanceMark = document.getElementById('balance-mark')!;
  private readonly eventBox = document.getElementById('event')!;
  private readonly countdown = document.getElementById('countdown')!;
  private readonly result = document.getElementById('result')!;
  private readonly prompt = document.getElementById('prompt')!;
  private promptKey = '';
  private eventKey = '';
  private trickTimer = 0;
  private balanceShown = 0;
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

  /** Balance bar while on a rail: the marker drifts toward the side you're tipping; lean back with A/D. */
  updateBalance(dt: number, balance: number | null): void {
    this.balance.classList.toggle('on', balance !== null);
    if (balance === null) return;
    this.balanceShown += (balance - this.balanceShown) * (1 - Math.exp(-20 * dt));
    // Positive balance tips left, so the marker moves left.
    this.balanceMark.style.transform = `translateX(${(-this.balanceShown * 100).toFixed(1)}px)`;
    this.balance.classList.toggle('danger', Math.abs(balance) > 0.7);
  }

  /** A quiet line under the middle of the screen: what E would do here, a note, or the lift you're on. */
  updatePrompt(text: string): void {
    if (text === this.promptKey) return;
    this.promptKey = text;
    this.prompt.innerHTML = text;
    this.prompt.classList.toggle('on', text !== '');
  }

  /** Event name and live clock or score up top, a big countdown, and the result card at the end. */
  updateEvent(e: EventSession | null): void {
    this.eventBox.classList.toggle('on', e !== null);
    if (!e) {
      this.countdown.classList.remove('on');
      this.result.classList.remove('on');
      this.eventKey = '';
      return;
    }
    const { def, run } = e;
    const value = (v: number) => (def.scoring === 'points' ? points(Math.round(v)) : clock(v));
    const best = e.best?.result.finished ? `Best ${value(e.best.result.value)}` : 'No best yet';
    const live = def.scoring === 'points' ? `${points(run.score)} pts` : clock(run.clock);
    const ghost = e.ghost ? ` · Ghost: ${e.ghostLabel.toLowerCase()}` : '';
    const key = `${def.id}|${run.phase}|${live}|${best}|${ghost}`;
    if (key !== this.eventKey) {
      this.eventKey = key;
      this.eventBox.innerHTML = `<div class="event-name">${def.name}</div><div class="event-live">${live}</div><div class="event-sub">${best}${ghost}</div>`;
    }

    this.countdown.classList.toggle('on', run.phase === 'countdown' || (run.phase === 'running' && run.clock < 0.6));
    this.countdown.textContent = run.phase === 'countdown' ? String(Math.ceil(run.countdown)) : 'Go';
    if (run.phase === 'countdown' && run.countdown > 2) this.countdown.innerHTML = `<span class="blurb">${def.blurb}</span>${Math.ceil(run.countdown)}`;

    const r = run.result;
    this.result.classList.toggle('on', r !== null);
    if (r && !this.result.dataset.shown) {
      const medal = r.medal ? `<div class="medal ${r.medal}">${MEDAL_LABEL[r.medal]}</div>` : '';
      const headline = r.finished ? value(r.value) : r.reason;
      const targets = def.medals.map((m, i) => `${['B', 'S', 'G', 'P'][i]} ${value(m)}`).join(' · ');
      this.result.innerHTML = `${medal}<div class="result-value">${headline}</div>${
        e.newBest ? '<div class="result-best">New best</div>' : ''
      }<div class="result-sub">${targets}</div><div class="result-sub">${def.id === 'slopestyle' ? '1' : '2'} to go again · Backspace to leave</div>`;
      this.result.dataset.shown = '1';
    }
    if (!r) delete this.result.dataset.shown;
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
