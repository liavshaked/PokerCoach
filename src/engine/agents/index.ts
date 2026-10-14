import type { Card } from '../../types/poker';
import type { AgentView, GameAction, LegalGameAction } from '../game/types';
import { evaluateHand } from '../equity';
import { preflopStrength } from '../ranges';
import { estimateSituation, type SituationCalculation } from './calculation';
export { estimateSituation, type SituationCalculation } from './calculation';

export type AgentDifficulty = 'beginner' | 'intermediate' | 'advanced' | 'expert';
export type AgentProfileId =
  'balanced' | 'tight-aggressive' | 'loose-aggressive' | 'passive' | 'tricky' | 'exploitative';
export interface AgentProfile {
  id: AgentProfileId;
  name: string;
  description: string;
  openFloor: number;
  threeBetFloor: number;
  aggression: number;
  bluff: number;
  callTolerance: number;
  betFraction: number;
}
/** Authored parameters of an explicit policy, not solved ranges or population frequencies. */
export const agentProfiles: AgentProfile[] = [
  {
    id: 'balanced',
    name: 'Balanced regular',
    description: 'Selective position-aware ranges, value betting and restrained draw pressure.',
    openFloor: 27,
    threeBetFloor: 43,
    aggression: 0.62,
    bluff: 0.1,
    callTolerance: 0,
    betFraction: 0.55,
  },
  {
    id: 'tight-aggressive',
    name: 'Tight aggressive',
    description: 'Narrower entries, stronger continuations and decisive value bets.',
    openFloor: 32,
    threeBetFloor: 47,
    aggression: 0.72,
    bluff: 0.035,
    callTolerance: -0.055,
    betFraction: 0.65,
  },
  {
    id: 'loose-aggressive',
    name: 'Loose aggressive',
    description: 'Wider late-position entries, more pressure and larger bets.',
    openFloor: 21,
    threeBetFloor: 37,
    aggression: 0.88,
    bluff: 0.24,
    callTolerance: 0.035,
    betFraction: 0.75,
  },
  {
    id: 'passive',
    name: 'Patient recreational',
    description: 'Wide calls, small value bets and very few bluffs or three-bets.',
    openFloor: 20,
    threeBetFloor: 51,
    aggression: 0.16,
    bluff: 0.015,
    callTolerance: 0.11,
    betFraction: 0.35,
  },
  {
    id: 'tricky',
    name: 'Tricky aggressive',
    description: 'Delayed value lines, draw aggression and blocker-sensitive bluffs.',
    openFloor: 25,
    threeBetFloor: 40,
    aggression: 0.77,
    bluff: 0.2,
    callTolerance: 0.015,
    betFraction: 0.7,
  },
  {
    id: 'exploitative',
    name: 'Observant regular',
    description:
      'A selective baseline with bounded adjustments to observed public folds and aggression.',
    openFloor: 28,
    threeBetFloor: 43,
    aggression: 0.68,
    bluff: 0.1,
    callTolerance: 0,
    betFraction: 0.6,
  },
];

export interface PublicPlayerObservation {
  actions: number;
  preflopOpportunities: number;
  voluntaryEntries: number;
  raises: number;
  bets: number;
  calls: number;
  folds: number;
  riverBetFaced: number;
  riverFolds: number;
  lastPreflopHand: string | null;
  lastEntryHand: string | null;
}
export type PublicObservations = Record<string, PublicPlayerObservation>;
export interface AgentContext {
  profile: AgentProfileId;
  difficulty: AgentDifficulty;
  observations?: PublicObservations;
  /** One draw from a coordinator-owned independent stream; no deck/policy seeds cross this boundary. */
  randomValue: number;
}
export interface HoldingFeatures {
  preflopScore: number;
  strength: number;
  madeHand: string;
  flushDraw: boolean;
  straightDraw: boolean;
  nutFlushBlocker: boolean;
  wetBoard: boolean;
  pairedBoard: boolean;
}
export interface PolicyOption {
  action: GameAction;
  weight: number;
  probability: number;
  label: string;
}
export interface PolicyDistribution {
  options: PolicyOption[];
  recommended: PolicyOption;
  features: HoldingFeatures;
  calculation: SituationCalculation;
  reasons: string[];
  model: 'feltlab-calculated-policy-v2';
  adaptation: string | null;
}

export const blankObservation = (): PublicPlayerObservation => ({
  actions: 0,
  preflopOpportunities: 0,
  voluntaryEntries: 0,
  raises: 0,
  bets: 0,
  calls: 0,
  folds: 0,
  riverBetFaced: 0,
  riverFolds: 0,
  lastPreflopHand: null,
  lastEntryHand: null,
});
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const valueOf = (card: Card) => '23456789TJQKA'.indexOf(card.rank) + 2;
const sigmoid = (value: number) => 1 / (1 + Math.exp(-clamp(value, -30, 30)));

/** Only own cards and currently visible board are accepted by the feature model. */
export function holdingFeatures(
  holeCards: readonly Card[],
  board: readonly Card[],
): HoldingFeatures {
  const preflopScore = preflopStrength(holeCards);
  const counts = new Map<string, number>();
  const suits = new Map<string, number>();
  for (const card of board) {
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
    suits.set(card.suit, (suits.get(card.suit) ?? 0) + 1);
  }
  const pairedBoard = [...counts.values()].some((count) => count > 1);
  const all = [...holeCards, ...board];
  let flushDraw =
    board.length < 5 &&
    all.some(
      (card) =>
        holeCards.some((own) => own.suit === card.suit) &&
        all.filter((item) => item.suit === card.suit).length === 4,
    );
  const ranks = new Set(all.map(valueOf));
  if (ranks.has(14)) ranks.add(1);
  let straightDraw = false;
  if (board.length < 5)
    for (let low = 1; low <= 10; low += 1) {
      const window = Array.from({ length: 5 }, (_, index) => low + index);
      if (
        window.filter((rank) => ranks.has(rank)).length === 4 &&
        holeCards.some((card) => window.includes(valueOf(card)))
      )
        straightDraw = true;
    }
  const nutFlushBlocker = holeCards.some(
    (card) => card.rank === 'A' && (suits.get(card.suit) ?? 0) >= 3,
  );
  const boardRanks = [...new Set(board.map(valueOf))].sort((a, b) => a - b);
  const connected = boardRanks.some(
    (rank) => boardRanks.filter((other) => Math.abs(other - rank) <= 3).length >= 3,
  );
  const wetBoard = connected || [...suits.values()].some((count) => count >= 3);
  if (board.length < 3)
    return {
      preflopScore,
      strength: clamp((preflopScore - 17) / 45),
      madeHand: holeCards[0].rank === holeCards[1].rank ? 'Pocket pair' : 'Unpaired holding',
      flushDraw: false,
      straightDraw: false,
      nutFlushBlocker,
      wetBoard,
      pairedBoard,
    };
  const solved = evaluateHand(all);
  // Do not describe an already stronger made hand as needing a lesser draw to improve.
  if (solved.rank >= 5) straightDraw = false;
  if (solved.rank >= 6) flushDraw = false;
  let strength = [0.0, 0.16, 0.4, 0.72, 0.84, 0.9, 0.94, 0.98, 0.995, 1][solved.rank] ?? 0.2;
  const ownPair = holeCards[0].rank === holeCards[1].rank;
  const boardHigh = Math.max(...board.map(valueOf));
  const matched = holeCards.filter((card) => counts.has(card.rank));
  if (solved.rank === 1) strength = 0.1 + Math.max(...holeCards.map(valueOf)) / 140;
  if (solved.rank === 2) {
    if (ownPair)
      strength =
        valueOf(holeCards[0]) > boardHigh
          ? 0.69
          : valueOf(holeCards[0]) >= boardHigh - 3
            ? 0.45
            : 0.3;
    else if (matched.length)
      strength =
        Math.max(...matched.map(valueOf)) === boardHigh
          ? 0.57 + Math.max(...holeCards.map(valueOf)) / 200
          : 0.36;
    else strength = 0.17 + Math.max(...holeCards.map(valueOf)) / 180;
  }
  if (
    board.length === 5 &&
    solved.rank <= evaluateHand(board).rank &&
    matched.length === 0 &&
    !ownPair
  )
    strength = Math.min(strength, 0.32);
  return {
    preflopScore,
    strength,
    madeHand: solved.descr,
    flushDraw,
    straightDraw,
    nutFlushBlocker,
    wetBoard,
    pairedBoard,
  };
}

export function actionLabel(action: GameAction, bigBlind = 1): string {
  const amount = Number(((action.amount ?? 0) / bigBlind).toFixed(2));
  return action.type === 'bet'
    ? `Bet ${amount} BB`
    : action.type === 'raise'
      ? `Raise to ${amount} BB`
      : action.type[0].toUpperCase() + action.type.slice(1);
}

export function observePublicAction(
  observations: PublicObservations,
  view: AgentView,
  action: GameAction,
): PublicObservations {
  const previous = observations[view.playerId] ?? blankObservation();
  const next = { ...previous, actions: previous.actions + 1 };
  if (view.table.street === 'preflop') {
    if (next.lastPreflopHand !== view.table.id) {
      next.preflopOpportunities += 1;
      next.lastPreflopHand = view.table.id;
    }
    if (['call', 'bet', 'raise'].includes(action.type) && next.lastEntryHand !== view.table.id) {
      next.voluntaryEntries += 1;
      next.lastEntryHand = view.table.id;
    }
  }
  if (action.type === 'raise') next.raises += 1;
  if (action.type === 'bet') next.bets += 1;
  if (action.type === 'call') next.calls += 1;
  if (action.type === 'fold') next.folds += 1;
  if (
    view.table.street === 'river' &&
    view.legalActions.some((legal) => legal.type === 'call' && (legal.amount ?? 0) > 0)
  ) {
    next.riverBetFaced += 1;
    if (action.type === 'fold') next.riverFolds += 1;
  }
  return { ...observations, [view.playerId]: next };
}

export function policyDistribution(
  view: AgentView,
  context: Omit<AgentContext, 'randomValue'>,
): PolicyDistribution {
  if (
    !view.legalActions.length ||
    view.holeCards.length !== 2 ||
    view.table.actorId !== view.playerId
  )
    throw new Error('Policy requires a live actor information set.');
  const profile = agentProfiles.find((item) => item.id === context.profile);
  if (!profile) throw new Error('Unsupported opponent profile.');
  const hero = view.table.players.find((player) => player.id === view.playerId)!;
  const active = view.table.players.filter(
    (player) => player.status !== 'folded' && player.stack + player.committed > 0,
  );
  const calculation = estimateSituation(view);
  const call = view.legalActions.find((action) => action.type === 'call')?.amount ?? 0;
  const price = calculation.requiredEquity ?? 0;
  const raises = view.table.events.filter(
    (event) =>
      event.type === 'action' &&
      event.street === view.table.street &&
      event.playerId !== view.playerId &&
      ['bet', 'raise'].includes(event.action?.type ?? ''),
  ).length;
  const features = holdingFeatures(view.holeCards, view.table.board);
  const sophistication =
    context.difficulty === 'beginner'
      ? 0
      : context.difficulty === 'intermediate'
        ? 1
        : context.difficulty === 'advanced'
          ? 2
          : 3;
  const late = hero.position.startsWith('BTN') || hero.position === 'CO';
  const spr = calculation.spr;
  const terminalCall =
    call >= hero.stack ||
    active.every((player) => player.id === hero.id || player.status === 'all-in');
  // This discount is a strategy assumption about realizing showdown equity through future betting.
  // It never changes the reported sampled equity or exact pot-odds price.
  const realization =
    terminalCall || view.table.street === 'river'
      ? 1
      : clamp(
          (calculation.inPosition ? 0.94 : 0.85) - Math.max(0, active.length - 2) * 0.025,
          0.65,
          1,
        );
  const usableEquity = calculation.equity * realization;
  let bluff = profile.bluff;
  let tolerance = profile.callTolerance + (sophistication === 0 ? 0.08 : 0);
  let adaptation: string | null = null;
  if (context.profile === 'exploitative' && context.difficulty === 'expert') {
    const observed = active
      .filter((player) => player.id !== hero.id)
      .map((player) => context.observations?.[player.id])
      .filter((item): item is PublicPlayerObservation => Boolean(item));
    const river = observed.filter((item) => item.riverBetFaced >= 8);
    if (
      river.length &&
      view.table.street === 'river' &&
      river.every((item) => item.riverFolds / item.riverBetFaced > 0.65)
    ) {
      bluff *= 1.6;
      adaptation =
        'More river pressure after at least eight publicly observed river-bet opportunities and frequent folds.';
    }
    if (
      observed.some((item) => item.actions >= 30 && (item.bets + item.raises) / item.actions > 0.4)
    ) {
      tolerance += 0.035;
      adaptation =
        'Slightly wider defense against repeatedly observed aggression (at least 30 actions).';
    }
  }
  const weights: Array<{ action: GameAction; weight: number }> = [];
  const reasons: string[] = [];
  let foldWeight = 0,
    passiveWeight = 0,
    aggressiveWeight = 0;
  if (view.table.street === 'preflop') {
    const facingRaise = view.table.currentBet > view.table.bigBlind * 1.01;
    const floor =
      profile.openFloor +
      (sophistication > 0 ? (late ? -4 : active.length >= 5 ? 3 : 0) : 0) +
      (facingRaise ? 5 + Math.max(0, raises - 1) * 5 : 0);
    const structureContinue = sigmoid(
      (features.preflopScore - floor) / 3.5 - Math.max(0, price - 0.3) * 4 + tolerance * 8,
    );
    const equityContinue = sigmoid((usableEquity - price - 0.045 + tolerance) * 18);
    const continueProbability = terminalCall
      ? equityContinue
      : clamp(structureContinue * (0.45 + 0.55 * equityContinue));
    const aceBlocker = view.holeCards.some((card) => card.rank === 'A');
    const raiseFloor = facingRaise
      ? profile.threeBetFloor + (sophistication === 3 ? (aceBlocker ? -2 : raises > 1 ? 2 : 0) : 0)
      : floor + 2;
    aggressiveWeight = sigmoid((features.preflopScore - raiseFloor) / 3) * profile.aggression;
    // Risk larger raises only with enough sampled showdown strength or a small authored bluff allowance.
    const aggressiveEquity = sigmoid(
      (calculation.equity - 1 / Math.max(active.length, 2) - 0.09) * 14,
    );
    aggressiveWeight *= 0.1 + 0.9 * aggressiveEquity;
    passiveWeight = call > 0 ? continueProbability * (1 - aggressiveWeight) : 1 - aggressiveWeight;
    foldWeight = call > 0 ? (1 - continueProbability) * (facingRaise ? 1.3 : 0.8) : 0.001;
    if (
      !terminalCall &&
      call > view.table.bigBlind * 20 &&
      features.preflopScore < 50 &&
      sophistication > 0
    ) {
      foldWeight *= 3;
      aggressiveWeight *= 0.12;
      passiveWeight *= 0.2;
    }
    reasons.push(
      `${late ? 'Late' : 'Earlier'} position and ${facingRaise ? 'prior raises' : 'an unopened/limped pot'} change the authored range threshold.`,
    );
    if (sophistication === 3 && facingRaise)
      reasons.push(
        'Expert blocker selection modestly changes the authored three-bet threshold; this is not a solved frequency.',
      );
  } else {
    const draw =
      sophistication > 0 && view.table.street !== 'river'
        ? (features.flushDraw ? 0.12 : 0) + (features.straightDraw ? 0.08 : 0)
        : 0;
    const multiway = Math.max(0, active.length - 2) * 0.025;
    const pressure = sophistication > 1 ? Math.min(0.06, Math.max(0, raises - 1) * 0.025) : 0;
    const uncertaintyMargin =
      sophistication > 0 ? Math.min(0.05, calculation.equityStandardError * 0.7) : 0;
    const continueProbability = sigmoid(
      (usableEquity - price - uncertaintyMargin - pressure + tolerance) * 20,
    );
    passiveWeight = call > 0 ? continueProbability : 1;
    foldWeight =
      call > 0 ? (1 - continueProbability) * (1 + Math.max(0, active.length - 2) * 0.15) : 0.001;
    const value = sigmoid((calculation.equity - (0.61 + multiway)) * 18);
    if (sophistication === 3) bluff *= features.nutFlushBlocker ? 1.4 : draw > 0.05 ? 1.1 : 0.65;
    const credibleDraw =
      draw > 0.05 ? 0.6 : features.nutFlushBlocker && sophistication > 1 ? 0.4 : 0.13;
    aggressiveWeight =
      profile.aggression * value + (bluff * credibleDraw) / Math.max(1, active.length - 1);
    if (call > 0) aggressiveWeight *= value + draw * calculation.equity;
    else passiveWeight = Math.max(0.08, 1 - aggressiveWeight * 0.85);
    if (
      context.profile === 'tricky' &&
      call === 0 &&
      features.strength > 0.8 &&
      view.table.street === 'flop'
    )
      aggressiveWeight *= 0.6;
    if (sophistication > 1 && features.wetBoard && calculation.equity < 0.4 && call > 0)
      passiveWeight *= 0.8;
    if (spr < 1 && calculation.equity > 0.7) aggressiveWeight *= 1.3;
    reasons.push(
      `${features.madeHand}; ${active.length}-way pot${draw ? ', potential draws' : ''}${features.wetBoard ? ', coordinated board' : ''}.`,
    );
  }
  reasons.push(
    `${Math.round(calculation.equity * 100)}% estimated showdown share from ${calculation.samples} samples against ${calculation.opponents} publicly modeled opponent${calculation.opponents === 1 ? '' : 's'}.`,
  );
  if (call > 0)
    reasons.push(
      `The call risks ${Number(call.toFixed(2))} chips to contest ${Number(calculation.eligiblePot.toFixed(2))} currently eligible chips; the immediate break-even price is ${Math.round(price * 100)}%.`,
    );
  if (!terminalCall && view.table.street !== 'river')
    reasons.push(
      `Future betting and ${calculation.inPosition ? 'acting last' : 'acting before an opponent'} affect how much showdown equity this policy expects to realize.`,
    );
  reasons.push(
    'Opponent ranges and future-betting adjustments are model assumptions, not known hands, solved frequencies or verified EV.',
  );
  for (const legal of view.legalActions) {
    if (legal.type === 'fold')
      weights.push({ action: { type: 'fold' }, weight: Math.max(0.001, foldWeight) });
    if (legal.type === 'check')
      weights.push({ action: { type: 'check' }, weight: Math.max(0.005, passiveWeight) });
    if (legal.type === 'call')
      weights.push({ action: { type: 'call' }, weight: Math.max(0.001, passiveWeight) });
    if (legal.type === 'bet' || legal.type === 'raise') {
      const valueFraction = calculation.equity > 0.8 ? 0.15 : calculation.equity < 0.55 ? -0.12 : 0;
      const textureFraction = features.wetBoard && calculation.equity > 0.62 ? 0.12 : 0;
      const fraction = clamp(profile.betFraction + valueFraction + textureFraction, 0.28, 0.95);
      let total =
        view.table.street === 'preflop'
          ? view.table.currentBet > view.table.bigBlind * 1.01
            ? view.table.currentBet * (late ? 3 : 3.5)
            : view.table.bigBlind * (context.profile === 'passive' ? 2.2 : 2.6) +
              view.table.events.filter(
                (event) => event.street === 'preflop' && event.action?.type === 'call',
              ).length *
                view.table.bigBlind
          : hero.streetCommitted + call + (view.table.pot + call) * fraction;
      // Short-stack value hands use a legal commitment size instead of leaving a token stack behind.
      if (spr < 1.2 && calculation.equity > 0.72 && context.profile !== 'passive')
        total = hero.streetCommitted + hero.stack;
      const amount = legalSize(legal, total, view.table.chipUnit);
      weights.push({
        action: { type: legal.type, amount },
        weight: Math.max(0.001, aggressiveWeight),
      });
    }
  }
  const totalWeight = weights.reduce((sum, option) => sum + option.weight, 0);
  const options = weights.map((option) => ({
    ...option,
    probability: option.weight / totalWeight,
    label: actionLabel(option.action, view.table.bigBlind),
  }));
  const recommended = options.reduce((best, option) =>
    option.weight > best.weight ? option : best,
  );
  return {
    options,
    recommended,
    features,
    calculation,
    reasons,
    model: 'feltlab-calculated-policy-v2',
    adaptation,
  };
}

function legalSize(legal: LegalGameAction, target: number, chipUnit: number): number {
  const min = legal.minAmount ?? legal.amount ?? 0;
  const max = legal.maxAmount ?? min;
  if (legal.allInOnly) return max;
  const rounded = Math.round(clamp(target, min, max) / chipUnit) * chipUnit;
  return Number(clamp(rounded, min, max).toFixed(6));
}

/** Randomness samples a documented conditional policy; it never chooses an arbitrary legal action. */
export function chooseAgentAction(view: AgentView, context: AgentContext): GameAction {
  const distribution = policyDistribution(view, context);
  const draw = context.randomValue;
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1)
    throw new Error('Policy randomness must be a draw in [0, 1).');
  let cumulative = 0;
  for (const option of distribution.options) {
    cumulative += option.probability;
    if (draw < cumulative) return { ...option.action };
  }
  return { ...distribution.options.at(-1)!.action };
}
