import type {
  OpponentPrivateState,
  OpponentStrategy,
  PublicGameState,
  Scenario,
  StrategyAction,
  StrategySource,
  OpponentProfileId,
} from '../../types/poker';
import { modeledPreflopRange, weightedHandPercentile } from '../ranges';
/** Explicit allowlist: new private scenario fields cannot leak through a spread. */
export function toPublicGameState(scenario: Scenario): PublicGameState {
  return {
    scenarioId: scenario.id,
    street: scenario.street,
    board: scenario.board.map((card) => ({ ...card })),
    heroPosition: scenario.heroPosition,
    opponentPosition: scenario.opponentPosition,
    blinds: { ...scenario.blinds },
    stacks: { ...scenario.stacks },
    currentPot: scenario.currentPot,
    history: scenario.history.map((action) => ({ ...action })),
  };
}
/** Replays published lines; this is a curated opponent, not an autonomous AI. */
export class CuratedOpponentStrategy implements OpponentStrategy {
  private readonly actions: Map<string, StrategyAction>;
  constructor(scenarios: readonly Pick<Scenario, 'id' | 'opponentAction'>[] = []) {
    this.actions = new Map(
      scenarios.map((scenario) => [scenario.id, { ...scenario.opponentAction }]),
    );
  }
  getAction(state: PublicGameState, privateState: OpponentPrivateState): StrategyAction {
    if (!privateState || !Array.isArray(privateState.cards))
      throw new Error('Opponent private state requires a cards array.');
    const action = this.actions.get(state.scenarioId);
    if (!action) throw new Error(`No curated opponent action for ${state.scenarioId}.`);
    return { ...action };
  }
}
export interface VerifiedActionDistribution {
  source: Extract<StrategySource, { category: 'expert-reviewed' | 'solver-verified' }>;
  actions: { action: StrategyAction; probability: number }[];
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
/** Import boundary for future licensed, traceable strategy packs. */
export function validateVerifiedDistribution(value: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!record(value)) return { valid: false, errors: ['Action distribution must be an object.'] };
  const source = value.source;
  if (
    !record(source) ||
    !['expert-reviewed', 'solver-verified'].includes(String(source.category)) ||
    !text(source.reference) ||
    !text(source.label) ||
    !text(source.description)
  )
    errors.push('Action frequencies require traceable reviewed or solver provenance.');
  else if (
    (source.category === 'expert-reviewed' && !text(source.reviewer)) ||
    (source.category === 'solver-verified' && !text(source.solver))
  )
    errors.push('Verified provenance must identify the reviewer or solver.');
  if (!Array.isArray(value.actions) || !value.actions.length)
    errors.push('Action distribution must contain actions.');
  else {
    let total = 0;
    for (const item of value.actions) {
      if (
        !record(item) ||
        typeof item.probability !== 'number' ||
        !Number.isFinite(item.probability) ||
        item.probability < 0 ||
        item.probability > 1
      ) {
        errors.push('Action probabilities must be finite values between zero and one.');
        continue;
      }
      total += item.probability;
      const action = item.action;
      if (
        !record(action) ||
        !['fold', 'check', 'call', 'bet', 'raise'].includes(String(action.kind)) ||
        !text(action.label)
      )
        errors.push('Invalid action in distribution.');
      else if (
        ['fold', 'check'].includes(String(action.kind))
          ? action.amount !== undefined
          : typeof action.amount !== 'number' ||
            !Number.isFinite(action.amount) ||
            action.amount <= 0
      )
        errors.push('Invalid amount in strategy action.');
    }
    if (Math.abs(total - 1) > 1e-8) errors.push('Action probabilities must sum to one.');
  }
  return { valid: errors.length === 0, errors };
}
/** The bundled training pack contains no verified action-frequency policy. */
export function sampleVerifiedAction(
  distribution: VerifiedActionDistribution,
  random: () => number = Math.random,
): StrategyAction {
  const validation = validateVerifiedDistribution(distribution);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  const draw = random();
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1)
    throw new Error('Random value must be in [0, 1).');
  const total = distribution.actions.reduce((sum, item) => sum + item.probability, 0),
    target = draw * total;
  let cumulative = 0;
  for (const item of distribution.actions) {
    cumulative += item.probability;
    if (item.probability > 0 && target < cumulative) return { ...item.action };
  }
  return { ...distribution.actions.filter((item) => item.probability > 0).at(-1)!.action };
}
export interface PolicyContext {
  profile: OpponentProfileId;
  legalActions: readonly StrategyAction[];
  verifiedDistribution?: VerifiedActionDistribution;
}
export interface OpponentDecision {
  action: StrategyAction;
  provenance: 'verified-policy' | 'heuristic';
  explanation: string;
}
export interface OpponentAgent {
  decide(
    state: PublicGameState,
    privateHand: OpponentPrivateState,
    context: PolicyContext,
  ): OpponentDecision;
}
/** Reusable, explicitly limited policy foundation. Future rules engines supply
 * legal actions. No hero cards or coaching answers enter this interface. */
export class RangeAwarePreflopAgent implements OpponentAgent {
  decide(
    state: PublicGameState,
    privateHand: OpponentPrivateState,
    context: PolicyContext,
  ): OpponentDecision {
    if (state.street !== 'preflop')
      throw new Error(
        'This authored range policy supports preflop only. No postflop strategy is claimed.',
      );
    if (!context.legalActions.length)
      throw new Error('Policy needs legal actions from the rules engine.');
    const raises = state.history.filter((action) => action.kind === 'raise').length;
    const range = modeledPreflopRange(
      context.profile,
      raises > 1 ? 'three-bet' : 'open',
      privateHand.cards,
    );
    const { percentile } = weightedHandPercentile(privateHand.cards, range);
    const desired = percentile > 0.84 ? 'raise' : percentile > 0.2 ? 'call' : 'fold';
    const action =
      context.legalActions.find((item) => item.kind === desired) ??
      context.legalActions.find((item) => item.kind === 'check') ??
      context.legalActions.find((item) => item.kind === 'call') ??
      context.legalActions[0];
    return {
      action: { ...action },
      provenance: 'heuristic',
      explanation:
        'Authored structural range percentile; not solved preflop equity or a validated GTO policy.',
    };
  }
}
