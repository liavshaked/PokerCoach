import { expect, test } from '@playwright/test';

test('100 fresh generated decisions, reload, summary, progress, and restart', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start Training', exact: true }).click();
  const fingerprints = new Set<string>();
  let previousFingerprint = '';
  for (let index = 1; index <= 100; index++) {
    await expect(page.getByText(`Spot ${index}`, { exact: true })).toBeVisible();
    await expect(page.locator('.poker-action').first()).toBeVisible();
    const fingerprint = await page.locator('.table-stage').evaluate((element) => {
      const cards = [...element.querySelectorAll('.playing-card:not(.card-back)')].map((card) =>
        card.getAttribute('aria-label'),
      );
      return JSON.stringify([cards, element.querySelector('.pot-label strong')?.textContent]);
    });
    expect(fingerprint).not.toBe(previousFingerprint);
    previousFingerprint = fingerprint;
    fingerprints.add(fingerprint);
    await page.locator('.poker-action').first().click();
    await expect(page.locator('.desktop-coaching .decision-grade')).toBeVisible();
    if (index === 40) {
      await page.reload();
      await expect(page.locator('.desktop-coaching .decision-grade')).toBeVisible();
      await expect(page.getByText('Spot 40', { exact: true })).toBeVisible();
    }
    if (index < 100)
      await page.locator('.action-dock').getByRole('button', { name: 'Next spot' }).click();
  }
  const data = await page.evaluate(
    () => JSON.parse(localStorage.getItem('feltlab-generated-v2')!).state,
  );
  expect(data.results).toHaveLength(100);
  expect(fingerprints.size).toBeGreaterThan(95);
  expect(new Set(data.results.map((result: { seed: string }) => result.seed)).size).toBe(100);
  expect(new Set(data.results.map((result: { street: string }) => result.street)).size).toBe(4);
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'End session', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Session in the books.' })).toBeVisible();
  await expect(page.getByText('100 first attempts saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Review progress' }).click();
  await expect(page.locator('.metric').nth(1).locator('strong')).toHaveText('100');
  await page.reload();
  await expect(page.locator('.metric').nth(1).locator('strong')).toHaveText('100');
  await page.getByRole('button', { name: 'Practice room', exact: true }).click();
  await page.getByRole('button', { name: 'Another session' }).click();
  await expect(page.getByText('Spot 1', { exact: true })).toBeVisible();
  await expect(page.locator('.poker-action').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('focus filters persist and only expose supported concepts', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Focused/ }).click();
  await page.locator('.practice-options > summary').click();
  await page.getByLabel('Training street', { exact: true }).selectOption('turn');
  await page.getByLabel('Training concept', { exact: true }).selectOption('drawing-odds');
  await expect(
    page.getByLabel('Training concept', { exact: true }).locator('option[value="blind-defense"]'),
  ).toHaveCount(0);
  await page.getByLabel('Opponent profile', { exact: true }).selectOption('tight');
  await page.getByLabel('Difficulty', { exact: true }).selectOption('advanced');
  await page.reload();
  await page.locator('.practice-options > summary').click();
  await expect(page.getByLabel('Training concept', { exact: true })).toHaveValue('drawing-odds');
  await page.getByRole('button', { name: 'Start Training', exact: true }).click();
  await expect(page.locator('.poker-action').first()).toBeVisible();
  const state = await page.evaluate(
    () => JSON.parse(localStorage.getItem('feltlab-generated-v2')!).state,
  );
  expect(state.currentScenario.street).toBe('turn');
  expect(state.currentScenario.generated.category).toBe('drawing-odds');
  expect(state.currentScenario.generated.profile).toBe('tight');
  expect(state.currentScenario.difficulty).toBe('advanced');
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(page.locator('.poker-action')).toHaveCount(4);
  const hero = await page.locator('.hero-badge').boundingBox();
  const dock = await page.locator('.action-dock-active').boundingBox();
  expect(hero!.y + hero!.height).toBeLessThanOrEqual(dock!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const button of await page.locator('.poker-action').all()) {
    const bounds = await button.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(740);
  }
  await page.screenshot({ path: 'test-results/feltlab-v2-advanced-math-320.png', fullPage: true });
});

test('mobile analysis, navigation, cards and modals fit every requested width', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.getByRole('button', { name: /^Focused/ }).click();
  await page.getByRole('button', { name: 'Start Training', exact: true }).click();
  await expect(page.locator('.poker-action').first()).toBeVisible();
  for (const width of [320, 360, 375, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const issues = await page.locator('.table-stage').evaluate((table) => {
      const problems: string[] = [];
      const overlap = (a: DOMRect, b: DOMRect) =>
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
      for (const card of table.querySelectorAll('.playing-card:not(.card-back)')) {
        const rank = card.querySelector('.card-corner strong')!.getBoundingClientRect();
        const suit = card.querySelector('.card-corner span')!.getBoundingClientRect();
        const center = card.querySelector('.card-center-suit')!.getBoundingClientRect();
        if (overlap(rank, suit) || overlap(rank, center) || overlap(suit, center))
          problems.push('Card symbols overlap');
        const bounds = card.getBoundingClientRect();
        if (bounds.left < 0 || bounds.right > innerWidth + 0.5)
          problems.push('Card outside screen');
      }
      const boardCards = [...table.querySelectorAll('.community-cards .playing-card')].map((card) =>
        card.getBoundingClientRect(),
      );
      const heroCards = [...table.querySelectorAll('.hero-cards .playing-card')].map((card) =>
        card.getBoundingClientRect(),
      );
      if (boardCards.some((board) => heroCards.some((hero) => overlap(board, hero))))
        problems.push('Hero and board cards overlap');
      for (let i = 1; i < boardCards.length; i++)
        if (overlap(boardCards[i - 1], boardCards[i])) problems.push('Community cards overlap');
      return problems;
    });
    expect(issues).toEqual([]);
    if (width < 768) {
      const bounds = await page.locator('.poker-action').first().boundingBox();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
    }
    await page.screenshot({ path: `test-results/feltlab-v2-active-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.poker-action').first().click();
  await page.getByRole('button', { name: 'View analysis' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').locator('.decision-grade')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/feltlab-v2-mobile-analysis.png' });
  await page.getByRole('dialog').getByRole('button', { name: 'Next spot' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.poker-action').first()).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/feltlab-v2-landscape.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 568 });
  for (const label of ['Spot library', 'Your progress', 'Settings']) {
    if (label === 'Your progress')
      await page
        .getByRole('navigation', { name: 'Mobile navigation' })
        .getByRole('button', { name: label, exact: true })
        .click();
    else {
      await page.getByRole('button', { name: 'More pages' }).click();
      await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `test-results/feltlab-v2-${label.replaceAll(' ', '-')}-320.png`,
      fullPage: true,
    });
  }
});
