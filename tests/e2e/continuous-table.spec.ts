import { expect, test, type Page } from '@playwright/test';

async function setFixture(page: Page, kind: 'spectator' | 'final') {
  await page.evaluate(async (kind) => {
    const storePath = '/src/features/table/store.ts';
    const gamePath = '/src/engine/game/index.ts';
    const cardsPath = '/src/engine/cards/index.ts';
    const [{ useTableStore }, { createHand, applyAction }, { createDeck }] = await Promise.all([
      import(/* @vite-ignore */ storePath),
      import(/* @vite-ignore */ gamePath),
      import(/* @vite-ignore */ cardsPath),
    ]);
    useTableStore
      .getState()
      .startSession({ playerCount: 3, botDelayMs: 1200 }, 'browser-elimination');
    const stacks = kind === 'spectator' ? [10, 10, 100] : [0.5, 0.5, 0.5];
    const ranks = ['K', 'A', 'Q'];
    const slots = new Map<number, { rank: string; suit: string }>();
    [1, 2, 0].forEach((seat, offset) => {
      slots.set(offset, { rank: ranks[seat], suit: 'clubs' });
      slots.set(offset + 3, { rank: ranks[seat], suit: 'hearts' });
    });
    [
      { rank: '2', suit: 'diamonds' },
      { rank: '4', suit: 'hearts' },
      { rank: '6', suit: 'spades' },
      { rank: '8', suit: 'diamonds' },
      { rank: 'T', suit: 'clubs' },
    ].forEach((card, index) => slots.set([7, 8, 9, 11, 13][index], card));
    const rest = createDeck([...slots.values()]);
    const hand = createHand({
      seed: 'browser-elimination',
      buttonSeat: 0,
      smallBlind: 0.5,
      bigBlind: 1,
      players: stacks.map((stack, seat) => ({
        id: seat ? `bot-${seat}` : 'hero',
        name: seat ? `Bot ${seat}` : 'You',
        stack,
      })),
      deck: Array.from({ length: 52 }, (_, index) => slots.get(index) ?? rest.shift()),
    });
    useTableStore.setState({ currentHand: hand });
    if (kind === 'spectator') {
      useTableStore
        .getState()
        .submitHero(
          { type: 'raise', amount: 10 },
          `${hand.id}:${hand.events.length}:${hand.actorId}`,
        );
      useTableStore.setState({
        currentHand: applyAction(useTableStore.getState().currentHand, { type: 'call' }),
      });
    }
  }, kind);
}

test('hands deal automatically and reviews hold the table until resumed', async ({ page }) => {
  await page.goto('/#table');
  await page.clock.install();
  await page.getByRole('button', { name: 'Heads-up', exact: true }).click();
  await page.getByRole('button', { name: 'Take a seat', exact: true }).click();
  await page.getByRole('button', { name: 'Fold', exact: true }).click();
  await expect(page.getByText('Next deal in 4s')).toBeVisible();
  await page.getByRole('button', { name: 'Review & pause', exact: true }).click();
  await page.clock.fastForward(6000);
  await expect(page.locator('.ai-toolbar')).toContainText('HAND 1');
  await expect(page.getByRole('heading', { name: 'What you did well' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What to work on' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.getByRole('dialog').evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/feltlab-coaching-390.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.clock.fastForward(6000);
  await expect(page.locator('.ai-toolbar')).toContainText('HAND 1');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.clock.runFor(4100);
  await expect(page.locator('.ai-toolbar')).toContainText('HAND 2');
  await expect(page.getByRole('region', { name: 'Recent hands' })).toContainText('Hand 1');
});

test('fast-forward stops at the next human decision', async ({ page }) => {
  await page.goto('/#table');
  await page.clock.install();
  await page.getByRole('button', { name: 'Take a seat', exact: true }).click();
  await page.getByRole('button', { name: 'Skip to my turn', exact: true }).click();
  await expect(page.locator('.table-action-title strong')).toHaveText('Your decision');
  const before = await page.evaluate(
    () => JSON.parse(localStorage.getItem('feltlab-table-v3')!).state.session.decisions,
  );
  await page.clock.fastForward(10000);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('feltlab-table-v3')!).state.session.decisions,
    ),
  ).toBe(before);
  await expect(page.getByRole('button', { name: /Fast-forward|Skip to my turn/ })).toHaveCount(0);
});

test('a busted hero watches heads-up and remains out after refresh', async ({ page }) => {
  await page.goto('/#table');
  await page.clock.install();
  await setFixture(page, 'spectator');
  await page.getByRole('button', { name: 'Fast-forward hand', exact: true }).click();
  await expect(page.locator('.spectator-notice')).toContainText('You’re out. Watching 2 players');
  await expect(page.locator('.ai-toolbar')).toContainText('HEADS-UP');
  await page.getByRole('button', { name: 'Deal now', exact: true }).click();
  await expect(page.locator('.seat-hero')).toHaveClass(/seat-out/);
  await expect(page.locator('.seat-hero .card-back')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.reload();
  await expect(page.locator('.seat-hero .seat-status')).toHaveText('OUT');
  await expect(page.locator('.ai-toolbar')).toContainText('HEADS-UP');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
});

test('the last stack wins and a completed match stays finished after refresh', async ({ page }) => {
  await page.goto('/#table');
  await page.clock.install();
  await setFixture(page, 'final');
  await page.getByRole('button', { name: 'Call 0.5', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bot 1 wins the table.' })).toBeVisible();
  await expect(page.getByLabel('Final standings').locator('div')).toHaveCount(3);
  await page.clock.fastForward(10000);
  await expect(page.getByTestId('hand-complete')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Bot 1 wins the table.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/feltlab-match-winner.png', fullPage: true });
});
