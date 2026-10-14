import { describe, expect, it } from 'vitest';
import { EVENTS, ghostFrom, medalFor, rideEvent, startEvent, stepCountdown, stepEvent, stepGhost } from '../../src/sim/events';
import { slopestyleBot, treeRunBot } from '../../src/sim/bots';
import { decodeInput, encodeInput, packInputs, unpackInputs } from '../../src/sim/replay';
import { noInput } from '../../src/sim/input';
import { stepRider } from '../../src/sim/rider';
import { WORLD } from '../../src/sim/tuning';

const STEP = 1 / WORLD.stepHz;

describe('events', () => {
  for (const sport of ['board', 'ski'] as const) {
    it(`a good ${sport} run medals in the slopestyle`, () => {
      const { result } = rideEvent(EVENTS.slopestyle, sport, 'normal', slopestyleBot());
      expect(result.finished).toBe(true);
      expect(result.medal).not.toBeNull();
    });

    it(`a good ${sport} line through the glade medals in the tree run`, () => {
      const { result } = rideEvent(EVENTS.treeRun, sport, 'normal', treeRunBot());
      expect(result.finished).toBe(true);
      expect(['gold', 'platinum']).toContain(result.medal);
    });
  }

  it('waits for the countdown before the clock starts', () => {
    const { run } = startEvent(EVENTS.treeRun, 'board', 'normal');
    let started = false;
    for (let t = 0; t < 2.9; t += STEP) started ||= stepCountdown(run, STEP);
    expect(started).toBe(false);
    for (let t = 0; t < 0.2; t += STEP) started ||= stepCountdown(run, STEP);
    expect(started).toBe(true);
    expect(run.phase).toBe('running');
  });

  it('leaving the glade ends a tree run', () => {
    const { rider, run } = startEvent(EVENTS.treeRun, 'board', 'normal');
    run.phase = 'running';
    while (run.phase === 'running') {
      stepRider(rider, { ...noInput(), right: true }, STEP);
      stepEvent(run, rider, STEP);
    }
    expect(run.result).toMatchObject({ finished: false, medal: null, reason: 'Left the course' });
  });

  it('repeating a trick scores half each time', () => {
    const { rider, run } = startEvent(EVENTS.slopestyle, 'board', 'normal');
    run.phase = 'running';
    for (let i = 0; i < 3; i++) {
      rider.lastTrick = { name: 'Frontside 360', score: 400, quality: 'solid' };
      rider.landings++;
      stepEvent(run, rider, STEP);
    }
    expect(run.score).toBe(400 + 200 + 100);
  });

  it('medals by points and by time', () => {
    expect(medalFor(EVENTS.slopestyle, EVENTS.slopestyle.medals[2])).toBe('gold');
    expect(medalFor(EVENTS.slopestyle, 0)).toBeNull();
    expect(medalFor(EVENTS.treeRun, EVENTS.treeRun.medals[1] - 0.1)).toBe('silver');
    expect(medalFor(EVENTS.treeRun, 999)).toBeNull();
  });
});

describe('ghosts', () => {
  it('inputs pack small and unpack exactly', () => {
    const inputs = [0, 0, 0, 1, 1, 5, 5, 5, 5, 0, 63];
    expect(unpackInputs(packInputs(inputs))).toEqual(inputs);
    const keys = { ...noInput(), left: true, jump: true };
    expect(decodeInput(encodeInput(keys))).toEqual(keys);
  });

  it('a recorded run replays to exactly the same ride', () => {
    const { recording } = rideEvent(EVENTS.slopestyle, 'board', 'normal', slopestyleBot());
    const packed = packInputs(recording.inputs);
    expect(packed.length).toBeLessThan(4000);
    // Ride it once live, then replay the packed recording as a ghost.
    const { rider } = startEvent(EVENTS.slopestyle, 'board', 'normal');
    for (const mask of recording.inputs) stepRider(rider, decodeInput(mask), STEP);
    const ghost = ghostFrom(EVENTS.slopestyle, { ...recording, inputs: unpackInputs(packed) });
    for (let i = 0; i < recording.inputs.length + 10; i++) stepGhost(ghost, STEP);
    expect(ghost.rider.pos).toEqual(rider.pos);
    expect(ghost.rider.lastTrick).toEqual(rider.lastTrick);
  });
});
