import type { Card } from '../../types/poker';
import type { PolicyDistribution } from '../agents';
import type { GameAction } from '../game';
import type {
  DecisionCoaching,
  DecisionSnapshot,
  DecisionAnalysis,
  PotOddsAnalysis,
} from './types';

const amount = (value: number) => Number(value.toFixed(2)).toLocaleString('en-US');
const percent = (value: number) => `${Math.round(value * 100)}%`;
const suits = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
const cards = (holding: readonly Card[]) =>
  holding.map((card) => `${card.rank === 'T' ? '10' : card.rank}${suits[card.suit]}`).join(' ');
const rankNames: Record<string, string> = {
  A: 'aces',
  K: 'kings',
  Q: 'queens',
  J: 'jacks',
  T: 'tens',
  '9': 'nines',
  '8': 'eights',
  '7': 'sevens',
  '6': 'sixes',
  '5': 'fives',
  '4': 'fours',
  '3': 'threes',
  '2': 'twos',
};

/** Chips, not BB: table blind sizes are configurable. Raises are street-total amounts. */
export function coachingAction(action: GameAction, toCall = 0): string {
  if (action.type === 'call') return `call ${amount(toCall)} chips`;
  if (action.type === 'bet' || action.type === 'raise')
    return `${action.type} to ${amount(action.amount ?? 0)} chips`;
  return action.type;
}

function positionExplanation(snapshot: DecisionSnapshot, distribution: PolicyDistribution): string {
  const { view } = snapshot;
  const hero = view.table.players.find((player) => player.id === view.playerId)!;
  const funded = view.table.players.filter((player) => player.stack + player.committed > 0);
  if (
    distribution.calculation.toCall >= hero.stack ||
    view.table.players.every(
      (player) => player.id === hero.id || player.status === 'folded' || player.stack === 0,
    )
  )
    return 'If you call, you cannot face another betting decision in this hand. Concentrate on the price and the range that put the chips in.';
  if (view.table.street !== 'preflop')
    return distribution.calculation.inPosition
      ? 'You act after the remaining opponents on this street, so their actions give you information before you commit more chips.'
      : 'You act before at least one remaining opponent, so checking or calling can leave you facing another bet without knowing their plan.';
  if (funded.length === 2)
    return hero.position.startsWith('BTN')
      ? 'Heads-up, the button acts first before the flop and last on later streets. That later information makes a wider opening range reasonable.'
      : 'Heads-up, the big blind acts first after the flop. A discount to call helps, but weak holdings can still be difficult to play on later streets.';
  if (hero.position.startsWith('BTN'))
    return 'The button acts last after the flop, giving you more information and more room to play a wider range of hands.';
  if (hero.position === 'CO')
    return 'The cutoff is late position, so fewer players remain behind you, but the button can still take position against you.';
  if (hero.position === 'SB')
    return 'From the small blind you will usually act first after the flop. Chips already posted do not justify adding more with a weak hand.';
  if (hero.position === 'BB')
    return 'The big blind gives you a discount to call, but opponents who act after you on later streets can make weak hands expensive to continue.';
  return 'From earlier position, players behind can call or raise. Stronger, more playable holdings are better candidates to enter the pot.';
}

function describeHolding(snapshot: DecisionSnapshot, distribution: PolicyDistribution): string {
  const { holeCards, table } = snapshot.view;
  if (table.street === 'preflop') {
    if (holeCards[0].rank === holeCards[1].rank)
      return `a pocket pair of ${rankNames[holeCards[0].rank]}`;
    return `${holeCards[0].suit === holeCards[1].suit ? 'suited' : 'offsuit'} cards`;
  }
  const { features } = distribution;
  const draws = [
    features.flushDraw && !/flush/i.test(features.madeHand) ? 'a flush draw' : '',
    features.straightDraw && !/straight/i.test(features.madeHand) ? 'a straight draw' : '',
  ].filter(Boolean);
  return `${features.madeHand}${draws.length ? ` with ${draws.join(' and ')}` : ''}`;
}

function priceExplanation(
  snapshot: DecisionSnapshot,
  distribution: PolicyDistribution,
  potOdds: PotOddsAnalysis | null,
): string {
  const { calculation } = distribution;
  if (!potOdds)
    return `Against the model's assumed ranges for ${calculation.opponents} ${calculation.opponents === 1 ? 'opponent' : 'opponents'}, your estimated showdown share is about ${percent(calculation.equity)}.`;
  const equity = calculation.equity;
  const margin = Math.max(0.035, calculation.equityStandardError * 1.96);
  const edge = equity - potOdds.requiredEquity;
  const comparison = edge > margin ? 'above' : edge < -margin ? 'below' : 'close to';
  const price = `Calling costs ${amount(potOdds.toCall)} chips to contest ${amount(potOdds.eligiblePot + potOdds.toCall)} chips after your call, so the immediate break-even share is ${percent(potOdds.requiredEquity)}.`;
  const estimate = `Your estimated showdown share is about ${percent(equity)} against the assumed opponent ranges, ${comparison} that price.`;
  const hero = snapshot.view.table.players.find((player) => player.id === snapshot.view.playerId)!;
  const terminal =
    potOdds.toCall >= hero.stack ||
    snapshot.view.table.players.every(
      (player) => player.id === hero.id || player.status === 'folded' || player.stack === 0,
    );
  const future =
    snapshot.view.table.street === 'river'
      ? 'On the river there are no cards left to improve your hand; the key uncertainty is which hands the opponent would bet.'
      : terminal
        ? 'Calling would end your betting decisions for this hand, so the remaining cards run out without another payment from you.'
        : 'There are more cards and possible bets to come, so reaching that showdown share can cost more than this call alone.';
  const capped =
    potOdds.eligiblePot < potOdds.currentPot
      ? ' The calculation excludes side-pot chips you cannot win.'
      : '';
  return `${price} ${estimate} ${future}${capped}`;
}

function explainChoice(
  snapshot: DecisionSnapshot,
  distribution: PolicyDistribution,
  potOdds: PotOddsAnalysis | null,
): string {
  const { chosenAction, view } = snapshot;
  const hero = view.table.players.find((player) => player.id === view.playerId)!;
  const { calculation, features, recommended } = distribution;
  const reference = recommended.action;
  const equityMargin = Math.max(0.035, calculation.equityStandardError * 1.96);
  const highEnough = potOdds && calculation.equity > potOdds.requiredEquity + equityMargin;
  const belowPrice = potOdds && calculation.equity < potOdds.requiredEquity - equityMargin;
  const hasDraw =
    view.table.street !== 'preflop' &&
    view.table.street !== 'river' &&
    ((features.flushDraw && !/flush/i.test(features.madeHand)) ||
      (features.straightDraw && !/straight/i.test(features.madeHand)));
  const draw = hasDraw
    ? "Your draw gives you ways to improve, but completing it does not guarantee winning: the board can also improve an opponent's hand."
    : '';
  let choice: string;
  if (chosenAction.type === 'fold') {
    choice =
      reference.type === 'fold'
        ? `Folding preserves your remaining ${amount(hero.stack)} chips. ${belowPrice ? 'The estimated share does not cover the immediate calling price under these range assumptions.' : 'The model considers this holding too fragile for the price, position and pressure you face.'}`
        : `Folding gives up your chance to win the ${amount(view.table.pot)}-chip pot without risking more. ${highEnough ? 'The estimated share leaves room to consider continuing at this price, so folding may be overly cautious under these assumptions.' : 'The reference model sees enough playability at this price to consider continuing, although that is sensitive to the opponent ranges.'}`;
  } else if (chosenAction.type === 'call') {
    const canWinMoreLater =
      view.table.street !== 'river' &&
      hero.stack > calculation.toCall &&
      view.table.players.some(
        (player) => player.id !== hero.id && player.status !== 'folded' && player.stack > 0,
      );
    choice = belowPrice
      ? canWinMoreLater
        ? 'This call needs either a weaker opponent range or enough extra chips won later to justify its price. The current range estimate does not provide that support on its own.'
        : 'The estimated share falls short of the calling price. This call needs a weaker opponent range than the model currently assumes; there is no later value-betting opportunity to make up the difference.'
      : reference.type === 'fold'
        ? 'The immediate price is only part of this call. The model favors folding because position, repeated aggression or future betting can make it hard to collect your estimated share.'
        : reference.type === 'raise'
          ? 'Calling keeps the pot smaller and allows weaker hands to stay in. The model prefers raising here to charge those hands and build a pot, while accepting that stronger hands can continue.'
          : 'Calling keeps weaker hands and bluffs in the pot while limiting how much you add now. That is useful when raising would mainly get action from stronger hands.';
  } else if (chosenAction.type === 'check') {
    choice =
      reference.type === 'check'
        ? `Checking adds no chips to the ${amount(view.table.pot)}-chip pot. It keeps weaker hands in and avoids building a larger pot without a clear value or bluffing advantage.`
        : 'Checking controls the pot, but it also lets opponents continue without paying. The model prefers a bet here to seek value or apply pressure; whether that works depends on which weaker hands call and which better hands fold.';
  } else {
    const risk = Math.max(0, (chosenAction.amount ?? 0) - hero.streetCommitted);
    const remaining = Math.max(0, hero.stack - risk);
    const referenceRisk = Math.max(0, (reference.amount ?? 0) - hero.streetCommitted);
    const sizing =
      reference.type === chosenAction.type && referenceRisk > 0 && risk / referenceRisk > 1.25
        ? 'Your size risks noticeably more than the reference size. That can drive out weaker hands and leave you playing a larger pot against stronger continuations.'
        : reference.type === chosenAction.type && referenceRisk > 0 && risk / referenceRisk < 0.75
          ? 'Your smaller size gives opponents a cheaper call. That may keep weak hands involved, but it charges draws less and creates less pressure.'
          : '';
    choice = `Your ${chosenAction.type} adds ${amount(risk)} chips and leaves ${amount(remaining)} behind. `;
    choice +=
      reference.type === 'fold' || reference.type === 'call' || reference.type === 'check'
        ? 'The model prefers a smaller commitment here. A bigger pot is helpful only if enough weaker hands call or enough better hands fold; raw showdown share does not establish either.'
        : hasDraw
          ? 'Pressure with a draw gives you two possible ways to win: an opponent folds now, or your hand improves. The estimate does not measure how often opponents will fold.'
          : 'Building the pot can earn value from weaker hands, but an opponent who continues will usually have a stronger range than one who has not faced this bet.';
    if (sizing) choice += ` ${sizing}`;
  }
  return [choice, draw].filter(Boolean).join(' ');
}

function referenceLine(
  snapshot: DecisionSnapshot,
  distribution: PolicyDistribution,
  scored: boolean,
): string {
  const { view } = snapshot;
  const hero = view.table.players.find((player) => player.id === view.playerId)!;
  const action = distribution.recommended.action;
  const prefix = scored ? 'The model suggests' : 'One line to compare in replay is';
  if (action.type === 'fold')
    return `${prefix} folding and keeping ${amount(hero.stack)} chips for a better opportunity. Money already committed cannot be recovered by adding more.`;
  if (action.type === 'check')
    return `${prefix} checking, which adds no chips. If an opponent bets, reassess the new price instead of deciding now that you must continue.`;
  if (action.type === 'call')
    return `${prefix} calling ${amount(distribution.calculation.toCall)} chips, leaving ${amount(Math.max(0, hero.stack - distribution.calculation.toCall))} behind. ${
      view.table.street === 'river' ||
      distribution.calculation.toCall >= hero.stack ||
      view.table.players.every(
        (player) => player.id === hero.id || player.status === 'folded' || player.stack === 0,
      )
        ? 'Make that commitment using the current price and the hands the opponents can plausibly hold.'
        : 'Reassess if the price changes or a new board card changes the hands opponents can hold.'
    }`;
  const risk = Math.max(0, (action.amount ?? 0) - hero.streetCommitted);
  return `${prefix} a ${coachingAction(action)}, a total commitment on this street. That adds ${amount(risk)} chips and leaves ${amount(Math.max(0, hero.stack - risk))} behind. ${
    risk >= hero.stack
      ? 'This puts your remaining stack at risk; compare your holding with the stronger range likely to call.'
      : 'Before using this size, identify weaker hands that might call and your response to a raise.'
  }`;
}

function takeaway(
  snapshot: DecisionSnapshot,
  distribution: PolicyDistribution,
  odds: PotOddsAnalysis | null,
): string {
  if (snapshot.view.table.street === 'preflop') {
    const raises = snapshot.view.table.events.filter(
      (event) =>
        event.type === 'action' &&
        event.street === 'preflop' &&
        event.playerId !== snapshot.view.playerId &&
        event.action?.type === 'raise',
    ).length;
    return raises > 0
      ? 'Facing a raise, compare the new price with a tighter opponent range and your position; a hand worth opening is not automatically worth calling.'
      : 'Choose your opening hands together with your position: acting later makes marginal hands easier to play, while earlier seats need more selectivity.';
  }
  if (odds) {
    const hero = snapshot.view.table.players.find(
      (player) => player.id === snapshot.view.playerId,
    )!;
    const terminal =
      odds.toCall >= hero.stack ||
      snapshot.view.table.players.every(
        (player) => player.id === hero.id || player.status === 'folded' || player.stack === 0,
      );
    return `Before calling, name the ${percent(odds.requiredEquity)} price and the hands you expect the opponent to bet. ${
      snapshot.view.table.street === 'river'
        ? 'A bluff-catcher only earns a call when that range contains enough bluffs.'
        : terminal
          ? 'When the call ends your betting decisions, compare the full runout estimate with that price and account for which side pots you can win.'
          : 'Allow for future bets and for draw cards that may also help your opponent.'
    }`;
  }
  if (distribution.features.wetBoard)
    return 'On a coordinated board, consider both the weaker hands you can charge and the stronger draws or made hands that can raise you.';
  return 'Before betting, identify the weaker hands that can call or the better hands that can fold. If neither group is clear, checking is worth considering.';
}

/** Every sentence uses the information available immediately before the action, never the result. */
export function decisionCoaching(
  snapshot: DecisionSnapshot,
  distribution: PolicyDistribution,
  assessment: Pick<DecisionAnalysis, 'grade' | 'scored'>,
  odds: PotOddsAnalysis | null,
): DecisionCoaching {
  const { view, chosenAction } = snapshot;
  const hero = view.table.players.find((player) => player.id === view.playerId)!;
  const action = coachingAction(chosenAction, distribution.calculation.toCall);
  const reference = coachingAction(
    distribution.recommended.action,
    distribution.calculation.toCall,
  );
  const situation = `You held ${cards(view.holeCards)} (${describeHolding(snapshot, distribution)})${view.table.board.length ? ` on ${cards(view.table.board)}` : ''}. The pot was ${amount(view.table.pot)} chips, with ${amount(hero.stack)} behind in ${hero.position}.`;
  const verdict = !assessment.scored
    ? `Choosing to ${action} needs a qualitative review; this situation is outside the model's scoring scope.`
    : assessment.grade === 'preferred'
      ? `Choosing to ${action} fits this situation well in the training model.`
      : assessment.grade === 'defensible'
        ? `Choosing to ${action} is a reasonable option; compare it with the model's preference to ${reference}.`
        : `Choosing to ${action} deserves another look. The model prefers to ${reference}.`;
  return {
    situation,
    verdict,
    why: [
      explainChoice(snapshot, distribution, odds),
      priceExplanation(snapshot, distribution, odds),
      positionExplanation(snapshot, distribution),
    ]
      .filter(Boolean)
      .join(' '),
    alternative: referenceLine(snapshot, distribution, assessment.scored),
    takeaway: takeaway(snapshot, distribution, odds),
  };
}
