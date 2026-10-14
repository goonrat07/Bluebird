import { Game, type Telemetry } from './game';
import { SceneView } from './render/scene';
import { loadCharacters } from './render/characterAssets';
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
      teleport: (z: number, u?: number, speed?: number, run?: string) => void;
      /** Puts the rider at a point on the mountain, standing still and facing downhill. */
      placeAt: (x: number, z: number) => void;
      /** Jumps a lift ride along to a fraction of the way up (play tests only). */
      liftProgress: (f: number) => void;
      /** Jumps to a time of day and weather by name, e.g. ('Night', 'Snowstorm'). */
      setSky: (time: string, weather?: string) => void;
    };
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
// The Blender-made characters load first; everything else is built in code.
await loadCharacters();
const game = new Game(new SceneView(canvas));
game.start();
window.__game = {
  ready: true,
  telemetry: () => game.telemetry(),
  command: (c) => game.command(c),
  setAssist: (level) => game.setAssist(level),
  teleport: (z, u, speed, run) => game.teleport(z, u, speed, run),
  placeAt: (x, z) => game.placeAt(x, z),
  liftProgress: (f) => game.liftProgress(f),
  setSky: (time, weather) => game.setSky(time, weather),
};
