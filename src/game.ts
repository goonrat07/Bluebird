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
import { type LiftRide, boardLift, liftToBoard, stepLift, unloadRider } from './sim/lifts';
import { TrailMap } from './ui/trailMap';
import { heightAt } from './sim/terrain';
import { type WalkState, startWalking, stepWalk } from './sim/walk';
import { type Dog, createDogs, dogToPet, pet, stepDogs } from './sim/dogs';
import { type Counter, counterAt, insideOf } from './sim/village';

/** Jackets on the outfitters' rack; the first is the one you start in. */
export const JACKETS = [0xe0563b, 0x2d6cc0, 0x2f8f5b, 0xe0b13b, 0x8b5bc4];
const JACKET_KEY = 'bluebird.jacket';
/** Landing a trick worth this much near people gets a cheer. */
const CHEER_SCORE = 250;
/** You can only step out of your bindings this slow. */
const WALK_MAX_SPEED = 3;

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
  /** The chairlift being ridden, and how far up it (0..1). */
  lift: { name: string; progress: number } | null;
  /** The lift you could get on right now with E. */
  canBoard: string | null;
  /** What E would do right now, as shown on screen (lifts, dogs, shops). */
  prompt: string;
  /** On foot, and in which building. */
  walking: boolean;
  inside: string | null;
  jacket: number;
  dogs: { name: string; x: number; z: number; following: boolean; happy: boolean }[];
  /** How many villagers are cheering right now. */
  cheering: number;
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
  private chair: LiftRide | null = null;
  private walker: WalkState | null = null;
  private readonly dogs: Dog[] = createDogs();
  private jacket = 0;
  /** A short note after doing something (at a shop, with a dog); fades after a few seconds. */
  private note = '';
  private noteTime = 0;
  private cheeredLandings = 0;
  private readonly map = new TrailMap();

  constructor(private readonly view: SceneView) {
    this.keyboard.onCommand((c) => this.command(c));
    try {
      this.jacket = Math.max(0, JACKETS.indexOf(Number(localStorage.getItem(JACKET_KEY) ?? JACKETS[0])));
    } catch {
      this.jacket = 0;
    }
    this.view.setJacket(JACKETS[this.jacket]);
  }

  start(): void {
    requestAnimationFrame((t) => {
      this.lastTime = t;
      this.tick(t);
    });
  }

  command(c: Command): void {
    // Events replay from their inputs alone, so mid-run only a fresh start or leaving is allowed.
    if (c === 'toggleMap') return this.map.toggle();
    // E: pet a dog, use a shop, or get on a lift. None of it during an event.
    if (c === 'use') return this.use();
    if (c === 'walk') return this.toggleWalk();
    if (c === 'slopestyle' || c === 'treeRun') this.chair = this.walker = null;
    if (c === 'restart' || c === 'reset') this.walker = null;
    if (c === 'slopestyle' || c === 'treeRun') return this.startEvent(c);
    // Nothing but leaving (back to the top) while sitting on a chair.
    if (this.chair && c !== 'restart' && c !== 'toggleTuning' && c !== 'cycleLight' && c !== 'toggleMute' && c !== 'swapSport') return;
    if (c === 'restart') this.chair = null;
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

  /** What E does here and now: a dog first, then a shop counter (on foot), then a lift. */
  private useTarget(): { label: string; act: () => void } | null {
    if (this.event?.active || this.chair) return null;
    const { x, z } = this.rider.pos;
    const dog = dogToPet(this.dogs, x, z);
    if (dog) return { label: `pet ${dog.name}`, act: () => this.petDog(dog) };
    const counter = this.walker ? counterAt(x, z) : null;
    if (counter) return { label: counter.label, act: () => this.useCounter(counter) };
    const lift = liftToBoard(this.rider.pos, this.walker ? 0 : speedOf(this.rider));
    if (lift) {
      return {
        label: `ride the ${lift.name}`,
        act: () => {
          // Clip back in to ride; you'll want your gear at the top.
          if (this.walker) this.toggleWalk();
          this.chair = boardLift(lift);
        },
      };
    }
    return null;
  }

  private use(): void {
    this.useTarget()?.act();
  }

  private petDog(dog: Dog): void {
    pet(dog);
    this.say(dog.roams ? `${dog.name} wants to come along` : `${dog.name} leans into the scratch`);
  }

  private useCounter(c: Counter): void {
    if (c.action === 'swapGear') {
      swapSport(this.rider);
      this.say(this.rider.sport === 'ski' ? 'Skis it is' : 'Back on the board');
    } else if (c.action === 'outfit') {
      this.jacket = (this.jacket + 1) % JACKETS.length;
      this.view.setJacket(JACKETS[this.jacket]);
      try {
        localStorage.setItem(JACKET_KEY, String(JACKETS[this.jacket]));
      } catch {
        // Private windows: the jacket just isn't remembered.
      }
      this.say('Looking sharp');
    } else {
      this.say('Toasty');
    }
  }

  private say(text: string): void {
    this.note = text;
    this.noteTime = 2.5;
  }

  /** B: step out of your bindings to walk, or clip back in where you stand. */
  private toggleWalk(): void {
    if (this.event?.active || this.chair) return;
    const r = this.rider;
    if (this.walker) {
      const w = this.walker;
      this.walker = null;
      const fresh = createRider(r.sport, r.assist);
      fresh.pos = { x: w.x, y: heightAt(w.x, w.z), z: w.z };
      fresh.heading = w.heading;
      fresh.safeSpots = [{ pos: { ...fresh.pos }, heading: w.heading }];
      // Indoors you clip in at the door.
      const inside = insideOf(w.x, w.z);
      if (inside) {
        fresh.pos = { x: inside.x, y: heightAt(inside.x, inside.z - inside.d / 2 - 1.5), z: inside.z - inside.d / 2 - 1.5 };
        fresh.heading = Math.PI;
      }
      this.useRider(fresh);
      return;
    }
    if (!r.grounded || r.crashed || speedOf(r) > WALK_MAX_SPEED) return;
    this.walker = startWalking(r.pos.x, r.pos.z, r.heading);
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
    this.chair = this.walker = null;
    this.useRider(r);
  }

  /** Debug: puts the rider at (x, z), standing still and facing downhill. */
  placeAt(x: number, z: number): void {
    const r = createRider(this.rider.sport, this.rider.assist);
    r.pos = { x, y: heightAt(x, z), z };
    r.safeSpots = [{ pos: { ...r.pos }, heading: 0 }];
    this.event = null;
    this.chair = this.walker = null;
    this.useRider(r);
  }

  /** Debug: moves the current lift ride to fraction f of the way up. */
  liftProgress(f: number): void {
    if (!this.chair) return;
    this.chair.s = Math.min(1, Math.max(0, f)) * this.chair.lift.length;
    this.snapCamera = true;
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
      lift: this.chair && { name: this.chair.lift.name, progress: this.chair.s / this.chair.lift.length },
      canBoard: this.boardable(),
      prompt: this.promptText(),
      walking: this.walker !== null,
      inside: this.walker ? (insideOf(this.walker.x, this.walker.z)?.id ?? null) : null,
      jacket: JACKETS[this.jacket],
      dogs: this.dogs.map((d) => ({ name: d.name, x: d.x, z: d.z, following: d.follow > 0, happy: d.happy > 0 })),
      cheering: this.view.cheering,
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

  /** The line under the screen: the lift you're on, a note, or what E would do here. */
  private promptText(): string {
    if (this.chair) return `${this.chair.lift.name} · ${Math.round((this.chair.s / this.chair.lift.length) * 100)}% · hold W to hurry`;
    if (this.noteTime > 0) return this.note;
    const target = this.useTarget();
    if (target) return `<b>E</b> ${target.label}`;
    if (this.walker) return '<b>B</b> clip back in';
    return '';
  }

  private boardable(): string | null {
    if (this.chair || this.event?.active) return null;
    return liftToBoard(this.rider.pos, speedOf(this.rider))?.name ?? null;
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
      if (this.walker) {
        stepWalk(this.walker, input, STEP);
        const w = this.walker;
        this.rider.pos = { x: w.x, y: w.y, z: w.z };
        this.rider.heading = w.heading;
        this.rider.vel = { x: 0, y: 0, z: 0 };
        this.rider.grounded = true;
      } else if (this.chair) {
        if (stepLift(this.chair, this.rider, input.up, STEP)) {
          unloadRider(this.rider, this.chair.lift);
          this.chair = null;
        }
      } else if (this.event) this.event.step(input, STEP);
      else stepRider(this.rider, input, STEP);
      if (!before && this.rider.grounded) landed = true;
      this.listen(before, wasOnRail, popping);
      stepDogs(this.dogs, this.rider.pos, STEP);
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
        // Sitting on a chair reads best as the crouched tuck.
        tucking: r.tucking || this.chair !== null,
        braking: r.braking,
        skidding: r.skidding,
        grab: r.grab,
        switch: isSwitch(r),
        justLanded: landed,
        deepSnow: r.snow === 'powder',
        flow: r.flow,
        grinding: r.rail !== null,
        chair: this.chair ? this.chair.lift.heading : null,
        inside: this.walker ? (insideOf(this.walker.x, this.walker.z)?.id ?? null) : null,
        walk: this.walker ? this.walker.phase : null,
        walkSpeed: this.walker ? Math.abs(this.walker.speed) : 0,
      },
      dt,
      this.snapCamera,
    );
    this.snapCamera = false;
    this.hud.update(dt, speedOf(r) * 3.6, r.sport, r.assist, r.lastTrick, r.landings);
    this.hud.updateFlow(dt, r.flow, r.branchHits);
    this.hud.updateBalance(dt, r.rail?.balance ?? null);
    this.hud.updateEvent(this.event);
    this.noteTime = Math.max(0, this.noteTime - dt);
    this.hud.updatePrompt(this.promptText());
    this.view.renderDogs(this.dogs, dt);
    // A big landing near people gets a cheer.
    if (r.landings !== this.cheeredLandings) {
      this.cheeredLandings = r.landings;
      if (r.lastTrick && r.lastTrick.name !== 'Bail' && r.lastTrick.score >= CHEER_SCORE) this.view.cheer(r.pos.x, r.pos.z);
    }
    this.map.update(r.pos, r.heading, this.chair?.lift.id ?? null);
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
