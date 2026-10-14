export interface RideInput {
  left: boolean;
  right: boolean;
  /** W: tuck (or skate on skis when slow) on snow, front flip in the air. */
  up: boolean;
  /** S: brake on snow, back flip in the air. */
  down: boolean;
  /** Space: hold to load, release to pop. */
  jump: boolean;
  /** Shift: grab in the air (direction keys pick which grab). */
  grab: boolean;
}

export const noInput = (): RideInput => ({ left: false, right: false, up: false, down: false, jump: false, grab: false });

const KEYMAP: Record<string, keyof RideInput> = {
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  Space: 'jump',
  ShiftLeft: 'grab',
  ShiftRight: 'grab',
};

/** One-shot actions that aren't held riding inputs. */
export type Command = 'reset' | 'restart' | 'swapSport' | 'toggleTuning' | 'cycleLight';

const COMMANDS: Record<string, Command> = {
  KeyR: 'reset',
  Backspace: 'restart',
  KeyF: 'swapSport',
  Backquote: 'toggleTuning',
  KeyT: 'cycleLight',
};

export class Keyboard {
  readonly state = noInput();
  private commandHandler: ((c: Command) => void) | null = null;

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => this.onKey(e, true));
    target.addEventListener('keyup', (e) => this.onKey(e, false));
    target.addEventListener('blur', () => Object.assign(this.state, noInput()));
  }

  onCommand(handler: (c: Command) => void): void {
    this.commandHandler = handler;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    // Leave typing in the tuning panel alone.
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const command = COMMANDS[e.code];
    if (command) {
      if (down && !e.repeat) this.commandHandler?.(command);
      e.preventDefault();
      return;
    }
    const action = KEYMAP[e.code];
    if (!action) return;
    this.state[action] = down;
    e.preventDefault();
  }
}
