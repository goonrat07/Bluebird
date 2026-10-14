export interface RideInput {
  left: boolean;
  right: boolean;
  tuck: boolean;
  brake: boolean;
  jump: boolean;
}

export const noInput = (): RideInput => ({ left: false, right: false, tuck: false, brake: false, jump: false });

const KEYMAP: Record<string, keyof RideInput> = {
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  KeyW: 'tuck',
  ArrowUp: 'tuck',
  KeyS: 'brake',
  ArrowDown: 'brake',
  Space: 'jump',
};

export class Keyboard {
  readonly state = noInput();
  private resetHandler: (() => void) | null = null;

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => this.onKey(e, true));
    target.addEventListener('keyup', (e) => this.onKey(e, false));
    target.addEventListener('blur', () => Object.assign(this.state, noInput()));
  }

  onReset(handler: () => void): void {
    this.resetHandler = handler;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.code === 'KeyR' && down && !e.repeat) {
      this.resetHandler?.();
      return;
    }
    const action = KEYMAP[e.code];
    if (!action) return;
    this.state[action] = down;
    e.preventDefault();
  }
}
