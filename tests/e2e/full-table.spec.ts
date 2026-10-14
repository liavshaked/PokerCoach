import { expect, test, type Page } from '@playwright/test';

test('practice history replays visually and the notebook preserves the original choice', async ({
  page,
}) => {
  await page.goto('/#library');
  await page.locator('.scenario-tile').first().click();
  await page.getByRole('button', { name: 'Practice this spot', exact: true }).click();
  await page.locator('.poker-action').first().click();
  const original = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('feltlab-training-v1')!).state.currentSession.decisions[0]
        .actionId,
  );
  await page.getByRole('button', { name: 'Try another line', exact: true }).click();
  await page.locator('.poker-action').last().click();
  await page.getByRole('button', { name: 'Save practice spot', exact: true }).click();
  await page.getByRole('button', { name: 'Replay hand history', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.live-community .playing-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Last action', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.seat-hero')).toHaveClass(/seat-acting/);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.goto('/#notebook');
  await expect(page.locator('.notebook-card')).toHaveCount(1);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('feltlab-notebook-v3')!).state.spots[0].actionId,
    ),
  ).toBe(original);
  await page.reload();
  await expect(page.locator('.notebook-card')).toHaveCount(1);
});

async function playHand(page: Page) {
  for (let action = 0; action < 150; action++) {
    await expect
      .poll(
        async () =>
          (await page.getByRole('button', { name: 'Next hand →', exact: true }).count()) ||
          (await page
            .locator('.table-action-title strong')
            .filter({ hasText: 'Your decision' })
            .count()),
        { timeout: 15000 },
      )
      .toBeGreaterThan(0);
    if (await page.getByRole('button', { name: 'Next hand →', exact: true }).count()) return;
    const check = page
      .locator('.table-action-buttons')
      .getByRole('button', { name: 'Check', exact: true });
    const call = page.locator('.table-action-buttons').getByRole('button', { name: /^Call / });
    if (await check.count()) await check.click();
    else if (await call.count()) await call.click();
    else await page.locator('.table-action-buttons button').first().click();
  }
  throw new Error('Hand did not terminate in 150 hero actions');
}

test('complete 2, 3, and 6-player hands, continue, replay, save notes, and restore', async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/#table');
  await expect(page.getByRole('button', { name: '6 players', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  for (const count of [2, 3, 6]) {
    await page
      .getByRole('button', { name: count === 2 ? 'Heads-up' : `${count} players`, exact: true })
      .click();
    await page.locator('.table-config summary').click();
    await page.getByLabel('Table pace').selectOption('250');
    await page.getByLabel('Feedback timing').selectOption('full-hand');
    await page.getByRole('button', { name: 'Take a seat', exact: true }).click();
    await expect(page.locator('.ai-game-panel .live-seat')).toHaveCount(count);
    await playHand(page);
    await page.getByRole('button', { name: 'Save hand', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Hand saved', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Replay hand', exact: true }).click();
    await page.getByRole('button', { name: 'First action', exact: true }).click();
    await expect(page.getByRole('dialog').locator('.live-community .playing-card')).toHaveCount(0);
    await page.getByRole('button', { name: 'Last action', exact: true }).click();
    await expect(page.getByRole('dialog').locator('.live-pot')).toContainText('HAND COMPLETE');
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('button', { name: 'Next hand →', exact: true }).click();
    await expect(page.locator('.ai-toolbar')).toContainText('HAND 2');
    await page.reload();
    await expect(page.locator('.ai-toolbar')).toContainText('HAND 2');
    await playHand(page);
    await page.getByRole('button', { name: 'End session', exact: true }).click();
    await page.getByRole('button', { name: 'Finish & review', exact: true }).click();
  }
  await page.goto('/#notebook');
  await expect(page.locator('.notebook-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Review & notes' }).first().click();
  await page.getByLabel('Hand notes').fill('Review my river call and the price I was offered.');
  await page.getByLabel('Hand tags').fill('river, price');
  await page.getByLabel('Mark for another review').check();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.reload();
  await page.getByLabel('Search saved hands').fill('price');
  await expect(page.locator('.notebook-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Marked for review', exact: true }).click();
  await expect(page.locator('.notebook-card')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('session review hides answers across table, progress, notebook, and practice', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto('/#table');
  await page.getByRole('button', { name: 'Heads-up', exact: true }).click();
  await page.locator('.table-config summary').click();
  await page.getByLabel('Table pace').selectOption('250');
  await page.getByLabel('Feedback timing').selectOption('session-review');
  await page.getByRole('button', { name: 'Take a seat', exact: true }).click();
  await playHand(page);
  await expect(page.locator('.pending-review')).toBeVisible();
  await expect(page.locator('.decision-review')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save hand', exact: true }).click();
  await page.goto('/#progress');
  await expect(page.getByRole('heading', { name: 'Your review is waiting.' })).toBeVisible();
  await page.goto('/#notebook');
  await page.getByRole('button', { name: 'Review & notes' }).click();
  await expect(page.locator('.pending-review')).toBeVisible();
  await expect(page.locator('.decision-review')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.goto('/#table');
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await page.getByRole('button', { name: 'Finish & review', exact: true }).click();
  await page.locator('.session-hand-list button').first().click();
  await expect(page.locator('.decision-review').first()).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.goto('/#practice');
  await page.getByRole('button', { name: 'Start Training', exact: true }).click();
  await page.locator('.poker-action').first().click();
  await expect(page.locator('.decision-grade')).toHaveCount(0);
  await expect(page.getByText('Decision recorded. Keep your focus.')).toBeVisible();
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'End session', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Session in the books.' })).toBeVisible();
});

test('full table, card symbols, replay and range explorer fit phone through desktop', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto('/#table');
  await page.getByRole('button', { name: 'Take a seat', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const problems = await page.locator('.live-table').evaluate((table) => {
      const problems: string[] = [];
      const overlaps = (a: DOMRect, b: DOMRect) =>
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
      const seats = [...table.querySelectorAll('.seat-plaque')].map((item) =>
        item.getBoundingClientRect(),
      );
      const board = table.querySelector('.live-community')!.getBoundingClientRect();
      for (let a = 0; a < seats.length; a++) {
        if (overlaps(seats[a], board)) problems.push('Board overlaps seat');
        if (seats[a].left < 0 || seats[a].right > innerWidth + 0.5)
          problems.push('Seat outside viewport');
        for (let b = a + 1; b < seats.length; b++)
          if (overlaps(seats[a], seats[b])) problems.push('Seats overlap');
      }
      for (const card of table.querySelectorAll('.playing-card:not(.card-back)')) {
        const rank = card.querySelector('.card-corner strong')!.getBoundingClientRect();
        const suit = card.querySelector('.card-corner span')!.getBoundingClientRect();
        const center = card.querySelector('.card-center-suit')!.getBoundingClientRect();
        if (overlaps(rank, suit) || overlaps(rank, center) || overlaps(suit, center))
          problems.push('Card symbols overlap');
      }
      return problems;
    });
    expect(problems).toEqual([]);
    await page.screenshot({ path: `test-results/feltlab-v3-table-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Replay hand so far', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'First action', exact: true }).click();
  await page.getByRole('button', { name: 'Play replay', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause replay', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/feltlab-v3-replay-390.png' });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.goto('/#ranges');
  await expect(page.locator('.range-cell')).toHaveCount(169);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/feltlab-v3-ranges-320.png', fullPage: true });
});

test('mobile betting controls stay below hero cards at small phone heights', async ({ page }) => {
  await page.goto('/#table');
  await page.locator('.table-config summary').click();
  await page.getByLabel('Table pace').selectOption('250');
  await page.getByRole('button', { name: 'Take a seat', exact: true }).click();
  await expect(page.locator('.table-action-title strong')).toHaveText('Your decision');
  for (const [width, height] of [
    [390, 844],
    [320, 740],
    [375, 667],
  ]) {
    await page.setViewportSize({ width, height });
    const hero = await page.locator('.seat-hero').boundingBox();
    const dock = await page.locator('.live-actions').boundingBox();
    expect(hero!.y + hero!.height).toBeLessThanOrEqual(dock!.y);
    expect(dock!.y + dock!.height).toBeLessThanOrEqual(height - 50);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.getByLabel('Pot size preset')).toBeVisible();
    await page.getByLabel('Pot size preset').selectOption('all');
    await expect(page.getByLabel('Bet or raise size')).toHaveValue('100');
    await page.screenshot({
      path: `test-results/feltlab-v3-betting-${width}-${height}.png`,
      fullPage: true,
    });
  }
  await page.getByRole('button', { name: 'Open hand replay', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
