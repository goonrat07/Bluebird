import { Game, type Telemetry } from './game';
import { SceneView } from './render/scene';

declare global {
  interface Window {
    /** Debug hook used by play tests (see test/e2e). */
    __game?: { ready: boolean; telemetry: () => Telemetry; reset: () => void };
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(new SceneView(canvas));
game.start();
window.__game = { ready: true, telemetry: () => game.telemetry(), reset: () => game.reset() };
