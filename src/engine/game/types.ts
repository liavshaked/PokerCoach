import type { Card, Street } from '../../types/poker';

export type GameStreet = Street | 'showdown';
export type GameActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise';
/** All amounts use configured chips (default BB). Bet/raise are street totals. */
export interface GameAction {
  type: GameActionType;
  amount?: number;
}
export interface LegalGameAction {
  type: GameActionType;
  amount?: number;
  minAmount?: number;
  maxAmount?: number;
  allInOnly?: boolean;
}
export interface GamePlayerConfig {
  id: string;
  name: string;
  stack: number;
}
export interface HandConfig {
  seed: string;
  players: GamePlayerConfig[];
  buttonSeat?: number;
  smallBlind: number;
  bigBlind: number;
  chipUnit?: number;
  handNumber?: number;
  id?: string;
  /** Deterministic testing/hand import only. A full unique 52-card deck. */
  deck?: Card[];
}
export interface GamePlayer extends GamePlayerConfig {
  seat: number;
  startingStack: number;
  committed: number;
  streetCommitted: number;
  status: 'active' | 'folded' | 'all-in';
  holeCards: Card[];
  lastAction: GameAction | null;
}
export interface SidePot {
  amount: number;
  eligiblePlayerIds: string[];
  contributorIds: string[];
}
export interface PotAward extends SidePot {
  winnerIds: string[];
  payouts: Record<string, number>;
}
export interface HandResult {
  reason: 'folds' | 'showdown';
  winnerIds: string[];
  payouts: Record<string, number>;
  netResults: Record<string, number>;
  pots: PotAward[];
  descriptions: Record<string, string>;
}
interface EventBase {
  index: number;
  street: GameStreet;
}
export type GameEvent = EventBase &
  (
    | { type: 'hand-started'; config: HandConfig }
    | { type: 'blind-posted'; playerId: string; blind: 'small' | 'big'; amount: number }
    | { type: 'hole-cards-dealt'; playerId: string; cards: Card[] }
    | { type: 'action'; playerId: string; action: GameAction; paid: number }
    | { type: 'board-dealt'; cards: Card[]; burn: Card }
    | { type: 'uncalled-returned'; playerId: string; amount: number }
    | { type: 'hand-settled'; result: HandResult }
  );
export interface GameState {
  version: 3;
  id: string;
  seed: string;
  handNumber: number;
  config: HandConfig;
  players: GamePlayer[];
  buttonSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  street: GameStreet;
  board: Card[];
  pot: number;
  currentBet: number;
  /** Size of the last full raise; the minimum increment for another full raise. */
  minRaise: number;
  actorId: string | null;
  pendingActorIds: string[];
  lastActedBet: Record<string, number | null>;
  deck: Card[];
  deckIndex: number;
  events: GameEvent[];
  result: HandResult | null;
}
export interface PublicGamePlayer extends Omit<GamePlayer, 'holeCards'> {
  position: string;
  /** Exposed only after the actual showdown event; folded hands remain hidden. */
  revealedCards?: Card[];
}
export interface PublicGameState {
  id: string;
  handNumber: number;
  players: PublicGamePlayer[];
  buttonSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  street: GameStreet;
  board: Card[];
  pot: number;
  currentBet: number;
  minRaise: number;
  actorId: string | null;
  smallBlind: number;
  bigBlind: number;
  chipUnit: number;
  events: PublicGameEvent[];
  result: HandResult | null;
}
export interface PublicGameEvent {
  index: number;
  street: GameStreet;
  type: GameEvent['type'];
  playerId?: string;
  blind?: 'small' | 'big';
  amount?: number;
  action?: GameAction;
  paid?: number;
  cards?: Card[];
  result?: HandResult;
}
export interface AgentView {
  table: PublicGameState;
  playerId: string;
  holeCards: Card[];
  legalActions: LegalGameAction[];
}
export interface NextHandOptions {
  seed: string;
  autoRebuy?: boolean;
  startingStack?: number;
}
