import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronDown,
  Focus,
  Infinity as InfinityIcon,
  ListChecks,
  ShieldCheck,
  SlidersHorizontal,
  Spade,
  Target,
  TrendingUp,
} from 'lucide-react';
import { scenarios } from '../../data/scenarios';
import type {
  ActionGrade,
  Difficulty,
  OpponentProfileId,
  ScenarioCategory,
  Street,
} from '../../types/poker';
import { Button, EmptyState } from '../../components/ui/primitives';
import { useTrainingStore } from './store';
import {
  GENERATED_HISTORY_LIMIT,
  generatedCategoryStreets,
  generatedWeaknesses,
  selectGeneratedStatistics,
  useGeneratedStore,
} from './generated-store';
import type { GeneratedResult, GeneratedSessionMode } from './generated-store';

const gradeLabels: Record<ActionGrade, string> = {
  preferred: 'Preferred',
  defensible: 'Defensible',
  mistaken: 'Mistaken',
};
const categoryLabels: Record<ScenarioCategory, string> = {
  'blind-defense': 'Blind defense',
  'facing-three-bet': 'Facing a three-bet',
  'river-bluff-catching': 'River bluff catching',
  'pot-odds': 'Pot odds',
  'drawing-odds': 'Drawing odds',
  'bluff-math': 'Bluff mathematics',
};
const scenarioCategories = (Object.keys(generatedCategoryStreets) as ScenarioCategory[]).map(
  (id) => ({ id, label: categoryLabels[id], streets: generatedCategoryStreets[id] }),
);
const opponentProfiles: { id: OpponentProfileId; label: string; description: string }[] = [
  {
    id: 'balanced',
    label: 'Baseline model',
    description: 'Broad authored heads-up ranges. An educational baseline, not solved equilibrium.',
  },
  {
    id: 'tight',
    label: 'Tight',
    description: 'Narrower preflop ranges and less bluff weight in modeled river bets.',
  },
  {
    id: 'aggressive',
    label: 'Aggressive',
    description: 'Wider preflop pressure and more bluff weight in modeled river bets.',
  },
  {
    id: 'recreational',
    label: 'Recreational',
    description: 'A broad, less selective range, with medium-strength hands among river bets.',
  },
];
const streetChoices: { id: 'all' | Street; label: string }[] = [
  { id: 'all', label: 'All streets' },
  { id: 'preflop', label: 'Preflop' },
  { id: 'flop', label: 'Flop' },
  { id: 'turn', label: 'Turn' },
  { id: 'river', label: 'River' },
];
const modes = [
  {
    id: 'endless' as const,
    label: 'Endless',
    description: 'Fresh hands. Your pace.',
    icon: InfinityIcon,
  },
  { id: 'focused' as const, label: 'Focused', description: 'One concept at a time.', icon: Target },
  {
    id: 'challenge' as const,
    label: 'Challenge',
    description: '10, 20, or 50 decisions.',
    icon: ListChecks,
  },
  {
    id: 'weakness' as const,
    label: 'Weakness',
    description: 'Work on your missed spots.',
    icon: Focus,
  },
];
const categoryLabel = (id: ScenarioCategory) =>
  scenarioCategories.find((category) => category.id === id)?.label ?? id;
const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
const percent = (value: number | null) => (value === null ? '—' : `${value}%`);

export function PracticeSetup({
  busy,
}: {
  onStart: (mode?: GeneratedSessionMode) => void;
  busy: boolean;
}) {
  const { preferences, updatePreferences, results } = useGeneratedStore();
  const availableCategories = scenarioCategories.filter(
    (category) => preferences.street === 'all' || category.streets.includes(preferences.street),
  );
  const profile = opponentProfiles.find((item) => item.id === preferences.profile)!;
  const weakness = generatedWeaknesses(results, preferences.street).find(
    (item) => item.mistakes > 0,
  );
  const chooseMode = (mode: GeneratedSessionMode) => {
    if (mode === 'weakness') updatePreferences({ mode, category: 'all' });
    else if (mode === 'focused' && preferences.street === 'all' && preferences.category === 'all') {
      updatePreferences({ mode, street: 'river', category: 'river-bluff-catching' });
    } else updatePreferences({ mode });
  };
  return (
    <section className="practice-setup" aria-label="Practice setup">
      <div className="practice-mode-grid" aria-label="Practice mode">
        {modes.map((mode) => (
          <button
            key={mode.id}
            className={`practice-mode ${preferences.mode === mode.id ? 'mode-selected' : ''}`}
            aria-pressed={preferences.mode === mode.id}
            onClick={() => chooseMode(mode.id)}
            disabled={busy}
          >
            <mode.icon size={19} strokeWidth={1.7} />
            <span>
              <strong>{mode.label}</strong>
              <small>{mode.description}</small>
            </span>
            {preferences.mode === mode.id && <Check className="mode-check" size={14} />}
          </button>
        ))}
      </div>
      <details className="practice-options">
        <summary>
          <SlidersHorizontal size={16} />
          <span>
            Customize your practice
            <small>
              {streetChoices.find((street) => street.id === preferences.street)?.label} ·{' '}
              {preferences.mode === 'weakness'
                ? 'Personalized focus'
                : preferences.category === 'all'
                  ? 'Mixed concepts'
                  : categoryLabel(preferences.category)}{' '}
              · {profile.label}
            </small>
          </span>
          <ChevronDown size={16} />
        </summary>
        <div className="practice-fields">
          <label>
            Training street
            <select
              aria-label="Training street"
              value={preferences.street}
              disabled={busy}
              onChange={(event) =>
                updatePreferences({ street: event.target.value as 'all' | Street })
              }
            >
              {streetChoices.map((street) => (
                <option key={street.id} value={street.id}>
                  {street.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Training concept
            <select
              aria-label="Training concept"
              value={preferences.category}
              disabled={busy || preferences.mode === 'weakness'}
              onChange={(event) =>
                updatePreferences({ category: event.target.value as 'all' | ScenarioCategory })
              }
            >
              <option value="all">
                {preferences.mode === 'weakness'
                  ? 'Chosen from your results'
                  : 'All supported concepts'}
              </option>
              {availableCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Opponent profile
            <select
              aria-label="Opponent profile"
              value={preferences.profile}
              disabled={busy}
              onChange={(event) =>
                updatePreferences({ profile: event.target.value as OpponentProfileId })
              }
            >
              {opponentProfiles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Difficulty
            <select
              aria-label="Difficulty"
              value={preferences.difficulty}
              disabled={busy}
              onChange={(event) =>
                updatePreferences({ difficulty: event.target.value as 'all' | Difficulty })
              }
            >
              <option value="all">Mixed difficulty</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </label>
        </div>
        <p className="practice-model-note">
          <ShieldCheck size={15} />
          <span>
            {profile.description} Only concepts supported on your selected street are offered.
          </span>
        </p>
      </details>
      {preferences.mode === 'challenge' && (
        <div className="challenge-length">
          <span>Session length</span>
          <div aria-label="Challenge length">
            {([10, 20, 50] as const).map((length) => (
              <button
                key={length}
                aria-pressed={preferences.challengeLength === length}
                disabled={busy}
                onClick={() => updatePreferences({ challengeLength: length })}
              >
                {length} spots
              </button>
            ))}
          </div>
        </div>
      )}
      {preferences.mode === 'weakness' && (
        <p className="setup-context">
          {weakness
            ? `Starting focus: ${categoryLabel(weakness.category)} — ${weakness.mistakes} missed in ${weakness.attempts} scored attempts. Your focus adapts as you practice.`
            : 'Build a baseline first. Fresh hands will reveal which mathematical concepts need more practice.'}
        </p>
      )}
    </section>
  );
}

function ScoreBreakdown({
  title,
  groups,
}: {
  title: string;
  groups: { label: string; results: GeneratedResult[]; extraHeuristic?: number }[];
}) {
  return (
    <section className="content-panel score-breakdown">
      <div className="section-heading">
        <h2>{title}</h2>
        <span>Math decisions only</span>
      </div>
      {groups.map((group) => {
        const stats = selectGeneratedStatistics(group.results);
        const heuristic = stats.heuristic + (group.extraHeuristic ?? 0);
        return (
          <div className="score-breakdown-row" key={group.label}>
            <div>
              <strong>{group.label}</strong>
              <span>
                {percent(stats.accuracy)}{' '}
                <small>
                  · {stats.scored} scored{heuristic ? ` · ${heuristic} guidance` : ''}
                </small>
              </span>
            </div>
            <div
              className="performance-bar"
              aria-label={`${group.label}: ${stats.preferred} preferred, ${stats.defensible} defensible, ${stats.mistaken} mistaken mathematical decisions`}
            >
              {(['preferred', 'defensible', 'mistaken'] as const).map((grade) => (
                <span
                  key={grade}
                  className={`bar-${grade}`}
                  style={{ width: `${stats.scored ? (stats[grade] / stats.scored) * 100 : 0}%` }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function MathTrend({ results }: { results: GeneratedResult[] }) {
  const scored = results
    .filter((result) => result.scored)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const split = Math.floor(scored.length / 2);
  const early = selectGeneratedStatistics(scored.slice(0, split));
  const recent = selectGeneratedStatistics(scored.slice(split));
  const change =
    early.accuracy !== null && recent.accuracy !== null ? recent.accuracy - early.accuracy : 0;
  return (
    <section className="content-panel math-trend">
      <div className="section-heading">
        <h2>Your recent direction</h2>
        <TrendingUp size={19} />
      </div>
      {scored.length < 4 ? (
        <p className="panel-description">
          Complete {4 - scored.length} more scored{' '}
          {4 - scored.length === 1 ? 'decision' : 'decisions'} to compare the earlier and later
          halves of your practice.
        </p>
      ) : (
        <>
          <div className="trend-comparison">
            <div>
              <span>Earlier half</span>
              <strong>{percent(early.accuracy)}</strong>
              <small>{early.scored} math decisions</small>
            </div>
            <ArrowRight size={19} />
            <div>
              <span>Recent half</span>
              <strong>{percent(recent.accuracy)}</strong>
              <small>{recent.scored} math decisions</small>
            </div>
          </div>
          <p className="chart-footnote">
            {change > 0
              ? `Up ${change} percentage points`
              : change < 0
                ? `Down ${Math.abs(change)} percentage points`
                : 'The same accuracy'}{' '}
            across these samples. Difficulty and concept mix can differ; this is an observed trend,
            not a prediction.
          </p>
        </>
      )}
    </section>
  );
}

export function GeneratedProgress({
  onStart,
  onWeakness,
}: {
  onStart: () => void;
  onWeakness: () => void;
}) {
  const generated = useGeneratedStore();
  const legacy = useTrainingStore();
  const stats = selectGeneratedStatistics(generated.results);
  const modeledRiverAttempts = generated.results.filter(
    (result) =>
      result.scored && result.category === 'river-bluff-catching' && result.evLoss !== undefined,
  ).length;
  const weaknesses = generatedWeaknesses(generated.results)
    .filter((item) => item.mistakes > 0)
    .slice(0, 4);
  const heuristic = stats.heuristic + legacy.results.length;
  const sessions = [
    ...generated.sessions.map((session) => ({
      id: session.id,
      label: `${session.mode} practice`,
      at: session.completedAt,
      decisions: session.decisions,
      detail: `${session.scored} math · ${session.heuristic} guidance`,
      completed: session.completed,
    })),
    ...legacy.sessions.map((session) => ({
      id: session.id,
      label: 'Curated practice',
      at: session.completedAt,
      decisions: session.decisions,
      detail: 'Illustrative guidance',
      completed: session.completed,
    })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const practiceWeakness = () => {
    generated.updatePreferences({ street: 'all', category: 'all' });
    onWeakness();
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow page-eyebrow">THE LONG GAME</div>
          <h1>
            See your edge take shape<span>.</span>
          </h1>
          <p>First attempts, clear sources, and something useful to work on.</p>
        </div>
        <Button variant="secondary" onClick={practiceWeakness}>
          <Focus size={16} />
          Practice weaknesses
        </Button>
      </div>
      {stats.total + legacy.results.length === 0 ? (
        <EmptyState
          icon={<BarChart3 size={27} />}
          title="Your story starts with one decision."
          action={
            <Button onClick={onStart}>
              Start Training
              <ArrowRight size={17} />
            </Button>
          }
        >
          Fresh hands build a useful picture of your play. Mathematical results and educational
          guidance are tracked separately.
        </EmptyState>
      ) : (
        <>
          <div className="metric-grid">
            <div className="metric">
              <span>Sessions recorded</span>
              <strong>{sessions.length}</strong>
              <small>Finished and ended sessions</small>
            </div>
            <div className="metric">
              <span>First attempts</span>
              <strong>{stats.total + legacy.results.length}</strong>
              <small>Replays never add another result</small>
            </div>
            <div className="metric">
              <span>Math accuracy</span>
              <strong>{percent(stats.accuracy)}</strong>
              <small>
                {stats.preferred + stats.defensible} accepted / {stats.scored} scored decisions
              </small>
            </div>
            <div className="metric">
              <span>Guidance decisions</span>
              <strong>{heuristic}</strong>
              <small>Excluded from math accuracy</small>
            </div>
          </div>
          <p className="score-definition">
            <ShieldCheck size={15} />
            Math accuracy counts preferred or defensible answers under each stated mathematical
            model. It is not a GTO score.
          </p>
          {modeledRiverAttempts > 0 && (
            <p className="ev-model-summary">
              <strong>Modeled river EV loss: {stats.evLoss.toFixed(2)} BB</strong>
              <span>
                Across {modeledRiverAttempts} scored river{' '}
                {modeledRiverAttempts === 1 ? 'decision' : 'decisions'}, compared with the best
                supported action under each exercise’s stated range. Educational model values in
                practice chips, not real profit or loss.
              </span>
            </p>
          )}
          <div className="progress-grid">
            <MathTrend results={generated.results} />
            <section className="content-panel">
              <div className="section-heading">
                <h2>Your next focus</h2>
                <Focus size={18} />
              </div>
              {weaknesses.length ? (
                <>
                  <p className="panel-description">
                    Mathematical concepts with the highest observed miss rates.
                  </p>
                  <div className="weakness-list">
                    {weaknesses.map((item, index) => (
                      <div key={item.category}>
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <strong>{categoryLabel(item.category)}</strong>
                        <small>
                          {item.mistakes}/{item.attempts} missed
                        </small>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="small-empty">
                  <Check size={24} />
                  <p>
                    No missed mathematical concepts yet.
                    <br />
                    Keep exploring a wider range of hands.
                  </p>
                </div>
              )}
              <Button variant="secondary" onClick={practiceWeakness}>
                Practice weaknesses
                <ArrowRight size={16} />
              </Button>
            </section>
          </div>
          <div className="score-breakdown-grid">
            <ScoreBreakdown
              title="By street"
              groups={streetChoices
                .filter((street) => street.id !== 'all')
                .map((street) => ({
                  label: street.label,
                  results: generated.results.filter((result) => result.street === street.id),
                  extraHeuristic: legacy.results.filter((result) => result.street === street.id)
                    .length,
                }))}
            />
            <ScoreBreakdown
              title="By concept"
              groups={scenarioCategories.map((category) => ({
                label: category.label,
                results: generated.results.filter((result) => result.category === category.id),
              }))}
            />
            <ScoreBreakdown
              title="By opponent model"
              groups={opponentProfiles.map((profile) => ({
                label: profile.label,
                results: generated.results.filter((result) => result.profile === profile.id),
              }))}
            />
          </div>
          <section className="content-panel guidance-progress">
            <div className="section-heading">
              <h2>Educational guidance</h2>
              <span>Outside the math score</span>
            </div>
            <p className="panel-description">
              {stats.heuristic} generated preflop decisions and {legacy.results.length} curated
              decisions use illustrative judgments. Their preferred, defensible, and mistaken labels
              describe the stated assumptions.
            </p>
            <div className="guidance-counts">
              {(['preferred', 'defensible', 'mistaken'] as const).map((grade) => (
                <span key={grade}>
                  <i className={`grade-dot dot-${grade}`} />
                  <strong>
                    {generated.results.filter((result) => !result.scored && result.grade === grade)
                      .length + legacy.results.filter((result) => result.grade === grade).length}
                  </strong>
                  {gradeLabels[grade]}
                </span>
              ))}
            </div>
          </section>
          <section className="content-panel session-history">
            <div className="section-heading">
              <h2>Recent sessions</h2>
              <span>Saved in this browser</span>
            </div>
            {sessions.length ? (
              <div className="session-history-list">
                {sessions.slice(0, 10).map((session) => (
                  <div key={session.id}>
                    <span>
                      <strong>{session.label}</strong>
                      <small>
                        {formatDate(session.at)} · {session.completed ? 'Finished' : 'Ended early'}
                      </small>
                    </span>
                    <span>
                      <strong>{session.decisions} decisions</strong>
                      <small>{session.detail}</small>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="panel-description">
                Your first session is in progress. Finish whenever you are ready to save its
                summary.
              </p>
            )}
          </section>
          <p className="history-retention-note">
            Generated history retains the latest {GENERATED_HISTORY_LIMIT.toLocaleString()} first
            attempts and 200 session summaries in this browser. Metrics use the retained attempts.
            Your curated history is stored separately.
          </p>
        </>
      )}
    </>
  );
}

export function SessionReview({
  generated: isGenerated,
  onStart,
  onProgress,
  onSetup,
}: {
  generated: boolean;
  onStart: () => void;
  onProgress: () => void;
  onSetup: () => void;
}) {
  const generated = useGeneratedStore();
  const legacy = useTrainingStore();
  const session = isGenerated ? generated.currentSession : legacy.currentSession;
  if (!session) return null;
  const generatedResults = isGenerated
    ? generated.results.filter((result) => result.sessionId === session.id)
    : [];
  const legacyResults = !isGenerated ? (legacy.currentSession?.decisions ?? []) : [];
  const stats = selectGeneratedStatistics(generatedResults);
  const heuristic = stats.heuristic + legacyResults.length;
  const total = isGenerated ? generated.currentSession!.answered : legacyResults.length;
  const weakness = generatedWeaknesses(generatedResults).find((item) => item.mistakes > 0);
  const reviews = isGenerated
    ? generatedResults.map((result) => ({
        id: result.id,
        title: result.title,
        action: result.actionLabel,
        grade: result.grade,
        scored: result.scored,
      }))
    : legacyResults.map((result) => {
        const spot = scenarios.find((item) => item.id === result.scenarioId);
        return {
          id: result.id,
          title: spot?.title ?? 'Curated decision',
          action:
            spot?.legalActions.find((action) => action.id === result.actionId)?.label ??
            'Recorded action',
          grade: result.grade,
          scored: false,
        };
      });
  return (
    <section className="session-complete">
      <span className="complete-emblem">
        <Spade size={35} fill="currentColor" />
      </span>
      <span className="eyebrow">A LITTLE BETTER THAN BEFORE</span>
      <h2>Session in the books.</h2>
      <p>
        {total} first {total === 1 ? 'attempt' : 'attempts'} saved.
        <br />
        {stats.scored
          ? `${percent(stats.accuracy)} mathematical accuracy across ${stats.scored} scored decisions.`
          : 'This session recorded educational guidance.'}
      </p>
      <div className="complete-stats">
        {(['preferred', 'defensible', 'mistaken'] as const).map((grade) => (
          <div key={grade}>
            <span className={`grade-dot dot-${grade}`} />
            <strong>{stats[grade]}</strong>
            <span>{gradeLabels[grade]}</span>
          </div>
        ))}
      </div>
      <p className="review-score-note">
        Counts above include mathematical decisions only. {heuristic} guidance{' '}
        {heuristic === 1 ? 'decision is' : 'decisions are'} excluded. Replays preserve the first
        attempt.
      </p>
      <div className="review-recommendation">
        <Target size={20} />
        <p>
          {weakness ? (
            <>
              Your next focus: <strong>{categoryLabel(weakness.category)}</strong>. You missed{' '}
              {weakness.mistakes} of {weakness.attempts} scored attempts in this concept.
            </>
          ) : stats.scored ? (
            'Keep the range broad. Try another opponent profile or a new concept to test how well the lesson transfers.'
          ) : (
            'Try pot odds or river bluff catching next for feedback measured against an explicit mathematical model.'
          )}
        </p>
      </div>
      <div className="complete-actions">
        <Button onClick={onStart}>
          Another session
          <ArrowRight size={16} />
        </Button>
        <Button variant="secondary" onClick={onProgress}>
          Review progress
          <BarChart3 size={16} />
        </Button>
        <Button variant="ghost" onClick={onSetup}>
          Change practice
          <SlidersHorizontal size={16} />
        </Button>
      </div>
      <div className="complete-review">
        <h3>Your session, hand by hand</h3>
        {reviews.length > 50 && (
          <p className="panel-description">Showing your latest 50 retained first attempts.</p>
        )}
        {reviews.slice(-50).map((result, index) => (
          <div key={result.id}>
            <span className="review-number">
              {String(Math.max(0, reviews.length - 50) + index + 1).padStart(2, '0')}
            </span>
            <span>
              <strong>{result.title}</strong>
              <small>
                {result.action} · {result.scored ? 'Mathematical model' : 'Heuristic guidance'}
              </small>
            </span>
            <span className={`result-pill result-${result.grade}`}>
              {gradeLabels[result.grade]}
            </span>
          </div>
        ))}
        {!reviews.length && (
          <p className="panel-description">
            No decisions were submitted. Your next hand is a fresh start.
          </p>
        )}
      </div>
    </section>
  );
}
