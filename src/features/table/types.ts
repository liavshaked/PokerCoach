import type { AgentDifficulty, AgentProfileId, PublicObservations } from '../../engine/agents';
import type { HeroDecision, HandReport } from '../../engine/analysis/types';
import type { GameAction, GameState } from '../../engine/game/types';

export type FeedbackTiming = 'instant' | 'full-hand' | 'session-review';
export interface TableConfig {
  playerCount: 2 | 3 | 6;
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  difficulty: AgentDifficulty;
  profiles: AgentProfileId[];
  autoRebuy: boolean;
  feedbackTiming: FeedbackTiming;
  botDelayMs: number;
  heroName: string;
}
export interface TableSession {
  id: string;
  seed: string;
  policySeed: string;
  startedAt: string;
  endedAt: string | null;
  handsStarted: number;
  handsCompleted: number;
  decisions: number;
  heroNet: number;
}
export interface CompletedHand {
  id: string;
  sessionId: string;
  state: GameState;
  decisions: HeroDecision[];
  report: HandReport;
  outcome: { heroNet: number; won: boolean; showdown: boolean };
  completedAt: string;
}
export interface SavedFullHand extends CompletedHand {
  handId: string;
  savedAt: string;
  notes: string;
  tags: string[];
  marked: boolean;
}
export interface TableState {
  totals: { hands: number; decisions: number; heroNet: number };
  config: TableConfig;
  currentHand: GameState | null;
  decisions: HeroDecision[];
  hands: CompletedHand[];
  savedHands: SavedFullHand[];
  session: TableSession | null;
  observations: PublicObservations;
  paused: boolean;
  storageAvailable: boolean;
  error: string | null;
}
export interface TableStore extends TableState {
  startSession: (config?: Partial<TableConfig>, seed?: string) => boolean;
  nextHand: () => boolean;
  submitHero: (action: GameAction, expectedToken: string) => boolean;
  stepBot: (expectedToken: string) => boolean;
  pause: () => void;
  resume: () => void;
  endSession: () => void;
  updateConfig: (config: Partial<TableConfig>) => void;
  saveHand: (handId: string) => string | null;
  updateSavedHand: (
    savedId: string,
    changes: Partial<Pick<SavedFullHand, 'notes' | 'tags' | 'marked'>>,
  ) => void;
  removeSavedHand: (savedId: string) => void;
  clearProgress: () => void;
  exportJSON: () => string;
}
export type { HeroDecision, HandReport };

export function decisionToken(hand: GameState | null): string {
  return hand ? `${hand.id}:${hand.events.length}:${hand.actorId ?? 'finished'}` : '';
}
export function canRevealAnalysis(
  config: TableConfig,
  hand: GameState | null,
  session: TableSession | null,
): boolean {
  return (
    config.feedbackTiming === 'instant' ||
    (config.feedbackTiming === 'full-hand' && Boolean(hand?.result)) ||
    (config.feedbackTiming === 'session-review' && Boolean(session?.endedAt))
  );
}
export function canRevealHandRecord(
  config: TableConfig,
  record: CompletedHand,
  session: TableSession | null,
): boolean {
  return (
    config.feedbackTiming !== 'session-review' ||
    record.sessionId !== session?.id ||
    Boolean(session?.endedAt)
  );
}
