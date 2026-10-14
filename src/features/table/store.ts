import { create } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';
import {
  agentProfiles,
  blankObservation,
  chooseAgentAction,
  observePublicAction,
} from '../../engine/agents';
import type { AgentProfileId, PublicObservations } from '../../engine/agents';
import { analyzeDecision, summarizeHand } from '../../engine/analysis';
import { seededRandom } from '../../engine/generation/random';
import type { HeroDecision } from '../../engine/analysis';
import {
  applyAction,
  createHand,
  deserializeHand,
  getAgentView,
  nextHand as createNextHand,
  replayHand,
  serializeHand,
  validateGameState,
} from '../../engine/game';
import type { GameAction, GameState } from '../../engine/game';
import { decisionToken } from './types';
import type {
  CompletedHand,
  SavedFullHand,
  TableConfig,
  TableSession,
  TableState,
  TableStore,
} from './types';
export * from './types';

export const TABLE_STORAGE_KEY = 'feltlab-table-v3';
export const RECENT_HAND_LIMIT = 60;
export const SAVED_HAND_LIMIT = 100;
export const defaultTableConfig: TableConfig = {
  playerCount: 6,
  startingStack: 100,
  smallBlind: 0.5,
  bigBlind: 1,
  difficulty: 'advanced',
  profiles: ['tight-aggressive', 'loose-aggressive', 'balanced', 'passive', 'exploitative'],
  autoRebuy: true,
  feedbackTiming: 'full-hand',
  botDelayMs: 650,
  heroName: 'You',
};
interface DecisionMeta {
  id: string;
  eventIndex: number;
  createdAt: string | null;
}
interface PersistedHand {
  id: string;
  sessionId: string;
  hand: string;
  decisions: DecisionMeta[];
  completedAt: string;
}
interface PersistedSavedHand extends PersistedHand {
  handId: string;
  savedAt: string;
  notes: string;
  tags: string[];
  marked: boolean;
}
interface PersistedTable {
  totals: TableState['totals'];
  config: TableConfig;
  currentHand: string | null;
  decisions: DecisionMeta[];
  hands: PersistedHand[];
  savedHands: PersistedSavedHand[];
  session: TableSession | null;
  observations: PublicObservations;
  paused: boolean;
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const validString = (value: unknown, max = 512): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const validDate = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const boundedNumber = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
const profileIds = new Set(agentProfiles.map((profile) => profile.id));
const freshId = (prefix: string) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const defaultState = (): Omit<TableState, 'storageAvailable'> => ({
  totals: { hands: 0, decisions: 0, heroNet: 0 },
  config: { ...defaultTableConfig, profiles: [...defaultTableConfig.profiles] },
  currentHand: null,
  decisions: [],
  hands: [],
  savedHands: [],
  session: null,
  observations: {},
  paused: false,
  error: null,
});

export function sanitizeTableConfig(value: unknown): TableConfig {
  const source = record(value) ? value : {};
  const bigBlind = boundedNumber(source.bigBlind, 1, 0.1, 100);
  const smallBlind = boundedNumber(source.smallBlind, bigBlind / 2, 0.05, bigBlind);
  const profiles = Array.isArray(source.profiles)
    ? source.profiles
        .filter(
          (item): item is AgentProfileId =>
            typeof item === 'string' && profileIds.has(item as AgentProfileId),
        )
        .slice(0, 5)
    : [];
  return {
    playerCount:
      source.playerCount === 2 || source.playerCount === 3 || source.playerCount === 6
        ? source.playerCount
        : 6,
    startingStack: boundedNumber(source.startingStack, 100, 10, 500),
    smallBlind,
    bigBlind,
    difficulty: ['beginner', 'intermediate', 'advanced', 'expert'].includes(
      String(source.difficulty),
    )
      ? (source.difficulty as TableConfig['difficulty'])
      : 'advanced',
    profiles: profiles.length ? profiles : [...defaultTableConfig.profiles],
    autoRebuy: typeof source.autoRebuy === 'boolean' ? source.autoRebuy : true,
    feedbackTiming: ['instant', 'full-hand', 'session-review'].includes(
      String(source.feedbackTiming),
    )
      ? (source.feedbackTiming as TableConfig['feedbackTiming'])
      : 'full-hand',
    botDelayMs: Math.round(boundedNumber(source.botDelayMs, 650, 100, 2500)),
    heroName:
      typeof source.heroName === 'string' ? source.heroName.trim().slice(0, 24) || 'You' : 'You',
  };
}

function chipUnit(config: TableConfig): number {
  // Decimal units preserve configured blinds and stack depths without a fixed half-BB rounding constraint.
  const values = [config.smallBlind, config.bigBlind, config.startingStack * config.bigBlind];
  const decimals = Math.max(
    ...values.map((value) => (value.toString().split('.')[1] ?? '').length),
  );
  return Math.pow(10, -Math.min(6, decimals));
}
function decisionMeta(decision: HeroDecision): DecisionMeta {
  return { id: decision.id, eventIndex: decision.eventIndex, createdAt: decision.createdAt };
}
function persistedHand(hand: CompletedHand): PersistedHand {
  return {
    id: hand.id,
    sessionId: hand.sessionId,
    hand: serializeHand(hand.state),
    decisions: hand.decisions.map(decisionMeta),
    completedAt: hand.completedAt,
  };
}
function restoreHand(value: unknown): GameState | null {
  if (typeof value !== 'string' || value.length > 500_000) return null;
  try {
    const hand = deserializeHand(value);
    if (
      hand.players[0]?.id !== 'hero' ||
      !validateGameState(hand).valid ||
      hand.events.length > 500
    )
      return null;
    return hand;
  } catch {
    return null;
  }
}

function restoreDecisions(value: unknown, hand: GameState): HeroDecision[] {
  const metadata = new Map<number, string | null>();
  const decisions: HeroDecision[] = [];
  for (const item of (Array.isArray(value) ? value : []).slice(0, 100)) {
    if (
      !record(item) ||
      !(validDate(item.createdAt) || item.createdAt === null) ||
      typeof item.eventIndex !== 'number' ||
      !Number.isInteger(item.eventIndex) ||
      item.eventIndex < 1 ||
      item.eventIndex >= hand.events.length ||
      metadata.has(item.eventIndex)
    )
      continue;
    metadata.set(item.eventIndex, item.createdAt);
  }
  // The engine events establish every real hero action even if ancillary metadata was damaged.
  for (const event of hand.events) {
    if (event.type !== 'action' || event.playerId !== 'hero') continue;
    try {
      const before = replayHand(hand.events, event.index);
      if (before.actorId !== 'hero') continue;
      const snapshot = {
        id: `${hand.id}-decision-${event.index}`,
        handId: hand.id,
        eventIndex: event.index,
        createdAt: metadata.get(event.index) ?? null,
        view: getAgentView(before, 'hero'),
        chosenAction: { ...event.action },
      };
      decisions.push({ ...snapshot, analysis: analyzeDecision(snapshot) });
    } catch {
      /* A bad decision cannot manufacture a new history or score. */
    }
  }
  return decisions.sort((a, b) => a.eventIndex - b.eventIndex);
}

function completedRecord(
  hand: GameState,
  decisions: HeroDecision[],
  sessionId: string,
  completedAt = new Date().toISOString(),
): CompletedHand {
  const net = hand.result?.netResults.hero ?? 0;
  return {
    id: hand.id,
    sessionId,
    state: hand,
    decisions,
    report: summarizeHand(decisions),
    outcome: {
      heroNet: net,
      won: Boolean(hand.result?.winnerIds.includes('hero')),
      showdown: hand.result?.reason === 'showdown',
    },
    completedAt,
  };
}
function restoreRecords(value: unknown): CompletedHand[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const restored: CompletedHand[] = [];
  for (const item of value.slice(0, RECENT_HAND_LIMIT)) {
    if (
      !record(item) ||
      !validString(item.id) ||
      !validString(item.sessionId) ||
      !validDate(item.completedAt) ||
      seen.has(item.id)
    )
      continue;
    const hand = restoreHand(item.hand);
    if (!hand?.result || hand.id !== item.id) continue;
    restored.push(
      completedRecord(
        hand,
        restoreDecisions(item.decisions, hand),
        item.sessionId,
        item.completedAt,
      ),
    );
    seen.add(item.id);
  }
  return restored;
}
function cleanTags(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((tag): tag is string => typeof tag === 'string')
            .map((tag) => tag.trim().slice(0, 40))
            .filter(Boolean),
        ),
      ].slice(0, 12)
    : [];
}
function restoreSaved(value: unknown): SavedFullHand[] {
  if (!Array.isArray(value)) return [];
  const restored: SavedFullHand[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, SAVED_HAND_LIMIT)) {
    if (
      !record(item) ||
      !validString(item.handId) ||
      !validString(item.id) ||
      !validString(item.sessionId) ||
      !validDate(item.completedAt) ||
      !validDate(item.savedAt) ||
      seen.has(item.handId)
    )
      continue;
    const hand = restoreHand(item.hand);
    if (!hand?.result || hand.id !== item.handId) continue;
    const completed = completedRecord(
      hand,
      restoreDecisions(item.decisions, hand),
      item.sessionId,
      item.completedAt,
    );
    restored.push({
      ...completed,
      id: `saved-${hand.id}`,
      handId: hand.id,
      savedAt: item.savedAt,
      notes: typeof item.notes === 'string' ? item.notes.slice(0, 5000) : '',
      tags: cleanTags(item.tags),
      marked: item.marked === true,
    });
    seen.add(item.handId);
  }
  return restored;
}
function restoreSession(value: unknown): TableSession | null {
  if (
    !record(value) ||
    !validString(value.id, 150) ||
    !validString(value.seed, 150) ||
    !validDate(value.startedAt)
  )
    return null;
  return {
    id: value.id,
    seed: value.seed,
    policySeed: validString(value.policySeed, 150) ? value.policySeed : freshId('policy'),
    startedAt: value.startedAt,
    endedAt: validDate(value.endedAt) ? value.endedAt : null,
    handsStarted: Math.floor(boundedNumber(value.handsStarted, 0, 0, 1e8)),
    handsCompleted: Math.floor(boundedNumber(value.handsCompleted, 0, 0, 1e8)),
    decisions: Math.floor(boundedNumber(value.decisions, 0, 0, 1e9)),
    heroNet: boundedNumber(value.heroNet, 0, -1e12, 1e12),
  };
}
function restoreObservations(value: unknown): PublicObservations {
  if (!record(value)) return {};
  const result: PublicObservations = {};
  for (const [id, stats] of Object.entries(value).slice(0, 6)) {
    if (!validString(id, 100) || !record(stats)) continue;
    const next = blankObservation();
    for (const key of [
      'actions',
      'preflopOpportunities',
      'voluntaryEntries',
      'raises',
      'bets',
      'calls',
      'folds',
      'riverBetFaced',
      'riverFolds',
    ] as const)
      next[key] = Math.floor(boundedNumber(stats[key], 0, 0, 1e9));
    next.riverFolds = Math.min(next.riverFolds, next.riverBetFaced);
    next.lastPreflopHand = validString(stats.lastPreflopHand) ? stats.lastPreflopHand : null;
    next.lastEntryHand = validString(stats.lastEntryHand) ? stats.lastEntryHand : null;
    result[id] = next;
  }
  return result;
}
export function sanitizeTableData(value: unknown): Omit<TableState, 'storageAvailable'> {
  const defaults = defaultState();
  if (!record(value)) return defaults;
  const session = restoreSession(value.session);
  const currentHand = session ? restoreHand(value.currentHand) : null;
  const hands = restoreRecords(value.hands);
  const savedHands = restoreSaved(value.savedHands);
  const knownStates = new Map<string, GameState>();
  for (const hand of [...hands, ...savedHands]) knownStates.set(hand.state.id, hand.state);
  if (currentHand) knownStates.set(currentHand.id, currentHand);
  const knownCompleted = [...knownStates.values()].filter((hand) => hand.result);
  const knownDecisions = [...knownStates.values()].reduce(
    (sum, hand) =>
      sum +
      hand.events.filter((event) => event.type === 'action' && event.playerId === 'hero').length,
    0,
  );
  const totals = record(value.totals) ? value.totals : {};
  const config = sanitizeTableConfig(value.config);
  if (currentHand) {
    config.playerCount = currentHand.players.length as TableConfig['playerCount'];
    config.smallBlind = currentHand.config.smallBlind;
    config.bigBlind = currentHand.config.bigBlind;
  }
  return {
    ...defaults,
    totals: {
      hands: Math.max(
        knownCompleted.length,
        Math.floor(boundedNumber(totals.hands, knownCompleted.length, 0, 1e9)),
      ),
      decisions: Math.max(
        knownDecisions,
        Math.floor(boundedNumber(totals.decisions, knownDecisions, 0, 1e10)),
      ),
      heroNet: boundedNumber(
        totals.heroNet,
        knownCompleted.reduce((sum, hand) => sum + (hand.result?.netResults.hero ?? 0), 0),
        -1e12,
        1e12,
      ),
    },
    config,
    session,
    currentHand,
    decisions: currentHand ? restoreDecisions(value.decisions, currentHand) : [],
    hands,
    savedHands,
    observations: restoreObservations(value.observations),
    paused: value.paused === true || Boolean(session?.endedAt),
  };
}

function detectStorage(): boolean {
  try {
    return typeof globalThis.localStorage !== 'undefined';
  } catch {
    return false;
  }
}
function tableStorage(
  onAvailability: (available: boolean) => void,
): PersistStorage<PersistedTable> {
  return {
    getItem(name) {
      let text: string | null;
      try {
        text = globalThis.localStorage?.getItem(name) ?? null;
      } catch {
        onAvailability(false);
        return null;
      }
      if (!text) return null;
      try {
        const data: unknown = JSON.parse(text);
        return record(data) && data.version === 3 && record(data.state)
          ? { state: data.state as unknown as PersistedTable, version: 3 }
          : null;
      } catch {
        return null;
      }
    },
    setItem(name, value) {
      try {
        if (!globalThis.localStorage) {
          onAvailability(false);
          return;
        }
        localStorage.setItem(name, JSON.stringify(value));
        onAvailability(true);
      } catch {
        onAvailability(false);
      }
    },
    removeItem(name) {
      try {
        globalThis.localStorage?.removeItem(name);
      } catch {
        onAvailability(false);
      }
    },
  };
}

export const useTableStore = create<TableStore>()(
  persist(
    (set, get) => {
      const advance = (action: GameAction, expectedToken: string, heroAction: boolean): boolean => {
        const current = get();
        const hand = current.currentHand;
        if (
          !hand ||
          !current.session ||
          current.session.endedAt ||
          current.paused ||
          hand.result ||
          expectedToken !== decisionToken(hand) ||
          (hand.actorId === 'hero') !== heroAction ||
          !hand.actorId
        )
          return false;
        try {
          const view = getAgentView(hand, hand.actorId);
          const next = applyAction(hand, action);
          const event = next.events[hand.events.length];
          if (event.type !== 'action')
            throw new Error('Engine did not record the requested action.');
          let decisions = current.decisions;
          if (heroAction) {
            const snapshot = {
              id: `${hand.id}-decision-${hand.events.length}`,
              handId: hand.id,
              eventIndex: hand.events.length,
              createdAt: new Date().toISOString(),
              view,
              chosenAction: { ...event.action },
            };
            decisions = [...decisions, { ...snapshot, analysis: analyzeDecision(snapshot) }];
          }
          const session = {
            ...current.session,
            decisions: current.session.decisions + (heroAction ? 1 : 0),
          };
          const totals = {
            ...current.totals,
            decisions: current.totals.decisions + (heroAction ? 1 : 0),
          };
          let hands = current.hands;
          if (next.result && !hands.some((record) => record.id === next.id)) {
            const completed = completedRecord(next, decisions, session.id);
            hands = [completed, ...hands].slice(0, RECENT_HAND_LIMIT);
            session.handsCompleted += 1;
            session.heroNet += completed.outcome.heroNet;
            totals.hands += 1;
            totals.heroNet += completed.outcome.heroNet;
          }
          set({
            currentHand: next,
            decisions,
            hands,
            session,
            totals,
            observations: observePublicAction(current.observations, view, event.action),
            error: null,
          });
          return true;
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'This action is unavailable.' });
          return false;
        }
      };
      return {
        ...defaultState(),
        storageAvailable: detectStorage(),
        startSession(config = {}, seed = freshId('table')) {
          const previous = get();
          if (
            previous.currentHand &&
            !previous.currentHand.result &&
            previous.session &&
            !previous.session.endedAt
          ) {
            set({ error: 'End the current session before starting a new table.' });
            return false;
          }
          const settings = sanitizeTableConfig({ ...previous.config, ...config });
          if (!validString(seed, 150)) {
            set({ error: 'Use a nonempty session seed of at most 150 characters.' });
            return false;
          }
          try {
            const id = freshId('session');
            const players = Array.from({ length: settings.playerCount }, (_, seat) => ({
              id: seat === 0 ? 'hero' : `bot-${seat}`,
              name:
                seat === 0
                  ? settings.heroName
                  : (agentProfiles.find(
                      (profile) =>
                        profile.id === settings.profiles[(seat - 1) % settings.profiles.length],
                    )?.name ?? 'Balanced regular'),
              stack: settings.startingStack * settings.bigBlind,
            }));
            const hand = createHand({
              seed: `${seed}:1`,
              players,
              smallBlind: settings.smallBlind,
              bigBlind: settings.bigBlind,
              chipUnit: chipUnit(settings),
              buttonSeat: 0,
              handNumber: 1,
            });
            set({
              config: settings,
              currentHand: hand,
              decisions: [],
              paused: false,
              error: null,
              session: {
                id,
                seed,
                policySeed: freshId('policy'),
                startedAt: new Date().toISOString(),
                endedAt: null,
                handsStarted: 1,
                handsCompleted: 0,
                decisions: 0,
                heroNet: 0,
              },
            });
            return true;
          } catch (error) {
            set({ error: error instanceof Error ? error.message : 'Unable to create this table.' });
            return false;
          }
        },
        nextHand() {
          const current = get();
          if (!current.currentHand?.result || !current.session || current.session.endedAt)
            return false;
          try {
            const hand = createNextHand(current.currentHand, {
              seed: `${current.session.seed}:${current.session.handsStarted + 1}`,
              autoRebuy: current.config.autoRebuy,
              startingStack: current.config.startingStack * current.currentHand.config.bigBlind,
            });
            set({
              currentHand: hand,
              decisions: [],
              paused: false,
              error: null,
              session: { ...current.session, handsStarted: current.session.handsStarted + 1 },
            });
            return true;
          } catch (error) {
            set({
              error:
                error instanceof Error ? error.message : 'Rebuy is required before the next hand.',
            });
            return false;
          }
        },
        submitHero(action, expectedToken) {
          return advance(action, expectedToken, true);
        },
        stepBot(expectedToken) {
          const current = get();
          const hand = current.currentHand;
          if (
            !hand?.actorId ||
            hand.actorId === 'hero' ||
            hand.result ||
            !current.session ||
            current.paused ||
            current.session.endedAt ||
            expectedToken !== decisionToken(hand)
          )
            return false;
          const seat = hand.players.find((player) => player.id === hand.actorId)!.seat;
          const profile =
            current.config.profiles[(seat - 1) % current.config.profiles.length] ?? 'balanced';
          try {
            return advance(
              chooseAgentAction(getAgentView(hand, hand.actorId), {
                profile,
                difficulty: current.config.difficulty,
                observations: current.observations,
                randomValue: seededRandom(
                  `${current.session.policySeed}:${hand.handNumber}:${hand.events.length}:${hand.actorId}`,
                )(),
              }),
              expectedToken,
              false,
            );
          } catch (error) {
            set({
              error: error instanceof Error ? error.message : 'Opponent policy is unavailable.',
            });
            return false;
          }
        },
        pause() {
          set({ paused: true });
        },
        resume() {
          if (get().session && !get().session?.endedAt) set({ paused: false, error: null });
        },
        endSession() {
          const session = get().session;
          if (session && !session.endedAt)
            set({ session: { ...session, endedAt: new Date().toISOString() }, paused: true });
        },
        updateConfig(config) {
          const current = get();
          const next = sanitizeTableConfig({ ...current.config, ...config });
          // Table structure applies at a new session; timing, feedback and rebuy can change live.
          if (current.currentHand && current.session && !current.session.endedAt) {
            set({
              config: {
                ...current.config,
                autoRebuy: next.autoRebuy,
                feedbackTiming: next.feedbackTiming,
                botDelayMs: next.botDelayMs,
              },
              error: null,
            });
          } else set({ config: next, error: null });
        },
        saveHand(handId) {
          const current = get();
          const existing = current.savedHands.find((record) => record.handId === handId);
          if (existing) return existing.id;
          const hand = current.hands.find((record) => record.id === handId);
          if (!hand) return null;
          if (current.savedHands.length >= SAVED_HAND_LIMIT) {
            set({
              error: `The local notebook holds ${SAVED_HAND_LIMIT} full hands. Export or remove a saved hand first.`,
            });
            return null;
          }
          const saved: SavedFullHand = {
            ...hand,
            id: `saved-${hand.id}`,
            handId: hand.id,
            savedAt: new Date().toISOString(),
            notes: '',
            tags: [],
            marked: false,
          };
          set({ savedHands: [saved, ...current.savedHands], error: null });
          return saved.id;
        },
        updateSavedHand(savedId, changes) {
          set({
            savedHands: get().savedHands.map((hand) =>
              hand.id !== savedId
                ? hand
                : {
                    ...hand,
                    notes:
                      typeof changes.notes === 'string' ? changes.notes.slice(0, 5000) : hand.notes,
                    tags: changes.tags !== undefined ? cleanTags(changes.tags) : hand.tags,
                    marked: typeof changes.marked === 'boolean' ? changes.marked : hand.marked,
                  },
            ),
          });
        },
        removeSavedHand(savedId) {
          set({ savedHands: get().savedHands.filter((hand) => hand.id !== savedId) });
        },
        clearProgress() {
          set({
            totals: { hands: 0, decisions: 0, heroNet: 0 },
            currentHand: null,
            decisions: [],
            hands: [],
            savedHands: [],
            session: null,
            observations: {},
            paused: false,
            error: null,
          });
        },
        exportJSON() {
          const current = get();
          return JSON.stringify(
            {
              product: 'FeltLab',
              version: 3,
              exportedAt: new Date().toISOString(),
              config: current.config,
              totals: current.totals,
              session: current.session,
              currentHand: current.currentHand
                ? JSON.parse(serializeHand(current.currentHand))
                : null,
              decisions: current.decisions,
              hands: current.hands.map((hand) => ({
                ...hand,
                state: JSON.parse(serializeHand(hand.state)),
              })),
              savedHands: current.savedHands.map((hand) => ({
                ...hand,
                state: JSON.parse(serializeHand(hand.state)),
              })),
            },
            null,
            2,
          );
        },
      };
    },
    {
      name: TABLE_STORAGE_KEY,
      version: 3,
      storage: tableStorage((available) =>
        queueMicrotask(() => {
          if (useTableStore.getState().storageAvailable !== available)
            useTableStore.setState({ storageAvailable: available });
        }),
      ),
      partialize: (state): PersistedTable => ({
        totals: state.totals,
        config: state.config,
        currentHand: state.currentHand ? serializeHand(state.currentHand) : null,
        decisions: state.decisions.map(decisionMeta),
        hands: state.hands.map(persistedHand),
        savedHands: state.savedHands.map((hand) => ({
          ...persistedHand(hand),
          handId: hand.handId,
          savedAt: hand.savedAt,
          notes: hand.notes,
          tags: hand.tags,
          marked: hand.marked,
        })),
        session: state.session,
        observations: state.observations,
        paused: state.paused,
      }),
      merge: (persisted, current) =>
        persisted === undefined ? current : { ...current, ...sanitizeTableData(persisted) },
    },
  ),
);
