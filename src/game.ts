import { WORLD, type AssistLevel } from './sim/tuning';
import { RAILS } from './sim/rails';
import { createRider, isSwitch, resetToSafeSpot, restart, speedOf, stepRider, swapSport, type RiderState } from './sim/rider';
import { Keyboard, noInput, type Command, type RideInput } from './sim/input';
import { SceneView } from './render/scene';
import { Hud } from './ui/hud';
import { Sound } from './audio/sound';
import { EventSession } from './eventSession';
import { EVENTS, placeRider, type EventId } from './sim/events';
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
  flow: number;
  branchHits: number;
  /** Name of the rail or box being ridden, or null. */
  rail: string | null;
  /** -1..1 balance on a rail (0 when off one). */
  balance: number;
  /** Audio state: off until a key is pressed, then running (or muted). */
  sound: string;
  /** Loudness of the sound output right now (RMS). */
  soundLevel: number;
  /** The event being ridden, if any. */
  event: {
    id: EventId;
    phase: 'countdown' | 'running' | 'done';
    clock: number;
    score: number;
    result: { finished: boolean; value: number; medal: string | null; reason: string } | null;
    newBest: boolean;
    ghost: string | null;
    ghostZ: number | null;
  } | null;
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
  private readonly sound = new Sound(window);
  private heardLandings = 0;
  private heardBranches = 0;
  private event: EventSession | null = null;
  private ghostPrev: Vec3 | null = null;

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
    // Events replay from their inputs alone, so mid-run only a fresh start or leaving is allowed.
    if (c === 'slopestyle' || c === 'treeRun') return this.startEvent(c);
    if (this.event?.active && c === 'reset') return this.startEvent(this.event.def.id);
    if (this.event?.active && c === 'swapSport') return;
    if (c === 'reset' || c === 'restart' || c === 'swapSport') this.event = null;
    if (c === 'reset') resetToSafeSpot(this.rider);
    else if (c === 'restart') restart(this.rider);
    else if (c === 'swapSport') swapSport(this.rider);
    else if (c === 'toggleTuning') this.tuning.toggle();
    else if (c === 'cycleLight') this.view.cycleLight();
    else if (c === 'toggleMute') this.sound.toggleMute();
    if (c === 'restart') this.view.clearTrails();
    if (c === 'reset' || c === 'restart') {
      this.prevPos = { ...this.rider.pos };
      this.prevHeading = this.rider.heading;
      this.prevPitch = this.rider.pitch;
      this.snapCamera = true;
    }
  }

  /** Starts (or restarts) an event: a fresh rider at its gate, a countdown, and a ghost to chase. */
  startEvent(id: EventId): void {
    this.event = new EventSession(EVENTS[id], this.rider.sport, this.rider.assist);
    this.useRider(this.event.rider);
    this.ghostPrev = null;
  }

  /** Debug: puts the rider at distance z down the run, u metres off the centerline, moving downhill. */
  teleport(z: number, u = 0, speed = 10, run = 'kettle'): void {
    const r = createRider(this.rider.sport, this.rider.assist);
    placeRider(r, z, u, speed, run);
    this.event = null;
    this.useRider(r);
  }

  private useRider(r: RiderState): void {
    this.rider = r;
    this.heardLandings = r.landings;
    this.heardBranches = r.branchHits;
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
      flow: r.flow,
      branchHits: r.branchHits,
      rail: r.rail ? RAILS[r.rail.index].name : null,
      balance: r.rail?.balance ?? 0,
      sound: this.sound.state,
      soundLevel: this.sound.level(),
      event: this.event && {
        id: this.event.def.id,
        phase: this.event.run.phase,
        clock: this.event.run.clock,
        score: this.event.run.score,
        result: this.event.run.result,
        newBest: this.event.newBest,
        ghost: this.event.ghost ? this.event.ghostLabel : null,
        ghostZ: this.event.ghost?.rider.pos.z ?? null,
      },
    };
  }

  private renderGhost(alpha: number, dt: number): void {
    const g = this.event?.ghost?.rider;
    // Hide the ghost during the countdown (it's standing right where you are) and once you're done.
    if (!g || !this.ghostPrev || this.event!.run.phase === 'countdown') {
      this.view.renderGhost(null, dt);
      return;
    }
    this.view.renderGhost(
      {
        pos: add(this.ghostPrev, scale(sub(g.pos, this.ghostPrev), alpha)),
        heading: g.heading,
        pitch: g.pitch,
        edge: g.rail ? g.rail.balance * 0.8 : g.edge,
        speed: speedOf(g),
        sport: g.sport,
        grounded: g.grounded,
        crashed: g.crashed,
        crashTimer: g.crashTimer,
        charge: g.charge,
        tucking: g.tucking,
        braking: g.braking,
        grab: g.grab,
        switch: isSwitch(g),
      },
      dt,
    );
  }

  /** Plays one-shot sounds for what just happened in a simulation step. */
  private listen(wasGrounded: boolean, wasOnRail: boolean, popping: boolean): void {
    const r = this.rider;
    if (popping && !r.grounded && !r.jumpHeld) this.sound.pop();
    if (r.rail && !wasOnRail) this.sound.railOn(RAILS[r.rail.index].kind);
    else if (!wasGrounded && r.grounded && !r.crashed) this.sound.landing(r.air.airTime / 1.5);
    if (r.landings !== this.heardLandings) {
      this.heardLandings = r.landings;
      if (r.lastTrick?.name === 'Bail') this.sound.bail();
      else if (r.lastTrick) this.sound.trick(r.lastTrick.quality);
    }
    if (r.branchHits !== this.heardBranches) {
      if (r.branchHits > this.heardBranches) this.sound.branch();
      this.heardBranches = r.branchHits;
    }
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
      const wasOnRail = this.rider.rail !== null;
      const popping = this.rider.jumpHeld && !input.jump;
      if (this.event?.ghost) this.ghostPrev = { ...this.event.ghost.rider.pos };
      if (this.event) this.event.step(input, STEP);
      else stepRider(this.rider, input, STEP);
      if (!before && this.rider.grounded) landed = true;
      this.listen(before, wasOnRail, popping);
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
        // On a rail the body leans with the balance instead of an edge.
        edge: r.rail ? r.rail.balance * 0.8 : r.edge,
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
        flow: r.flow,
        grinding: r.rail !== null,
      },
      dt,
      this.snapCamera,
    );
    this.snapCamera = false;
    this.hud.update(dt, speedOf(r) * 3.6, r.sport, r.assist, r.lastTrick, r.landings);
    this.hud.updateFlow(dt, r.flow, r.branchHits);
    this.hud.updateBalance(dt, r.rail?.balance ?? null);
    this.hud.updateEvent(this.event);
    this.renderGhost(alpha, dt);
    this.sound.update({
      speed: speedOf(r),
      grounded: r.grounded,
      crashed: r.crashed,
      edge: r.edge,
      skidding: r.skidding,
      snow: r.snow,
      grind: r.rail ? RAILS[r.rail.index].kind : null,
    });

    this.frame++;
    requestAnimationFrame((t) => this.tick(t));
  }
}
