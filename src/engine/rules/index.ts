import type { Actor, HistoryAction, LegalAction, Scenario, Street } from '../../types/poker';
import { scenarioShapeErrors } from './schema';

const streets: Street[] = ['preflop', 'flop', 'turn', 'river'];
const near = (a: number, b: number) => Math.abs(a - b) < 1e-8;
const other = (actor: Actor): Actor => (actor === 'hero' ? 'opponent' : 'hero');
const fail = (message: string): never => {
  throw new Error(message);
};

export interface ReplayState {
  street: Street;
  pot: number;
  potBeforeLastAction: number;
  stacks: Scenario['stacks'];
  contributions: Record<Actor, number>;
  currentBet: number;
  lastFullRaise: number;
  nextActor: Actor;
  pending: Actor[];
}

/** Immediate break-even equity price. currentPot already includes the bet faced.
 * This is not an estimate of hand equity or future equity realization. */
export function potOdds(toCall: number, currentPot: number): number {
  if (!Number.isFinite(toCall) || !Number.isFinite(currentPot) || toCall < 0 || currentPot < 0) {
    throw new Error('Pot and call must be finite, nonnegative BB amounts.');
  }
  return toCall === 0 ? 0 : toCall / (currentPot + toCall);
}

export function replayHistory(scenario: Scenario): ReplayState {
  const button: Actor = scenario.heroPosition === 'BTN' ? 'hero' : 'opponent';
  const bigBlind = other(button);
  const state: ReplayState = {
    street: 'preflop',
    pot: 0,
    potBeforeLastAction: 0,
    stacks: { ...scenario.startingStacks },
    contributions: { hero: 0, opponent: 0 },
    currentBet: scenario.blinds.big,
    lastFullRaise: scenario.blinds.big,
    nextActor: button,
    pending: [button, bigBlind],
  };
  let posts = 0;
  let ended = false;
  const commit = (actor: Actor, chips: number) => {
    if (!Number.isFinite(chips) || chips < 0 || chips > state.stacks[actor] + 1e-8)
      fail('Action exceeds available stack.');
    state.stacks[actor] -= chips;
    state.contributions[actor] += chips;
    state.pot += chips;
  };

  scenario.history.forEach((action, index) => {
    if (!['hero', 'opponent'].includes(action.actor)) fail('Unknown actor in history.');
    if (!streets.includes(action.street)) fail('Unknown street in history.');
    if (ended) fail('Action appears after the hand ended.');
    state.potBeforeLastAction = state.pot;
    if (action.kind === 'post') {
      if (index !== posts || posts > 1 || action.street !== 'preflop')
        fail('The two blind posts must begin history.');
      const expected = posts === 0 ? button : bigBlind;
      const amount = posts === 0 ? scenario.blinds.small : scenario.blinds.big;
      if (action.actor !== expected || !near(action.amount ?? -1, amount))
        fail('Blind post does not match position and blinds.');
      commit(action.actor, amount);
      posts += 1;
      return;
    }
    if (posts !== 2) fail('Both blinds must be posted before betting.');
    if (action.street !== state.street) {
      if (
        streets.indexOf(action.street) !== streets.indexOf(state.street) + 1 ||
        state.pending.length
      ) {
        fail('Street advanced before betting completed or skipped a street.');
      }
      if (state.stacks.hero === 0 || state.stacks.opponent === 0)
        fail('No further decisions after an all-in call.');
      state.street = action.street;
      state.contributions = { hero: 0, opponent: 0 };
      state.currentBet = 0;
      state.lastFullRaise = scenario.blinds.big;
      state.nextActor = bigBlind;
      state.pending = [bigBlind, button];
    }
    if (!state.pending.length || action.actor !== state.nextActor) fail('Action is out of turn.');
    if (state.stacks[action.actor] <= 1e-8) fail('An all-in player cannot take another action.');
    const facing = state.currentBet - state.contributions[action.actor];
    if (action.kind === 'check') {
      if (facing > 1e-8 || action.amount !== undefined)
        fail('Check is illegal while facing a bet.');
      state.pending = state.pending.filter((actor) => actor !== action.actor);
    } else if (action.kind === 'fold') {
      if (facing <= 1e-8 || action.amount !== undefined) fail('Fold requires a bet to face.');
      ended = true;
      state.pending = [];
    } else if (action.kind === 'call') {
      if (facing <= 1e-8 || !near(action.amount ?? -1, facing))
        fail('Call must add exactly the outstanding chips.');
      commit(action.actor, facing);
      state.pending = state.pending.filter((actor) => actor !== action.actor);
    } else if (action.kind === 'bet' || action.kind === 'raise') {
      const target = action.amount ?? NaN;
      const opponent = other(action.actor);
      if (state.stacks[opponent] <= 1e-8) fail('Cannot bet or raise against an all-in opponent.');
      if (target > state.contributions[opponent] + state.stacks[opponent] + 1e-8)
        fail('Uncalled excess is outside the supported covered-stack model.');
      if (action.kind === 'bet' && state.currentBet !== 0)
        fail('An existing bet requires a raise, not a bet.');
      if (action.kind === 'raise' && state.currentBet === 0) fail('No existing bet to raise.');
      const increment = target - state.currentBet;
      if (!Number.isFinite(target) || increment < state.lastFullRaise - 1e-8)
        fail('Bet or raise is below the minimum full raise.');
      commit(action.actor, target - state.contributions[action.actor]);
      state.currentBet = target;
      state.lastFullRaise = increment;
      state.pending = [other(action.actor)];
    } else {
      fail('Unknown action kind.');
    }
    state.nextActor = other(action.actor);
  });
  if (posts !== 2) fail('History requires two blind posts.');
  return state;
}

function actionError(action: LegalAction, state: ReplayState): string | null {
  const facing = state.currentBet - state.contributions.hero;
  const amount = action.amount;
  if (action.kind === 'fold' || action.kind === 'check') {
    if (amount !== undefined) return 'Check/fold must not specify chips.';
    return action.kind === 'check'
      ? facing > 1e-8
        ? 'Cannot check facing a bet.'
        : null
      : facing <= 1e-8
        ? 'Cannot offer fold when checking is free.'
        : null;
  }
  if (action.kind === 'call') {
    if (facing <= 1e-8 || !near(amount ?? -1, facing)) return 'Call amount is inconsistent.';
    return facing > state.stacks.hero + 1e-8 ? 'Unsupported short all-in call.' : null;
  }
  if (action.kind !== 'bet' && action.kind !== 'raise') return 'Unknown legal action.';
  if (action.kind === 'bet' && state.currentBet !== 0)
    return 'Bet is illegal with an existing wager.';
  if (action.kind === 'raise' && state.currentBet === 0) return 'Raise requires an existing wager.';
  if (
    amount === undefined ||
    !Number.isFinite(amount) ||
    amount - state.currentBet < state.lastFullRaise - 1e-8
  ) {
    return 'Raise/bet is below the minimum full raise.';
  }
  if (amount - state.contributions.hero > state.stacks.hero + 1e-8)
    return 'Raise/bet exceeds hero stack.';
  if (amount > state.contributions.opponent + state.stacks.opponent + 1e-8)
    return 'Raise/bet exceeds effective stack; uncalled excess is outside this MVP.';
  return null;
}

export function validateScenario(value: unknown): { valid: boolean; errors: string[] } {
  const errors = scenarioShapeErrors(value);
  if (errors.length) return { valid: false, errors };
  const scenario = value as Scenario;
  const cards = [...scenario.heroCards, ...scenario.board];
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const suits = ['clubs', 'diamonds', 'hearts', 'spades'];
  if (scenario.heroCards.length !== 2) errors.push('Hero must have exactly two cards.');
  if (cards.some((card) => !ranks.includes(card.rank) || !suits.includes(card.suit)))
    errors.push('Invalid card rank or suit.');
  if (new Set(cards.map((card) => `${card.rank}:${card.suit}`)).size !== cards.length)
    errors.push('Duplicate cards.');
  const boardSize: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };
  if (scenario.board.length !== boardSize[scenario.street])
    errors.push('Board count does not match street.');
  if (
    !['BTN', 'BB'].includes(scenario.heroPosition) ||
    scenario.heroPosition === scenario.opponentPosition ||
    !['BTN', 'BB'].includes(scenario.opponentPosition)
  )
    errors.push('Heads-up positions must be BTN and BB.');
  if (!(
    scenario.blinds.small > 0 &&
    scenario.blinds.big >= scenario.blinds.small &&
    Number.isFinite(scenario.blinds.big)
  ))
    errors.push('Invalid blinds.');
  if (
    ![scenario.startingStacks.hero, scenario.startingStacks.opponent].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    errors.push('Invalid starting stacks.');
  if (
    ![
      scenario.currentPot,
      scenario.potBeforeAction,
      scenario.toCall,
      scenario.stacks.hero,
      scenario.stacks.opponent,
    ].every((n) => Number.isFinite(n) && n >= 0)
  )
    errors.push('Chip amounts must be finite and nonnegative.');
  if (
    !near(
      scenario.startingStacks.hero + scenario.startingStacks.opponent,
      scenario.stacks.hero + scenario.stacks.opponent + scenario.currentPot,
    )
  )
    errors.push('Total chips are not conserved.');
  if (!scenario.legalActions.length) errors.push('Scenario has no supported actions.');
  if (
    new Set(scenario.legalActions.map((action) => action.id)).size !== scenario.legalActions.length
  )
    errors.push('Duplicate legal action ids.');
  if (!scenario.exercise && !scenario.legalActions.some((action) => action.grade === 'preferred'))
    errors.push('Scenario requires a preferred illustrative action.');
  if (
    !['illustrative', 'mathematical-model', 'expert-reviewed', 'solver-verified'].includes(
      scenario.source.category,
    )
  )
    errors.push('Unknown strategy provenance.');
  if (
    scenario.source.category === 'expert-reviewed' &&
    (!scenario.source.reference?.trim() || !scenario.source.reviewer?.trim())
  )
    errors.push('Expert-reviewed provenance requires a reviewer and traceable reference.');
  if (
    scenario.source.category === 'solver-verified' &&
    (!scenario.source.reference?.trim() || !scenario.source.solver?.trim())
  )
    errors.push('Solver provenance requires an identified solver and traceable reference.');
  if (
    scenario.legalActions.some(
      (action) => !['preferred', 'defensible', 'mistaken'].includes(action.grade),
    )
  )
    errors.push('Invalid decision grade.');
  try {
    const state = replayHistory(scenario);
    if (state.street !== scenario.street)
      errors.push('History does not reach the declared street.');
    if (!state.pending.includes('hero') || state.nextActor !== 'hero')
      errors.push('It must be heroâ€™s turn.');
    if (!near(state.pot, scenario.currentPot)) errors.push('Current pot differs from replay.');
    if (!near(state.potBeforeLastAction, scenario.potBeforeAction))
      errors.push('Pot before latest action differs from replay.');
    if (
      !near(state.stacks.hero, scenario.stacks.hero) ||
      !near(state.stacks.opponent, scenario.stacks.opponent)
    )
      errors.push('Remaining stacks differ from replay.');
    if (!near(state.currentBet - state.contributions.hero, scenario.toCall))
      errors.push('Call price differs from replay.');
    const latest: HistoryAction | undefined = scenario.history.at(-1);
    if (
      !latest ||
      latest.actor !== 'opponent' ||
      latest.kind !== scenario.opponentAction.kind ||
      latest.amount !== scenario.opponentAction.amount
    )
      errors.push('Latest opponent action differs from history.');
    for (const action of scenario.legalActions) {
      const error = actionError(action, state);
      if (error) errors.push(`${action.id}: ${error}`);
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Invalid history.');
  }
  return { valid: errors.length === 0, errors };
}
