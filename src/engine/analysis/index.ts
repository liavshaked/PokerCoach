import type { Card, Street, WeightedCombo } from '../../types/poker';
import type { AgentView } from '../game/types';
import { policyDistribution } from '../agents';
import { riverEquity } from '../equity';
import { callEV } from '../math';
import { coachingAction, decisionCoaching } from './coaching';
import type {
  DecisionAnalysis,
  DecisionSnapshot,
  HandReport,
  HeroDecision,
  PotOddsAnalysis,
} from './types';
export type * from './types';

/** Eligibility is capped at the hero's total contribution after calling; inaccessible side pots are excluded. */
export function decisionPotOdds(view: AgentView): PotOddsAnalysis | null {
  const hero = view.table.players.find((player) => player.id === view.playerId);
  const toCall = view.legalActions.find((action) => action.type === 'call')?.amount ?? 0;
  if (!hero || toCall <= 0) return null;
  const cap = hero.committed + toCall;
  const eligiblePot = view.table.players.reduce(
    (sum, player) => sum + Math.min(player.committed, cap),
    0,
  );
  return {
    toCall,
    eligiblePot,
    currentPot: view.table.pot,
    requiredEquity: toCall / (eligiblePot + toCall),
    explanation:
      'Call / (currently eligible pot + call), before future betting and rake. Side pots above your contribution cap are excluded. This threshold is not your actual equity.',
  };
}

export function analyzeDecision(snapshot: DecisionSnapshot): DecisionAnalysis {
  const { view, chosenAction } = snapshot;
  const hero = view.table.players.find((player) => player.id === view.playerId)!;
  const active = view.table.players.filter(
    (player) => player.status !== 'folded' && player.stack + player.committed > 0,
  );
  const funded = view.table.players.filter((player) => player.stack + player.committed > 0);
  const potOdds = decisionPotOdds(view);
  const distribution = policyDistribution(view, { profile: 'balanced', difficulty: 'advanced' });
  const corresponding = distribution.options.find(
    (option) => option.action.type === chosenAction.type,
  );
  const maxWeight = distribution.recommended.weight;
  let agreement = corresponding ? corresponding.weight / maxWeight : 0;
  if (
    (chosenAction.type === 'bet' || chosenAction.type === 'raise') &&
    corresponding?.action.amount &&
    chosenAction.amount
  ) {
    const chosenRisk = Math.max(view.table.chipUnit, chosenAction.amount - hero.streetCommitted);
    const referenceRisk = Math.max(
      view.table.chipUnit,
      corresponding.action.amount - hero.streetCommitted,
    );
    agreement *= Math.min(chosenRisk, referenceRisk) / Math.max(chosenRisk, referenceRisk);
  }
  const stackBB = hero.startingStack / view.table.bigBlind;
  const allIn =
    active.some((player) => player.status === 'all-in') ||
    (potOdds?.toCall ?? 0) >= hero.stack ||
    ((chosenAction.type === 'bet' || chosenAction.type === 'raise') &&
      (chosenAction.amount ?? 0) - hero.streetCommitted >= hero.stack);
  const scored =
    funded.length >= 2 &&
    funded.length <= 6 &&
    stackBB >= 40 &&
    stackBB <= 200 &&
    !allIn &&
    (view.table.street === 'preflop' || active.length === 2);
  const score = scored ? Math.round(Math.min(1, agreement) * 100) : null;
  const grade =
    score === null ? null : score >= 80 ? 'preferred' : score >= 40 ? 'defensible' : 'mistaken';
  const importance =
    1 +
    Math.min(
      3,
      (potOdds?.toCall ?? 0) / view.table.bigBlind / 8 + view.table.pot / view.table.bigBlind / 30,
    );
  const tags =
    view.table.street === 'preflop'
      ? [
          'Preflop selection',
          hero.position.startsWith('BTN') || hero.position === 'CO'
            ? 'Position'
            : 'Preflop defense',
        ]
      : active.length > 2
        ? ['Multi-way selection', 'Range uncertainty']
        : potOdds
          ? [view.table.street === 'river' ? 'River defense' : 'Facing aggression', 'Pot odds']
          : ['Value betting', 'Bet sizing'];
  const limitations = !scored
    ? allIn
      ? 'All-in/side-pot decisions receive a qualitative review; this policy does not provide a supported all-in range valuation.'
      : active.length > 2 && view.table.street !== 'preflop'
        ? 'Multi-way postflop ranges are too uncertain for this reference model to assign a score.'
        : 'This stack depth is outside the 40–200 BB scoring scope.'
    : null;
  const coaching = decisionCoaching(snapshot, distribution, { grade, scored }, potOdds);
  const samplingMargin = Math.min(1, distribution.calculation.equityStandardError * 1.96);
  return {
    status: 'available',
    level: scored ? 'model' : 'heuristic',
    source: {
      category: scored ? 'model-based' : 'heuristic',
      label: scored ? 'Calculated training model' : 'Qualitative coaching',
    },
    model: distribution.model,
    confidence: scored ? 'medium' : 'low',
    confidenceWeight: scored ? (view.table.street === 'preflop' ? 0.55 : 0.4) : 0.2,
    grade,
    score,
    scored,
    importance,
    recommendedActions: [{ ...distribution.recommended.action }],
    explanation: `${coaching.verdict} ${coaching.why}${limitations ? ` ${limitations}` : ''}`,
    principle: coaching.takeaway,
    assumptions: [
      'Reference: FeltLab balanced/advanced calculated policy v2, using only public state and hero cards.',
      ...distribution.calculation.assumptions,
      `Estimated showdown share uses ${distribution.calculation.samples} simulated completions. The approximate 95% sampling margin is ±${Math.round(samplingMargin * 100)} percentage points; uncertainty in the opponent range is additional and is not measured by that interval.`,
      'Policy weights are authored choices, not solver frequencies. Estimated showdown share does not measure fold equity, realized equity, tournament payout value, or the EV of betting.',
      'Numeric scope: 40–200 BB starting depth, non-all-in preflop 2–6 players or non-all-in heads-up postflop.',
      'Agreement = chosen action weight / maximum policy action weight; aggressive sizing also receives the smaller/larger additional-risk ratio.',
      ...(limitations ? [limitations] : []),
    ],
    potOdds,
    evLoss: null,
    tags,
    coaching,
    estimatedEquity: {
      share: distribution.calculation.equity,
      samples: distribution.calculation.samples,
      samplingMargin,
      opponents: distribution.calculation.opponents,
      method: distribution.calculation.method,
    },
  };
}

export function summarizeHand(decisions: readonly HeroDecision[]): HandReport {
  const scored = decisions.filter(
    (decision) => decision.analysis.scored && decision.analysis.score !== null,
  );
  const totalImportance = decisions.reduce(
    (sum, decision) => sum + decision.analysis.importance,
    0,
  );
  const scoredImportance = scored.reduce((sum, decision) => sum + decision.analysis.importance, 0);
  const coverage = decisions.length ? scored.length / decisions.length : 0;
  const weightedCoverage = totalImportance ? scoredImportance / totalImportance : 0;
  const importantUnsupported = decisions.some(
    (decision) => !decision.analysis.scored && decision.analysis.importance >= 3,
  );
  const aggregate = (items: readonly HeroDecision[]) => {
    const supported = items.filter(
      (decision) => decision.analysis.score !== null && decision.analysis.scored,
    );
    const weight = supported.reduce(
      (sum, decision) => sum + decision.analysis.importance * decision.analysis.confidenceWeight,
      0,
    );
    return weight
      ? Math.round(
          supported.reduce(
            (sum, decision) =>
              sum +
              decision.analysis.score! *
                decision.analysis.importance *
                decision.analysis.confidenceWeight,
            0,
          ) / weight,
        )
      : null;
  };
  const score =
    coverage >= 0.75 && weightedCoverage >= 0.75 && !importantUnsupported
      ? aggregate(scored)
      : null;
  const mostImportant = decisions.reduce<HeroDecision | null>(
    (best, decision) =>
      !best || decision.analysis.importance > best.analysis.importance ? decision : best,
    null,
  );
  const lessons = [
    ...new Set(
      decisions
        .filter((decision) => decision.analysis.grade !== 'preferred' || !decision.analysis.scored)
        .map((decision) => decision.analysis.principle),
    ),
  ].slice(0, 3);
  if (!lessons.length && decisions.length)
    lessons.push(mostImportant?.analysis.principle ?? decisions[0].analysis.principle);
  const point = (decision: HeroDecision) => ({
    decisionId: decision.id,
    street: decision.view.table.street,
    title: `${decision.view.table.street} · ${coachingAction(decision.chosenAction, decision.analysis.potOdds?.toCall ?? 0)}`,
    detail: decision.analysis.coaching?.why ?? decision.analysis.explanation,
  });
  const strengths = scored
    .filter((decision) => decision.analysis.grade === 'preferred')
    .sort((a, b) => b.analysis.importance - a.analysis.importance)
    .slice(0, 2)
    .map(point);
  const improvements = decisions
    .filter((decision) => decision.analysis.grade !== 'preferred')
    .sort((a, b) => {
      const priority = (item: HeroDecision) =>
        item.analysis.importance * (item.analysis.grade === 'mistaken' ? 2 : 1);
      return priority(b) - priority(a);
    })
    .slice(0, 2)
    .map((decision) => ({
      ...point(decision),
      detail:
        `${decision.analysis.coaching?.verdict ?? ''} ${decision.analysis.coaching?.alternative ?? decision.analysis.principle}`.trim(),
    }));
  const clearStrengths = scored.filter(
    (decision) => decision.analysis.grade === 'preferred',
  ).length;
  const reviewChoices = scored.filter((decision) => decision.analysis.grade === 'mistaken').length;
  const summary = !decisions.length
    ? 'You had no decisions to make in this hand, so there is no play to assess.'
    : `${decisions.length === 1 ? 'You made one decision' : `You made ${decisions.length} decisions`} in this hand. ${clearStrengths ? `${clearStrengths === 1 ? 'One choice fits' : `${clearStrengths} choices fit`} the training model well. ` : ''}${reviewChoices ? `${reviewChoices === 1 ? 'One choice is' : `${reviewChoices} choices are`} worth a closer look. ` : ''}${decisions.length > scored.length ? `${decisions.length - scored.length} ${decisions.length - scored.length === 1 ? 'decision is' : 'decisions are'} reviewed in words because the model cannot support a score for ${decisions.length - scored.length === 1 ? 'that situation' : 'those situations'}. ` : ''}Focus on the reasons behind each choice; winning or losing this pot does not change them.`;
  return {
    score,
    scoreLabel: 'Model agreement',
    coverage,
    weightedCoverage,
    totalDecisions: decisions.length,
    evaluatedDecisions: decisions.filter((decision) => decision.analysis.status === 'available')
      .length,
    scoredDecisions: scored.length,
    confidence: score === null ? 'low' : 'medium',
    strongDecisions: scored.filter((decision) => decision.analysis.grade === 'preferred').length,
    notableMistakes: scored.filter((decision) => decision.analysis.grade === 'mistaken').length,
    mostImportantDecisionId: mostImportant?.id ?? null,
    biggestEvLoss: null,
    streets: (['preflop', 'flop', 'turn', 'river'] as Street[]).map((street) => {
      const items = decisions.filter((decision) => decision.view.table.street === street);
      const streetScore = items.every((decision) => decision.analysis.scored)
        ? aggregate(items)
        : null;
      return {
        street,
        decisions: items.length,
        scored: items.filter((decision) => decision.analysis.scored).length,
        score: streetScore,
        assessment: !items.length
          ? 'No decision'
          : streetScore === null
            ? 'Qualitative review'
            : streetScore >= 80
              ? 'Strong model agreement'
              : streetScore >= 40
                ? 'Reasonable model agreement'
                : 'Review this model choice',
      };
    }),
    lessons,
    summary,
    strengths,
    improvements,
    method:
      'Confidence × decision-importance weighted calculated-policy agreement. Overall number requires at least 75% count and importance coverage, and no unscored decision with importance ≥3. Outcome is never an input.',
  };
}

/** Optional constrained provider: exact enumeration of a supplied finite range, not a claim about actual opponents. */
export function evaluateSpecifiedRiverRange(
  hero: readonly Card[],
  board: readonly Card[],
  range: readonly WeightedCombo[],
  currentPot: number,
  toCall: number,
) {
  if (!Number.isFinite(currentPot) || currentPot < 0 || !Number.isFinite(toCall) || toCall <= 0)
    throw new Error(
      'A terminal river call requires a positive finite call amount and a nonnegative pot.',
    );
  const result = riverEquity(hero, board, range);
  return {
    ...result,
    callEV: callEV(result.equity, currentPot, toCall),
    requiredEquity: toCall / (currentPot + toCall),
    source:
      'Exact weighted river enumeration under the supplied range, heads-up terminal call, no rake or future betting.',
  };
}
