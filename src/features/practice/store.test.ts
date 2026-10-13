import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scenarios } from '../../data/scenarios';
import type { Street } from '../../types/poker';
import {
  createTrainingStorage,
  defaultSettings,
  sanitizePersistedState,
  SESSION_LENGTH,
  STORAGE_KEY,
  useTrainingStore,
} from './store';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function resetStore() {
  useTrainingStore.setState({
    settings: { ...defaultSettings },
    results: [],
    sessions: [],
    currentSession: null,
    selectedActionId: null,
    storageAvailable: true,
  });
}

function currentScenario() {
  const session = useTrainingStore.getState().currentSession;
  const scenario = scenarios.find((item) => item.id === session?.scenarioIds[session.index]);
  if (!scenario) throw new Error('Expected a current scenario.');
  return scenario;
}

function persistedSnapshot(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(STORAGE_KEY)!).state as Record<string, unknown>;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  resetStore();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('training session lifecycle', () => {
  it('selects ten unique scenarios and limits street sessions to their available pack', () => {
    useTrainingStore.getState().startSession();
    const mixed = useTrainingStore.getState().currentSession!;
    expect(mixed.scenarioIds).toHaveLength(Math.min(SESSION_LENGTH, scenarios.length));
    expect(new Set(mixed.scenarioIds).size).toBe(mixed.scenarioIds.length);
    for (const street of ['preflop', 'flop', 'turn', 'river'] as Street[]) {
      useTrainingStore.getState().startSession(street);
      const session = useTrainingStore.getState().currentSession!;
      expect(session.scenarioIds).toHaveLength(
        Math.min(SESSION_LENGTH, scenarios.filter((item) => item.street === street).length),
      );
      expect(
        session.scenarioIds.every(
          (id) => scenarios.find((item) => item.id === id)?.street === street,
        ),
      ).toBe(true);
      expect(new Set(session.scenarioIds).size).toBe(session.scenarioIds.length);
    }
  });

  it('represents every available street in a mixed session even when shuffling keeps pack order', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    useTrainingStore.getState().startSession();
    const ids = useTrainingStore.getState().currentSession!.scenarioIds;
    const selectedStreets = new Set(
      ids.map((id) => scenarios.find((scenario) => scenario.id === id)!.street),
    );
    expect(selectedStreets).toEqual(new Set(scenarios.map((scenario) => scenario.street)));
    expect(ids).toHaveLength(Math.min(SESSION_LENGTH, scenarios.length));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('refuses unsupported actions, rapid duplicate submissions, and advancing unanswered spots', () => {
    useTrainingStore.getState().startSession();
    expect(useTrainingStore.getState().nextScenario()).toBe(false);
    expect(useTrainingStore.getState().submitAction('unlisted-action')).toBe(false);
    expect(useTrainingStore.getState().results).toHaveLength(0);
    const action = currentScenario().legalActions[0];
    expect(useTrainingStore.getState().submitAction(action.id)).toBe(true);
    expect(useTrainingStore.getState().submitAction(action.id)).toBe(false);
    expect(useTrainingStore.getState().results).toHaveLength(1);
    expect(useTrainingStore.getState().currentSession?.decisions).toHaveLength(1);
    expect(useTrainingStore.getState().nextScenario()).toBe(true);
    expect(useTrainingStore.getState().currentSession?.index).toBe(1);
    expect(useTrainingStore.getState().selectedActionId).toBeNull();
  });

  it('keeps the first graded attempt when replaying, and archives the completed session once', () => {
    const scenario = scenarios.find(
      (item) =>
        item.legalActions.some((action) => action.grade === 'mistaken') &&
        item.legalActions.some((action) => action.grade === 'preferred'),
    )!;
    const mistake = scenario.legalActions.find((action) => action.grade === 'mistaken')!;
    const preferred = scenario.legalActions.find((action) => action.grade === 'preferred')!;
    useTrainingStore.getState().startSession('all', 'mixed', scenario.id);
    useTrainingStore.getState().submitAction(mistake.id);
    useTrainingStore.getState().replayScenario();
    expect(useTrainingStore.getState().selectedActionId).toBeNull();
    expect(useTrainingStore.getState().nextScenario()).toBe(false);
    expect(useTrainingStore.getState().submitAction(preferred.id)).toBe(true);
    expect(useTrainingStore.getState().selectedActionId).toBe(preferred.id);
    expect(useTrainingStore.getState().results).toHaveLength(1);
    expect(useTrainingStore.getState().results[0].grade).toBe('mistaken');
    useTrainingStore.getState().nextScenario();
    expect(useTrainingStore.getState().currentSession?.completed).toBe(true);
    expect(useTrainingStore.getState().sessions).toHaveLength(1);
    expect(useTrainingStore.getState().sessions[0]).toMatchObject({
      decisions: 1,
      preferred: 0,
      mistaken: 1,
      completed: true,
    });
    expect(useTrainingStore.getState().nextScenario()).toBe(false);
    expect(useTrainingStore.getState().submitAction(preferred.id)).toBe(false);
    useTrainingStore.getState().endSession();
    expect(useTrainingStore.getState().sessions).toHaveLength(1);
    expect(useTrainingStore.getState().results).toHaveLength(1);
  });

  it('finishes a full session with one result per scenario and the correct totals', () => {
    useTrainingStore.getState().startSession();
    const count = useTrainingStore.getState().currentSession!.scenarioIds.length;
    for (let index = 0; index < count; index += 1) {
      const action = currentScenario().legalActions.find(
        (candidate) => candidate.grade === 'preferred',
      )!;
      useTrainingStore.getState().submitAction(action.id);
      useTrainingStore.getState().nextScenario();
    }
    expect(useTrainingStore.getState().results).toHaveLength(count);
    expect(useTrainingStore.getState().sessions[0]).toMatchObject({
      decisions: count,
      preferred: count,
      completed: true,
    });
    expect(useTrainingStore.getState().currentSession?.completed).toBe(true);
  });

  it('keeps recorded decisions when ending early or replacing a session', () => {
    useTrainingStore.getState().startSession();
    useTrainingStore.getState().submitAction(currentScenario().legalActions[0].id);
    const firstId = useTrainingStore.getState().currentSession!.id;
    useTrainingStore.getState().startSession();
    expect(useTrainingStore.getState().sessions[0]).toMatchObject({
      id: firstId,
      decisions: 1,
      completed: false,
    });
    useTrainingStore.getState().submitAction(currentScenario().legalActions[0].id);
    useTrainingStore.getState().endSession();
    expect(useTrainingStore.getState().currentSession).toBeNull();
    expect(useTrainingStore.getState().results).toHaveLength(2);
    expect(useTrainingStore.getState().sessions).toHaveLength(2);
    useTrainingStore.getState().endSession();
    expect(useTrainingStore.getState().sessions).toHaveLength(2);
  });

  it('prioritizes a missed scenario in a weakness session without repeats', () => {
    const missed = scenarios.find((item) =>
      item.legalActions.some((action) => action.grade === 'mistaken'),
    )!;
    useTrainingStore.getState().startSession('all', 'mixed', missed.id);
    useTrainingStore
      .getState()
      .submitAction(missed.legalActions.find((action) => action.grade === 'mistaken')!.id);
    useTrainingStore.getState().endSession();
    useTrainingStore.getState().startSession('all', 'weakness');
    const session = useTrainingStore.getState().currentSession!;
    expect(session.scenarioIds[0]).toBe(missed.id);
    expect(new Set(session.scenarioIds).size).toBe(session.scenarioIds.length);
    expect(session.mode).toBe('weakness');
  });

  it('leaves the current session intact for an unknown requested scenario', () => {
    useTrainingStore.getState().startSession();
    const session = useTrainingStore.getState().currentSession;
    expect(useTrainingStore.getState().startSession('all', 'mixed', 'missing-scenario')).toBe(
      false,
    );
    expect(useTrainingStore.getState().currentSession).toBe(session);
  });

  it('clears training history while retaining validated settings', () => {
    useTrainingStore
      .getState()
      .updateSettings({ displayName: '  Liav  ', animations: false, showHints: true });
    useTrainingStore.getState().startSession();
    useTrainingStore.getState().submitAction(currentScenario().legalActions[0].id);
    useTrainingStore.getState().clearProgress();
    expect(useTrainingStore.getState().results).toEqual([]);
    expect(useTrainingStore.getState().sessions).toEqual([]);
    expect(useTrainingStore.getState().currentSession).toBeNull();
    expect(useTrainingStore.getState().settings).toMatchObject({
      displayName: 'Liav',
      animations: false,
      showHints: true,
    });
  });
});

describe('safe local progress persistence', () => {
  it('restores an active session, its feedback, settings, and results after rehydration', async () => {
    useTrainingStore.getState().updateSettings({ displayName: 'Ada', showHints: true });
    useTrainingStore.getState().startSession();
    useTrainingStore.getState().submitAction(currentScenario().legalActions[0].id);
    useTrainingStore.getState().nextScenario();
    const actionId = currentScenario().legalActions[0].id;
    useTrainingStore.getState().submitAction(actionId);
    const original = useTrainingStore.getState().currentSession!;
    const raw = localStorage.getItem(STORAGE_KEY)!;
    resetStore();
    localStorage.setItem(STORAGE_KEY, raw);
    await useTrainingStore.persist.rehydrate();
    expect(useTrainingStore.getState().settings).toMatchObject({
      displayName: 'Ada',
      showHints: true,
    });
    expect(useTrainingStore.getState().currentSession).toEqual(original);
    expect(useTrainingStore.getState().selectedActionId).toBe(actionId);
    expect(useTrainingStore.getState().results).toHaveLength(2);
    expect(useTrainingStore.getState().submitAction(actionId)).toBe(false);
    expect(persistedSnapshot()).not.toHaveProperty('storageAvailable');
  });

  it('restores a replay without counting another decision', async () => {
    useTrainingStore.getState().startSession();
    const actionId = currentScenario().legalActions[0].id;
    useTrainingStore.getState().submitAction(actionId);
    useTrainingStore.getState().replayScenario();
    await useTrainingStore.persist.rehydrate();
    expect(useTrainingStore.getState().selectedActionId).toBeNull();
    expect(useTrainingStore.getState().submitAction(actionId)).toBe(true);
    expect(useTrainingStore.getState().results).toHaveLength(1);
  });

  it('handles invalid JSON, unsupported storage versions, and broken state shapes', async () => {
    for (const raw of [
      '{broken',
      JSON.stringify({ version: 999, state: {} }),
      JSON.stringify({ version: 1, state: 'invalid' }),
    ]) {
      localStorage.setItem(STORAGE_KEY, raw);
      await expect(Promise.resolve(useTrainingStore.persist.rehydrate())).resolves.toBeUndefined();
      expect(useTrainingStore.getState().currentSession).toBeNull();
      expect(useTrainingStore.getState().results).toEqual([]);
      expect(useTrainingStore.getState().settings).toEqual(defaultSettings);
      expect(useTrainingStore.getState().startSession()).toBe(true);
      resetStore();
    }
  });

  it('rejects duplicate or illegal results and discards malformed sessions without losing valid progress', () => {
    useTrainingStore.getState().startSession();
    useTrainingStore.getState().submitAction(currentScenario().legalActions[0].id);
    const snapshot = persistedSnapshot();
    const result = useTrainingStore.getState().results[0];
    const sanitized = sanitizePersistedState({
      ...snapshot,
      results: [
        result,
        { ...result, id: 'duplicate' },
        { ...result, id: 'illegal', sessionId: 'different', actionId: 'all-in-9999' },
      ],
      currentSession: { ...useTrainingStore.getState().currentSession, index: -2 },
      settings: {
        displayName: '   ',
        animations: 'yes',
        showHints: false,
        keyboardShortcuts: true,
      },
    });
    expect(sanitized.results).toHaveLength(1);
    expect(sanitized.currentSession).toBeNull();
    expect(sanitized.selectedActionId).toBeNull();
    expect(sanitized.settings).toEqual(defaultSettings);
  });

  it('rejects an active session with recorded decisions beyond its current index', () => {
    useTrainingStore.getState().startSession();
    const session = useTrainingStore.getState().currentSession!;
    const future = scenarios.find((scenario) => scenario.id === session.scenarioIds[3])!;
    const action = future.legalActions[0];
    const sanitized = sanitizePersistedState({
      ...persistedSnapshot(),
      results: [
        {
          id: 'future-result',
          sessionId: session.id,
          scenarioId: future.id,
          actionId: action.id,
          grade: action.grade,
          street: future.street,
          tags: future.tags,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    expect(sanitized.currentSession).toBeNull();
  });

  it('recalculates summary counts from saved legal decisions', () => {
    useTrainingStore.getState().startSession('all', 'mixed', scenarios[0].id);
    const action = currentScenario().legalActions[0];
    useTrainingStore.getState().submitAction(action.id);
    useTrainingStore.getState().nextScenario();
    const snapshot = persistedSnapshot();
    const summaries = useTrainingStore.getState().sessions;
    const sanitized = sanitizePersistedState({
      ...snapshot,
      sessions: [
        { ...summaries[0], decisions: 9999, preferred: 9999, defensible: 9999, mistaken: 9999 },
      ],
    });
    expect(sanitized.sessions[0].decisions).toBe(1);
    expect(
      sanitized.sessions[0].preferred +
        sanitized.sessions[0].defensible +
        sanitized.sessions[0].mistaken,
    ).toBe(1);
    expect(sanitized.sessions[0][action.grade]).toBe(1);
  });

  it('continues training in memory when browser storage throws and exposes the failure', async () => {
    const blockedStorage = memoryStorage();
    vi.spyOn(blockedStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    vi.stubGlobal('localStorage', blockedStorage);
    expect(() => useTrainingStore.getState().startSession()).not.toThrow();
    expect(useTrainingStore.getState().submitAction(currentScenario().legalActions[0].id)).toBe(
      true,
    );
    await Promise.resolve();
    expect(useTrainingStore.getState().results).toHaveLength(1);
    expect(useTrainingStore.getState().storageAvailable).toBe(false);
    expect(createTrainingStorage().getItem(STORAGE_KEY)).toBeNull();
    vi.spyOn(blockedStorage, 'getItem').mockImplementation(() => {
      throw new Error('Access denied');
    });
    expect(createTrainingStorage().getItem(STORAGE_KEY)).toBeNull();
    await useTrainingStore.persist.rehydrate();
    expect(useTrainingStore.getState().results).toHaveLength(1);
  });

  it('clears the persistence notice after storage becomes writable again', async () => {
    const storage = memoryStorage();
    const write = vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('Full storage');
    });
    vi.stubGlobal('localStorage', storage);
    useTrainingStore.getState().startSession();
    await Promise.resolve();
    expect(useTrainingStore.getState().storageAvailable).toBe(false);
    write.mockRestore();
    useTrainingStore.getState().clearProgress();
    await Promise.resolve();
    expect(useTrainingStore.getState().storageAvailable).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });
});
