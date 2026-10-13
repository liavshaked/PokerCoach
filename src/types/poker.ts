export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';
export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';
export interface Card {
  rank: Rank;
  suit: Suit;
}
export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type Position = 'BTN' | 'BB';
export type Actor = 'hero' | 'opponent';
export type ActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise';
export type ActionGrade = 'preferred' | 'defensible' | 'mistaken';
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';
export type OpponentProfileId = 'balanced' | 'tight' | 'aggressive' | 'recreational';
export type ScenarioCategory =
  | 'blind-defense'
  | 'facing-three-bet'
  | 'river-bluff-catching'
  | 'pot-odds'
  | 'drawing-odds'
  | 'bluff-math';
export interface WeightedCombo {
  cards: [Card, Card];
  weight: number;
}
export interface MathAnswer {
  id: string;
  label: string;
  value: number;
  grade: ActionGrade;
  explanation: string;
}
export interface MathExercise {
  kind: 'pot-odds' | 'drawing-odds' | 'bluff-math';
  question: string;
  answers: MathAnswer[];
}
export interface GeneratedMetadata {
  seed: string;
  version: 1;
  category: ScenarioCategory;
  profile: OpponentProfileId;
  provenance: 'mathematical-model' | 'heuristic';
  scored: boolean;
  assumptions: string[];
  range?: WeightedCombo[];
  math?: {
    equity?: number;
    requiredEquity?: number;
    callEv?: number;
    foldEv?: number;
    outs?: number;
    drawProbability?: number;
    bluffBreakEven?: number;
    rangeCombos?: number;
    blockedCombos?: number;
    tieProbability?: number;
    handPercentile?: number;
    rangeMeanStrength?: number;
  };
}
/** All amounts use BB. Bet/raise amounts are total street commitments;
 * call/post amounts are chips added. Check/fold have no amount. */
export interface HistoryAction {
  street: Street;
  actor: Actor;
  kind: ActionKind | 'post';
  amount?: number;
}
export interface StrategyAction {
  kind: ActionKind;
  amount?: number;
  label: string;
}
export interface LegalAction extends StrategyAction {
  id: string;
  grade: ActionGrade;
  explanation: string;
}
export type StrategySource =
  | { category: 'illustrative'; label: string; description: string }
  | { category: 'mathematical-model'; label: string; description: string }
  | {
      category: 'expert-reviewed';
      label: string;
      description: string;
      reviewer: string;
      reference: string;
    }
  | {
      category: 'solver-verified';
      label: string;
      description: string;
      solver: string;
      reference: string;
    };
export interface Scenario {
  id: string;
  title: string;
  description: string;
  difficulty: Difficulty;
  street: Street;
  heroPosition: Position;
  opponentPosition: Position;
  blinds: { small: number; big: number };
  heroCards: Card[];
  board: Card[];
  startingStacks: { hero: number; opponent: number };
  stacks: { hero: number; opponent: number };
  potBeforeAction: number;
  currentPot: number;
  toCall: number;
  opponentAction: StrategyAction;
  legalActions: LegalAction[];
  history: HistoryAction[];
  prompt: string;
  hint: string;
  principle: string;
  reasoning: string;
  deepDive: string;
  tags: string[];
  source: StrategySource;
  generated?: GeneratedMetadata;
  exercise?: MathExercise;
}
/** This boundary deliberately contains no hero hole cards or answer data. */
export interface PublicGameState {
  scenarioId: string;
  street: Street;
  board: Card[];
  heroPosition: Position;
  opponentPosition: Position;
  blinds: Scenario['blinds'];
  stacks: Scenario['stacks'];
  currentPot: number;
  history: HistoryAction[];
}
export interface OpponentPrivateState {
  cards: Card[];
}
export interface OpponentStrategy {
  getAction(state: PublicGameState, opponentPrivateState: OpponentPrivateState): StrategyAction;
}
