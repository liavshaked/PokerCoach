import { assertCards, cardKey, createDeck } from '../cards';
import { evaluateHand } from '../equity';
import { seededRandom, shuffled } from '../generation/random';
import type {
  AgentView,
  GameAction,
  GameEvent,
  GamePlayer,
  GameState,
  HandConfig,
  HandResult,
  LegalGameAction,
  NextHandOptions,
  PotAward,
  PublicGameEvent,
  PublicGameState,
  SidePot,
} from './types';
export * from './types';

const EPS = 1e-8;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function frozen<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
const rounded = (amount: number): number => Math.round(amount * 1e9) / 1e9;
const unit = (state: GameState): number => state.config.chipUnit ?? 0.5;
const same = (a: number, b: number) => Math.abs(a - b) < EPS;
const active = (state: GameState) => state.players.filter((player) => player.status !== 'folded');
const capable = (state: GameState) =>
  state.players.filter((player) => player.status === 'active' && player.stack > EPS);
const playerById = (state: GameState, id: string): GamePlayer => {
  const player = state.players.find((item) => item.id === id);
  if (!player) throw new Error(`Unknown player ${id}.`);
  return player;
};
const onGrid = (value: number, chipUnit: number) =>
  Number.isFinite(value) && same(value / chipUnit, Math.round(value / chipUnit));

export function validateHandConfig(config: HandConfig): void {
  if (!config || typeof config.seed !== 'string' || !config.seed.trim() || config.seed.length > 256)
    throw new Error('A nonempty deterministic seed is required.');
  if (!Array.isArray(config.players) || ![2, 3, 6].includes(config.players.length))
    throw new Error('Supported tables have 2, 3 or 6 players.');
  const chipUnit = config.chipUnit ?? 0.5;
  if (!Number.isFinite(chipUnit) || chipUnit <= 0 || chipUnit < 0.000001)
    throw new Error('Invalid chip denomination.');
  if (
    !onGrid(config.smallBlind, chipUnit) ||
    !onGrid(config.bigBlind, chipUnit) ||
    config.smallBlind <= 0 ||
    config.bigBlind < config.smallBlind
  )
    throw new Error('Blinds must be positive chip-unit multiples.');
  if (new Set(config.players.map((player) => player.id)).size !== config.players.length)
    throw new Error('Player ids must be unique.');
  if (
    config.players.some(
      (player) =>
        typeof player.id !== 'string' ||
        !player.id.trim() ||
        player.id.length > 100 ||
        typeof player.name !== 'string' ||
        !player.name.trim() ||
        player.name.length > 100 ||
        !onGrid(player.stack, chipUnit) ||
        player.stack < 0 ||
        player.stack > 1e9,
    ) ||
    config.players.filter((player) => player.stack > 0).length < 2
  )
    throw new Error('Invalid player identity, stack, or fewer than two funded seats.');
  if (
    config.buttonSeat !== undefined &&
    (!Number.isInteger(config.buttonSeat) ||
      config.buttonSeat < 0 ||
      config.buttonSeat >= config.players.length)
  )
    throw new Error('Invalid button seat.');
  if (
    config.handNumber !== undefined &&
    (!Number.isInteger(config.handNumber) || config.handNumber < 1)
  )
    throw new Error('Invalid hand number.');
  if (
    config.id !== undefined &&
    (typeof config.id !== 'string' || !config.id.trim() || config.id.length > 300)
  )
    throw new Error('Invalid hand identity.');
  if (config.deck) assertCards(config.deck, 52, 52);
}

function initialState(config: HandConfig): GameState {
  validateHandConfig(config);
  const normalized = copy({
    ...config,
    chipUnit: config.chipUnit ?? 0.5,
    buttonSeat: config.buttonSeat ?? 0,
    handNumber: config.handNumber ?? 1,
  });
  const count = config.players.length;
  const nextFunded = (after: number) => {
    for (let offset = 1; offset <= count; offset++)
      if (config.players[(after + offset) % count].stack > 0) return (after + offset) % count;
    throw new Error('No funded seat.');
  };
  const buttonSeat =
    config.players[normalized.buttonSeat].stack > 0
      ? normalized.buttonSeat
      : nextFunded(normalized.buttonSeat);
  normalized.buttonSeat = buttonSeat;
  const smallBlindSeat =
    config.players.filter((player) => player.stack > 0).length === 2
      ? buttonSeat
      : nextFunded(buttonSeat);
  const bigBlindSeat = nextFunded(smallBlindSeat);
  const players: GamePlayer[] = config.players.map((player, seat) => ({
    ...player,
    seat,
    startingStack: player.stack,
    committed: 0,
    streetCommitted: 0,
    status: player.stack > 0 ? 'active' : 'folded',
    holeCards: [],
    lastAction: null,
  }));
  return {
    version: 3,
    id: config.id ?? `hand-${normalized.handNumber}`,
    seed: config.seed,
    handNumber: normalized.handNumber,
    config: normalized,
    players,
    buttonSeat,
    smallBlindSeat,
    bigBlindSeat,
    street: 'preflop',
    board: [],
    pot: 0,
    currentBet: config.bigBlind,
    minRaise: config.bigBlind,
    actorId: null,
    pendingActorIds: players.filter((player) => player.stack > 0).map((player) => player.id),
    lastActedBet: Object.fromEntries(players.map((player) => [player.id, null])),
    deck: config.deck ? copy(config.deck) : shuffled(createDeck(), seededRandom(config.seed)),
    deckIndex: 0,
    events: [],
    result: null,
  };
}

function nextPending(state: GameState, afterSeat: number): string | null {
  for (let offset = 1; offset <= state.players.length; offset++) {
    const player = state.players[(afterSeat + offset) % state.players.length];
    if (state.pendingActorIds.includes(player.id)) return player.id;
  }
  return null;
}

function normalizePending(state: GameState, afterSeat: number): void {
  const cash = capable(state);
  state.pendingActorIds = [...new Set(state.pendingActorIds)].filter((id) => {
    const player = playerById(state, id);
    if (player.status !== 'active' || player.stack <= EPS) return false;
    if (cash.length <= 1) {
      const opponentBet = Math.max(
        0,
        ...active(state)
          .filter((other) => other.id !== id)
          .map((other) => other.streetCommitted),
      );
      return player.streetCommitted + EPS < opponentBet;
    }
    return true;
  });
  const dealingComplete = state.players.every(
    (player) => player.startingStack === 0 || player.holeCards.length === 2,
  );
  state.actorId = dealingComplete ? nextPending(state, afterSeat) : null;
}

function callPrice(state: GameState, player: GamePlayer): number {
  const target =
    capable(state).length <= 1
      ? Math.min(
          state.currentBet,
          Math.max(
            0,
            ...active(state)
              .filter((other) => other.id !== player.id)
              .map((other) => other.streetCommitted),
          ),
        )
      : state.currentBet;
  return rounded(Math.min(player.stack, Math.max(0, target - player.streetCommitted)));
}

export function getLegalActions(state: GameState, playerId = state.actorId): LegalGameAction[] {
  if (state.result || !playerId || playerId !== state.actorId) return [];
  const player = playerById(state, playerId);
  if (player.status !== 'active' || player.stack <= EPS) return [];
  const price = callPrice(state, player);
  const actions: LegalGameAction[] =
    price > EPS ? [{ type: 'fold' }, { type: 'call', amount: price }] : [{ type: 'check' }];
  const last = state.lastActedBet[playerId];
  const reopened = last === null || state.currentBet - last + EPS >= state.minRaise;
  const otherCanCall = capable(state).some(
    (other) =>
      other.id !== playerId && other.streetCommitted + other.stack > state.currentBet + EPS,
  );
  const maxAmount = rounded(player.streetCommitted + player.stack);
  if (reopened && otherCanCall && maxAmount > state.currentBet + EPS) {
    const minAmount =
      state.currentBet === 0 ? state.config.bigBlind : rounded(state.currentBet + state.minRaise);
    actions.push({
      type: state.currentBet === 0 ? 'bet' : 'raise',
      minAmount: Math.min(minAmount, maxAmount),
      maxAmount,
      ...(maxAmount < minAmount - EPS ? { allInOnly: true } : {}),
    });
  }
  return actions;
}

function canonicalAction(state: GameState, input: GameAction): GameAction {
  if (!input || !['fold', 'check', 'call', 'bet', 'raise'].includes(input.type))
    throw new Error('Unknown poker action.');
  const option = getLegalActions(state).find((action) => action.type === input.type);
  if (!option) throw new Error(`${input.type} is not legal for the current actor.`);
  if (input.type === 'check' || input.type === 'fold') {
    if (input.amount !== undefined) throw new Error('Check/fold cannot specify chips.');
    return { type: input.type };
  }
  if (input.type === 'call') {
    if (input.amount !== undefined && !same(input.amount, option.amount!))
      throw new Error('Incorrect call amount.');
    return { type: 'call', amount: option.amount };
  }
  const amount = input.amount;
  if (
    amount === undefined ||
    !onGrid(amount, unit(state)) ||
    amount < option.minAmount! - EPS ||
    amount > option.maxAmount! + EPS ||
    (option.allInOnly && !same(amount, option.maxAmount!))
  )
    throw new Error('Bet/raise size is outside the legal chip window.');
  return { type: input.type, amount };
}

function moveChips(state: GameState, player: GamePlayer, amount: number): void {
  if (amount < -EPS || amount > player.stack + EPS)
    throw new Error('Chip commitment exceeds stack.');
  player.stack = rounded(player.stack - amount);
  player.committed = rounded(player.committed + amount);
  player.streetCommitted = rounded(player.streetCommitted + amount);
  state.pot = rounded(state.pot + amount);
  if (player.stack <= EPS) player.status = 'all-in';
}

/** Each typed event is reduced through the same authoritative rules path. */
function reduceEvent(previous: GameState | null, event: GameEvent): GameState {
  if (
    !event ||
    ![
      'hand-started',
      'blind-posted',
      'hole-cards-dealt',
      'action',
      'board-dealt',
      'uncalled-returned',
      'hand-settled',
    ].includes(event.type)
  )
    throw new Error('Unknown hand event type.');
  if (event.type === 'hand-started') {
    if (previous || event.index !== 0 || event.street !== 'preflop')
      throw new Error('Invalid hand-start event.');
    const state = initialState(event.config);
    state.events = frozen([frozen(copy(event))]);
    return state;
  }
  if (!previous || event.index !== previous.events.length || previous.result)
    throw new Error('Event sequence is invalid or already settled.');
  // Copy mutable state only; previous event objects are never modified.
  const state: GameState = {
    ...previous,
    players: previous.players.map((player) => ({ ...player, holeCards: [...player.holeCards] })),
    board: [...previous.board],
    pendingActorIds: [...previous.pendingActorIds],
    lastActedBet: { ...previous.lastActedBet },
    events: [...previous.events],
  };
  if (event.type === 'blind-posted') {
    if (!['small', 'big'].includes(event.blind)) throw new Error('Unknown blind type.');
    const seat = event.blind === 'small' ? state.smallBlindSeat : state.bigBlindSeat;
    const expected = Math.min(
      state.players[seat].stack,
      event.blind === 'small' ? state.config.smallBlind : state.config.bigBlind,
    );
    if (
      event.index !== (event.blind === 'small' ? 1 : 2) ||
      event.playerId !== state.players[seat].id ||
      !same(event.amount, expected) ||
      state.players[seat].streetCommitted !== 0 ||
      event.street !== 'preflop'
    )
      throw new Error('Invalid blind post.');
    moveChips(state, state.players[seat], event.amount);
    normalizePending(state, state.bigBlindSeat);
  } else if (event.type === 'hole-cards-dealt') {
    const player = playerById(state, event.playerId);
    if (
      state.street !== 'preflop' ||
      event.street !== 'preflop' ||
      event.cards.length !== 2 ||
      player.holeCards.length ||
      state.events[1]?.type !== 'blind-posted' ||
      state.events[2]?.type !== 'blind-posted' ||
      state.events.some((prior) => prior.type === 'action')
    )
      throw new Error('Invalid private deal event.');
    assertCards(event.cards, 2, 2);
    // Actual dealing is one card clockwise per pass. Deck consumption is encoded
    // by the generated pair and checked against the seeded deck in create/replay.
    const order = Array.from(
      { length: state.players.length },
      (_, offset) => (state.buttonSeat + 1 + offset) % state.players.length,
    ).filter((seat) => state.players[seat].startingStack > 0);
    const offset = order.indexOf(player.seat);
    if (event.index !== 3 + offset) throw new Error('Private cards must be dealt in seat order.');
    if (
      event.cards.some(
        (card, i) => cardKey(card) !== cardKey(state.deck[offset + i * order.length]),
      )
    )
      throw new Error('Private cards do not match deterministic deal.');
    player.holeCards = copy(event.cards);
    if (state.players.every((item) => item.startingStack === 0 || item.holeCards.length === 2)) {
      state.deckIndex = order.length * 2;
      normalizePending(state, state.bigBlindSeat);
    }
  } else if (event.type === 'action') {
    if (
      event.playerId !== state.actorId ||
      event.street !== state.street ||
      state.players.some((player) => player.startingStack > 0 && player.holeCards.length !== 2)
    )
      throw new Error('Action is out of turn or private dealing is incomplete.');
    const action = canonicalAction(state, event.action);
    const player = playerById(state, event.playerId);
    const paid =
      action.type === 'call'
        ? action.amount!
        : action.type === 'bet' || action.type === 'raise'
          ? rounded(action.amount! - player.streetCommitted)
          : 0;
    if (!same(event.paid, paid)) throw new Error('Event chip payment is inconsistent.');
    state.pendingActorIds = state.pendingActorIds.filter((id) => id !== player.id);
    if (action.type === 'fold') player.status = 'folded';
    else if (paid > 0) moveChips(state, player, paid);
    if (action.type === 'bet' || action.type === 'raise') {
      const increment = rounded(action.amount! - state.currentBet);
      if (increment + EPS >= state.minRaise) state.minRaise = increment;
      state.currentBet = action.amount!;
      state.pendingActorIds = capable(state)
        .filter((other) => other.id !== player.id && other.streetCommitted + EPS < state.currentBet)
        .map((other) => other.id);
    }
    player.lastAction = action;
    state.lastActedBet[player.id] = state.currentBet;
    normalizePending(state, player.seat);
  } else if (event.type === 'uncalled-returned') {
    if (state.actorId || event.street !== state.street)
      throw new Error('Cannot refund while action is pending or on a different street.');
    const ranked = [...state.players].sort((a, b) => b.streetCommitted - a.streetCommitted);
    const difference = rounded(ranked[0].streetCommitted - ranked[1].streetCommitted);
    if (event.playerId !== ranked[0].id || difference <= EPS || !same(event.amount, difference))
      throw new Error('Invalid uncalled refund.');
    const player = playerById(state, event.playerId);
    player.stack = rounded(player.stack + difference);
    player.committed = rounded(player.committed - difference);
    player.streetCommitted = rounded(player.streetCommitted - difference);
    if (player.status === 'all-in') player.status = 'active';
    state.pot = rounded(state.pot - difference);
    state.currentBet = Math.max(...state.players.map((item) => item.streetCommitted));
  } else if (event.type === 'board-dealt') {
    const next = ({ preflop: 'flop', flop: 'turn', turn: 'river' } as const)[
      state.street as 'preflop' | 'flop' | 'turn'
    ];
    const count = next === 'flop' ? 3 : 1;
    const unmatched =
      Math.max(...state.players.map((player) => player.streetCommitted)) -
      [...state.players].sort((a, b) => b.streetCommitted - a.streetCommitted)[1].streetCommitted;
    if (
      state.actorId ||
      state.players.some((player) => player.startingStack > 0 && player.holeCards.length !== 2) ||
      unmatched > EPS ||
      event.street !== next ||
      event.cards.length !== count ||
      active(state).length < 2
    )
      throw new Error('Invalid board transition.');
    const expectedBurn = state.deck[state.deckIndex];
    const expectedCards = state.deck.slice(state.deckIndex + 1, state.deckIndex + count + 1);
    if (
      cardKey(event.burn) !== cardKey(expectedBurn) ||
      event.cards.some((card, index) => cardKey(card) !== cardKey(expectedCards[index]))
    )
      throw new Error('Board does not match deterministic deck.');
    state.deckIndex += count + 1;
    state.board.push(...copy(event.cards));
    state.street = next!;
    state.currentBet = 0;
    state.minRaise = state.config.bigBlind;
    state.lastActedBet = Object.fromEntries(state.players.map((player) => [player.id, null]));
    for (const player of state.players) {
      player.streetCommitted = 0;
      player.lastAction = null;
    }
    state.pendingActorIds = capable(state).map((player) => player.id);
    normalizePending(state, state.buttonSeat);
  } else if (event.type === 'hand-settled') {
    const expectedStreet = active(state).length > 1 ? 'showdown' : state.street;
    const unmatched =
      Math.max(...state.players.map((player) => player.streetCommitted)) -
      [...state.players].sort((a, b) => b.streetCommitted - a.streetCommitted)[1].streetCommitted;
    if (
      state.actorId ||
      unmatched > EPS ||
      event.street !== expectedStreet ||
      (active(state).length > 1 && state.street !== 'river')
    )
      throw new Error('Hand is not ready to settle.');
    const result = calculateResult(state);
    if (JSON.stringify(event.result) !== JSON.stringify(result))
      throw new Error('Settlement does not match cards and pots.');
    for (const player of state.players) {
      player.stack = rounded(player.stack + (result.payouts[player.id] ?? 0));
      player.streetCommitted = 0;
    }
    state.result = result;
    state.pot = 0;
    state.currentBet = 0;
    state.actorId = null;
    state.pendingActorIds = [];
    if (result.reason === 'showdown') state.street = 'showdown';
  }
  state.events.push(frozen(copy(event)));
  frozen(state.events);
  return state;
}

type WithoutIndex<T> = T extends unknown ? Omit<T, 'index'> : never;
function append(state: GameState | null, event: WithoutIndex<GameEvent>): GameState {
  return reduceEvent(state, { ...event, index: state?.events.length ?? 0 } as GameEvent);
}

export function buildSidePots(state: GameState): SidePot[] {
  const levels = [
    ...new Set(
      state.players.filter((player) => player.committed > EPS).map((player) => player.committed),
    ),
  ].sort((a, b) => a - b);
  let previous = 0;
  return levels
    .map((level) => {
      const contributors = state.players.filter((player) => player.committed + EPS >= level);
      const pot = {
        amount: rounded((level - previous) * contributors.length),
        contributorIds: contributors.map((player) => player.id),
        eligiblePlayerIds: contributors
          .filter((player) => player.status !== 'folded')
          .map((player) => player.id),
      };
      previous = level;
      return pot;
    })
    .filter((pot) => pot.amount > EPS);
}

function calculateResult(state: GameState): HandResult {
  const live = active(state);
  const reason = live.length === 1 ? 'folds' : 'showdown';
  const hands = new Map(
    live.map((player) => [
      player.id,
      reason === 'showdown' ? evaluateHand([...player.holeCards, ...state.board]) : null,
    ]),
  );
  const payouts: Record<string, number> = Object.fromEntries(
    state.players.map((player) => [player.id, 0]),
  );
  const oddOrder = Array.from(
    { length: state.players.length },
    (_, offset) => state.players[(state.buttonSeat + 1 + offset) % state.players.length].id,
  );
  const pots: PotAward[] = buildSidePots(state).map((pot) => {
    let winnerIds: string[] = reason === 'folds' ? [live[0].id] : [];
    for (const id of reason === 'showdown' ? pot.eligiblePlayerIds : []) {
      if (!winnerIds.length) winnerIds = [id];
      else {
        const comparison = hands.get(id)!.compare(hands.get(winnerIds[0])!);
        if (comparison < 0) winnerIds = [id];
        else if (comparison === 0) winnerIds.push(id);
      }
    }
    if (!winnerIds.length) throw new Error('Side pot has no eligible winner.');
    winnerIds.sort((a, b) => oddOrder.indexOf(a) - oddOrder.indexOf(b));
    const chips = Math.round(pot.amount / unit(state));
    const base = Math.floor(chips / winnerIds.length);
    const remainder = chips % winnerIds.length;
    const shares = Object.fromEntries(
      winnerIds.map((id, index) => [
        id,
        rounded((base + (index < remainder ? 1 : 0)) * unit(state)),
      ]),
    );
    for (const [id, amount] of Object.entries(shares)) payouts[id] = rounded(payouts[id] + amount);
    return { ...pot, winnerIds, payouts: shares };
  });
  return {
    reason,
    winnerIds: [...new Set(pots.flatMap((pot) => pot.winnerIds))],
    payouts,
    netResults: Object.fromEntries(
      state.players.map((player) => [
        player.id,
        rounded(player.stack + payouts[player.id] - player.startingStack),
      ]),
    ),
    pots,
    descriptions: Object.fromEntries(
      live.map((player) => [player.id, hands.get(player.id)?.descr ?? 'Uncontested pot']),
    ),
  };
}

function advanceAutomatically(start: GameState): GameState {
  let state = start;
  for (let guard = 0; guard < 10 && !state.actorId && !state.result; guard++) {
    const ranked = [...state.players].sort((a, b) => b.streetCommitted - a.streetCommitted);
    const refund = rounded(ranked[0].streetCommitted - ranked[1].streetCommitted);
    if (refund > EPS)
      state = append(state, {
        type: 'uncalled-returned',
        street: state.street,
        playerId: ranked[0].id,
        amount: refund,
      });
    if (active(state).length === 1 || state.street === 'river')
      return append(state, {
        type: 'hand-settled',
        street: active(state).length === 1 ? state.street : 'showdown',
        result: calculateResult(state),
      });
    const next = ({ preflop: 'flop', flop: 'turn', turn: 'river' } as const)[
      state.street as 'preflop' | 'flop' | 'turn'
    ]!;
    const count = next === 'flop' ? 3 : 1;
    state = append(state, {
      type: 'board-dealt',
      street: next,
      burn: state.deck[state.deckIndex],
      cards: state.deck.slice(state.deckIndex + 1, state.deckIndex + count + 1),
    });
  }
  if (!state.actorId && !state.result)
    throw new Error('Automatic street progression did not terminate.');
  return state;
}

export function createHand(config: HandConfig): GameState {
  const opaqueId =
    config.id ??
    `hand-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
  let state = append(null, {
    type: 'hand-started',
    street: 'preflop',
    config: copy({ ...config, id: opaqueId }),
  });
  for (const blind of ['small', 'big'] as const) {
    const player = state.players[blind === 'small' ? state.smallBlindSeat : state.bigBlindSeat];
    state = append(state, {
      type: 'blind-posted',
      street: 'preflop',
      blind,
      playerId: player.id,
      amount: Math.min(player.stack, blind === 'small' ? config.smallBlind : config.bigBlind),
    });
  }
  const order = Array.from(
    { length: state.players.length },
    (_, offset) => (state.buttonSeat + 1 + offset) % state.players.length,
  ).filter((seat) => state.players[seat].startingStack > 0);
  for (let offset = 0; offset < order.length; offset++) {
    const seat = order[offset];
    state = append(state, {
      type: 'hole-cards-dealt',
      street: 'preflop',
      playerId: state.players[seat].id,
      cards: [state.deck[offset], state.deck[offset + order.length]],
    });
  }
  return advanceAutomatically(state);
}

export function applyAction(state: GameState, action: GameAction): GameState {
  const canonical = canonicalAction(state, action);
  const player = playerById(state, state.actorId!);
  const paid =
    canonical.type === 'call'
      ? canonical.amount!
      : canonical.type === 'raise' || canonical.type === 'bet'
        ? rounded(canonical.amount! - player.streetCommitted)
        : 0;
  return advanceAutomatically(
    append(state, {
      type: 'action',
      street: state.street,
      playerId: player.id,
      action: canonical,
      paid,
    }),
  );
}

export function getPosition(state: GameState, seat: number): string {
  const order = Array.from(
    { length: state.players.length },
    (_, offset) => (state.buttonSeat + offset) % state.players.length,
  ).filter((index) => state.players[index].startingStack > 0);
  const offset = order.indexOf(seat);
  if (offset < 0) return 'OUT';
  if (order.length === 2) return offset === 0 ? 'BTN / SB' : 'BB';
  const labels: Record<number, string[]> = {
    3: ['BTN', 'SB', 'BB'],
    4: ['BTN', 'SB', 'BB', 'CO'],
    5: ['BTN', 'SB', 'BB', 'HJ', 'CO'],
    6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  };
  return labels[order.length][offset];
}

function publicEvent(event: GameEvent): PublicGameEvent {
  const base = { index: event.index, street: event.street, type: event.type };
  if (event.type === 'action')
    return { ...base, playerId: event.playerId, action: copy(event.action), paid: event.paid };
  if (event.type === 'blind-posted')
    return { ...base, playerId: event.playerId, blind: event.blind, amount: event.amount };
  if (event.type === 'board-dealt') return { ...base, cards: copy(event.cards) };
  if (event.type === 'uncalled-returned')
    return { ...base, playerId: event.playerId, amount: event.amount };
  if (event.type === 'hole-cards-dealt') return { ...base, playerId: event.playerId };
  if (event.type === 'hand-settled') return { ...base, result: copy(event.result) };
  return base;
}

/** Never exposes a deck, seed, imported private config, future events or live cards. */
export function getPublicState(state: GameState): PublicGameState {
  return {
    id: state.id,
    handNumber: state.handNumber,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      stack: player.stack,
      startingStack: player.startingStack,
      committed: player.committed,
      streetCommitted: player.streetCommitted,
      status: player.status,
      lastAction: copy(player.lastAction),
      position: getPosition(state, player.seat),
      ...(state.result?.reason === 'showdown' && player.status !== 'folded'
        ? { revealedCards: copy(player.holeCards) }
        : {}),
    })),
    buttonSeat: state.buttonSeat,
    smallBlindSeat: state.smallBlindSeat,
    bigBlindSeat: state.bigBlindSeat,
    street: state.street,
    board: copy(state.board),
    pot: state.pot,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    actorId: state.actorId,
    smallBlind: state.config.smallBlind,
    bigBlind: state.config.bigBlind,
    chipUnit: unit(state),
    events: state.events.map(publicEvent),
    result: copy(state.result),
  };
}

/** A player's complete information set; no other player's unrevealed cards. */
export function getAgentView(state: GameState, playerId: string): AgentView {
  const player = playerById(state, playerId);
  return {
    table: getPublicState(state),
    playerId,
    holeCards: copy(player.holeCards),
    legalActions: copy(getLegalActions(state, playerId)),
  };
}

/** UI viewer projection only. Opponent policies must use getAgentView instead. */
export function getPublicView(state: GameState, viewerSeat = 0): PublicGameState {
  const table = getPublicState(state);
  const player = state.players[viewerSeat];
  if (player) table.players[viewerSeat].revealedCards = copy(player.holeCards);
  return table;
}

export function replayHand(events: readonly GameEvent[], eventCount = events.length): GameState {
  if (
    !Array.isArray(events) ||
    !events.length ||
    events.length > 10000 ||
    !Number.isInteger(eventCount) ||
    eventCount < 1 ||
    eventCount > events.length
  )
    throw new Error('Invalid hand event prefix.');
  let state: GameState | null = null;
  for (const event of events.slice(0, eventCount)) state = reduceEvent(state, event);
  return state!;
}

export function serializeHand(state: GameState): string {
  return JSON.stringify({ version: 3, events: state.events });
}

/** Imported data is replayed through rules instead of trusting stored snapshots. */
export function deserializeHand(json: string): GameState {
  if (typeof json !== 'string' || json.length > 5_000_000)
    throw new Error('Hand import exceeds supported size.');
  const data = JSON.parse(json) as { version?: number; events?: GameEvent[] };
  if (data.version !== 3 || !Array.isArray(data.events))
    throw new Error('Unsupported hand history version.');
  const state = replayHand(data.events);
  if (
    state.players.some((player) => player.startingStack > 0 && player.holeCards.length !== 2) ||
    (!state.actorId && !state.result)
  ) {
    throw new Error('Imported hand ends in an incomplete automatic transition.');
  }
  return state;
}

export function nextHand(previous: GameState, options: NextHandOptions): GameState {
  if (!previous.result) throw new Error('Complete the current hand before starting another.');
  const target = options.startingStack ?? previous.config.players[0].stack;
  const players = previous.players.map((player) => ({
    id: player.id,
    name: player.name,
    stack: options.autoRebuy && player.stack === 0 ? target : player.stack,
  }));
  if (players.filter((player) => player.stack > 0).length < 2)
    throw new Error('Fewer than two funded seats remain. Enable auto-rebuy to continue.');
  return createHand({
    ...previous.config,
    deck: undefined,
    id: undefined,
    seed: options.seed,
    players,
    buttonSeat: (previous.buttonSeat + 1) % players.length,
    handNumber: previous.handNumber + 1,
  });
}

export function validateGameState(state: GameState): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const total = state.players.reduce((sum, player) => sum + player.stack, 0) + state.pot;
  const initial = state.players.reduce((sum, player) => sum + player.startingStack, 0);
  if (!same(total, initial)) errors.push('Total chips are not conserved.');
  if (
    state.players.some(
      (player) =>
        player.stack < -EPS ||
        player.committed < -EPS ||
        player.streetCommitted < -EPS ||
        !onGrid(player.stack, unit(state)),
    )
  )
    errors.push('Invalid player chip balance.');
  if (state.pot < -EPS || !onGrid(state.pot, unit(state))) errors.push('Invalid pot.');
  try {
    assertCards([...state.players.flatMap((player) => player.holeCards), ...state.board]);
  } catch {
    errors.push('Invalid or duplicate dealt cards.');
  }
  if (state.actorId && !getLegalActions(state).length) errors.push('Actor has no legal actions.');
  if (state.result && state.actorId) errors.push('Completed hand still has an actor.');
  return { valid: !errors.length, errors };
}
