import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The practice room.' })).toBeVisible();
});

test('ten decisions, alternate replay and refresh retain honest first-attempt progress', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByRole('heading', { name: 'The practice room.' })).toBeVisible();
  await page.getByRole('button', { name: /^Challenge/ }).click();
  await page.getByRole('button', { name: 'Start Training' }).click();
  await expect(page.getByText('Spot 1', { exact: true })).toBeVisible();
  await page.locator('.poker-action').first().click();
  await expect(page.locator('.decision-grade')).toBeVisible();
  await page.getByRole('button', { name: 'Try another line' }).click();
  await page.locator('.poker-action').last().click();
  await page.reload();
  await expect(page.locator('.decision-grade')).toBeVisible();
  await page.locator('.next-button').click();
  for (let spot = 2; spot <= 10; spot++) {
    await expect(page.getByText(`Spot ${spot}`, { exact: true })).toBeVisible();
    await page.locator('.poker-action').first().click();
    await expect(page.locator('.decision-grade')).toBeVisible();
    await page.locator('.next-button').click();
  }
  await expect(page.getByRole('heading', { name: 'Session in the books.' })).toBeVisible();
  await expect(page.locator('.complete-review > div')).toHaveCount(10);
  await page.getByRole('button', { name: 'Review progress' }).click();
  await expect(page.locator('.metric').nth(0).locator('strong')).toHaveText('1');
  await expect(page.locator('.metric').nth(1).locator('strong')).toHaveText('10');
  await page.reload();
  await expect(page.locator('.metric').nth(1).locator('strong')).toHaveText('10');
  await page.getByRole('button', { name: 'Practice room', exact: true }).click();
  await page.getByRole('button', { name: 'Change practice' }).click();
  await expect(page.getByRole('button', { name: /^Endless/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('library filters, single-spot practice, keyboard and settings work', async ({ page }) => {
  await page.getByRole('button', { name: 'Spot library', exact: true }).click();
  await expect(page.locator('.scenario-tile')).toHaveCount(16);
  await page.getByRole('button', { name: /^River\s*4$/ }).click();
  await expect(page.locator('.scenario-tile')).toHaveCount(4);
  await page.getByRole('textbox', { name: 'Search scenarios' }).fill('not-a-real-spot');
  await expect(page.getByText('No spots in this range.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search scenarios' }).fill('');
  await page.locator('.scenario-tile').first().click();
  await page.getByRole('button', { name: 'Practice this spot' }).click();
  await page.keyboard.press('1');
  await expect(page.locator('.decision-grade')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Session in the books.' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Your display name').fill('Maya');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('switch', { name: 'Subtle table animations' }).click();
  await page.reload();
  await expect(page.getByLabel('Your display name')).toHaveValue('Maya');
  await expect(page.getByRole('switch', { name: 'Subtle table animations' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/^feltlab-progress-.*\.json$/);
  await page.getByRole('button', { name: 'Reset progress', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Reset progress', exact: true })
    .click();
  await page.getByRole('button', { name: 'Your progress', exact: true }).click();
  await expect(page.getByText('Your story starts with one decision.')).toBeVisible();
});

test('laptop and phone layouts contain the table and expose controls', async ({ page }) => {
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('button', { name: 'Start Training' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/feltlab-practice.png', fullPage: true });
});
