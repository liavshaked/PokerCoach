import { expect, test } from '@playwright/test';

test('production manifest, install icons, service worker and offline practice', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start Training' })).toBeVisible();
  const manifestLink = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestLink).toBeTruthy();
  const response = await page.request.get(manifestLink!);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
  for (const icon of manifest.icons) expect((await page.request.get(icon.src)).ok()).toBe(true);
  expect((await page.request.get('/apple-touch-icon.png')).ok()).toBe(true);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await page.getByRole('button', { name: 'Start Training' }).click();
  await page.locator('.poker-action').last().click();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.decision-grade')).toBeVisible();
  await page.locator('.next-button').click();
  await expect(page.locator('.poker-action').first()).toBeVisible();
  await page.locator('.poker-action').first().click();
  await expect(page.locator('.decision-grade')).toBeVisible();
  await page.goto('/#table');
  await page.getByRole('button', { name: 'Heads-up', exact: true }).click();
  await page.getByRole('button', { name: 'Take a seat', exact: true }).click();
  await page
    .locator('.table-action-buttons')
    .getByRole('button', { name: 'Fold', exact: true })
    .click();
  await expect(page.locator('.live-pot')).toContainText('HAND COMPLETE');
  await page.getByRole('button', { name: 'Save hand', exact: true }).click();
  await page.goto('/#notebook');
  await expect(page.locator('.notebook-card')).toHaveCount(1);
  await page.goto('/#ranges');
  await expect(page.locator('.range-cell')).toHaveCount(169);
  await context.setOffline(false);
});
