import { AIR, ASSIST, CRASH, RIDE, SNOW, SPORTS } from '../sim/tuning';
import { CAMERA } from '../render/scene';
import { BODY } from '../render/riderModel';

type NumberTable = Record<string, number | boolean>;

// Everything the panel can edit, grouped as it appears on screen.
const GROUPS: [string, NumberTable][] = [
  ['Snowboard', SPORTS.board as unknown as NumberTable],
  ['Skis', SPORTS.ski as unknown as NumberTable],
  ['Groomed snow', SNOW.groomed as unknown as NumberTable],
  ['Powder', SNOW.powder as unknown as NumberTable],
  ['Ice', SNOW.ice as unknown as NumberTable],
  ['Riding', RIDE as unknown as NumberTable],
  ['Air', AIR as unknown as NumberTable],
  ['Assist: relaxed', ASSIST.relaxed as unknown as NumberTable],
  ['Assist: normal', ASSIST.normal as unknown as NumberTable],
  ['Assist: real', ASSIST.real as unknown as NumberTable],
  ['Crashes', CRASH as unknown as NumberTable],
  ['Camera', CAMERA as unknown as NumberTable],
  ['Body animation', BODY as unknown as NumberTable],
];

const DEFAULTS = JSON.stringify(GROUPS.map(([, t]) => t));

/** Every tuning value as JSON, for pasting back into the thread. */
export function tuningSnapshot(): string {
  return JSON.stringify(Object.fromEntries(GROUPS.map(([name, t]) => [name, t])), null, 2);
}

// Live sliders for every feel number (toggle with the backtick key).
export class TuningPanel {
  private readonly el = document.createElement('div');

  constructor() {
    this.el.id = 'tuning';
    this.el.hidden = true;
    document.body.append(this.el);
    this.build();
  }

  toggle(): void {
    this.el.hidden = !this.el.hidden;
  }

  private build(): void {
    this.el.replaceChildren();
    const header = document.createElement('div');
    header.className = 'tuning-header';
    header.innerHTML = '<strong>Tuning</strong> <span>` to close</span>';
    const copy = button('Copy values', async () => {
      await navigator.clipboard?.writeText(tuningSnapshot());
      copy.textContent = 'Copied';
      setTimeout(() => (copy.textContent = 'Copy values'), 1200);
    });
    const reset = button('Reset all', () => {
      const defaults = JSON.parse(DEFAULTS) as NumberTable[];
      GROUPS.forEach(([, t], i) => Object.assign(t, defaults[i]));
      this.build();
    });
    header.append(copy, reset);
    this.el.append(header);

    for (const [name, table] of GROUPS) {
      const section = document.createElement('details');
      section.innerHTML = `<summary>${name}</summary>`;
      for (const key of Object.keys(table)) section.append(control(table, key));
      this.el.append(section);
    }
  }
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function control(table: NumberTable, key: string): HTMLElement {
  const row = document.createElement('label');
  const name = document.createElement('span');
  name.textContent = key;
  const value = table[key];
  if (typeof value === 'boolean') {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = value;
    box.addEventListener('change', () => (table[key] = box.checked));
    row.append(name, box);
    return row;
  }
  const slider = document.createElement('input');
  slider.type = 'range';
  const max = value === 0 ? 1 : Math.abs(value) * 3;
  slider.min = '0';
  slider.max = String(max);
  slider.step = String(max / 300);
  slider.value = String(value);
  const out = document.createElement('output');
  out.textContent = format(value);
  slider.addEventListener('input', () => {
    table[key] = Number(slider.value);
    out.textContent = format(Number(slider.value));
  });
  row.append(name, slider, out);
  return row;
}

const format = (n: number): string => (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 1 ? n.toFixed(2) : n.toFixed(4));
