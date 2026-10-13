import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { scenarios } from '../../data/scenarios';
import type { ActionGrade, Scenario, Street } from '../../types/poker';

export const STORAGE_KEY = 'feltlab-training-v1';
export const SESSION_LENGTH = 10;
const STORAGE_VERSION = 1;

export type StreetFilter = 'all' | Street;
export type SessionMode = 'mixed' | 'weakness';

export interface TrainingSettings {
  displayName: string;
  animations: boolean;
  keyboardShortcuts: boolean;
  showHints: boolean;
}

export interface DecisionResult {
  id: string;
  scenarioId: string;
  actionId: string;
  grade: ActionGrade;
  street: Street;
  tags: string[];
  createdAt: string;
  sessionId: string;
}

export interface TrainingSession {
  id: string;
  scenarioIds: string[];
  index: number;
  decisions: DecisionResult[];
  completed: boolean;
  mode: SessionMode;
  filter: StreetFilter;
  startedAt: string;
}

export interface SessionSummary {
  id: string;
  mode: SessionMode;
  filter: StreetFilter;
  scenarioIds: string[];
  startedAt: string;
  completedAt: string;
  completed: boolean;
  decisions: number;
  preferred: number;
  defensible: number;
  mistaken: number;
}

interface PersistedTrainingState {
  settings: TrainingSettings;
  results: DecisionResult[];
  sessions: SessionSummary[];
  currentSession: TrainingSession | null;
  selectedActionId: string | null;
}

export interface TrainingStore extends PersistedTrainingState {
  storageAvailable: boolean;
  startSession: (filter?: StreetFilter, mode?: SessionMode, scenarioId?: string) => boolean;
  submitAction: (actionId: string) => boolean;
  nextScenario: () => boolean;
  replayScenario: () => void;
  endSession: () => void;
  updateSettings: (settings: Partial<TrainingSettings>) => void;
  clearProgress: () => void;
}

export const defaultSettings: TrainingSettings = {
  displayName: 'You',
  animations: true,
  keyboardShortcuts: true,
  showHints: false,
};

const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
const streets = new Set<string>(['preflop', 'flop', 'turn', 'river']);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 200;
const isDate = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const isFilter = (value: unknown): value is StreetFilter =>
  value === 'all' || (typeof value === 'string' && streets.has(value));
const isMode = (value: unknown): value is SessionMode => value === 'mixed' || value === 'weakness';

function sanitizeSettings(value: unknown): TrainingSettings {
  const source = isRecord(value) ? value : {};
  return {
    displayName:
      typeof source.displayName === 'string'
        ? source.displayName.trim().slice(0, 24) || defaultSettings.displayName
        : defaultSettings.displayName,
    animations:
      typeof source.animations === 'boolean' ? source.animations : defaultSettings.animations,
    keyboardShortcuts:
      typeof source.keyboardShortcuts === 'boolean'
        ? source.keyboardShortcuts
        : defaultSettings.keyboardShortcuts,
    showHints: typeof source.showHints === 'boolean' ? source.showHints : defaultSettings.showHints,
  };
}

function emptyState(): PersistedTrainingState {
  return {
    settings: { ...defaultSettings },
    results: [],
    sessions: [],
    currentSession: null,
    selectedActionId: null,
  };
}

function sanitizeResults(value: unknown): DecisionResult[] {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  const seenDecisions = new Set<string>();
  const results: DecisionResult[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isId(item.id) ||
      !isId(item.sessionId) ||
      !isId(item.scenarioId) ||
      !isId(item.actionId) ||
      !isDate(item.createdAt)
    )
      continue;
    const scenario = scenarioById.get(item.scenarioId);
    const action = scenario?.legalActions.find((candidate) => candidate.id === item.actionId);
    if (!scenario || !action || action.grade !== item.grade || scenario.street !== item.street)
      continue;
    const decisionKey = JSON.stringify([item.sessionId, item.scenarioId]);
    if (seenIds.has(item.id) || seenDecisions.has(decisionKey)) continue;
    seenIds.add(item.id);
    seenDecisions.add(decisionKey);
    results.push({
      id: item.id,
      scenarioId: scenario.id,
      actionId: action.id,
      grade: action.grade,
      street: scenario.street,
      tags: [...scenario.tags],
      createdAt: item.createdAt,
      sessionId: item.sessionId,
    });
  }
  return results;
}

function validScenarioIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= SESSION_LENGTH &&
    value.every((id) => typeof id === 'string' && scenarioById.has(id)) &&
    new Set(value).size === value.length
  );
}

function summarizeSession(session: TrainingSession, completedAt: string): SessionSummary {
  return {
    id: session.id,
    mode: session.mode,
    filter: session.filter,
    scenarioIds: [...session.scenarioIds],
    startedAt: session.startedAt,
    completedAt,
    completed: session.completed,
    decisions: session.decisions.length,
    preferred: session.decisions.filter((result) => result.grade === 'preferred').length,
    defensible: session.decisions.filter((result) => result.grade === 'defensible').length,
    mistaken: session.decisions.filter((result) => result.grade === 'mistaken').length,
  };
}

function sanitizeSessions(value: unknown, results: DecisionResult[]): SessionSummary[] {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  const summaries: SessionSummary[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isId(item.id) ||
      seenIds.has(item.id) ||
      !isDate(item.startedAt) ||
      !isDate(item.completedAt) ||
      !isMode(item.mode) ||
      !isFilter(item.filter) ||
      !validScenarioIds(item.scenarioIds)
    )
      continue;
    const scenarioIds = item.scenarioIds;
    const decisions = results.filter(
      (result) => result.sessionId === item.id && scenarioIds.includes(result.scenarioId),
    );
    if (decisions.length === 0) continue;
    seenIds.add(item.id);
    summaries.push(
      summarizeSession(
        {
          id: item.id,
          mode: item.mode,
          filter: item.filter,
          scenarioIds: item.scenarioIds,
          index: item.scenarioIds.length - 1,
          startedAt: item.startedAt,
          completed: item.completed === true && decisions.length === item.scenarioIds.length,
          decisions,
        },
        item.completedAt,
      ),
    );
  }
  return summaries.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
}

function sanitizeCurrentSession(value: unknown, results: DecisionResult[]): TrainingSession | null {
  if (
    !isRecord(value) ||
    !isId(value.id) ||
    !isMode(value.mode) ||
    !isFilter(value.filter) ||
    !isDate(value.startedAt) ||
    !validScenarioIds(value.scenarioIds) ||
    typeof value.index !== 'number' ||
    !Number.isInteger(value.index) ||
    value.index < 0 ||
    value.index >= value.scenarioIds.length
  )
    return null;
  const scenarioIds = value.scenarioIds;
  const index = value.index;
  if (
    value.filter !== 'all' &&
    scenarioIds.some((id) => scenarioById.get(id)?.street !== value.filter)
  )
    return null;
  const sessionResults = results.filter((result) => result.sessionId === value.id);
  const decisions = scenarioIds.flatMap((id) =>
    sessionResults.filter((result) => result.scenarioId === id),
  );
  // A valid session advances in order and can only have answered up to its current spot.
  if (
    sessionResults.length !== decisions.length ||
    decisions.length > value.index + 1 ||
    decisions.some((decision) => scenarioIds.indexOf(decision.scenarioId) > index) ||
    scenarioIds.slice(0, index).some((id) => !decisions.some((result) => result.scenarioId === id))
  )
    return null;
  const completed = value.completed === true;
  if (
    completed &&
    (value.index !== scenarioIds.length - 1 || decisions.length !== scenarioIds.length)
  )
    return null;
  return {
    id: value.id,
    mode: value.mode,
    filter: value.filter,
    startedAt: value.startedAt,
    scenarioIds: [...scenarioIds],
    index: value.index,
    completed,
    decisions,
  };
}

/** Treat storage as untrusted: restore only known scenarios and legal, consistent decisions. */
export function sanitizePersistedState(value: unknown): PersistedTrainingState {
  if (!isRecord(value)) return emptyState();
  const results = sanitizeResults(value.results);
  const currentSession = sanitizeCurrentSession(value.currentSession, results);
  const currentScenario =
    currentSession && scenarioById.get(currentSession.scenarioIds[currentSession.index]);
  const selectedActionId =
    typeof value.selectedActionId === 'string' &&
    currentScenario?.legalActions.some((action) => action.id === value.selectedActionId) &&
    currentSession?.decisions.some((decision) => decision.scenarioId === currentScenario.id)
      ? value.selectedActionId
      : null;
  return {
    settings: sanitizeSettings(value.settings),
    results,
    sessions: sanitizeSessions(value.sessions, results),
    currentSession,
    selectedActionId,
  };
}

/** Storage failures must not prevent training (private browsing, denied access, full quota). */
export function createTrainingStorage(
  onAvailabilityChange?: (available: boolean) => void,
): PersistStorage<PersistedTrainingState> {
  return {
    getItem(name) {
      let raw: string | null | undefined;
      try {
        const storage = globalThis.localStorage;
        if (!storage) {
          onAvailabilityChange?.(false);
          return null;
        }
        raw = storage.getItem(name);
      } catch {
        onAvailabilityChange?.(false);
        return null;
      }
      if (!raw) return null;
      try {
        const data: unknown = JSON.parse(raw);
        if (!isRecord(data) || data.version !== STORAGE_VERSION) return null;
        return { state: sanitizePersistedState(data.state), version: STORAGE_VERSION };
      } catch {
        return null;
      }
    },
    setItem(name, value: StorageValue<PersistedTrainingState>) {
      try {
        const storage = globalThis.localStorage;
        if (!storage) {
          onAvailabilityChange?.(false);
          return;
        }
        storage.setItem(name, JSON.stringify(value));
        onAvailabilityChange?.(true);
      } catch {
        onAvailabilityChange?.(false);
      }
    },
    removeItem(name) {
      try {
        const storage = globalThis.localStorage;
        if (!storage) {
          onAvailabilityChange?.(false);
          return;
        }
        storage.removeItem(name);
      } catch {
        onAvailabilityChange?.(false);
      }
    },
  };
}

function detectStorage(): boolean {
  try {
    return typeof globalThis.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function makeId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function shuffle<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

function weaknessScore(scenario: Scenario, results: DecisionResult[]): number {
  const attempts = results.filter((result) => result.scenarioId === scenario.id);
  const latest = attempts.at(-1);
  const ownScore = latest?.grade === 'mistaken' ? 2 : latest?.grade === 'defensible' ? 0.6 : 0;
  const related = results.filter((result) =>
    result.tags.some((tag) => scenario.tags.includes(tag)),
  );
  const tagScore =
    related.length === 0
      ? 0
      : related.reduce(
          (sum, result) =>
            sum + (result.grade === 'mistaken' ? 1 : result.grade === 'defensible' ? 0.3 : 0),
          0,
        ) / related.length;
  return ownScore + tagScore;
}

function archiveSession(
  session: TrainingSession | null,
  summaries: SessionSummary[],
): SessionSummary[] {
  if (
    !session ||
    session.decisions.length === 0 ||
    summaries.some((summary) => summary.id === session.id)
  )
    return summaries;
  return [summarizeSession(session, new Date().toISOString()), ...summaries];
}

export const useTrainingStore = create<TrainingStore>()(
  persist(
    (set, get) => ({
      ...emptyState(),
      storageAvailable: detectStorage(),
      startSession(filter = 'all', mode = 'mixed', scenarioId) {
        if (!isFilter(filter) || !isMode(mode)) return false;
        const state = get();
        let candidates = [...scenarioById.values()].filter(
          (scenario) => filter === 'all' || scenario.street === filter,
        );
        if (scenarioId) candidates = candidates.filter((scenario) => scenario.id === scenarioId);
        if (candidates.length === 0) return false;
        candidates = shuffle(candidates);
        if (mode === 'weakness')
          candidates.sort(
            (a, b) => weaknessScore(b, state.results) - weaknessScore(a, state.results),
          );
        let selected = candidates.slice(0, SESSION_LENGTH);
        if (filter === 'all' && mode === 'mixed' && !scenarioId) {
          const firstByStreet = new Map<Street, Scenario>();
          for (const candidate of candidates) {
            if (!firstByStreet.has(candidate.street))
              firstByStreet.set(candidate.street, candidate);
          }
          const seeded = [...firstByStreet.values()];
          const seededIds = new Set(seeded.map((scenario) => scenario.id));
          const remaining = candidates.filter((scenario) => !seededIds.has(scenario.id));
          selected = shuffle([...seeded, ...remaining.slice(0, SESSION_LENGTH - seeded.length)]);
        }
        set({
          sessions: archiveSession(state.currentSession, state.sessions),
          currentSession: {
            id: makeId('session'),
            scenarioIds: selected.map((scenario) => scenario.id),
            index: 0,
            decisions: [],
            completed: false,
            mode,
            filter,
            startedAt: new Date().toISOString(),
          },
          selectedActionId: null,
        });
        return true;
      },
      submitAction(actionId) {
        const state = get();
        const session = state.currentSession;
        if (!session || session.completed || state.selectedActionId !== null) return false;
        const scenario = scenarioById.get(session.scenarioIds[session.index]);
        const action = scenario?.legalActions.find((candidate) => candidate.id === actionId);
        if (!scenario || !action) return false;
        // Replays reveal fresh feedback, but the original graded attempt remains the only statistic.
        if (session.decisions.some((result) => result.scenarioId === scenario.id)) {
          set({ selectedActionId: action.id });
          return true;
        }
        const result: DecisionResult = {
          id: makeId('decision'),
          scenarioId: scenario.id,
          actionId: action.id,
          grade: action.grade,
          street: scenario.street,
          tags: [...scenario.tags],
          createdAt: new Date().toISOString(),
          sessionId: session.id,
        };
        set({
          selectedActionId: action.id,
          results: [...state.results, result],
          currentSession: { ...session, decisions: [...session.decisions, result] },
        });
        return true;
      },
      nextScenario() {
        const state = get();
        const session = state.currentSession;
        if (!session || session.completed || state.selectedActionId === null) return false;
        if (session.index < session.scenarioIds.length - 1) {
          set({ currentSession: { ...session, index: session.index + 1 }, selectedActionId: null });
        } else {
          const completedSession = { ...session, completed: true };
          set({
            currentSession: completedSession,
            sessions: archiveSession(completedSession, state.sessions),
          });
        }
        return true;
      },
      replayScenario() {
        const session = get().currentSession;
        if (session && !session.completed) set({ selectedActionId: null });
      },
      endSession() {
        const state = get();
        set({
          sessions: archiveSession(state.currentSession, state.sessions),
          currentSession: null,
          selectedActionId: null,
        });
      },
      updateSettings(settings) {
        set({ settings: sanitizeSettings({ ...get().settings, ...settings }) });
      },
      clearProgress() {
        set({ results: [], sessions: [], currentSession: null, selectedActionId: null });
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: createTrainingStorage((available) => {
        // Defer until the store has initialized; an unchanged flag prevents recursive writes.
        queueMicrotask(() => {
          if (useTrainingStore.getState().storageAvailable !== available) {
            useTrainingStore.setState({ storageAvailable: available });
          }
        });
      }),
      partialize: ({ settings, results, sessions, currentSession, selectedActionId }) => ({
        settings,
        results,
        sessions,
        currentSession,
        selectedActionId,
      }),
      merge: (persistedState, currentState) =>
        persistedState === undefined
          ? currentState
          : { ...currentState, ...sanitizePersistedState(persistedState) },
    },
  ),
);
