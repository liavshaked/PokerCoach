import type {
  Actor,
  Card,
  HistoryAction,
  LegalAction,
  Position,
  Rank,
  Scenario,
  Street,
  Suit,
} from '../../types/poker';
import { replayHistory } from '../../engine/rules';
import { loadScenarios } from './loader';
export { loadScenarios } from './loader';

const suits: Record<string, Suit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (text: string): Card[] =>
  text ? text.split(' ').map((card) => ({ rank: card[0] as Rank, suit: suits[card[1]] })) : [];
const h = (
  street: Street,
  actor: Actor,
  kind: HistoryAction['kind'],
  amount?: number,
): HistoryAction => ({ street, actor, kind, ...(amount === undefined ? {} : { amount }) });
const a = (
  kind: LegalAction['kind'],
  grade: LegalAction['grade'],
  explanation: string,
  amount?: number,
): LegalAction => ({
  id: `${kind}${amount === undefined ? '' : `-${amount}`}`,
  kind,
  grade,
  explanation,
  label: `${kind[0].toUpperCase()}${kind.slice(1)}${amount === undefined ? '' : `${kind === 'raise' ? ' to' : ''} ${amount} BB`}`,
  ...(amount === undefined ? {} : { amount }),
});
const posts = (position: Position): HistoryAction[] =>
  position === 'BTN'
    ? [h('preflop', 'hero', 'post', 0.5), h('preflop', 'opponent', 'post', 1)]
    : [h('preflop', 'opponent', 'post', 0.5), h('preflop', 'hero', 'post', 1)];
const opened = (position: Position): HistoryAction[] => [
  ...posts(position),
  h('preflop', position === 'BTN' ? 'hero' : 'opponent', 'raise', 2.5),
  h('preflop', position === 'BTN' ? 'opponent' : 'hero', 'call', 1.5),
];

type Spot = Pick<
  Scenario,
  | 'id'
  | 'title'
  | 'description'
  | 'difficulty'
  | 'street'
  | 'heroPosition'
  | 'history'
  | 'legalActions'
  | 'prompt'
  | 'hint'
  | 'principle'
  | 'reasoning'
  | 'deepDive'
  | 'tags'
> & { hand: string; board: string };
function makeSpot(spot: Spot): Scenario {
  const { hand, board, ...fields } = spot;
  const base: Scenario = {
    ...fields,
    opponentPosition: spot.heroPosition === 'BTN' ? 'BB' : 'BTN',
    heroCards: cards(hand),
    board: cards(board),
    blinds: { small: 0.5, big: 1 },
    startingStacks: { hero: 100, opponent: 100 },
    stacks: { hero: 100, opponent: 100 },
    currentPot: 0,
    potBeforeAction: 0,
    toCall: 0,
    opponentAction: { kind: 'check', label: 'Check' },
    source: {
      category: 'illustrative',
      label: 'Illustrative Â· heuristic',
      description:
        'Curated educational spot. Grades express the stated opponent assumptions and teaching principle; no solver data, EV estimates or precise strategy frequencies.',
    },
  };
  const state = replayHistory(base);
  const latest = spot.history.at(-1)!;
  if (latest.kind === 'post')
    throw new Error('A training decision needs a voluntary opponent action.');
  return {
    ...base,
    stacks: state.stacks,
    currentPot: state.pot,
    potBeforeAction: state.potBeforeLastAction,
    toCall: state.currentBet - state.contributions.hero,
    opponentAction: {
      kind: latest.kind,
      ...(latest.amount === undefined ? {} : { amount: latest.amount }),
      label: `${latest.kind[0].toUpperCase()}${latest.kind.slice(1)}${latest.amount === undefined ? '' : `${latest.kind === 'raise' ? ' to' : ''} ${latest.amount} BB`}`,
    },
  };
}

const scenarioFactories: (() => Scenario)[] = [
  () =>
    makeSpot({
      id: 'preflop-suited-defense',
      title: 'Suited king in the big blind',
      description: 'A balanced button opens to 2.5 BB. You have K9 suited in the big blind.',
      difficulty: 'beginner',
      street: 'preflop',
      heroPosition: 'BB',
      hand: 'Kh 9h',
      board: '',
      history: [...posts('BB'), h('preflop', 'opponent', 'raise', 2.5)],
      legalActions: [
        a(
          'fold',
          'mistaken',
          'K9 suited has useful high-card and flush potential against a broad button opening range at this price.',
        ),
        a(
          'call',
          'preferred',
          'Defend the suited king for 1.5 BB and retain weaker hands in the buttonâ€™s range.',
          1.5,
        ),
        a(
          'raise',
          'defensible',
          'A 3-bet can be a reasonable mix against frequent opens, but it makes the pot larger out of position.',
          9,
        ),
      ],
      prompt: 'The button opens. How do you defend K9 suited?',
      hint: 'You already invested the big blind; compare the additional call to the pot.',
      principle: 'Defend with playable hands at a favorable price.',
      reasoning:
        'The call costs 1.5 BB into a 3.5 BB pot, an immediate 30% price. K9 suited is playable against a broad heads-up opening range, although being out of position reduces how well it realizes equity.',
      deepDive:
        'The 30% figure is a pot-odds threshold, not a measured equity result. A suited king can make strong flushes and top pairs, but must still play carefully when dominated. Calling is the teaching default; a 3-bet depends on the buttonâ€™s tendencies.',
      tags: ['preflop defense', 'pot odds', 'suited hands'],
    }),
  () =>
    makeSpot({
      id: 'preflop-bottom-range',
      title: 'Seven-deuce faces an open',
      description:
        'A straightforward button uses a 3 BB open. You have 72 offsuit in the big blind.',
      difficulty: 'beginner',
      street: 'preflop',
      heroPosition: 'BB',
      hand: '7c 2d',
      board: '',
      history: [...posts('BB'), h('preflop', 'opponent', 'raise', 3)],
      legalActions: [
        a(
          'fold',
          'preferred',
          'Save the remaining stack with a disconnected, low offsuit hand that realizes equity poorly.',
        ),
        a(
          'call',
          'mistaken',
          'The price alone does not justify defending every hand; 72 offsuit makes weak pairs and few strong draws.',
          2,
        ),
        a(
          'raise',
          'mistaken',
          'This hand lacks useful high-card blockers and robust postflop playability for a default bluff 3-bet.',
          10,
        ),
      ],
      prompt: 'Is 72 offsuit a defend against this larger open?',
      hint: 'A discount does not make every hand profitable.',
      principle: 'Pot odds must be combined with hand quality and equity realization.',
      reasoning:
        'You must add 2 BB to a 4 BB pot. The immediate price is one third of the final pot, and 72 offsuit is near the bottom of the starting-hand range. Folding is a sensible heuristic against this opening size.',
      deepDive:
        'This grade assumes a straightforward opponent and no exploitable tendency such as folding almost every 3-bet. Exact defend boundaries require a defined opening range and a strategy model; this pack does not claim to provide either.',
      tags: ['preflop defense', 'hand selection'],
    }),
  () =>
    makeSpot({
      id: 'preflop-aces-fourbet',
      title: 'Aces face a three-bet',
      description: 'You open the button to 2.5 BB. The big blind 3-bets to 8 BB.',
      difficulty: 'intermediate',
      street: 'preflop',
      heroPosition: 'BTN',
      hand: 'As Ah',
      board: '',
      history: [
        ...posts('BTN'),
        h('preflop', 'hero', 'raise', 2.5),
        h('preflop', 'opponent', 'raise', 8),
      ],
      legalActions: [
        a(
          'fold',
          'mistaken',
          'Aces are the strongest starting hand and should continue against a normal 3-bet.',
        ),
        a(
          'call',
          'defensible',
          'Flatting can protect a calling range or trap an aggressive opponent; it gives up immediate pot building.',
          5.5,
        ),
        a(
          'raise',
          'preferred',
          'A 4-bet to 22 BB builds a value pot while leaving room for the big blind to continue.',
          22,
        ),
      ],
      prompt: 'How do you continue with pocket aces?',
      hint: 'Think about the hands that can pay your strongest holding.',
      principle: 'Build pots with hands that dominate the continuing range.',
      reasoning:
        'Aces benefit from putting in more money before the flop. A moderate 4-bet is our value default at 100 BB, while calling remains a plausible trap in position.',
      deepDive:
        'â€œRaise to 22â€ is a total preflop commitment. Since you already put in 2.5 BB, the raise adds 19.5 BB. The big blindâ€™s raise from 2.5 to 8 increased the bet by 5.5 BB, so a legal full re-raise must be to at least 13.5 BB.',
      tags: ['value raising', 'preflop aggression', 'bet sizing'],
    }),
  () =>
    makeSpot({
      id: 'preflop-domination',
      title: 'Ace-ten against a tight three-bet',
      description:
        'The big blind is known to 3-bet infrequently and mostly for value. Your button open receives a large 3-bet.',
      difficulty: 'intermediate',
      street: 'preflop',
      heroPosition: 'BTN',
      hand: 'Ac Td',
      board: '',
      history: [
        ...posts('BTN'),
        h('preflop', 'hero', 'raise', 2.5),
        h('preflop', 'opponent', 'raise', 11),
      ],
      legalActions: [
        a(
          'fold',
          'preferred',
          'Against the stated tight value tendency, ATo often runs into better aces and strong pairs.',
        ),
        a(
          'call',
          'mistaken',
          'Position helps, but paying 8.5 BB with a frequently dominated offsuit ace is a poor default against this opponent.',
          8.5,
        ),
        a(
          'raise',
          'mistaken',
          'An ace blocker alone is insufficient reason to bluff a player who seldom 3-bets and continues strongly.',
          26,
        ),
      ],
      prompt: 'Do you continue against this opponentâ€™s large 3-bet?',
      hint: 'The opponent profile matters more than the appeal of an ace.',
      principle: 'Adjust to credible opponent tendencies.',
      reasoning:
        'AT offsuit is vulnerable to domination by stronger aces. The large size and explicitly tight 3-betting profile favor folding, despite your position.',
      deepDive:
        'This is an exploitative teaching assumption, not a universal ATo rule. Against a wide, aggressive 3-bettor, continuing strategies can change. No precise opponent frequencies or hand equity have been supplied.',
      tags: ['hand selection', 'opponent tendencies', 'domination'],
    }),
  () =>
    makeSpot({
      id: 'flop-thin-value',
      title: 'Top pair on a dry flop',
      description:
        'You raised the button. The big blind checks a dry king-high flop to your top pair.',
      difficulty: 'beginner',
      street: 'flop',
      heroPosition: 'BTN',
      hand: 'Kh Qc',
      board: 'Ks 8d 3c',
      history: [...opened('BTN'), h('flop', 'opponent', 'check')],
      legalActions: [
        a(
          'check',
          'defensible',
          'Checking can protect your checking range and keep weak hands involved, though it delays value.',
        ),
        a(
          'bet',
          'preferred',
          'A small bet can be called by worse kings, an eight or other bluff-catching hands.',
          1.5,
        ),
        a(
          'bet',
          'defensible',
          'A larger bet can target a calling opponent, but often loses the weakest hands you want to keep.',
          3.5,
        ),
      ],
      prompt: 'Choose a plan for top pair on a dry board.',
      hint: 'Ask which worse hands can continue to each size.',
      principle: 'Choose a value size that worse hands can call.',
      reasoning:
        'KQ has a strong value hand on K83 rainbow. A small 1.5 BB bet into 5 BB gets money from weaker holdings while keeping a broad calling range.',
      deepDive:
        'A small bet is a heuristic, not a prescribed solver frequency. Checking sometimes is strategically reasonable. The dry texture has few immediate draws, so there is less need to use a large size solely for protection.',
      tags: ['value betting', 'bet sizing', 'dry boards'],
    }),
  () =>
    makeSpot({
      id: 'flop-no-backdoor',
      title: 'Seven-high on a queen-high flop',
      description:
        'You defended the big blind. The button continuation-bets a queen-high flop after your check.',
      difficulty: 'beginner',
      street: 'flop',
      heroPosition: 'BB',
      hand: '7s 6s',
      board: 'Qd 9h 2c',
      history: [...opened('BB'), h('flop', 'hero', 'check'), h('flop', 'opponent', 'bet', 1.5)],
      legalActions: [
        a(
          'fold',
          'preferred',
          'You have no pair, direct straight draw or backdoor flush draw; this is a sensible hand to release.',
        ),
        a(
          'call',
          'mistaken',
          'A small price does not create sufficient playability for every unpaired holding.',
          1.5,
        ),
        a(
          'raise',
          'mistaken',
          'Prefer bluff candidates with stronger draws or relevant blockers rather than this low-equity default.',
          6,
        ),
      ],
      prompt: 'What is your best response with seven-high?',
      hint: 'Count real draws before defending automatically.',
      principle: 'Continue with hands that have a credible path to winning.',
      reasoning:
        '76 of spades misses Q92 rainbow. It has no immediate draw and no backdoor flush draw, so folding keeps chips available for better defense candidates.',
      deepDive:
        'There are remote runner-runner improvement paths, but that does not make the hand a strong call. The recommendation assumes a normal continuation-bet range and no evidence of an exceptionally exploitable opponent.',
      tags: ['flop defense', 'hand selection', 'draw recognition'],
    }),
  () =>
    makeSpot({
      id: 'flop-combo-draw',
      title: 'Two draws on a connected flop',
      description:
        'The big blind leads into you on a connected flop. You hold an open-ended straight draw and a flush draw.',
      difficulty: 'intermediate',
      street: 'flop',
      heroPosition: 'BTN',
      hand: 'Qh Jh',
      board: 'Th 9h 2c',
      history: [...opened('BTN'), h('flop', 'opponent', 'bet', 3)],
      legalActions: [
        a(
          'fold',
          'mistaken',
          'This strong combination draw has many useful improvement routes and position.',
        ),
        a(
          'call',
          'preferred',
          'Calling retains the opponentâ€™s weaker holdings and lets you use position on later streets.',
          3,
        ),
        a(
          'raise',
          'defensible',
          'Raising can combine fold equity with substantial drawing potential, but increases variance and the risk of a re-raise.',
          10,
        ),
      ],
      prompt: 'How do you use this combination draw in position?',
      hint: 'Some straight-completing cards also complete the flush; do not count them twice.',
      principle: 'Strong draws can continue through both calls and semi-bluffs.',
      reasoning:
        'QJ of hearts on T9 with two hearts has a flush draw and an open-ended straight draw. Calling is our controlled default in position; a semi-bluff raise is also reasonable.',
      deepDive:
        'There are nine unseen hearts and eight straight-completing ranks/cards, with the king and eight of hearts counted in both sets: fifteen distinct direct straight-or-flush outs before accounting for opponent cards and redraws. These outs are not a promised equity figure, and the flop call does not buy both remaining cards for free.',
      tags: ['draws', 'semi-bluffing', 'position'],
    }),
  () =>
    makeSpot({
      id: 'flop-top-set',
      title: 'Top set in a three-bet pot',
      description:
        'You 3-bet from the big blind and checked the flop. The button bets into your top set.',
      difficulty: 'intermediate',
      street: 'flop',
      heroPosition: 'BB',
      hand: 'Ah Ad',
      board: 'As 7h 2c',
      history: [
        ...posts('BB'),
        h('preflop', 'opponent', 'raise', 2.5),
        h('preflop', 'hero', 'raise', 8),
        h('preflop', 'opponent', 'call', 5.5),
        h('flop', 'hero', 'check'),
        h('flop', 'opponent', 'bet', 8),
      ],
      legalActions: [
        a('fold', 'mistaken', 'Top set is an extremely strong value hand on this board.'),
        a(
          'call',
          'defensible',
          'A slowplay can retain bluffs on this dry board and is a reasonable alternative.',
          8,
        ),
        a(
          'raise',
          'preferred',
          'A check-raise to 24 BB builds a pot while worse aces and lower sets can continue.',
          24,
        ),
      ],
      prompt: 'The button bets half pot. How do you play top set?',
      hint: 'Balance trapping against making room to win a large value pot.',
      principle: 'Plan how a strong hand can put meaningful money in.',
      reasoning:
        'Top set supports building a large pot at 100 BB. Raising is the value-building default here, while calling can be defensible on a dry texture against an aggressive opponent.',
      deepDive:
        'Holding two aces and seeing one on the board reduces the number of ace-high hands the opponent can have. That card removal is a reason to consider a slowplay, not a reason to fold. Neither action is claimed to have a measured EV advantage.',
      tags: ['value raising', 'sets', 'pot building'],
    }),
  () =>
    makeSpot({
      id: 'turn-top-pair-value',
      title: 'Top pair on a low turn',
      description:
        'Your small flop bet was called. The big blind checks again on an innocuous low turn.',
      difficulty: 'intermediate',
      street: 'turn',
      heroPosition: 'BTN',
      hand: 'Kh Qh',
      board: 'Ks 8d 3c 2s',
      history: [
        ...opened('BTN'),
        h('flop', 'opponent', 'check'),
        h('flop', 'hero', 'bet', 1.5),
        h('flop', 'opponent', 'call', 1.5),
        h('turn', 'opponent', 'check'),
      ],
      legalActions: [
        a(
          'check',
          'defensible',
          'Pot control and protecting checks are reasonable, particularly against a tight flop caller.',
        ),
        a(
          'bet',
          'preferred',
          'A 5 BB bet into 8 BB seeks another call from worse kings and suitable bluff catchers.',
          5,
        ),
        a(
          'bet',
          'defensible',
          'A pot-sized value bet can work against a loose caller, but narrows the range of worse hands continuing.',
          8,
        ),
      ],
      prompt: 'Do you take another street of value with KQ?',
      hint: 'The turn is mostly a blank, though it introduces a spade draw.',
      principle: 'Reassess value targets after each card.',
      reasoning:
        'KQ remains a strong top pair. The 2 of spades creates some new draws but does little to improve most flop calls, so a moderate second value bet is a sensible default.',
      deepDive:
        'This assumes a big blind who can call twice with weaker kings or other bluff catchers. Against a highly selective player, checking becomes more appealing. A future river decision would still depend on the runout and the opponentâ€™s response.',
      tags: ['value betting', 'turn barreling', 'bet sizing'],
    }),
  () =>
    makeSpot({
      id: 'turn-draw-price',
      title: 'A draw faces a turn barrel',
      description:
        'A tight value-heavy opponent bets two thirds pot on the turn. You have a heart draw and a gutshot.',
      difficulty: 'advanced',
      street: 'turn',
      heroPosition: 'BTN',
      hand: 'Jh Th',
      board: 'Ah 8h 2c Qs',
      history: [
        ...opened('BTN'),
        h('flop', 'opponent', 'bet', 2),
        h('flop', 'hero', 'call', 2),
        h('turn', 'opponent', 'bet', 6),
      ],
      legalActions: [
        a(
          'fold',
          'preferred',
          'Against a value-heavy line with limited implied payoff, the immediate drawing price is insufficient.',
        ),
        a(
          'call',
          'defensible',
          'A call needs credible extra river value or another way to win; it is conditional rather than justified by pot odds alone.',
          6,
        ),
        a(
          'raise',
          'mistaken',
          'The stated value-heavy opponent gives little reason to expect enough fold equity for this semi-bluff.',
          20,
        ),
      ],
      prompt: 'Can your draw justify the turn price?',
      hint: 'You are buying one more card. Compare distinct outs with the immediate call price.',
      principle: 'A drawing call needs the right price or credible implied odds.',
      reasoning:
        'Calling costs 6 BB into a 15 BB pot, requiring 28.6% immediate equity. Nine hearts and four kings overlap at Kh, leaving twelve direct straight-or-flush outs: 12/46, about 26.1%, in a simple unseen-card count. That alone does not meet the price.',
      deepDive:
        'The 26.1% count is an improvement probability before conditioning on the opponentâ€™s holdings, not a calculated equity result: some apparent outs can lose to a full house or a better flush. Additional river payoff can support a call, but it must be a plausible assumption rather than treated as guaranteed.',
      tags: ['pot odds', 'draws', 'implied odds'],
    }),
  () =>
    makeSpot({
      id: 'turn-two-pair',
      title: 'Top two pair against a barrel',
      description:
        'You called the flop in the big blind. The aggressive button bets again into your top two pair.',
      difficulty: 'intermediate',
      street: 'turn',
      heroPosition: 'BB',
      hand: 'Js Ts',
      board: 'Jh Tc 4d 2s',
      history: [
        ...opened('BB'),
        h('flop', 'hero', 'check'),
        h('flop', 'opponent', 'bet', 3),
        h('flop', 'hero', 'call', 3),
        h('turn', 'hero', 'check'),
        h('turn', 'opponent', 'bet', 7.5),
      ],
      legalActions: [
        a(
          'fold',
          'mistaken',
          'Top two pair is much too strong to fold to this ordinary barrel by default.',
        ),
        a(
          'call',
          'defensible',
          'Calling keeps bluffs involved and can fit an opponent who attacks rivers too often.',
          7.5,
        ),
        a(
          'raise',
          'preferred',
          'A value raise can be paid by strong one-pair hands and draws, while charging their improvement chances.',
          24,
        ),
      ],
      prompt: 'How do you respond with top two pair?',
      hint: 'Consider worse made hands and straight draws that can still continue.',
      principle: 'Strong but vulnerable value hands can benefit from raising.',
      reasoning:
        'JT makes top two pair on JT42 with no flush draw. Against the stated aggressive opponent, a raise is a useful value-building default, with calls still defensible to preserve bluffs.',
      deepDive:
        'Sets remain possible, and straight draws such as KQ can improve. A strong hand does not mean a guaranteed win. The teaching preference is based on a plausible continuing range, not exact range weights or solver output.',
      tags: ['value raising', 'two pair', 'turn defense'],
    }),
  () =>
    makeSpot({
      id: 'turn-nut-straight',
      title: 'A turn that changes everything',
      description: 'The big blind leads when the turn completes your nine-high straight.',
      difficulty: 'intermediate',
      street: 'turn',
      heroPosition: 'BTN',
      hand: '9s 8s',
      board: '7d 6c 2h 5s',
      history: [
        ...opened('BTN'),
        h('flop', 'opponent', 'check'),
        h('flop', 'hero', 'bet', 2),
        h('flop', 'opponent', 'call', 2),
        h('turn', 'opponent', 'bet', 6),
      ],
      legalActions: [
        a('fold', 'mistaken', 'You hold the highest possible straight on this turn.'),
        a(
          'call',
          'defensible',
          'Calling can keep a bluff-heavy lead range betting on the river.',
          6,
        ),
        a(
          'raise',
          'preferred',
          'Raising extracts value from lower straights, sets and two pair before a river changes the board.',
          20,
        ),
      ],
      prompt: 'You made the nut straight. Choose a response.',
      hint: 'Your best five cards are 5â€“6â€“7â€“8â€“9.',
      principle: 'Build value when you hold the top of the hand-strength ladder.',
      reasoning:
        '98 on 7652 makes the nut straight on this rainbow turn. Raising targets worse strong hands while there is one card left for the board to pair or alter the action.',
      deepDive:
        'This hand is currently unbeatable, but a paired river can allow a full house. A call is a credible trapping line against frequent bluffs. The raise size is an evaluated scenario option, not the only legal size in real poker.',
      tags: ['nut advantage', 'value raising', 'straights'],
    }),
  () =>
    makeSpot({
      id: 'river-respect-value',
      title: 'A queen faces three barrels',
      description:
        'A passive, value-heavy opponent fires a third barrel when an ace lands on the river.',
      difficulty: 'intermediate',
      street: 'river',
      heroPosition: 'BB',
      hand: 'Qh Jd',
      board: 'Qs 9c 6h 2d As',
      history: [
        ...opened('BB'),
        h('flop', 'hero', 'check'),
        h('flop', 'opponent', 'bet', 3),
        h('flop', 'hero', 'call', 3),
        h('turn', 'hero', 'check'),
        h('turn', 'opponent', 'bet', 7),
        h('turn', 'hero', 'call', 7),
        h('river', 'hero', 'check'),
        h('river', 'opponent', 'bet', 20),
      ],
      legalActions: [
        a(
          'fold',
          'preferred',
          'Your queen is now a bluff catcher against a player described as rarely bluffing this river line.',
        ),
        a(
          'call',
          'mistaken',
          'You need about 30.8% winning equity; the stated opponent tendency gives no credible basis for that many bluffs.',
          20,
        ),
        a(
          'raise',
          'mistaken',
          'A bluff raise against a strong value-heavy range needs a specific fold tendency that this scenario does not provide.',
          60,
        ),
      ],
      prompt: 'Should your second pair pay off the third barrel?',
      hint: 'A good-looking pair only wins against the portion of the betting range it beats.',
      principle: 'Bluff catchers require a credible bluffing component.',
      reasoning:
        'A 20 BB call into 45 BB needs about 30.8% equity. Against a polarized range that always beats QJ when value-betting, this means enough bluffs to meet that price. The explicitly passive opponent makes folding the teaching default.',
      deepDive:
        'This is an opponent-dependent heuristic. We have not measured the bluff frequency, so the threshold is mathematical while the assumption is qualitative. An ace can improve several earlier bluffs into value, which further weakens a routine call.',
      tags: ['river bluff-catching', 'opponent tendencies', 'pot odds'],
    }),
  () =>
    makeSpot({
      id: 'river-small-bluffcatch',
      title: 'The small river price',
      description:
        'An aggressive big blind leads small after calling two streets. Missed straight draws are plausible.',
      difficulty: 'advanced',
      street: 'river',
      heroPosition: 'BTN',
      hand: 'Kh Qs',
      board: 'Kc 9d 5s 2c 2h',
      history: [
        ...opened('BTN'),
        h('flop', 'opponent', 'check'),
        h('flop', 'hero', 'bet', 2),
        h('flop', 'opponent', 'call', 2),
        h('turn', 'opponent', 'check'),
        h('turn', 'hero', 'bet', 6),
        h('turn', 'opponent', 'call', 6),
        h('river', 'opponent', 'bet', 7),
      ],
      legalActions: [
        a(
          'fold',
          'defensible',
          'Folding can be a cautious exploit against evidence of a value-heavy river lead; that is not the stated default profile.',
        ),
        a(
          'call',
          'preferred',
          'Kings and deuces with a queen kicker and a 20% immediate price support bluff-catching against the described aggressive opponent.',
          7,
        ),
        a(
          'raise',
          'mistaken',
          'A raise isolates a stronger continuing range and gives up the value of catching bluffs with this showdown-value hand.',
          24,
        ),
      ],
      prompt: 'How do you respond to the small river lead?',
      hint: 'The bet is 7 BB into a pot that was 21 BB before it arrived.',
      principle: 'Use the price and a plausible range together.',
      reasoning:
        'The pot is now 28 BB and calling 7 BB creates a 35 BB pot, so the threshold is 20%. KQ can beat missed draws and some weaker kings. The stated aggressive profile makes a call a reasonable default.',
      deepDive:
        'There are no future cards, so river pot odds directly price showdown equity. The 20% is still not a measured equity estimate. Holding a queen removes some QJ combinations, which should temper confidence rather than turn a small bet into an automatic fold.',
      tags: ['river bluff-catching', 'pot odds', 'blockers'],
    }),
  () =>
    makeSpot({
      id: 'river-thin-value',
      title: 'Ace-jack at the river',
      description:
        'The turn checked through. The big blind checks a quiet river to your ace with a jack kicker.',
      difficulty: 'beginner',
      street: 'river',
      heroPosition: 'BTN',
      hand: 'Ac Jd',
      board: 'As 8h 4c 2d 7s',
      history: [
        ...opened('BTN'),
        h('flop', 'opponent', 'check'),
        h('flop', 'hero', 'bet', 2),
        h('flop', 'opponent', 'call', 2),
        h('turn', 'opponent', 'check'),
        h('turn', 'hero', 'check'),
        h('river', 'opponent', 'check'),
      ],
      legalActions: [
        a(
          'check',
          'defensible',
          'Checking takes showdown value and can be sensible against a player who rarely pays with worse.',
        ),
        a(
          'bet',
          'preferred',
          'A moderate 4 BB bet into 9 BB targets weaker aces and occasional bluff catchers.',
          4,
        ),
        a(
          'bet',
          'defensible',
          'A larger 9 BB bet is possible against a calling opponent but offers fewer obvious worse hands a comfortable price.',
          9,
        ),
      ],
      prompt: 'Is there another street of value with AJ?',
      hint: 'Name the worse hands that can call before choosing a size.',
      principle: 'Thin value is about the opponentâ€™s calling range.',
      reasoning:
        'After the turn checks through, a small-to-moderate river bet can be called by weaker aces. AJ has sufficient value to consider betting, with checking a reasonable lower-variance alternative.',
      deepDive:
        'A river bet cannot protect against future cards. Its purpose here is value. Some straights and two-pair holdings are possible on this runout, so AJ is not the nuts and an unexpected check-raise would require a separate decision.',
      tags: ['thin value', 'value betting', 'bet sizing'],
    }),
  () =>
    makeSpot({
      id: 'river-royal-value',
      title: 'The top of the deck',
      description: 'Your river completes a royal flush. The button bets after your check.',
      difficulty: 'beginner',
      street: 'river',
      heroPosition: 'BB',
      hand: 'Kc Qc',
      board: 'Jc Tc 2d 9h Ac',
      history: [
        ...opened('BB'),
        h('flop', 'hero', 'check'),
        h('flop', 'opponent', 'bet', 3),
        h('flop', 'hero', 'call', 3),
        h('turn', 'hero', 'check'),
        h('turn', 'opponent', 'bet', 7),
        h('turn', 'hero', 'call', 7),
        h('river', 'hero', 'check'),
        h('river', 'opponent', 'bet', 18),
      ],
      legalActions: [
        a('fold', 'mistaken', 'A royal flush cannot lose or tie on this board.'),
        a(
          'call',
          'defensible',
          'Calling guarantees the current pot, but gives up the opportunity to get paid by worse strong hands.',
          18,
        ),
        a(
          'raise',
          'preferred',
          'Move all-in to 87.5 BB total this street and give strong flushes or other value hands a chance to call.',
          87.5,
        ),
      ],
      prompt: 'You hold a royal flush. How do you maximize value?',
      hint: 'This is the last decision; there are no future cards to trap on.',
      principle: 'Seek a final value raise with an unbeatable hand.',
      reasoning:
        'AKQJT of clubs is a royal flush. Raising lets the opponent pay more with a worse hand. Calling is safe, but leaves value untested when no future betting street remains.',
      deepDive:
        'The all-in adds 87.5 BB from your current stack. Your opponent has already put in 18 BB on the river and can call another 69.5 BB. Total chips remain conserved: this is a matched 100 BB effective-stack hand with no rake.',
      tags: ['nut advantage', 'value raising', 'river value'],
    }),
];

const loadedPack = loadScenarios(scenarioFactories);
export const scenarios = loadedPack.scenarios;
export const scenarioLoadIssues = loadedPack.issues;
export const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
