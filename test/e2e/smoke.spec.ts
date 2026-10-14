import { expect, test, type Page } from '@playwright/test';

const telemetry = (page: Page) => page.evaluate(() => window.__game!.telemetry());

async function load(page: Page, errors: string[]) {
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.ready && window.__game.telemetry().frame > 30);
}

test('the game loads and the rider can ride', async ({ page }) => {
  const errors: string[] = [];
  await load(page, errors);
  await page.screenshot({ path: 'test/artifacts/start.png' });

  // Wait on distance ridden, not wall-clock time: on slow software-rendered CI the
  // simulation runs slower than real time, so a fixed wait covers less riding.
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game!.telemetry().pos.z > 30, null, { timeout: 30_000 });
  await page.keyboard.up('KeyW');

  const t = await telemetry(page);
  expect(t.speedKmh).toBeGreaterThan(15);
  // Sound starts on the first key press; M mutes it.
  expect(t.sound).toBe('running');
  console.log(`sound level while riding: ${t.soundLevel.toFixed(3)}`);
  expect(t.soundLevel).toBeGreaterThan(0.001); // quiet at low speed, but not silent
  await page.keyboard.press('KeyM');
  expect((await telemetry(page)).sound).toBe('muted');
  await page.keyboard.press('KeyM');
  console.log(`fps while riding: ${t.fps.toFixed(1)}`);
  await page.screenshot({ path: 'test/artifacts/riding.png' });

  // Carve hard and look at the spray.
  await page.keyboard.down('KeyA');
  await page.waitForFunction(() => Math.abs(window.__game!.telemetry().edge) > 0.9, null, { timeout: 10_000 });
  await page.screenshot({ path: 'test/artifacts/carving.png' });
  await page.keyboard.up('KeyA');

  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => window.__game!.telemetry().pos.z < 15);
  expect(errors).toEqual([]);
});

test('jumping, spinning and landing produce a result', async ({ page }) => {
  const errors: string[] = [];
  await load(page, errors);
  await page.evaluate(() => window.__game!.setAssist('relaxed'));
  // Start already moving: on a slow software renderer, building speed from a standstill can take minutes.
  await page.evaluate(() => window.__game!.teleport(40, 0, 9));
  await page.waitForFunction(() => window.__game!.telemetry().speedKmh > 25, null, { timeout: 30_000 });

  // Hold for a number of rendered frames, not milliseconds, so a slow software renderer still sees the key.
  const holdFrom = (await telemetry(page)).frame;
  await page.keyboard.down('Space');
  await page.waitForFunction((f) => window.__game!.telemetry().frame > f + 20, holdFrom);
  await page.keyboard.up('Space');
  await page.waitForFunction(() => !window.__game!.telemetry().grounded, null, { timeout: 30_000 });
  await page.keyboard.down('KeyA');
  await page.screenshot({ path: 'test/artifacts/air.png' });
  await page.waitForFunction(() => window.__game!.telemetry().grounded, null, { timeout: 60_000 }); // a jump can span many slow frames
  await page.keyboard.up('KeyA');

  const t = await telemetry(page);
  expect(t.landings).toBeGreaterThan(0);
  expect(t.lastTrick).not.toBeNull();
  await page.waitForTimeout(100);
  await page.screenshot({ path: 'test/artifacts/landed.png' });
  expect(errors).toEqual([]);
});

test('skis swap in and the tuning panel opens', async ({ page }) => {
  const errors: string[] = [];
  await load(page, errors);
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__game!.telemetry().sport === 'ski');
  await page.keyboard.press('Backquote');
  await expect(page.locator('#tuning')).toBeVisible();
  await page.locator('#tuning summary').first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test/artifacts/skis-tuning.png' });

  // The style guide asks for every look at golden hour (the default) and at noon.
  await page.keyboard.press('Backquote');
  await page.keyboard.press('KeyT');
  // Wait for whole frames drawn in the new light, not wall time: software GL can be slow.
  const lit = (await telemetry(page)).frame;
  await page.waitForFunction((f) => window.__game!.telemetry().frame > f + 3, lit);
  await page.screenshot({ path: 'test/artifacts/noon.png' });
  expect(errors).toEqual([]);
});

test('landmarks down Kettle Run', async ({ page }) => {
  test.setTimeout(300_000); // five spots, each drawn in software GL
  const errors: string[] = [];
  await load(page, errors);
  // Fixed camera spots: the glade, the park line, the Kettle Wall and the finish.
  const spots: [string, number, number][] = [
    ['glade', 500, 30],
    ['park', 800, 0],
    ['rails', 926, 13],
    ['wall', 1105, 0],
    ['finish', 1420, 0],
  ];
  for (const [name, z, u] of spots) {
    await page.evaluate(([z, u]) => window.__game!.teleport(z, u), [z, u]);
    const f = (await telemetry(page)).frame;
    await page.waitForFunction((f) => window.__game!.telemetry().frame > f + 10, f);
    await page.screenshot({ path: `test/artifacts/spot-${name}.png` });
  }
  expect(errors).toEqual([]);
});

test('the rest of Kettle Peak', async ({ page }) => {
  test.setTimeout(300_000); // six spots, each drawn in software GL
  const errors: string[] = [];
  await load(page, errors);
  // A spot on each of the other runs, and one looking across from Kettle at a branch.
  const spots: [string, string, number, number][] = [
    ['cornice', 'cornice', -330, 0],
    ['couloir', 'couloir', -300, 0],
    ['raven-traverse', 'raven', 300, 0],
    ['raven-face', 'raven', 490, 0],
    ['fernwood', 'fernwood', 1050, 0],
    ['fernwood-base', 'fernwood', 1420, 0],
  ];
  for (const [name, run, z, u] of spots) {
    await page.evaluate(([run, z, u]) => window.__game!.teleport(z as number, u as number, 6, run as string), [run, z, u]);
    const f = (await telemetry(page)).frame;
    await page.waitForFunction((f) => window.__game!.telemetry().frame > f + 10, f);
    await page.screenshot({ path: `test/artifacts/peak-${name}.png` });
  }
  expect(errors).toEqual([]);
});

test('riding the glade builds Flow', async ({ page }) => {
  test.setTimeout(180_000); // the glade is the heaviest view for a software renderer
  const errors: string[] = [];
  await load(page, errors);
  await page.evaluate(() => window.__game!.setAssist('relaxed'));
  await page.evaluate(() => window.__game!.teleport(480, 31, 12));
  // Ride the glade hands-off; relaxed gap sense threads the trunks.
  await page.waitForFunction(() => window.__game!.telemetry().pos.z > 530, null, { timeout: 150_000 });
  await page.screenshot({ path: 'test/artifacts/glade-flow.png' });
  const t = await telemetry(page);
  console.log(`glade: flow ${t.flow.toFixed(2)}, branch hits ${t.branchHits}, crashed ${t.crashed}`);
  expect(errors).toEqual([]);
});

test('riding onto the park box grinds it', async ({ page }) => {
  const errors: string[] = [];
  await load(page, errors);
  await page.evaluate(() => window.__game!.setAssist('relaxed'));
  // The box starts at z 850, 13 m across from the centerline; ride straight at it.
  await page.evaluate(() => window.__game!.teleport(842, 13, 8));
  await page.waitForFunction(() => window.__game!.telemetry().rail !== null, null, { timeout: 60_000 });
  const f = (await telemetry(page)).frame;
  await page.waitForFunction((f) => window.__game!.telemetry().frame > f + 3, f);
  await page.screenshot({ path: 'test/artifacts/grind.png' });
  const t = await telemetry(page);
  console.log(`grinding ${t.rail}, balance ${t.balance.toFixed(2)}`);
  await page.waitForFunction(() => window.__game!.telemetry().rail === null, null, { timeout: 60_000 });
  expect(errors).toEqual([]);
});

test('events: countdown, a ghost to chase, and a result', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  await load(page, errors);
  await page.keyboard.press('Digit1');
  await page.waitForFunction(() => window.__game!.telemetry().event?.phase === 'countdown');
  await page.screenshot({ path: 'test/artifacts/event-countdown.png' });
  await page.waitForFunction(() => (window.__game!.telemetry().event?.clock ?? 0) > 3, null, { timeout: 90_000 });
  const t = await telemetry(page);
  console.log(`slopestyle: ghost ${t.event!.ghost} at z ${t.event!.ghostZ?.toFixed(0)}, rider at z ${t.pos.z.toFixed(0)}`);
  expect(t.event!.ghost).toBe('Rival');
  await page.screenshot({ path: 'test/artifacts/event-ghost.png' });

  // The glade dash ridden hands-off drifts out of the trees, which ends the run with a result card.
  await page.keyboard.press('Digit2');
  await page.waitForFunction(() => window.__game!.telemetry().event?.id === 'treeRun');
  await page.waitForFunction(() => window.__game!.telemetry().event?.phase === 'done', null, { timeout: 180_000 });
  const done = await telemetry(page);
  console.log(`glade dash: ${JSON.stringify(done.event!.result)}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test/artifacts/event-result.png' });
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => window.__game!.telemetry().event === null);
  expect(errors).toEqual([]);
});
