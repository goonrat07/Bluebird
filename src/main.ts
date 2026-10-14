import { Game, type Telemetry } from './game';
import { SceneView } from './render/scene';
import type { Command } from './sim/input';
import type { AssistLevel } from './sim/tuning';

declare global {
  interface Window {
    /** Debug hook used by play tests (see test/e2e). */
    __game?: {
      ready: boolean;
      telemetry: () => Telemetry;
      command: (c: Command) => void;
      setAssist: (level: AssistLevel) => void;
    };
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(new SceneView(canvas));
game.start();
window.__game = {
  ready: true,
  telemetry: () => game.telemetry(),
  command: (c) => game.command(c),
  setAssist: (level) => game.setAssist(level),
};
