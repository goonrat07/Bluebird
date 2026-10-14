import { TUNING } from './sim/tuning';
import { createRider, speedOf, stepRider, type RiderState } from './sim/rider';
import { Keyboard, type RideInput } from './sim/input';
import { SceneView } from './render/scene';
import { type Vec3, add, scale, sub } from './sim/vec';

export interface Telemetry {
  frame: number;
  speedKmh: number;
  grounded: boolean;
  airTime: number;
  heading: number;
  pos: Vec3;
  fps: number;
}

const STEP = 1 / TUNING.stepHz;

// Fixed-step simulation with interpolated rendering: riding behaves the same at 30 or 144 fps.
export class Game {
  private rider: RiderState = createRider();
  private prevPos: Vec3 = { ...this.rider.pos };
  private accumulator = 0;
  private lastTime = 0;
  private frame = 0;
  private fps = 0;
  private snapCamera = true;
  private readonly keyboard = new Keyboard(window);
  private readonly speedEl = document.getElementById('speed');

  constructor(private readonly view: SceneView) {
    this.keyboard.onReset(() => this.reset());
  }

  start(): void {
    requestAnimationFrame((t) => {
      this.lastTime = t;
      this.tick(t);
    });
  }

  reset(): void {
    this.rider = createRider();
    this.prevPos = { ...this.rider.pos };
    this.snapCamera = true;
  }

  telemetry(): Telemetry {
    const r = this.rider;
    return {
      frame: this.frame,
      speedKmh: speedOf(r) * 3.6,
      grounded: r.grounded,
      airTime: r.airTime,
      heading: r.heading,
      pos: { ...r.pos },
      fps: this.fps,
    };
  }

  private tick(now: number): void {
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.1;

    const input: RideInput = this.keyboard.state;
    this.accumulator += dt;
    while (this.accumulator >= STEP) {
      this.prevPos = { ...this.rider.pos };
      stepRider(this.rider, input, STEP);
      this.accumulator -= STEP;
    }
    const alpha = this.accumulator / STEP;
    const drawPos = add(this.prevPos, scale(sub(this.rider.pos, this.prevPos), alpha));

    this.view.render(drawPos, this.rider.heading, dt, this.snapCamera);
    this.snapCamera = false;
    if (this.speedEl) this.speedEl.textContent = `${Math.round(speedOf(this.rider) * 3.6)} km/h`;

    this.frame++;
    requestAnimationFrame((t) => this.tick(t));
  }
}
