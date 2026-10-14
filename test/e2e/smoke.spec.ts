import { expect, test } from '@playwright/test';

test('the game loads and the rider can ride', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.waitForFunction(() => window.__game?.ready && window.__game.telemetry().frame > 30);
  await page.screenshot({ path: 'test/artifacts/start.png' });

  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3000);
  await page.keyboard.up('KeyW');

  const t = await page.evaluate(() => window.__game!.telemetry());
  expect(t.speedKmh).toBeGreaterThan(15);
  expect(t.pos.z).toBeGreaterThan(15);
  await page.screenshot({ path: 'test/artifacts/riding.png' });

  await page.keyboard.press('KeyR');
  await page.waitForTimeout(200);
  const afterReset = await page.evaluate(() => window.__game!.telemetry());
  expect(afterReset.pos.z).toBeLessThan(15);

  expect(errors).toEqual([]);
});
