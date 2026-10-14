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
  autoRebuy: false,
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
interface RestoreCache {
  hands: Map<string, GameState | null>;
  decisions: Map<GameState, HeroDecision[]>;
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
    // Kept in the saved schema for older clients; elimination tables never rebuy.
    autoRebuy: false,
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
function restoreHand(value: unknown, cache?: RestoreCache): GameState | null {
  if (typeof value !== 'string' || value.length > 500_000) return null;
  if (cache?.hands.has(value)) return cache.hands.get(value) ?? null;
  try {
    const hand = deserializeHand(value);
    if (
      hand.players[0]?.id !== 'hero' ||
      !validateGameState(hand).valid ||
      hand.events.length > 500
    )
      return null;
    cache?.hands.set(value, hand);
    return hand;
  } catch {
    cache?.hands.set(value, null);
    return null;
  }
}

function restoreDecisions(value: unknown, hand: GameState, cache?: RestoreCache): HeroDecision[] {
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
  const cached = cache?.decisions.get(hand);
  if (cached)
    return cached.map((decision) => ({
      ...decision,
      createdAt: metadata.get(decision.eventIndex) ?? null,
    }));
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
  decisions.sort((a, b) => a.eventIndex - b.eventIndex);
  cache?.decisions.set(hand, decisions);
  return decisions;
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

/** The larger entering stack finishes higher when several players bust together;
 * equal entering stacks share a place. Zero-stack seats remain in the engine for replay. */
function settleMatch(session: TableSession, hand: GameState, completedAt: string): TableSession {
  if (!hand.result) return session;
  const remaining = hand.players.filter((player) => player.stack > 0);
  const busted = hand.players.filter((player) => player.startingStack > 0 && player.stack === 0);
  const known = new Set(session.eliminations.map((entry) => entry.playerId));
  const eliminations = [
    ...session.eliminations,
    ...busted
      .filter((player) => !known.has(player.id))
      .map((player) => ({
        playerId: player.id,
        handNumber: hand.handNumber,
        place:
          remaining.length +
          1 +
          busted.filter((other) => other.startingStack > player.startingStack).length,
      })),
  ];
  return {
    ...session,
    eliminations,
    ...(remaining.length === 1 && session.endedReason !== 'left'
      ? {
          winnerId: remaining[0].id,
          endedAt: session.endedAt ?? completedAt,
          endedReason: 'winner' as const,
        }
      : {}),
  };
}

function completedProgress(
  current: Pick<TableState, 'hands' | 'totals'>,
  hand: GameState,
  decisions: HeroDecision[],
  session: TableSession,
): Pick<TableState, 'hands' | 'session' | 'totals'> {
  if (!hand.result) return { hands: current.hands, session, totals: current.totals };
  const existing = current.hands.find((record) => record.id === hand.id);
  const completed = existing ?? completedRecord(hand, decisions, session.id);
  return {
    hands: existing ? current.hands : [completed, ...current.hands].slice(0, RECENT_HAND_LIMIT),
    session: settleMatch(
      {
        ...session,
        handsCompleted: session.handsCompleted + (existing ? 0 : 1),
        heroNet: session.heroNet + (existing ? 0 : completed.outcome.heroNet),
      },
      hand,
      completed.completedAt,
    ),
    totals: {
      ...current.totals,
      hands: current.totals.hands + (existing ? 0 : 1),
      heroNet: current.totals.heroNet + (existing ? 0 : completed.outcome.heroNet),
    },
  };
}

function reconcileMatch(
  session: TableSession | null,
  currentHand: GameState | null,
  hands: CompletedHand[],
): TableSession | null {
  if (!session || !currentHand) return session;
  // An all-in player is still in the match until the pot has actually been awarded.
  const out = new Set(
    currentHand.players
      .filter((player) => (currentHand.result ? player.stack === 0 : player.startingStack === 0))
      .map((player) => player.id),
  );
  const seen = new Set<string>();
  let restored: TableSession = {
    ...session,
    winnerId: null,
    eliminations: session.eliminations.filter((entry) => {
      if (
        !out.has(entry.playerId) ||
        seen.has(entry.playerId) ||
        entry.handNumber > currentHand.handNumber
      )
        return false;
      seen.add(entry.playerId);
      return true;
    }),
  };
  const history = hands
    .filter(
      (hand) => hand.sessionId === session.id && hand.state.handNumber <= currentHand.handNumber,
    )
    .sort((a, b) => a.state.handNumber - b.state.handNumber);
  for (const completed of history) {
    // Old cash-table sessions may have rebought a player after an earlier bust.
    // A later funded hand supersedes that earlier elimination in legacy history.
    restored.eliminations = restored.eliminations.filter(
      (entry) =>
        entry.handNumber >= completed.state.handNumber ||
        !completed.state.players.some(
          (player) => player.id === entry.playerId && player.startingStack > 0,
        ),
    );
    const settled = settleMatch(
      { ...restored, endedReason: 'left' },
      completed.state,
      completed.completedAt,
    );
    restored.eliminations = settled.eliminations.filter((entry) => out.has(entry.playerId));
  }
  if (currentHand.result) restored = settleMatch(restored, currentHand, new Date().toISOString());
  // Old saves may predate the retained hand window. A zero hand number explicitly means
  // the elimination hand is unknown; never invent a precise historical finish order.
  for (const playerId of out) {
    if (!restored.eliminations.some((entry) => entry.playerId === playerId)) {
      restored.eliminations.push({
        playerId,
        handNumber: 0,
        place: currentHand.players.length - out.size + 1,
      });
    }
  }
  if (restored.endedReason === 'winner' && !restored.winnerId)
    restored.endedReason = restored.endedAt ? 'left' : null;
  return restored;
}
function restoreRecords(value: unknown, cache?: RestoreCache): CompletedHand[] {
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
    const hand = restoreHand(item.hand, cache);
    if (!hand?.result || hand.id !== item.id) continue;
    restored.push(
      completedRecord(
        hand,
        restoreDecisions(item.decisions, hand, cache),
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
function restoreSaved(value: unknown, cache?: RestoreCache): SavedFullHand[] {
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
    const hand = restoreHand(item.hand, cache);
    if (!hand?.result || hand.id !== item.handId) continue;
    const completed = completedRecord(
      hand,
      restoreDecisions(item.decisions, hand, cache),
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
    winnerId: validString(value.winnerId, 100) ? value.winnerId : null,
    endedReason:
      value.endedReason === 'winner' || value.endedReason === 'left'
        ? value.endedReason
        : validDate(value.endedAt)
          ? 'left'
          : null,
    eliminations: Array.isArray(value.eliminations)
      ? value.eliminations
          .filter(
            (item): item is TableSession['eliminations'][number] =>
              record(item) &&
              validString(item.playerId, 100) &&
              Number.isInteger(item.handNumber) &&
              Number(item.handNumber) >= 0 &&
              Number.isInteger(item.place) &&
              Number(item.place) >= 2 &&
              Number(item.place) <= 6,
          )
          .slice(0, 5)
      : [],
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
  // Current, recent and notebook entries often reference the exact same hand.
  // Rebuild authoritative analysis once per unique history, never from saved scores.
  const cache: RestoreCache = { hands: new Map(), decisions: new Map() };
  let session = restoreSession(value.session);
  const currentHand = session ? restoreHand(value.currentHand, cache) : null;
  const hands = restoreRecords(value.hands, cache);
  session = reconcileMatch(session, currentHand, hands);
  const savedHands = restoreSaved(value.savedHands, cache);
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
    decisions: currentHand ? restoreDecisions(value.decisions, currentHand, cache) : [],
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
          const progress = completedProgress({ ...current, totals }, next, decisions, session);
          set({
            currentHand: next,
            decisions,
            ...progress,
            paused: Boolean(progress.session?.endedAt),
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
          if (previous.session && !previous.session.endedAt && previous.currentHand) {
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
            const session: TableSession = {
              id,
              seed,
              policySeed: freshId('policy'),
              startedAt: new Date().toISOString(),
              endedAt: null,
              endedReason: null,
              winnerId: null,
              eliminations: [],
              handsStarted: 1,
              handsCompleted: 0,
              decisions: 0,
              heroNet: 0,
            };
            const progress = completedProgress(previous, hand, [], session);
            set({
              config: settings,
              currentHand: hand,
              decisions: [],
              paused: Boolean(progress.session?.endedAt),
              error: null,
              ...progress,
            });
            return true;
          } catch (error) {
            set({ error: error instanceof Error ? error.message : 'Unable to create this table.' });
            return false;
          }
        },
        nextHand(expectedToken) {
          const current = get();
          if (
            !current.currentHand?.result ||
            !current.session ||
            current.session.endedAt ||
            current.paused ||
            (expectedToken !== undefined && expectedToken !== decisionToken(current.currentHand))
          )
            return false;
          try {
            const hand = createNextHand(current.currentHand, {
              seed: `${current.session.seed}:${current.session.handsStarted + 1}`,
              autoRebuy: false,
            });
            const progress = completedProgress(current, hand, [], {
              ...current.session,
              handsStarted: current.session.handsStarted + 1,
            });
            set({
              currentHand: hand,
              decisions: [],
              paused: Boolean(progress.session?.endedAt),
              error: null,
              ...progress,
            });
            return true;
          } catch (error) {
            set({
              error: error instanceof Error ? error.message : 'Unable to deal the next hand.',
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
        fastForward(expectedToken) {
          const current = get();
          if (
            !current.currentHand ||
            decisionToken(current.currentHand) !== expectedToken ||
            current.currentHand.actorId === 'hero' ||
            current.currentHand.result ||
            current.paused ||
            !current.session ||
            current.session.endedAt
          )
            return false;
          let advanced = false;
          // A finite bound protects the UI even if a future policy/engine regression loops.
          // Each action uses the same public view and deterministic policy as normal playback.
          for (let step = 0; step < 300; step += 1) {
            const state = get();
            const hand = state.currentHand;
            if (
              !hand ||
              hand.result ||
              hand.actorId === 'hero' ||
              state.paused ||
              state.session?.endedAt
            )
              return advanced;
            if (!state.stepBot(decisionToken(hand))) return advanced;
            advanced = true;
          }
          const hand = get().currentHand;
          if (hand && !hand.result && hand.actorId !== 'hero')
            set({
              paused: true,
              error: 'Fast-forward paused after 300 actions. Resume to continue.',
            });
          return advanced;
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
            set({
              session: { ...session, endedAt: new Date().toISOString(), endedReason: 'left' },
              paused: true,
            });
        },
        updateConfig(config) {
          const current = get();
          const next = sanitizeTableConfig({ ...current.config, ...config });
          // Table structure applies at a new session; timing and feedback can change live.
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
