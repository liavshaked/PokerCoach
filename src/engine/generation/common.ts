import type {
  Actor,
  Difficulty,
  HistoryAction,
  LegalAction,
  Position,
  Scenario,
  Street,
} from '../../types/poker';
import { replayHistory } from '../rules';
import { pick } from './random';
export const historyAction = (
  street: Street,
  actor: Actor,
  kind: HistoryAction['kind'],
  amount?: number,
): HistoryAction => ({ street, actor, kind, ...(amount === undefined ? {} : { amount }) });
export function blindPosts(position: Position): HistoryAction[] {
  const button = position === 'BTN' ? 'hero' : 'opponent',
    bb = button === 'hero' ? 'opponent' : 'hero';
  return [historyAction('preflop', button, 'post', 0.5), historyAction('preflop', bb, 'post', 1)];
}
export function option(
  kind: LegalAction['kind'],
  grade: LegalAction['grade'],
  explanation: string,
  amount?: number,
): LegalAction {
  return {
    id: `${kind}${amount === undefined ? '' : `-${amount}`}`,
    kind,
    grade,
    explanation,
    label: `${kind[0].toUpperCase()}${kind.slice(1)}${amount === undefined ? '' : `${kind === 'raise' ? ' to' : ''} ${amount} BB`}`,
    ...(amount === undefined ? {} : { amount }),
  };
}
export function postflopHistory(
  street: Exclude<Street, 'preflop'>,
  position: Position,
  random: () => number,
  lastKind: 'bet' | 'check' = 'bet',
  difficulty: Difficulty = 'intermediate',
): HistoryAction[] {
  const button: Actor = position === 'BTN' ? 'hero' : 'opponent',
    bb: Actor = button === 'hero' ? 'opponent' : 'hero';
  const open = pick(
    difficulty === 'beginner'
      ? [2, 3, 4]
      : difficulty === 'advanced'
        ? [2.5, 3.5, 4.5]
        : [2, 2.5, 3, 3.5, 4],
    random,
  );
  const history = [
    ...blindPosts(position),
    historyAction('preflop', button, 'raise', open),
    historyAction('preflop', bb, 'call', open - 1),
  ];
  let pot = 2 * open,
    behind = 100 - open;
  for (const previous of ['flop', 'turn', 'river'] as const) {
    if (previous === street) break;
    if (random() < (difficulty === 'beginner' ? 0.7 : difficulty === 'advanced' ? 0.15 : 0.45))
      history.push(historyAction(previous, bb, 'check'), historyAction(previous, button, 'check'));
    else {
      const bet = Math.max(
        1,
        Math.min(
          Math.round(
            pot *
              pick(
                difficulty === 'beginner'
                  ? [0.5]
                  : difficulty === 'advanced'
                    ? [0.33, 0.67, 0.75]
                    : [0.25, 0.33, 0.5],
                random,
              ) *
              2,
          ) / 2,
          Math.floor(behind / 4),
        ),
      );
      history.push(
        historyAction(previous, bb, 'bet', bet),
        historyAction(previous, button, 'call', bet),
      );
      pot += 2 * bet;
      behind -= bet;
    }
  }
  if (position === 'BB') history.push(historyAction(street, 'hero', 'check'));
  if (lastKind === 'check') history.push(historyAction(street, 'opponent', 'check'));
  else {
    const bet = Math.max(
      1,
      Math.min(
        Math.round(
          pot *
            pick(
              difficulty === 'beginner'
                ? [0.5, 1]
                : difficulty === 'advanced'
                  ? [0.37, 0.62, 0.87, 1.25]
                  : [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25],
              random,
            ) *
            2,
        ) / 2,
        behind,
      ),
    );
    history.push(historyAction(street, 'opponent', 'bet', bet));
  }
  return history;
}
export type ScenarioSeed = Omit<
  Scenario,
  | 'opponentPosition'
  | 'blinds'
  | 'startingStacks'
  | 'stacks'
  | 'potBeforeAction'
  | 'currentPot'
  | 'toCall'
  | 'opponentAction'
>;
export function finalizeScenario(fields: ScenarioSeed): Scenario {
  const scenario: Scenario = {
    ...fields,
    opponentPosition: fields.heroPosition === 'BTN' ? 'BB' : 'BTN',
    blinds: { small: 0.5, big: 1 },
    startingStacks: { hero: 100, opponent: 100 },
    stacks: { hero: 100, opponent: 100 },
    potBeforeAction: 0,
    currentPot: 0,
    toCall: 0,
    opponentAction: { kind: 'check', label: 'Check' },
  };
  const replay = replayHistory(scenario),
    latest = fields.history.at(-1)!;
  if (latest.kind === 'post')
    throw new Error('A generated decision needs a voluntary opponent action.');
  return {
    ...scenario,
    stacks: replay.stacks,
    potBeforeAction: replay.potBeforeLastAction,
    currentPot: replay.pot,
    toCall: replay.currentBet - replay.contributions.hero,
    opponentAction: {
      kind: latest.kind,
      label: option(latest.kind, 'defensible', '', latest.amount).label,
      ...(latest.amount === undefined ? {} : { amount: latest.amount }),
    },
  };
}
