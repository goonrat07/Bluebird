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
  await page.waitForFunction(() => window.__game!.telemetry().speedKmh > 25, null, { timeout: 30_000 });

  await page.keyboard.down('Space');
  await page.waitForTimeout(450);
  await page.keyboard.up('Space');
  await page.waitForFunction(() => !window.__game!.telemetry().grounded, null, { timeout: 5_000 });
  await page.keyboard.down('KeyA');
  await page.screenshot({ path: 'test/artifacts/air.png' });
  await page.waitForFunction(() => window.__game!.telemetry().grounded, null, { timeout: 10_000 });
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
  expect(errors).toEqual([]);
});
