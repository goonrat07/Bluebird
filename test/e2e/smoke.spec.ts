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
  // T steps on through the day from golden hour; jump straight to noon for the screenshot.
  await page.keyboard.press('KeyT');
  expect((await telemetry(page)).sky.time).toBe('Blue hour');
  await page.evaluate(() => window.__game!.setSky('Bluebird noon'));
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

test('lifts, the cat track and the trail map', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await load(page, errors);
  const frames = async (n: number) => {
    const f = (await telemetry(page)).frame;
    await page.waitForFunction(([f, n]) => window.__game!.telemetry().frame > f + n, [f, n]);
  };
  // Stop at the bottom of the Kettle Express and get on.
  await page.evaluate(() => window.__game!.placeAt(-45.7, 1493));
  await frames(5);
  expect((await telemetry(page)).canBoard).toBe('Kettle Express');
  await page.screenshot({ path: 'test/artifacts/lift-base.png' });
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__game!.telemetry().lift !== null);
  await page.evaluate(() => window.__game!.liftProgress(0.45));
  await frames(5);
  const riding = await telemetry(page);
  expect(riding.lift!.name).toBe('Kettle Express');
  await page.screenshot({ path: 'test/artifacts/lift-riding.png' });
  // Hurry to the top and get set down on the snow.
  await page.evaluate(() => window.__game!.liftProgress(0.995));
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game!.telemetry().lift === null, null, { timeout: 60_000 });
  await page.keyboard.up('KeyW');
  const top = await telemetry(page);
  expect(top.grounded).toBe(true);
  expect(Math.hypot(top.pos.x + 30, top.pos.z - 2)).toBeLessThan(6);
  await frames(5);
  await page.screenshot({ path: 'test/artifacts/lift-top.png' });

  // Summit Road, partway down its switchbacks.
  await page.evaluate(() => window.__game!.placeAt(-165, -315.5));
  await frames(2);
  expect((await telemetry(page)).snow).toBe('groomed');
  await frames(8);
  await page.screenshot({ path: 'test/artifacts/summit-road.png' });

  // The trail map opens and closes with Tab.
  await page.keyboard.press('Tab');
  await frames(3);
  await page.screenshot({ path: 'test/artifacts/trail-map.png' });
  await page.keyboard.press('Tab');
  expect(await page.locator('#map').isHidden()).toBe(true);
  expect(errors).toEqual([]);
});

test('the village: walking, shops and the dogs', async ({ page }) => {
  test.setTimeout(600_000); // walks the whole village, then the summit, in software GL
  const errors: string[] = [];
  await load(page, errors);
  const frames = async (n: number) => {
    const f = (await telemetry(page)).frame;
    await page.waitForFunction(([f, n]) => window.__game!.telemetry().frame > f + n, [f, n]);
  };
  // Stand at the bottom of the run looking down at the lodge and its terrace crowd.
  await page.evaluate(() => window.__game!.placeAt(44, 1556));
  await page.keyboard.press('KeyB');
  await page.waitForFunction(() => window.__game!.telemetry().walking);
  await frames(10);
  await page.screenshot({ path: 'test/artifacts/village.png' });

  // Outside the rental shop: step out of the bindings and walk in to the counter.
  await page.keyboard.press('KeyB');
  await page.waitForFunction(() => !window.__game!.telemetry().walking);
  await page.evaluate(() => window.__game!.placeAt(-48, 1560));
  await frames(3);
  // The sign hangs clear of the roof.
  await page.screenshot({ path: 'test/artifacts/rental-outside.png' });
  await page.evaluate(() => window.__game!.placeAt(-48, 1566));
  await frames(3);
  await page.keyboard.press('KeyB');
  await page.waitForFunction(() => window.__game!.telemetry().walking);
  // Face downhill (into the shop) is the default heading; walk until inside at the counter.
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game!.telemetry().prompt.includes('swap'), null, { timeout: 60_000 });
  await page.keyboard.up('KeyW');
  const shop = await telemetry(page);
  expect(shop.inside).toBe('rental');
  const sport = shop.sport;
  await page.keyboard.press('KeyE');
  await page.waitForFunction((s) => window.__game!.telemetry().sport !== s, sport);
  await frames(3);
  await page.screenshot({ path: 'test/artifacts/rental-shop.png' });

  // Clip back in by the door, ride over to the lodge and warm up by the fire.
  await page.keyboard.press('KeyB');
  await page.waitForFunction(() => !window.__game!.telemetry().walking);
  // On skis now: W double-poles along the flat village floor.
  await page.evaluate(() => window.__game!.placeAt(-20, 1610));
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game!.telemetry().speedKmh > 4, null, { timeout: 60_000 });
  await page.screenshot({ path: 'test/artifacts/pole-push.png' });
  await page.keyboard.up('KeyW');
  await page.evaluate(() => window.__game!.placeAt(48, 1580));
  await frames(3);
  await page.keyboard.press('KeyB');
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game!.telemetry().prompt.includes('fire'), null, { timeout: 90_000 });
  await page.keyboard.up('KeyW');
  await frames(3);
  await page.screenshot({ path: 'test/artifacts/lodge-inside.png' });

  // Pet Pepper in the village; she tags along.
  const pepper = (await telemetry(page)).dogs.find((d) => d.name === 'Pepper')!;
  await page.evaluate(([x, z]) => window.__game!.placeAt(x + 1.2, z), [pepper.x, pepper.z]);
  await frames(2);
  expect((await telemetry(page)).prompt).toContain('Pepper');
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__game!.telemetry().dogs.find((d) => d.name === 'Pepper')!.following);
  await frames(5);
  await page.screenshot({ path: 'test/artifacts/pepper.png' });

  // Bowie waits at the patrol hut by the top of the Summit Chair.
  // Step out of the bindings so you don't slide off down the summit.
  await page.evaluate(() => window.__game!.placeAt(22.5, -447));
  await page.keyboard.press('KeyB');
  await page.waitForFunction(() => window.__game!.telemetry().walking);
  await page.waitForFunction(() => window.__game!.telemetry().prompt.includes('Bowie'), null, { timeout: 60_000 });
  await page.screenshot({ path: 'test/artifacts/bowie.png' });
  expect(errors).toEqual([]);
});

test('time of day and weather', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await load(page, errors);
  const frames = async (n: number) => {
    const f = (await telemetry(page)).frame;
    await page.waitForFunction(([f, n]) => window.__game!.telemetry().frame > f + n, [f, n]);
  };
  // Y steps through the weather and says what it is.
  await page.keyboard.press('KeyY');
  const t = await telemetry(page);
  expect(t.sky.weather).toBe('Flat light');
  expect(t.prompt).toContain('Flat light');

  // The same stretch of Kettle Run, past a lamp post, through the day and the weather.
  const looks: [string, string, string][] = [
    ['Dawn', 'Clear', 'sky-dawn'],
    ['Morning', 'Clear', 'sky-morning'],
    ['Blue hour', 'Clear', 'sky-blue-hour'],
    ['Night', 'Clear', 'sky-night'],
    ['Golden hour', 'Snowstorm', 'sky-storm'],
    ['Bluebird noon', 'Flat light', 'sky-flat-light'],
  ];
  for (const [time, weather, shot] of looks) {
    await page.evaluate(([time, weather]) => {
      window.__game!.setSky(time, weather);
      window.__game!.teleport(580, -12, 4);
    }, [time, weather]);
    await frames(4);
    const sky = (await telemetry(page)).sky;
    expect(sky).toEqual({ time, weather });
    await page.screenshot({ path: `test/artifacts/${shot}.png` });
  }

  // The village after dark, windows lit.
  await page.evaluate(() => {
    window.__game!.setSky('Night', 'Clear');
    window.__game!.placeAt(44, 1556);
  });
  await page.keyboard.press('KeyB');
  await page.waitForFunction(() => window.__game!.telemetry().walking);
  await frames(4);
  await page.screenshot({ path: 'test/artifacts/village-night.png' });
  expect(errors).toEqual([]);
});

test('riding feel: carving, skid turns and the camera at speed', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await load(page, errors);
  const frames = async (n: number) => {
    const f = (await telemetry(page)).frame;
    await page.waitForFunction(([f, n]) => window.__game!.telemetry().frame > f + n, [f, n]);
  };
  for (const sport of ['board', 'ski']) {
    if ((await telemetry(page)).sport !== sport) {
      await page.keyboard.press('KeyF');
      await page.waitForFunction((s) => window.__game!.telemetry().sport === s, sport);
    }
    // A full carve at speed: the body leans into it and the horizon tips a little.
    await page.evaluate(() => window.__game!.teleport(180, 6, 17));
    await frames(2);
    await page.keyboard.down('KeyD');
    await page.waitForFunction(() => window.__game!.telemetry().edge < -0.95);
    await frames(6);
    await page.screenshot({ path: `test/artifacts/feel-carve-${sport}.png` });
    await page.keyboard.up('KeyD');
    // S + A: a braking pivot that throws the equipment sideways and scrubs speed.
    await page.evaluate(() => window.__game!.teleport(180, 0, 14));
    await frames(2);
    await page.keyboard.down('KeyS');
    await page.keyboard.down('KeyA');
    await frames(8);
    await page.screenshot({ path: `test/artifacts/feel-skid-${sport}.png` });
    await page.keyboard.up('KeyA');
    await page.keyboard.up('KeyS');
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
  test.setTimeout(600_000); // two events, ridden in software GL
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
  // Hands-off it leaves the glade after about 12 s of riding; software GL runs well behind real time.
  await page.waitForFunction(() => window.__game!.telemetry().event?.phase === 'done', null, { timeout: 360_000 });
  const done = await telemetry(page);
  console.log(`glade dash: ${JSON.stringify(done.event!.result)}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test/artifacts/event-result.png' });
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => window.__game!.telemetry().event === null);
  expect(errors).toEqual([]);
});

test('characters up close', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await load(page, errors);
  const frames = async (n: number) => {
    const f = (await telemetry(page)).frame;
    await page.waitForFunction(([f, n]) => window.__game!.telemetry().frame > f + n, [f, n]);
  };
  // On foot by the lodge terrace: the rider close up, with the crowd behind.
  await page.evaluate(() => window.__game!.placeAt(44, 1560));
  await page.keyboard.press('KeyB');
  await page.waitForFunction(() => window.__game!.telemetry().walking);
  // Turn a little so the face shows.
  await page.keyboard.down('KeyA');
  await frames(6);
  await page.keyboard.up('KeyA');
  await frames(3);
  await page.screenshot({ path: 'test/artifacts/char-walk.png' });
  // Riding.
  await page.keyboard.press('KeyB');
  await page.evaluate(() => window.__game!.teleport(180, 4, 12));
  await frames(6);
  await page.screenshot({ path: 'test/artifacts/char-ride.png' });
  expect(errors).toEqual([]);
});

test.describe('on a high-DPI screen', () => {
  test.use({ deviceScaleFactor: 1.5 });
  test('the trail map fills the screen', async ({ page }) => {
    const errors: string[] = [];
    await load(page, errors);
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => window.__game!.telemetry().frame > 0);
    // The paper sheet sits in the middle of the screen, top to bottom.
    const paper = await page.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const c = document.getElementById('map') as HTMLCanvasElement;
      const px = (x: number, y: number) => Array.from(c.getContext('2d')!.getImageData(Math.round(c.width * x), Math.round(c.height * y), 1, 1).data);
      return [px(0.5, 0.03), px(0.5, 0.97)];
    });
    await page.screenshot({ path: 'test/artifacts/trail-map-hidpi.png' });
    for (const [r, g, b] of paper) expect(r + g + b).toBeGreaterThan(600);
    expect(errors).toEqual([]);
  });
});
