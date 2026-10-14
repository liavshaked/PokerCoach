import { lazy, Suspense, useEffect, useState } from 'react';
import { MotionConfig } from 'motion/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  Bookmark,
  Grid3X3,
  MoreHorizontal,
  Play,
  Users,
  ArrowDownToLine,
  ArrowRight,
  BarChart3,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Flag,
  Focus,
  LayoutGrid,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Spade,
  X,
} from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { BRAND } from '../lib/brand';
import { scenarios } from '../data/scenarios';
import { getDecisionOptions } from '../engine/evaluation';
import { useTrainingStore } from '../features/practice/store';
import { useGeneratedStore } from '../features/practice/generated-store';
import { PokerTable } from '../components/poker/PokerTable';
import { CoachingPanel } from '../components/feedback/CoachingPanel';
import { Button, Dialog, Tip } from '../components/ui/primitives';
import { ScenarioLibrary, SettingsPage } from './Pages';
import {
  PracticeSetup,
  GeneratedProgress,
  SessionReview,
} from '../features/practice/TrainingViews';

import { useTableStore } from '../features/table/store';
import { useSpotNotebook } from '../features/notebook/spot-notebook';
import { HandReplay } from '../components/replay/HandReplay';
import { spotReplayFrames } from '../features/practice/spot-replay';
import { FullHandProgress } from '../features/table/FullHandProgress';
const TablePage = lazy(() => import('../features/table/TablePage'));
const NotebookPage = lazy(() => import('../features/notebook/NotebookPage'));
const RangeExplorer = lazy(() => import('../features/ranges/RangeExplorer'));
type Page = 'table' | 'practice' | 'library' | 'notebook' | 'ranges' | 'progress' | 'settings';
const navItems = [
  { page: 'table' as const, label: 'AI poker table', short: 'Table', icon: Users },
  { page: 'practice' as const, label: 'Practice room', short: 'Practice', icon: Spade },
  { page: 'library' as const, label: 'Spot library', short: 'Library', icon: LayoutGrid },
  { page: 'notebook' as const, label: 'Hand notebook', short: 'Notebook', icon: Bookmark },
  { page: 'ranges' as const, label: 'Range explorer', short: 'Ranges', icon: Grid3X3 },
  { page: 'progress' as const, label: 'Your progress', short: 'Progress', icon: BarChart3 },
  { page: 'settings' as const, label: 'Settings', short: 'Settings', icon: Settings2 },
];
const readPage = (): Page =>
  navItems.find((item) => item.page === window.location.hash.slice(1))?.page ?? 'practice';

export default function App() {
  const table = useTableStore();
  const notebook = useSpotNotebook();
  const [moreOpen, setMoreOpen] = useState(false);
  const [spotReplayOpen, setSpotReplayOpen] = useState(false);
  const legacy = useTrainingStore();
  const generated = useGeneratedStore();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const [page, setPage] = useState<Page>(readPage);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const isGenerated = Boolean(generated.currentSession);
  const current = isGenerated ? generated.currentSession : legacy.currentSession;
  const active = Boolean(current && !current.completed);
  const loading = generated.busy;
  const deferPractice = table.config.feedbackTiming === 'session-review' && active;
  const deferProgress =
    deferPractice ||
    (table.config.feedbackTiming === 'session-review' &&
      Boolean(table.session && !table.session.endedAt));
  const scenario =
    isGenerated && generated.currentScenario
      ? generated.currentScenario
      : (scenarios.find(
          (spot) => spot.id === legacy.currentSession?.scenarioIds[legacy.currentSession.index],
        ) ?? scenarios.find((spot) => spot.street === 'river')!);
  const selected = isGenerated
    ? generated.currentScenario
      ? generated.selectedActionId
      : null
    : legacy.selectedActionId;
  const options = getDecisionOptions(scenario);
  const last = isGenerated
    ? generated.currentSession?.limit === (generated.currentSession?.index ?? 0) + 1
    : Boolean(
        legacy.currentSession &&
        legacy.currentSession.index === legacy.currentSession.scenarioIds.length - 1,
      );
  const navigate = (next: Page) => {
    setPage(next);
    window.location.hash = next;
    setAnalysisOpen(false);
  };
  const start = async (mode?: 'endless' | 'focused' | 'challenge' | 'weakness') => {
    legacy.endSession();
    navigate('practice');
    await generated.startSession(mode);
  };
  const next = () => {
    setAnalysisOpen(false);
    if (isGenerated) void generated.nextScenario();
    else legacy.nextScenario();
  };
  const replay = () => {
    setAnalysisOpen(false);
    if (isGenerated) generated.replayScenario();
    else legacy.replayScenario();
  };
  const submit = (id: string) => {
    if (!loading) {
      if (isGenerated) generated.submitAction(id);
      else legacy.submitAction(id);
    }
  };
  const practiceCurated = (id: string) => {
    generated.closeSession();
    legacy.startSession('all', 'mixed', id);
    navigate('practice');
  };

  useEffect(() => {
    const onHashChange = () => setPage(readPage());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  useEffect(() => {
    if (!legacy.settings.keyboardShortcuts || page !== 'practice' || !active || loading) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        target.closest('input, textarea, select, [contenteditable="true"]') ||
        document.querySelector('[role="dialog"]')
      )
        return;
      if (selected) {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (isGenerated) void generated.nextScenario();
          else legacy.nextScenario();
        }
        return;
      }
      const key = event.key.toLowerCase();
      const candidates = options.filter(
        (action) =>
          'kind' in action &&
          ((key === 'f' && action.kind === 'fold') ||
            (key === 'c' && ['check', 'call'].includes(action.kind)) ||
            (key === 'r' && action.kind === 'raise') ||
            (key === 'b' && action.kind === 'bet')),
      );
      const action = /^[1-9]$/.test(key)
        ? options[Number(key) - 1]
        : candidates.length === 1
          ? candidates[0]
          : undefined;
      if (action) {
        event.preventDefault();
        if (isGenerated) generated.submitAction(action.id);
        else legacy.submitAction(action.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, page, loading, legacy, generated, options, selected, isGenerated]);

  const coaching = deferPractice ? (
    <section className="content-panel">
      <span className="eyebrow">SESSION REVIEW</span>
      <h2>Stay with the decision.</h2>
      <p>
        Your first attempts are being recorded. Analysis, hints, and scores unlock when you finish
        this session.
      </p>
      <Button variant="secondary" onClick={() => setEndOpen(true)}>
        Finish & review
      </Button>
    </section>
  ) : (
    <CoachingPanel
      key={`${scenario.id}-${active}`}
      scenario={scenario}
      selectedActionId={active ? selected : null}
      active={active}
      showHints={legacy.settings.showHints}
      onNext={next}
      onReplay={replay}
      onSource={() => setSourceOpen(true)}
      last={last}
      busy={loading}
    />
  );
  return (
    <Tooltip.Provider>
      <MotionConfig reducedMotion={legacy.settings.animations ? 'user' : 'always'}>
        <div
          className={`app-shell ${page === 'table' && table.currentHand && !table.session?.endedAt ? 'active-ai' : ''} ${!legacy.settings.animations ? 'motion-off' : ''}`}
        >
          <a className="skip-link" href="#main-content">
            Skip to main content
          </a>
          <aside className="sidebar">
            <button
              className="brand"
              onClick={() => navigate('practice')}
              aria-label={`${BRAND.name} home`}
            >
              <span className="brand-mark">
                <Spade size={21} fill="currentColor" strokeWidth={0.7} />
              </span>
              <span>
                {BRAND.name}
                <span className="brand-period">.</span>
              </span>
            </button>
            <div className="sidebar-section-label">YOUR WORKSPACE</div>
            <nav aria-label="Main navigation">
              {navItems.map((item) => (
                <button
                  key={item.page}
                  className={`nav-item ${page === item.page ? 'nav-active' : ''}`}
                  onClick={() => navigate(item.page)}
                  aria-current={page === item.page ? 'page' : undefined}
                >
                  <item.icon size={18} />
                  <span>{item.label}</span>
                  {page === item.page && <span className="nav-dot" />}
                </button>
              ))}
            </nav>
            <div className="sidebar-note">
              <div className="note-icon">
                <Focus size={20} />
              </div>
              <span className="eyebrow">A LITTLE, OFTEN.</span>
              <p>Good instincts are built one decision at a time.</p>
              <button onClick={() => setGuideOpen(true)}>
                The field notes
                <ArrowRight size={14} />
              </button>
            </div>
            <div className="sidebar-bottom">
              <div>
                <span className="tiny-dot" />
                Your private practice space
              </div>
              <span>Free to play. Built to learn.</span>
              <button onClick={() => setInstallOpen(true)}>
                <ArrowDownToLine size={14} />
                Install FeltLab
              </button>
            </div>
          </aside>
          <div className="workspace">
            <header className="mobile-header">
              <button
                className="brand"
                aria-label="FeltLab home"
                onClick={() => navigate('practice')}
              >
                <Spade size={20} fill="currentColor" />
                FeltLab<span className="brand-period">.</span>
              </button>
              <span>
                {active
                  ? `${isGenerated ? generated.currentSession?.mode : 'Curated'} · ${current!.index + 1}`
                  : 'Your practice space'}
              </span>
              <button
                className="icon-button"
                aria-label="Open field notes"
                onClick={() => setGuideOpen(true)}
              >
                <CircleHelp size={19} />
              </button>
            </header>
            <header className="topbar">
              <div className="breadcrumb">
                Workspace
                <ChevronRight size={13} />
                <strong>{navItems.find((item) => item.page === page)?.label}</strong>
              </div>
              <div className="topbar-right">
                <Tip text="Your settings and progress stay in this browser.">
                  <span className="local-badge">
                    <span className="tiny-dot" />
                    LOCAL FIRST
                  </span>
                </Tip>
                <button
                  className="profile-button"
                  onClick={() => navigate('settings')}
                  aria-label="Open profile settings"
                >
                  {legacy.settings.displayName.slice(0, 2).toUpperCase()}
                </button>
              </div>
            </header>
            {(!legacy.storageAvailable ||
              !generated.storageAvailable ||
              !table.storageAvailable ||
              !notebook.storageAvailable) && (
              <div className="storage-notice" role="status">
                Browser storage is unavailable. You can practice, but new progress may be lost when
                this page closes. Export a copy in Settings.
              </div>
            )}
            {needRefresh && (
              <div className="update-notice" role="status">
                <span>A fresh version of FeltLab is ready. Your progress is saved.</span>
                <button onClick={() => updateServiceWorker(true)}>
                  Update now
                  <RotateCcw size={13} />
                </button>
                <button
                  aria-label="Dismiss update notification"
                  onClick={() => setNeedRefresh(false)}
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <main id="main-content" tabIndex={-1}>
              <Suspense
                fallback={
                  <div className="content-panel" role="status">
                    Preparing your workspace?
                  </div>
                }
              >
                {page === 'table' && <TablePage />}
                {page === 'notebook' && <NotebookPage deferSpots={deferPractice} />}
                {page === 'ranges' && <RangeExplorer />}
                {page === 'practice' && (
                  <>
                    <div className="page-heading">
                      <div>
                        <div className="eyebrow page-eyebrow">
                          <span className="tiny-dot" />
                          THE WORK IS THE EDGE
                        </div>
                        <h1>
                          The practice room<span>.</span>
                        </h1>
                        <p>Fresh hands. Clear assumptions. Better instincts.</p>
                      </div>
                      <div className="game-type">
                        <span>HEADS-UP</span>
                        <span>No-Limit Hold’em</span>
                      </div>
                    </div>
                    {!active && (
                      <section className="table-setup">
                        <div className="table-setup-top">
                          <div>
                            <span className="eyebrow">NEW ? COMPLETE HANDS</span>
                            <h2>Read the whole table.</h2>
                            <p>
                              Heads-up, 3 players, or a full 6-seat table. Play every street, then
                              replay the decisions.
                            </p>
                          </div>
                          <Button onClick={() => navigate('table')}>
                            <Users size={17} />
                            Play against AI
                            <ArrowRight size={16} />
                          </Button>
                        </div>
                      </section>
                    )}
                    {current?.completed ? (
                      <SessionReview
                        generated={isGenerated}
                        onStart={() => void start()}
                        onProgress={() => navigate('progress')}
                        onSetup={() => {
                          generated.closeSession();
                          legacy.endSession();
                        }}
                      />
                    ) : (
                      <>
                        {!active && (
                          <PracticeSetup onStart={(mode) => void start(mode)} busy={loading} />
                        )}
                        {generated.error && (
                          <div className="generation-error" role="alert">
                            <strong>We couldn’t prepare this spot.</strong>
                            <p>{generated.error}</p>
                            <Button
                              onClick={() => void generated.retryGeneration()}
                              disabled={loading}
                            >
                              Try again
                              <RotateCcw size={16} />
                            </Button>
                          </div>
                        )}
                        <div className="practice-layout" aria-busy={loading}>
                          <section className="game-panel" aria-label="Poker spot battle">
                            <div className="game-toolbar">
                              {active ? (
                                <>
                                  <div className="session-counter">
                                    <span className="session-status-dot" />
                                    <span>
                                      {isGenerated
                                        ? `${generated.currentSession!.mode} practice`
                                        : 'Curated practice'}
                                    </span>
                                    <span className="muted">/</span>
                                    <strong>Spot {current!.index + 1}</strong>
                                    {isGenerated ? (
                                      generated.currentSession!.limit && (
                                        <span className="muted">
                                          of {generated.currentSession!.limit}
                                        </span>
                                      )
                                    ) : (
                                      <span className="muted">
                                        of {legacy.currentSession!.scenarioIds.length}
                                      </span>
                                    )}
                                  </div>
                                  <div className="toolbar-actions">
                                    <button
                                      className="icon-button"
                                      aria-label="Replay hand history"
                                      onClick={() => setSpotReplayOpen(true)}
                                      disabled={loading}
                                    >
                                      <Play size={16} />
                                    </button>
                                    {selected && !deferPractice && (
                                      <button
                                        className="icon-button"
                                        aria-label="Save practice spot"
                                        onClick={() =>
                                          notebook.save(
                                            scenario,
                                            (isGenerated ? generated.results : legacy.results).find(
                                              (result) =>
                                                result.scenarioId === scenario.id &&
                                                result.sessionId === current?.id,
                                            )?.actionId ?? selected,
                                          )
                                        }
                                        disabled={notebook.spots.some(
                                          (item) => item.scenario.id === scenario.id,
                                        )}
                                      >
                                        <Bookmark size={16} />
                                      </button>
                                    )}
                                    <button
                                      className="icon-button"
                                      aria-label="Replay current spot"
                                      onClick={replay}
                                      disabled={loading || !selected}
                                    >
                                      <RotateCcw size={16} />
                                    </button>
                                    <button
                                      className="text-button"
                                      onClick={() => setEndOpen(true)}
                                    >
                                      End session
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="session-counter">
                                    <span className="session-status-dot" />
                                    THE NEXT HAND <span className="new-label">V3</span>
                                  </div>
                                  <span className="quiet-label">A seat at your own pace</span>
                                </>
                              )}
                            </div>
                            {isGenerated && !generated.currentScenario ? (
                              <div className="table-placeholder" aria-label="Preparing poker table">
                                <Spade size={34} />
                                <span>
                                  {generated.error
                                    ? 'The table is paused'
                                    : 'Dealing your next spot?'}
                                </span>
                              </div>
                            ) : (
                              <PokerTable
                                key={scenario.id}
                                scenario={scenario}
                                displayName={legacy.settings.displayName}
                                decided={Boolean(selected)}
                                preview={!active}
                              />
                            )}
                            <div className={`action-dock ${active ? 'action-dock-active' : ''}`}>
                              {isGenerated && generated.error ? (
                                <p role="status">
                                  This hand is paused. Use Try again above to continue.
                                </p>
                              ) : loading ? (
                                <div className="loading-spot" role="status">
                                  <span className="loading-orbit" />
                                  Preparing a fresh, validated hand…
                                </div>
                              ) : active ? (
                                selected ? (
                                  <div className="decision-locked">
                                    <span className="locked-check">
                                      <Check size={18} />
                                    </span>
                                    <div>
                                      <strong>
                                        {deferPractice
                                          ? 'Decision recorded. Keep your focus.'
                                          : 'Decision made. Lesson unlocked.'}
                                      </strong>
                                      <span>
                                        {deferPractice
                                          ? 'Analysis unlocks at session review.'
                                          : scenario.generated?.scored
                                            ? 'Mathematical feedback under the stated model.'
                                            : 'Educational guidance. Excluded from math scores.'}
                                      </span>
                                    </div>
                                    <button
                                      className="mobile-analysis-trigger button button-secondary"
                                      onClick={() => setAnalysisOpen(true)}
                                    >
                                      <BookOpen size={16} />
                                      View analysis
                                    </button>
                                    <Button onClick={next}>
                                      {last ? 'Finish session' : 'Next spot'}
                                      <ArrowRight size={17} />
                                    </Button>
                                  </div>
                                ) : (
                                  <>
                                    <div className="action-prompt">
                                      <span>
                                        <span className="tiny-dot" />
                                        {scenario.exercise ? 'WORK THE NUMBERS' : 'YOUR MOVE'}
                                      </span>
                                      <button
                                        className="mobile-analysis-trigger"
                                        onClick={() => setAnalysisOpen(true)}
                                      >
                                        <BookOpen size={15} />
                                        Spot details
                                      </button>
                                    </div>
                                    <p className="exercise-question">
                                      {scenario.exercise?.question ?? scenario.prompt}
                                    </p>
                                    <div className="action-buttons">
                                      {options.map((action, index) => (
                                        <button
                                          key={action.id}
                                          className={`poker-action action-${'kind' in action ? action.kind : 'answer'}`}
                                          onClick={() => submit(action.id)}
                                        >
                                          <span>{action.label}</span>
                                          {legacy.settings.keyboardShortcuts && (
                                            <kbd>{index + 1}</kbd>
                                          )}
                                        </button>
                                      ))}
                                    </div>
                                    <p className="keyboard-note">
                                      {scenario.exercise
                                        ? 'A math drill, using the hand on the table.'
                                        : 'Take your time. There is no shot clock.'}
                                      <span>Number keys choose an answer.</span>
                                    </p>
                                  </>
                                )
                              ) : (
                                <div className="start-dock">
                                  <div>
                                    <span className="eyebrow">YOUR NEXT GOOD HABIT</span>
                                    <h3>A fresh hand, every time.</h3>
                                    <p>
                                      Choose your practice above. Keep going for as long as you
                                      like.
                                    </p>
                                  </div>
                                  <Button
                                    className="start-training"
                                    onClick={() => void start()}
                                    disabled={loading}
                                  >
                                    <Spade size={17} />
                                    Start Training
                                    <ArrowRight size={17} />
                                  </Button>
                                </div>
                              )}
                            </div>
                            <div className="game-footer">
                              <span>
                                <ShieldCheck size={13} />
                                Practice chips. Real learning.
                              </span>
                              <button onClick={() => setSourceOpen(true)}>
                                About our strategy
                                <CircleHelp size={12} />
                              </button>
                            </div>
                          </section>
                          <div className="desktop-coaching">{coaching}</div>
                        </div>
                        {active && (
                          <div className="session-progress">
                            <span>YOUR SESSION</span>
                            <span>
                              {isGenerated
                                ? generated.currentSession!.answered
                                : legacy.currentSession!.decisions.length}{' '}
                              first attempts saved
                            </span>
                            <button className="text-button" onClick={() => setEndOpen(true)}>
                              Review & finish
                              <ArrowRight size={14} />
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
                {page === 'library' && (
                  <ScenarioLibrary
                    onPractice={practiceCurated}
                    onSource={() => setSourceOpen(true)}
                    active={active}
                    hideResults={deferProgress}
                  />
                )}
                {page === 'progress' && !deferProgress && (
                  <>
                    <FullHandProgress
                      onPractice={(street) => {
                        if (street === 'flop' || street === 'turn') {
                          const spot = scenarios.find((item) => item.street === street);
                          if (spot) practiceCurated(spot.id);
                        } else {
                          generated.updatePreferences({ street: street ?? 'all' });
                          void start('focused');
                        }
                      }}
                    />
                    <GeneratedProgress
                      onStart={() => void start()}
                      onWeakness={() => void start('weakness')}
                    />
                  </>
                )}
                {page === 'progress' && deferProgress && (
                  <section className="content-panel">
                    <h1>Your review is waiting.</h1>
                    <p>Finish your active session to reveal scores and coaching.</p>
                    <Button
                      onClick={() => {
                        if (active) setEndOpen(true);
                        else navigate('table');
                      }}
                    >
                      Back to session
                    </Button>
                  </section>
                )}
                {page === 'settings' && (
                  <SettingsPage
                    onSource={() => setSourceOpen(true)}
                    onInstall={() => setInstallOpen(true)}
                  />
                )}
              </Suspense>
            </main>
            <footer className="workspace-footer">
              <span>
                {BRAND.name}
                <span> / </span>
                {BRAND.tagline}
              </span>
              <span>No stakes. Just progress.</span>
            </footer>
          </div>
          <nav className="mobile-nav" aria-label="Mobile navigation">
            {navItems
              .filter((item) => ['table', 'practice', 'notebook', 'progress'].includes(item.page))
              .map((item) => (
                <button
                  key={item.page}
                  aria-label={item.label}
                  className={page === item.page ? 'nav-active' : ''}
                  aria-current={page === item.page ? 'page' : undefined}
                  onClick={() => navigate(item.page)}
                >
                  <item.icon size={19} />
                  <span>{item.short}</span>
                </button>
              ))}
            <button aria-label="More pages" onClick={() => setMoreOpen(true)}>
              <MoreHorizontal size={19} />
              <span>More</span>
            </button>
          </nav>
          <Dialog
            open={moreOpen}
            onOpenChange={setMoreOpen}
            title="Your workspace"
            description="More ways to study and make FeltLab yours."
          >
            <div className="more-menu">
              {navItems
                .filter((item) => ['library', 'ranges', 'settings'].includes(item.page))
                .map((item) => (
                  <Button
                    key={item.page}
                    variant="secondary"
                    onClick={() => {
                      navigate(item.page);
                      setMoreOpen(false);
                    }}
                  >
                    <item.icon size={17} />
                    {item.label}
                  </Button>
                ))}
            </div>
          </Dialog>
          <Dialog
            className="replay-dialog"
            open={spotReplayOpen}
            onOpenChange={setSpotReplayOpen}
            title="The hand so far"
            description="Reconstruct the recorded action leading to this decision."
          >
            <HandReplay frames={spotReplayFrames(scenario, legacy.settings.displayName)} />
          </Dialog>
          <Dialog
            className="mobile-analysis-sheet"
            open={analysisOpen}
            onOpenChange={setAnalysisOpen}
            title={selected ? 'Your hand analysis' : 'Inside this spot'}
            description="Betting history, assumptions, and coaching."
          >
            {coaching}
          </Dialog>
          <Dialog
            open={sourceOpen}
            onOpenChange={setSourceOpen}
            title="Good coaching starts with honesty."
            description="Each hand declares exactly how it is evaluated."
          >
            <div className="dialog-copy">
              <p>
                <strong>Mathematical model.</strong> Pot odds, drawing probabilities, and bluff
                thresholds follow explicit formulas. River equity and call EV are exact against the
                finite weighted range shown in the analysis, with no rake or future betting.
              </p>
              <p>
                <strong>Heuristic educational guidance.</strong> Generated preflop spots use
                authored heads-up range models. The original 16 spots retain their illustrative
                coaching. These judgments are excluded from mathematical accuracy scores.
              </p>
              <p>
                No verified solver strategies or licensed verified heads-up charts are included. A
                profitable call against a modeled range is not a claim of GTO play. Practice spot
                ranges are authored assumptions. AI table opponents use distinct local policy
                models; full-hand scores measure model agreement and disclose coverage.
              </p>
              <div className="dialog-callout">
                <ShieldCheck size={20} />
                <span>Legal states checked. Strategy assumptions disclosed.</span>
              </div>
            </div>
            <Button onClick={() => setSourceOpen(false)}>
              Back to the felt
              <ArrowRight size={15} />
            </Button>
          </Dialog>
          <Dialog
            open={guideOpen}
            onOpenChange={setGuideOpen}
            title="The field notes"
            description="Choose a mode, make a decision, then explore the why."
          >
            <div className="glossary">
              {[
                [
                  'Endless practice',
                  'Fresh seeded situations keep coming. Finish whenever you want to see your session summary.',
                ],
                [
                  'Focused & weakness practice',
                  'Choose a supported street or concept. Weakness mode uses your actual category results to choose what to practice next.',
                ],
                [
                  'Challenge sessions',
                  'Choose 10, 20, or 50 decisions. Only mathematically evaluated decisions contribute to the math score.',
                ],
                [
                  'Position',
                  'In heads-up play, the button acts first preflop and last after the flop.',
                ],
                [
                  'Pot odds',
                  'The call amount divided by the pot after calling. Future betting and equity realization can change the value of a call before the river.',
                ],
                [
                  'Ranges & uncertainty',
                  'A range assigns weights to possible opponent hands. Inspect those assumptions before interpreting equity or EV.',
                ],
              ].map(([term, definition]) => (
                <div key={term}>
                  <h3>{term}</h3>
                  <p>{definition}</p>
                </div>
              ))}
            </div>
          </Dialog>
          <Dialog
            open={installOpen}
            onOpenChange={setInstallOpen}
            title="A place on your Home Screen."
            description="FeltLab runs locally and supports offline practice after its first production load."
          >
            <div className="dialog-copy">
              <p>
                On iPhone, open the app’s HTTPS address in Safari, tap Share, then Add to Home
                Screen. Desktop Chrome and Edge offer an install icon in the address bar.
              </p>
              <p>
                Generated training and the curated library run on your device. Progress stays in
                this browser and does not sync between devices. Export it from Settings.
              </p>
              <p>
                A computer’s localhost address is not accessible from your phone. Use HTTPS hosting
                for installation.
              </p>
            </div>
          </Dialog>
          <Dialog
            open={endOpen}
            onOpenChange={setEndOpen}
            title="Wrap up this session?"
            description="Your recorded first attempts stay in your progress."
          >
            <div className="dialog-actions">
              <Button variant="secondary" onClick={() => setEndOpen(false)}>
                Keep practicing
              </Button>
              <Button
                onClick={() => {
                  if (isGenerated) generated.endSession();
                  else legacy.endSession();
                  setEndOpen(false);
                }}
              >
                End session
                <Flag size={15} />
              </Button>
            </div>
          </Dialog>
        </div>
      </MotionConfig>
    </Tooltip.Provider>
  );
}
