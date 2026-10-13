import { create } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';
import { getDecisionOptions } from '../../engine/evaluation';
import type { GenerationOptions } from '../../engine/generation';
import type {
  ActionGrade,
  Difficulty,
  OpponentProfileId,
  Scenario,
  ScenarioCategory,
  Street,
  StrategySource,
} from '../../types/poker';
import { generateScenarioAsync } from './generation-client';

export const GENERATED_STORAGE_KEY = 'feltlab-generated-v2';
export const GENERATED_HISTORY_LIMIT = 2_000;
export const GENERATED_DUPLICATE_RETRIES = 4;
const STORAGE_VERSION = 1;
const SESSION_HISTORY_LIMIT = 200;

export type GeneratedSessionMode = 'endless' | 'focused' | 'challenge' | 'weakness';
export interface GeneratedPreferences {
  mode: GeneratedSessionMode;
  street: 'all' | Street;
  category: 'all' | ScenarioCategory;
  profile: OpponentProfileId;
  difficulty: 'all' | Difficulty;
  challengeLength: 10 | 20 | 50;
}
export interface GeneratedResult {
  id: string;
  sessionId: string;
  scenarioId: string;
  seed: string;
  title: string;
  actionId: string;
  actionLabel: string;
  grade: ActionGrade;
  street: Street;
  category: ScenarioCategory;
  profile: OpponentProfileId;
  difficulty: Difficulty;
  scored: boolean;
  source: Pick<StrategySource, 'category' | 'label'>;
  createdAt: string;
  /** Only the terminal, modeled river action EV supports this value. */
  evLoss?: number;
}
export interface GeneratedSession {
  id: string;
  mode: GeneratedSessionMode;
  index: number;
  answered: number;
  limit: 10 | 20 | 50 | null;
  completed: boolean;
  startedAt: string;
}
export interface GeneratedSessionSummary {
  id: string;
  mode: GeneratedSessionMode;
  startedAt: string;
  completedAt: string;
  completed: boolean;
  decisions: number;
  scored: number;
  heuristic: number;
  preferred: number;
  defensible: number;
  mistaken: number;
}
interface GeneratedPersistedState {
  preferences: GeneratedPreferences;
  results: GeneratedResult[];
  sessions: GeneratedSessionSummary[];
  currentSession: GeneratedSession | null;
  currentScenario: Scenario | null;
  selectedActionId: string | null;
  pendingRequest: GenerationOptions | null;
  lastSituation: string | null;
  lastSeed: string | null;
}
export interface GeneratedStore extends GeneratedPersistedState {
  busy: boolean;
  error: string | null;
  storageAvailable: boolean;
  replaying: boolean;
  startSession: (
    mode?: GeneratedSessionMode,
    preferences?: Partial<GeneratedPreferences>,
  ) => Promise<boolean>;
  submitAction: (actionId: string) => boolean;
  nextScenario: () => Promise<boolean>;
  retryGeneration: () => Promise<boolean>;
  replayScenario: () => boolean;
  endSession: () => void;
  closeSession: () => void;
  updatePreferences: (preferences: Partial<GeneratedPreferences>) => void;
  clearProgress: () => void;
}

export const defaultGeneratedPreferences: GeneratedPreferences = {
  mode: 'endless',
  street: 'all',
  category: 'all',
  profile: 'balanced',
  difficulty: 'all',
  challengeLength: 10,
};
/** Kept independent of the generator bundle so startup does not evaluate it. */
export const generatedCategoryStreets: Record<ScenarioCategory, readonly Street[]> = {
  'blind-defense': ['preflop'],
  'facing-three-bet': ['preflop'],
  'river-bluff-catching': ['river'],
  'pot-odds': ['preflop', 'flop', 'turn', 'river'],
  'drawing-odds': ['flop', 'turn'],
  'bluff-math': ['river'],
};
const streets: readonly string[] = ['preflop', 'flop', 'turn', 'river'];
const profiles: readonly string[] = ['balanced', 'tight', 'aggressive', 'recreational'];
const difficulties: readonly string[] = ['beginner', 'intermediate', 'advanced'];
const modes: readonly string[] = ['endless', 'focused', 'challenge', 'weakness'];
const grades: readonly string[] = ['preferred', 'defensible', 'mistaken'];
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 200): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const date = (value: unknown): value is string =>
  text(value, 40) && Number.isFinite(Date.parse(value));
const integer = (value: unknown, max = 1_000_000): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
const includes = <T extends string>(values: readonly string[], value: unknown): value is T =>
  typeof value === 'string' && values.includes(value);
const category = (value: unknown): value is ScenarioCategory =>
  typeof value === 'string' && Object.hasOwn(generatedCategoryStreets, value);

export function compatibleGeneratedCategories(street: 'all' | Street): ScenarioCategory[] {
  return (Object.keys(generatedCategoryStreets) as ScenarioCategory[]).filter(
    (id) => street === 'all' || generatedCategoryStreets[id].includes(street),
  );
}

/** Card order, a new ID, or a new seed alone do not make a situation fresh. */
export function generatedSituationFingerprint(scenario: Scenario): string {
  const cards = (values: Scenario['board']) =>
    values.map((card) => `${card.rank}:${card.suit}`).sort();
  return JSON.stringify([
    scenario.street,
    cards(scenario.heroCards),
    cards(scenario.board),
    scenario.currentPot,
    scenario.toCall,
  ]);
}

function cleanPreferences(value: unknown): GeneratedPreferences {
  const input = record(value) ? value : {};
  const result: GeneratedPreferences = {
    mode: includes<GeneratedSessionMode>(modes, input.mode) ? input.mode : 'endless',
    street:
      input.street === 'all' || includes<Street>(streets, input.street) ? input.street : 'all',
    category: input.category === 'all' || category(input.category) ? input.category : 'all',
    profile: includes<OpponentProfileId>(profiles, input.profile) ? input.profile : 'balanced',
    difficulty:
      input.difficulty === 'all' || includes<Difficulty>(difficulties, input.difficulty)
        ? input.difficulty
        : 'all',
    challengeLength:
      input.challengeLength === 20 || input.challengeLength === 50 ? input.challengeLength : 10,
  };
  if (
    result.category !== 'all' &&
    !compatibleGeneratedCategories(result.street).includes(result.category)
  )
    result.category = 'all';
  return result;
}

function cleanRequest(value: unknown): GenerationOptions | null {
  if (!record(value) || !text(value.seed, 256)) return null;
  if (
    (value.street !== undefined && !includes<Street>(streets, value.street)) ||
    (value.category !== undefined && !category(value.category)) ||
    (value.profile !== undefined && !includes<OpponentProfileId>(profiles, value.profile)) ||
    (value.difficulty !== undefined && !includes<Difficulty>(difficulties, value.difficulty))
  )
    return null;
  const request = value as unknown as GenerationOptions;
  if (
    request.category &&
    request.street &&
    !generatedCategoryStreets[request.category].includes(request.street)
  )
    return null;
  return {
    seed: request.seed,
    street: request.street,
    category: request.category,
    profile: request.profile,
    difficulty: request.difficulty,
  };
}

function requestFromScenario(value: unknown): GenerationOptions | null {
  if (!record(value) || !record(value.generated) || value.generated.version !== 1) return null;
  return cleanRequest({
    seed: value.generated.seed,
    street: value.street,
    category: value.generated.category,
    profile: value.generated.profile,
    difficulty: value.difficulty,
  });
}

function cleanResults(value: unknown): GeneratedResult[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>(),
    attempts = new Set<string>();
  return value.slice(-GENERATED_HISTORY_LIMIT).flatMap((item): GeneratedResult[] => {
    if (
      !record(item) ||
      !text(item.id) ||
      !text(item.sessionId) ||
      !text(item.scenarioId, 800) ||
      !text(item.seed, 256) ||
      !text(item.title) ||
      !text(item.actionId) ||
      !text(item.actionLabel) ||
      !includes<ActionGrade>(grades, item.grade) ||
      !includes<Street>(streets, item.street) ||
      !category(item.category) ||
      !generatedCategoryStreets[item.category].includes(item.street) ||
      !includes<OpponentProfileId>(profiles, item.profile) ||
      !includes<Difficulty>(difficulties, item.difficulty) ||
      typeof item.scored !== 'boolean' ||
      !date(item.createdAt) ||
      !record(item.source) ||
      !text(item.source.label) ||
      !['illustrative', 'mathematical-model'].includes(String(item.source.category))
    )
      return [];
    const mathematical = item.category !== 'blind-defense' && item.category !== 'facing-three-bet';
    if (
      item.scored !== mathematical ||
      item.source.category !== (mathematical ? 'mathematical-model' : 'illustrative')
    )
      return [];
    const attempt = `${item.sessionId}:${item.seed}`;
    if (ids.has(item.id) || attempts.has(attempt)) return [];
    ids.add(item.id);
    attempts.add(attempt);
    const evLoss =
      mathematical &&
      item.category === 'river-bluff-catching' &&
      typeof item.evLoss === 'number' &&
      Number.isFinite(item.evLoss) &&
      item.evLoss >= 0 &&
      item.evLoss <= 1_000_000
        ? item.evLoss
        : undefined;
    return [
      {
        id: item.id,
        sessionId: item.sessionId,
        scenarioId: item.scenarioId,
        seed: item.seed,
        title: item.title,
        actionId: item.actionId,
        actionLabel: item.actionLabel,
        grade: item.grade,
        street: item.street,
        category: item.category,
        profile: item.profile,
        difficulty: item.difficulty,
        scored: item.scored,
        source: {
          category: mathematical ? 'mathematical-model' : 'illustrative',
          label: item.source.label,
        },
        createdAt: item.createdAt,
        ...(evLoss === undefined ? {} : { evLoss }),
      },
    ];
  });
}

export function selectGeneratedStatistics(results: readonly GeneratedResult[]) {
  const scored = results.filter((result) => result.scored);
  const preferred = scored.filter((result) => result.grade === 'preferred').length;
  const defensible = scored.filter((result) => result.grade === 'defensible').length;
  return {
    total: results.length,
    scored: scored.length,
    heuristic: results.length - scored.length,
    preferred,
    defensible,
    mistaken: scored.length - preferred - defensible,
    accuracy: scored.length ? Math.round((100 * (preferred + defensible)) / scored.length) : null,
    evLoss: scored.reduce((sum, result) => sum + (result.evLoss ?? 0), 0),
  };
}

export function generatedWeaknesses(
  results: readonly GeneratedResult[],
  street: 'all' | Street = 'all',
) {
  return compatibleGeneratedCategories(street)
    .flatMap((id) => {
      const attempts = results.filter(
        (result) =>
          result.scored && result.category === id && (street === 'all' || result.street === street),
      );
      if (!attempts.length) return [];
      const mistakes = attempts.filter((result) => result.grade === 'mistaken').length;
      return [
        {
          category: id,
          attempts: attempts.length,
          mistakes,
          errorRate: mistakes / attempts.length,
        },
      ];
    })
    .sort(
      (a, b) =>
        b.errorRate - a.errorRate ||
        b.mistakes - a.mistakes ||
        b.attempts - a.attempts ||
        a.category.localeCompare(b.category),
    );
}

function summary(
  session: GeneratedSession,
  results: GeneratedResult[],
  completedAt: string,
): GeneratedSessionSummary {
  const stats = selectGeneratedStatistics(
    results.filter((result) => result.sessionId === session.id),
  );
  return {
    id: session.id,
    mode: session.mode,
    startedAt: session.startedAt,
    completedAt,
    completed: session.completed,
    decisions: session.answered,
    scored: stats.scored,
    heuristic: stats.heuristic,
    preferred: stats.preferred,
    defensible: stats.defensible,
    mistaken: stats.mistaken,
  };
}

function cleanSession(value: unknown, results: GeneratedResult[]): GeneratedSession | null {
  if (
    !record(value) ||
    !text(value.id) ||
    !includes<GeneratedSessionMode>(modes, value.mode) ||
    !date(value.startedAt) ||
    !integer(value.index) ||
    !integer(value.answered) ||
    typeof value.completed !== 'boolean' ||
    (value.limit !== null && value.limit !== 10 && value.limit !== 20 && value.limit !== 50)
  )
    return null;
  if (value.mode === 'challenge' ? value.limit === null : value.limit !== null) return null;
  const attempts = results.filter((result) => result.sessionId === value.id).length;
  // The current session is the newest uninterrupted run. Older sessions are
  // evicted first, so its attempts must fill the retained suffix exactly.
  if (
    attempts !== Math.min(value.answered, GENERATED_HISTORY_LIMIT) ||
    results.slice(results.length - attempts).some((result) => result.sessionId !== value.id) ||
    value.answered > value.index + 1 ||
    value.index > value.answered ||
    (value.limit !== null && (value.answered > value.limit || value.index >= value.limit))
  )
    return null;
  return {
    id: value.id,
    mode: value.mode,
    index: value.index,
    answered: value.answered,
    limit: value.limit,
    completed: value.completed,
    startedAt: value.startedAt,
  };
}

function initialPersisted(): GeneratedPersistedState {
  return {
    preferences: { ...defaultGeneratedPreferences },
    results: [],
    sessions: [],
    currentSession: null,
    currentScenario: null,
    selectedActionId: null,
    pendingRequest: null,
    lastSituation: null,
    lastSeed: null,
  };
}

/** Saved scenario bodies are deliberately discarded; the seeded engine reconstructs them. */
export function sanitizeGeneratedState(value: unknown): GeneratedPersistedState {
  if (!record(value)) return initialPersisted();
  const results = cleanResults(value.results);
  let currentSession = cleanSession(value.currentSession, results);
  const pendingRequest =
    requestFromScenario(value.currentScenario) ?? cleanRequest(value.pendingRequest);
  if (currentSession && !currentSession.completed && !pendingRequest) currentSession = null;
  if (currentSession && !currentSession.completed && pendingRequest) {
    const attempted = results.some(
      (result) => result.sessionId === currentSession!.id && result.seed === pendingRequest.seed,
    );
    if (attempted !== (currentSession.answered === currentSession.index + 1)) currentSession = null;
  }
  const seen = new Set<string>();
  const sessions = (Array.isArray(value.sessions) ? value.sessions : [])
    .slice(0, SESSION_HISTORY_LIMIT)
    .flatMap((item): GeneratedSessionSummary[] => {
      if (
        !record(item) ||
        !text(item.id) ||
        seen.has(item.id) ||
        !date(item.startedAt) ||
        !date(item.completedAt) ||
        !includes<GeneratedSessionMode>(modes, item.mode) ||
        typeof item.completed !== 'boolean' ||
        !integer(item.decisions)
      )
        return [];
      seen.add(item.id);
      const stats = selectGeneratedStatistics(
        results.filter((result) => result.sessionId === item.id),
      );
      return [
        {
          id: item.id,
          mode: item.mode,
          startedAt: item.startedAt,
          completedAt: item.completedAt,
          completed: item.completed,
          decisions: Math.max(stats.total, item.decisions),
          scored: stats.scored,
          heuristic: stats.heuristic,
          preferred: stats.preferred,
          defensible: stats.defensible,
          mistaken: stats.mistaken,
        },
      ];
    });
  return {
    preferences: cleanPreferences(value.preferences),
    results,
    sessions,
    currentSession,
    currentScenario: null,
    selectedActionId:
      currentSession && text(value.selectedActionId) ? value.selectedActionId : null,
    pendingRequest: currentSession ? pendingRequest : null,
    lastSituation: text(value.lastSituation, 500) ? value.lastSituation : null,
    lastSeed: text(value.lastSeed, 256) ? value.lastSeed : null,
  };
}

type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface GeneratedStoreOptions {
  generate?: (options: GenerationOptions, signal?: AbortSignal) => Promise<Scenario>;
  storage?: StorageAccess;
}

export function createGeneratedStorage(
  getStorage: () => StorageAccess | undefined,
  onAvailabilityChange: (available: boolean) => void,
): PersistStorage<GeneratedPersistedState> {
  return {
    getItem(name) {
      try {
        const storage = getStorage();
        if (!storage) {
          onAvailabilityChange(false);
          return null;
        }
        const raw = storage.getItem(name);
        if (!raw || raw.length > 6_000_000) return null;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return null;
        }
        if (!record(parsed) || parsed.version !== STORAGE_VERSION) return null;
        return { version: STORAGE_VERSION, state: sanitizeGeneratedState(parsed.state) };
      } catch {
        onAvailabilityChange(false);
        return null;
      }
    },
    setItem(name, value) {
      try {
        const storage = getStorage();
        if (!storage) {
          onAvailabilityChange(false);
          return;
        }
        storage.setItem(name, JSON.stringify(value));
        onAvailabilityChange(true);
      } catch {
        onAvailabilityChange(false);
      }
    },
    removeItem(name) {
      try {
        getStorage()?.removeItem(name);
      } catch {
        onAvailabilityChange(false);
      }
    },
  };
}

let idSequence = 0;
function uniqueId(prefix: string) {
  idSequence += 1;
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${idSequence.toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

function resultFor(
  scenario: Scenario,
  actionId: string,
  sessionId: string,
  existing?: GeneratedResult,
): GeneratedResult | null {
  const generated = scenario.generated;
  const action = getDecisionOptions(scenario).find((option) => option.id === actionId);
  if (!generated || !action) return null;
  let evLoss: number | undefined;
  if (
    generated.scored &&
    generated.category === 'river-bluff-catching' &&
    'kind' in action &&
    (action.kind === 'call' || action.kind === 'fold') &&
    Number.isFinite(generated.math?.callEv)
  ) {
    const callEv = generated.math!.callEv!,
      foldEv = generated.math?.foldEv ?? 0;
    evLoss = Math.max(0, Math.max(callEv, foldEv) - (action.kind === 'call' ? callEv : foldEv));
  }
  return {
    id: existing?.id ?? uniqueId('result'),
    sessionId,
    scenarioId: scenario.id,
    seed: generated.seed,
    title: scenario.title,
    actionId: action.id,
    actionLabel: action.label,
    grade: action.grade,
    street: scenario.street,
    category: generated.category,
    profile: generated.profile,
    difficulty: scenario.difficulty,
    scored: generated.scored,
    source: { category: scenario.source.category, label: scenario.source.label },
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    ...(evLoss === undefined ? {} : { evLoss }),
  };
}

export function createGeneratedStore(options: GeneratedStoreOptions = {}) {
  const generate = options.generate ?? generateScenarioAsync;
  const getStorage = () => options.storage ?? globalThis.localStorage;
  let controller: AbortController | null = null;
  let operation = 0;
  const store = create<GeneratedStore>()(
    persist(
      (set, get) => {
        const archive = (
          session: GeneratedSession | null,
          state: GeneratedStore,
        ): GeneratedSessionSummary[] => {
          if (!session || !session.answered) return state.sessions;
          return [
            summary(session, state.results, new Date().toISOString()),
            ...state.sessions.filter((item) => item.id !== session.id),
          ].slice(0, SESSION_HISTORY_LIMIT);
        };
        const request = (
          session: GeneratedSession,
          preferences: GeneratedPreferences,
          results: GeneratedResult[],
        ): GenerationOptions => {
          let selectedCategory = preferences.category === 'all' ? undefined : preferences.category;
          if (!selectedCategory && session.mode === 'weakness')
            selectedCategory = generatedWeaknesses(results, preferences.street).find(
              (item) => item.mistakes > 0,
            )?.category;
          return {
            seed: uniqueId('hand'),
            street: preferences.street === 'all' ? undefined : preferences.street,
            category: selectedCategory,
            profile: preferences.profile,
            difficulty:
              preferences.difficulty === 'all'
                ? (['beginner', 'intermediate', 'advanced'][session.index % 3] as Difficulty)
                : preferences.difficulty,
          };
        };
        const run = async (input: GenerationOptions): Promise<boolean> => {
          const token = ++operation;
          controller?.abort();
          controller = new AbortController();
          set({ busy: true, error: null, pendingRequest: input });
          try {
            let candidate = input;
            let scenario: Scenario | undefined;
            for (let attempt = 0; attempt <= GENERATED_DUPLICATE_RETRIES; attempt += 1) {
              scenario = await generate(candidate, controller.signal);
              if (token !== operation) return false;
              if (scenario.generated?.seed !== candidate.seed)
                throw new Error('The prepared hand did not match this session. Retry to continue.');
              const previous = get();
              if (
                candidate.seed === previous.lastSeed ||
                generatedSituationFingerprint(scenario) !== previous.lastSituation
              )
                break;
              if (attempt === GENERATED_DUPLICATE_RETRIES)
                throw new Error('Could not find a fresh situation. Retry to continue.');
              candidate = { ...input, seed: `${input.seed.slice(0, 230)}:fresh:${attempt + 1}` };
              set({ pendingRequest: candidate });
            }
            if (!scenario) throw new Error('Could not prepare this hand. Retry to continue.');
            const state = get(),
              session = state.currentSession;
            if (!session || session.completed)
              throw new Error('The prepared hand did not match this session. Retry to continue.');
            const acceptedScenario = scenario;
            const existing = state.results.find(
              (result) => result.sessionId === session.id && result.seed === candidate.seed,
            );
            const canonical =
              existing && resultFor(scenario, existing.actionId, session.id, existing);
            // Recompute this hand's saved result; never use stored cards or answer grades.
            const results = existing
              ? state.results.flatMap((result) =>
                  result.id !== existing.id ? [result] : canonical ? [canonical] : [],
                )
              : state.results;
            const selectedActionId =
              existing &&
              canonical &&
              getDecisionOptions(acceptedScenario).some(
                (action) => action.id === state.selectedActionId,
              )
                ? state.selectedActionId
                : null;
            set({
              currentScenario: scenario,
              pendingRequest: requestFromScenario(scenario),
              results,
              currentSession:
                existing && !canonical ? { ...session, answered: session.index } : session,
              selectedActionId,
              replaying: !!canonical && selectedActionId === null,
              busy: false,
              error: null,
              lastSituation: generatedSituationFingerprint(scenario),
              lastSeed: candidate.seed,
            });
            return true;
          } catch (error) {
            if (token !== operation) return false;
            set({
              busy: false,
              error:
                error instanceof Error
                  ? error.message.slice(0, 240)
                  : 'Could not prepare this hand. Retry to continue.',
            });
            return false;
          }
        };
        return {
          ...initialPersisted(),
          busy: false,
          error: null,
          storageAvailable: true,
          replaying: false,
          async startSession(mode, updates = {}) {
            const state = get();
            if (state.busy || (mode !== undefined && !modes.includes(mode))) return false;
            const preferences = cleanPreferences({
              ...state.preferences,
              ...updates,
              mode: mode ?? updates.mode ?? state.preferences.mode,
            });
            const session: GeneratedSession = {
              id: uniqueId('session'),
              mode: preferences.mode,
              index: 0,
              answered: 0,
              limit: preferences.mode === 'challenge' ? preferences.challengeLength : null,
              completed: false,
              startedAt: new Date().toISOString(),
            };
            const input = request(session, preferences, state.results);
            set({
              preferences,
              currentSession: session,
              sessions: archive(state.currentSession, state),
              currentScenario: null,
              selectedActionId: null,
              replaying: false,
              pendingRequest: input,
            });
            return run(input);
          },
          submitAction(actionId) {
            const state = get(),
              session = state.currentSession,
              scenario = state.currentScenario;
            if (
              state.busy ||
              state.error ||
              !session ||
              session.completed ||
              !scenario ||
              state.selectedActionId !== null
            )
              return false;
            const result = resultFor(scenario, actionId, session.id);
            if (!result) return false;
            if (
              state.results.some(
                (item) => item.sessionId === session.id && item.seed === scenario.generated?.seed,
              )
            ) {
              set({ selectedActionId: actionId, replaying: false });
              return true;
            }
            set({
              results: [...state.results, result].slice(-GENERATED_HISTORY_LIMIT),
              selectedActionId: actionId,
              replaying: false,
              currentSession: { ...session, answered: session.answered + 1 },
            });
            return true;
          },
          async nextScenario() {
            const state = get(),
              session = state.currentSession;
            if (
              state.busy ||
              state.error ||
              !session ||
              session.completed ||
              state.selectedActionId === null
            )
              return false;
            if (session.limit !== null && session.answered >= session.limit) {
              get().endSession();
              return true;
            }
            const next = { ...session, index: session.index + 1 };
            const input = request(next, state.preferences, state.results);
            set({
              currentSession: next,
              currentScenario: null,
              selectedActionId: null,
              replaying: false,
              pendingRequest: input,
            });
            return run(input);
          },
          async retryGeneration() {
            const state = get();
            if (
              state.busy ||
              !state.currentSession ||
              state.currentSession.completed ||
              !state.pendingRequest
            )
              return false;
            return run(state.pendingRequest);
          },
          replayScenario() {
            const state = get();
            if (
              state.busy ||
              !state.currentSession ||
              state.currentSession.completed ||
              !state.currentScenario ||
              state.selectedActionId === null
            )
              return false;
            set({ selectedActionId: null, replaying: true });
            return true;
          },
          endSession() {
            const state = get();
            if (!state.currentSession || state.currentSession.completed) return;
            ++operation;
            controller?.abort();
            const session = { ...state.currentSession, completed: true };
            set({
              currentSession: session,
              sessions: archive(session, state),
              busy: false,
              error: null,
              replaying: false,
            });
          },
          closeSession() {
            const state = get();
            ++operation;
            controller?.abort();
            set({
              sessions: archive(state.currentSession, state),
              currentSession: null,
              currentScenario: null,
              selectedActionId: null,
              pendingRequest: null,
              busy: false,
              error: null,
              replaying: false,
            });
          },
          updatePreferences(updates) {
            set({ preferences: cleanPreferences({ ...get().preferences, ...updates }) });
          },
          clearProgress() {
            ++operation;
            controller?.abort();
            set({
              ...initialPersisted(),
              preferences: get().preferences,
              busy: false,
              error: null,
              replaying: false,
            });
          },
        };
      },
      {
        name: GENERATED_STORAGE_KEY,
        version: STORAGE_VERSION,
        storage: createGeneratedStorage(getStorage, (available) =>
          queueMicrotask(() => {
            if (store.getState().storageAvailable !== available)
              store.setState({ storageAvailable: available });
          }),
        ),
        partialize: ({
          preferences,
          results,
          sessions,
          currentSession,
          currentScenario,
          selectedActionId,
          pendingRequest,
          lastSituation,
          lastSeed,
        }) => ({
          preferences,
          results,
          sessions,
          currentSession,
          currentScenario,
          selectedActionId,
          pendingRequest,
          lastSituation,
          lastSeed,
        }),
        merge: (saved, current) =>
          saved === undefined ? current : { ...current, ...sanitizeGeneratedState(saved) },
        onRehydrateStorage: () => () =>
          queueMicrotask(() => {
            const state = store.getState();
            if (
              state.currentSession &&
              !state.currentSession.completed &&
              !state.currentScenario &&
              state.pendingRequest &&
              !state.busy
            )
              void state.retryGeneration();
          }),
      },
    ),
  );
  return store;
}

export const useGeneratedStore = createGeneratedStore();
