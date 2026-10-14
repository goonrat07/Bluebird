import { WORLD, type AssistLevel } from './sim/tuning';
import { centerX, heightAt } from './sim/terrain';
import { createRider, isSwitch, resetToSafeSpot, restart, speedOf, stepRider, swapSport, type RiderState } from './sim/rider';
import { Keyboard, noInput, type Command, type RideInput } from './sim/input';
import { SceneView } from './render/scene';
import { Hud } from './ui/hud';
import { TuningPanel } from './ui/tuningPanel';
import { type Vec3, add, scale, sub } from './sim/vec';

export interface Telemetry {
  frame: number;
  speedKmh: number;
  sport: RiderState['sport'];
  assist: AssistLevel;
  grounded: boolean;
  crashed: boolean;
  switch: boolean;
  snow: RiderState['snow'];
  edge: number;
  heading: number;
  pos: Vec3;
  lastTrick: string | null;
  landings: number;
  fps: number;
}

const STEP = 1 / WORLD.stepHz;

// Fixed-step simulation with interpolated rendering: riding behaves the same at 30 or 144 fps.
export class Game {
  private rider: RiderState = createRider();
  private prevPos: Vec3 = { ...this.rider.pos };
  private prevHeading = 0;
  private prevPitch = 0;
  private accumulator = 0;
  private lastTime = 0;
  private frame = 0;
  private fps = 0;
  private snapCamera = true;
  private readonly keyboard = new Keyboard(window);
  private readonly hud = new Hud();
  private readonly tuning = new TuningPanel();

  constructor(private readonly view: SceneView) {
    this.keyboard.onCommand((c) => this.command(c));
  }

  start(): void {
    requestAnimationFrame((t) => {
      this.lastTime = t;
      this.tick(t);
    });
  }

  command(c: Command): void {
    if (c === 'reset') resetToSafeSpot(this.rider);
    else if (c === 'restart') restart(this.rider);
    else if (c === 'swapSport') swapSport(this.rider);
    else if (c === 'toggleTuning') this.tuning.toggle();
    else if (c === 'cycleLight') this.view.cycleLight();
    if (c === 'restart') this.view.clearTrails();
    if (c === 'reset' || c === 'restart') {
      this.prevPos = { ...this.rider.pos };
      this.prevHeading = this.rider.heading;
      this.prevPitch = this.rider.pitch;
      this.snapCamera = true;
    }
  }

  /** Debug: puts the rider at distance z down the run, u metres off the centerline, moving downhill. */
  teleport(z: number, u = 0, speed = 10): void {
    const x = centerX(z) + u;
    const r = createRider(this.rider.sport, this.rider.assist);
    r.pos = { x, y: heightAt(x, z), z };
    // Moving along the snow surface, so the rider doesn't launch off a steep pitch.
    const drop = heightAt(x, z + 1) - heightAt(x, z);
    r.vel = { x: 0, y: (speed * drop) / Math.hypot(1, drop), z: speed / Math.hypot(1, drop) };
    r.safeSpots = [{ pos: { ...r.pos }, heading: 0 }];
    this.rider = r;
    this.prevPos = { ...r.pos };
    this.prevHeading = r.heading;
    this.prevPitch = r.pitch;
    this.snapCamera = true;
    this.view.clearTrails();
  }

  setAssist(level: AssistLevel): void {
    this.rider.assist = level;
  }

  telemetry(): Telemetry {
    const r = this.rider;
    return {
      frame: this.frame,
      speedKmh: speedOf(r) * 3.6,
      sport: r.sport,
      assist: r.assist,
      grounded: r.grounded,
      crashed: r.crashed,
      switch: isSwitch(r),
      snow: r.snow,
      edge: r.edge,
      heading: r.heading,
      pos: { ...r.pos },
      lastTrick: r.lastTrick?.name ?? null,
      landings: r.landings,
      fps: this.fps,
    };
  }

  private tick(now: number): void {
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.1;

    const input: RideInput = document.hidden ? noInput() : this.keyboard.state;
    let landed = false;
    this.accumulator += dt;
    while (this.accumulator >= STEP) {
      this.prevPos = { ...this.rider.pos };
      this.prevHeading = this.rider.heading;
      this.prevPitch = this.rider.pitch;
      const before = this.rider.grounded;
      stepRider(this.rider, input, STEP);
      if (!before && this.rider.grounded) landed = true;
      this.accumulator -= STEP;
    }
    const alpha = this.accumulator / STEP;
    const r = this.rider;
    const pos = add(this.prevPos, scale(sub(r.pos, this.prevPos), alpha));
    // Rotation is interpolated too, so turns and spins stay smooth on any refresh rate.
    const dh = Math.atan2(Math.sin(r.heading - this.prevHeading), Math.cos(r.heading - this.prevHeading));
    const heading = this.prevHeading + dh * alpha;
    // Landing resets pitch from a full turn back to 0; don't draw a reverse flip between them.
    const pitch = Math.abs(r.pitch - this.prevPitch) > 1 ? r.pitch : this.prevPitch + (r.pitch - this.prevPitch) * alpha;

    this.view.render(
      {
        pos,
        vel: r.vel,
        heading,
        pitch,
        edge: r.edge,
        speed: speedOf(r),
        sport: r.sport,
        grounded: r.grounded,
        crashed: r.crashed,
        crashTimer: r.crashTimer,
        charge: r.charge,
        tucking: r.tucking,
        braking: r.braking,
        skidding: r.skidding,
        grab: r.grab,
        switch: isSwitch(r),
        justLanded: landed,
        deepSnow: r.snow === 'powder',
      },
      dt,
      this.snapCamera,
    );
    this.snapCamera = false;
    this.hud.update(dt, speedOf(r) * 3.6, r.sport, r.assist, r.lastTrick, r.landings);

    this.frame++;
    requestAnimationFrame((t) => this.tick(t));
  }
}
