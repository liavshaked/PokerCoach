/** Export actual FeltLab rules-engine hands for an independent PokerKit oracle. */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createServer } from 'vite';

const count = Number(process.argv[2] ?? 600);
if (!Number.isInteger(count) || count < 1 || count > 10000) {
  throw new Error('Hand count must be an integer from 1 to 10000.');
}
const destination = resolve(process.argv[3] ?? 'test-results/pokerkit-fixtures.json');
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { createHand, applyAction, getLegalActions } = await server.ssrLoadModule(
    '/src/engine/game/index.ts',
  );
  const { cardKey } = await server.ssrLoadModule('/src/engine/cards/index.ts');
  const hands = [];
  for (let index = 0; index < count; index++) {
    const playerCount = [2, 3, 6][index % 3];
    let randomState = (index + 1) >>> 0;
    const random = () =>
      (randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 4294967296;
    const chipUnit = 0.5;
    const chips = (value) => Math.round(value / chipUnit);
    let state = createHand({
      seed: `pokerkit-oracle-v3-${index}`,
      buttonSeat: Math.floor(index / 3) % playerCount,
      smallBlind: 0.5,
      bigBlind: 1,
      chipUnit,
      players: Array.from({ length: playerCount }, (_, seat) => ({
        id: `p${seat}`,
        name: `Seat ${seat + 1}`,
        stack: index % 4 === 0 ? 100 : (2 + Math.floor(random() * 199)) / 2,
      })),
    });
    const fixture = {
      id: state.id,
      button: state.buttonSeat,
      smallBlind: chips(state.config.smallBlind),
      bigBlind: chips(state.config.bigBlind),
      startingStacks: state.players.map((player) => chips(player.startingStack)),
      holeCards: state.players.map((player) => player.holeCards.map(cardKey)),
      actions: [],
      board: [],
      expectedFinalStacks: [],
    };
    for (let guard = 0; !state.result && guard < 500; guard++) {
      const legal = getLegalActions(state);
      const raise = legal.find((action) => action.type === 'raise' || action.type === 'bet');
      const call = legal.find((action) => action.type === 'call');
      const check = legal.find((action) => action.type === 'check');
      const fold = legal.find((action) => action.type === 'fold');
      const roll = random();
      let action;
      if (raise && roll < 0.28) {
        const sizing = random();
        const total =
          sizing < 0.25
            ? raise.maxAmount
            : sizing < 0.6
              ? raise.minAmount
              : Math.min(raise.maxAmount, raise.minAmount + Math.floor(random() * 20) * chipUnit);
        action = { type: raise.type, amount: total };
      } else if (fold && roll > 0.86) action = { type: 'fold' };
      else action = { type: check ? 'check' : call ? 'call' : 'fold' };
      fixture.actions.push({
        seat: state.players.find((player) => player.id === state.actorId).seat,
        street: state.street,
        kind: action.type,
        ...(action.amount === undefined ? {} : { amount: chips(action.amount) }),
        expected: {
          stacks: state.players.map((player) => chips(player.stack)),
          callAmount: call ? chips(call.amount) : 0,
          raiseAllowed: Boolean(raise),
          ...(raise
            ? { minRaiseTo: chips(raise.minAmount), maxRaiseTo: chips(raise.maxAmount) }
            : {}),
        },
      });
      state = applyAction(state, action);
    }
    if (!state.result) throw new Error(`Hand failed to finish: ${fixture.id}`);
    fixture.board = state.board.map(cardKey);
    fixture.expectedFinalStacks = state.players.map((player) => chips(player.stack));
    hands.push(fixture);
  }
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(
    destination,
    `${JSON.stringify({ version: 1, engine: 'FeltLab V3', hands }, null, 2)}\n`,
  );
  console.log(`Exported ${hands.length} actual FeltLab hands to ${destination}`);
} finally {
  await server.close();
}
