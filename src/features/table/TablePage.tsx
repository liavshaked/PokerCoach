import { useEffect, useState } from 'react';
import { Flag, Pause, Play, Settings2, Shield, Spade, Users } from 'lucide-react';
import { useTableStore } from './store';
import { canRevealAnalysis, canRevealHandRecord, decisionToken } from './types';
import type { TableConfig, CompletedHand } from './types';
import { agentProfiles, type AgentDifficulty, type AgentProfileId } from '../../engine/agents';
import { getLegalActions, getPublicView } from '../../engine/game';
import type { GameAction, GameState, LegalGameAction } from '../../engine/game/types';
import { TableView, chips } from '../../components/poker/TableView';
import { HandReplay } from '../../components/replay/HandReplay';
import { gameReplayFrames, tableView } from '../../components/replay/game-replay';
import { DecisionReview, HandReport } from '../../components/feedback/HandReport';
import { Button, Dialog } from '../../components/ui/primitives';
import { useTrainingStore } from '../practice/store';

export default function TablePage() {
  const store = useTableStore();
  const name = useTrainingStore((state) => state.settings.displayName);
  const [replay, setReplay] = useState<{ hand: GameState; index: number } | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const [review, setReview] = useState<CompletedHand | null>(null);
  const hand = store.currentHand;
  const token = decisionToken(hand);
  const active = Boolean(hand && !hand.result && !store.session?.endedAt);
  const hero = hand?.players[0];
  const heroTurn = active && hand!.actorId === hero?.id;
  const latest = store.hands.find((record) => record.id === hand?.id);
  useEffect(() => {
    if (
      !hand ||
      hand.result ||
      store.paused ||
      store.error ||
      store.session?.endedAt ||
      hand.actorId === hand.players[0].id
    )
      return;
    const timer = setTimeout(
      () => useTableStore.getState().stepBot(token),
      store.config.botDelayMs,
    );
    return () => clearTimeout(timer);
  }, [hand, token, store.paused, store.error, store.config.botDelayMs, store.session?.endedAt]);
  const start = () => {
    setReview(null);
    store.startSession({ heroName: name });
  };
  const openReplay = (record: GameState, index = record.events.length - 1) =>
    setReplay({ hand: record, index });
  const reveal = canRevealAnalysis(store.config, hand, store.session);
  const lastDecision = store.decisions.at(-1);
  return (
    <>
      <div className="page-heading v3-heading">
        <div>
          <span className="eyebrow page-eyebrow">
            <span className="tiny-dot" />
            YOUR SEAT IS OPEN
          </span>
          <h1>
            Play poker<span>.</span>
          </h1>
          <p>A complete hand. A table with character. Something to learn every time.</p>
        </div>
        <span className="provenance-badge">
          <Shield size={13} />
          Offline policy models · virtual chips
        </span>
      </div>
      {(!hand || store.session?.endedAt) && (
        <section className="table-setup">
          <div className="table-setup-top">
            <div>
              <span className="eyebrow">AI TABLE</span>
              <h2>Take a seat at the felt.</h2>
              <p>
                Play real hands against distinct, position-aware opponents. Review the decisions
                behind your results.
              </p>
            </div>
            <Button onClick={start}>
              <Spade size={18} />
              Take a seat
            </Button>
          </div>
          <div className="table-formats" aria-label="Table format">
            {([2, 3, 6] as const).map((count) => (
              <button
                key={count}
                aria-pressed={store.config.playerCount === count}
                onClick={() => store.updateConfig({ playerCount: count })}
              >
                <Users size={15} />
                {count === 2 ? 'Heads-up' : `${count} players`}
              </button>
            ))}
          </div>
          <TableSettings config={store.config} update={store.updateConfig} />
        </section>
      )}
      {!store.storageAvailable && (
        <div className="storage-notice" role="status">
          Your table is running in memory. Browser storage is unavailable; export your hands before
          closing this page.
        </div>
      )}
      {store.error && (
        <div className="generation-error" role="alert">
          {store.error}
          <div className="report-actions">
            <Button variant="secondary" onClick={() => store.pause()}>
              Pause table
            </Button>
          </div>
        </div>
      )}
      {hand && !store.session?.endedAt && (
        <>
          <div className="ai-room">
            <section className="ai-game-panel" aria-label="AI poker table">
              <div className="ai-toolbar">
                <span>
                  <span className="tiny-dot" />
                  HAND {hand.handNumber} · {hand.players.length} PLAYERS · {hand.config.smallBlind}/
                  {hand.config.bigBlind}
                </span>
                <div>
                  <button
                    onClick={() => (store.paused ? store.resume() : store.pause())}
                    disabled={Boolean(hand.result)}
                  >
                    {store.paused ? <Play size={14} /> : <Pause size={14} />}{' '}
                    {store.paused ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    aria-label="Open hand replay"
                    onClick={() => {
                      store.pause();
                      openReplay(hand);
                    }}
                  >
                    <Play size={14} />
                    Replay
                  </button>
                  <button onClick={() => setEndOpen(true)}>
                    <Flag size={14} />
                    End session
                  </button>
                </div>
              </div>
              <TableView state={tableView(getPublicView(hand, 0))} />
              <div className="replay-entry">
                <button
                  onClick={() => {
                    store.pause();
                    openReplay(hand);
                  }}
                >
                  <Play size={14} />
                  Replay hand so far
                </button>
                <span>
                  {hand.events.filter((event) => event.type === 'action').length} actions recorded
                </span>
              </div>
              {hand.result ? (
                <div className="table-action-dock">
                  <div className="table-action-title">
                    <strong>
                      {hand.result.reason === 'folds' ? 'The pot is won.' : 'Showdown.'}
                    </strong>
                    <span>Every chip accounted for.</span>
                  </div>
                  <div className="table-action-buttons">
                    <button onClick={() => store.nextHand()}>Next hand →</button>
                    <button className="table-fold" onClick={() => latest && setReview(latest)}>
                      Review this hand
                    </button>
                  </div>
                </div>
              ) : store.paused ? (
                <div className="table-action-dock live-actions">
                  <div className="table-waiting">Table paused. Your hand is saved.</div>
                  <Button onClick={store.resume}>
                    <Play size={16} />
                    Resume hand
                  </Button>
                </div>
              ) : heroTurn ? (
                <ActionDock
                  key={token}
                  hand={hand}
                  actions={getLegalActions(hand)}
                  onAction={(action) => store.submitHero(action, token)}
                />
              ) : (
                <div className="table-action-dock live-actions">
                  <div className="table-waiting">
                    <span className="loading-orbit" />
                    {hand.players.find((player) => player.id === hand.actorId)?.name ??
                      'The table'}{' '}
                    is thinking…
                  </div>
                </div>
              )}
            </section>
            <aside className="table-side-panel">
              <span className="eyebrow">READ THE TABLE</span>
              <h2>
                {heroTurn
                  ? 'Your move. Your story.'
                  : hand.result
                    ? 'A hand in the books.'
                    : 'A little patience. A better read.'}
              </h2>
              <p>
                {heroTurn
                  ? 'Use the legal actions below the table. Bet and raise amounts are total commitments on this street.'
                  : 'Cards stay private until an actual showdown. The table continues from its recorded state.'}
              </p>
              <span className="provenance-badge">{store.config.difficulty} · authored policy</span>
              <div className="opponent-roster">
                {hand.players.slice(1).map((player, index) => {
                  const profile = agentProfiles.find(
                    (item) => item.id === store.config.profiles[index],
                  );
                  return (
                    <div key={player.id}>
                      <span className="seat-avatar">
                        <Shield size={16} />
                      </span>
                      <span>
                        <strong>{player.name}</strong>
                        <small>{profile?.name ?? 'Range-based regular'}</small>
                      </span>
                    </div>
                  );
                })}
              </div>
              <p>
                Difficulty changes policy simplifications. These opponents are not verified GTO
                agents.
              </p>
              <Button
                variant="secondary"
                onClick={() => {
                  store.pause();
                  openReplay(hand);
                }}
              >
                <Play size={15} />
                Read the hand so far
              </Button>
            </aside>
          </div>
          <div className="table-session-strip">
            <span>
              {store.session?.handsCompleted ?? 0} hands · {store.session?.decisions ?? 0} hero
              decisions
            </span>
            <span>
              Session chips: {(store.session?.heroNet ?? 0) >= 0 ? '+' : ''}
              {chips(store.session?.heroNet ?? 0)}
            </span>
            <span>Feedback: {store.config.feedbackTiming.replaceAll('-', ' ')}</span>
          </div>
          {reveal && !hand.result && lastDecision && (
            <DecisionReview
              decision={lastDecision}
              onReplay={(index) => {
                store.pause();
                openReplay(hand, index);
              }}
            />
          )}
          {latest && (
            <HandReport
              record={latest}
              reveal={canRevealHandRecord(store.config, latest, store.session)}
              onReplay={(index) => openReplay(latest.state, index)}
              onSave={() => store.saveHand(latest.id)}
              saved={store.savedHands.some((item) => item.handId === latest.id)}
            />
          )}
        </>
      )}
      {store.session?.endedAt && (
        <section className="content-panel">
          <div className="section-heading">
            <h2>Your table session</h2>
            <span>{store.session.handsCompleted} completed hands</span>
          </div>
          <p className="panel-description">
            {store.session.decisions} decisions recorded. {chips(store.session.heroNet)} net
            practice chips. Review each hand on its own merits.
          </p>
          <div className="session-hand-list">
            {store.hands
              .filter((record) => record.sessionId === store.session!.id)
              .map((record) => (
                <button key={record.id} onClick={() => setReview(record)}>
                  <span>
                    <strong>
                      Hand {record.state.handNumber} · {record.state.players.length} players
                    </strong>
                    <small>
                      {record.report.totalDecisions} decisions ·{' '}
                      {Math.round(record.report.coverage * 100)}% scoring coverage
                    </small>
                  </span>
                  <span>
                    {record.outcome.heroNet >= 0 ? '+' : ''}
                    {chips(record.outcome.heroNet)} chips
                  </span>
                </button>
              ))}
          </div>
        </section>
      )}
      <Dialog
        className="replay-dialog"
        open={Boolean(replay)}
        onOpenChange={(open) => {
          if (!open) setReplay(null);
        }}
        title="Visual hand replay"
        description="The actual recorded table, one action at a time. Hidden cards and future streets stay hidden."
      >
        {replay && (
          <HandReplay
            key={`${replay.hand.id}-${replay.index}`}
            frames={gameReplayFrames(replay.hand)}
            initialIndex={replay.index}
            onClose={() => setReplay(null)}
          />
        )}
      </Dialog>
      <Dialog
        className="replay-dialog"
        open={Boolean(review)}
        onOpenChange={(open) => {
          if (!open) setReview(null);
        }}
        title="Hand performance"
        description="The result tells one story. Your decisions tell another."
      >
        {review && (
          <HandReport
            record={review}
            reveal={canRevealHandRecord(store.config, review, store.session)}
            onReplay={(index) => {
              setReview(null);
              openReplay(review.state, index);
            }}
            onSave={() => store.saveHand(review.id)}
            saved={store.savedHands.some((item) => item.handId === review.id)}
          />
        )}
      </Dialog>
      <Dialog
        open={endOpen}
        onOpenChange={setEndOpen}
        title="Finish this table session?"
        description="Completed hands and recorded decisions are kept. An unfinished hand will remain paused and cannot become a scored completed hand."
      >
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setEndOpen(false)}>
            Keep playing
          </Button>
          <Button
            onClick={() => {
              store.endSession();
              setEndOpen(false);
            }}
          >
            Finish & review
            <Flag size={15} />
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function TableSettings({
  config,
  update,
}: {
  config: TableConfig;
  update: (config: Partial<TableConfig>) => void;
}) {
  return (
    <details className="table-config">
      <summary>
        <Settings2 size={16} />
        Customize your table
      </summary>
      <div className="table-config-grid">
        <label>
          Starting stack
          <select
            value={config.startingStack}
            onChange={(e) => update({ startingStack: Number(e.target.value) })}
          >
            {[20, 50, 100, 200].map((value) => (
              <option key={value} value={value}>
                {value} BB
              </option>
            ))}
          </select>
        </label>
        <label>
          Blinds
          <select
            value={config.bigBlind}
            onChange={(e) =>
              update({ bigBlind: Number(e.target.value), smallBlind: Number(e.target.value) / 2 })
            }
          >
            <option value={1}>0.5 / 1</option>
            <option value={2}>1 / 2</option>
            <option value={5}>2.5 / 5</option>
          </select>
        </label>
        <label>
          Opponent difficulty
          <select
            value={config.difficulty}
            onChange={(e) => update({ difficulty: e.target.value as AgentDifficulty })}
          >
            {['beginner', 'intermediate', 'advanced', 'expert'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Feedback timing
          <select
            value={config.feedbackTiming}
            onChange={(e) =>
              update({ feedbackTiming: e.target.value as TableConfig['feedbackTiming'] })
            }
          >
            <option value="instant">Instant feedback</option>
            <option value="full-hand">After each full hand</option>
            <option value="session-review">At session review</option>
          </select>
        </label>
        <label>
          Table pace
          <select
            value={config.botDelayMs}
            onChange={(e) => update({ botDelayMs: Number(e.target.value) })}
          >
            <option value={250}>Quick · 0.25 seconds</option>
            <option value={650}>Natural · 0.65 seconds</option>
            <option value={1200}>Thoughtful · 1.2 seconds</option>
          </select>
        </label>
        <label className="checkbox-setting">
          <input
            type="checkbox"
            checked={config.autoRebuy}
            onChange={(e) => update({ autoRebuy: e.target.checked })}
          />
          Auto-rebuy practice chips
        </label>
        {Array.from({ length: config.playerCount - 1 }, (_, index) => (
          <label key={index}>
            Seat {index + 2} profile
            <select
              value={config.profiles[index] ?? 'balanced'}
              onChange={(e) => {
                const profiles = [...config.profiles];
                profiles[index] = e.target.value as AgentProfileId;
                update({ profiles });
              }}
            >
              {agentProfiles.map((profile) => (
                <option value={profile.id} key={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <p>
        Expert uses the full authored policy. It is not a claim of professional or solver strength.
        With rebuys off, busted opponents sit out. The session stops when you are out of chips or
        fewer than two seats are funded.
      </p>
    </details>
  );
}
function ActionDock({
  hand,
  actions,
  onAction,
}: {
  hand: GameState;
  actions: LegalGameAction[];
  onAction: (action: GameAction) => void;
}) {
  const keyboard = useTrainingStore((state) => state.settings.keyboardShortcuts);
  const aggressive = actions.find((action) => action.type === 'bet' || action.type === 'raise');
  const min = aggressive?.minAmount ?? aggressive?.amount ?? 0,
    max = aggressive?.maxAmount ?? aggressive?.amount ?? min;
  const [amount, setAmount] = useState(min);
  const unit = hand.config.chipUnit ?? 0.5;
  const setLegal = (value: number) =>
    setAmount(
      Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value / unit) * unit)) : min,
    );
  const hero = hand.players[0];
  const call = actions.find((action) => action.type === 'call');
  useEffect(() => {
    if (!keyboard) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]') ||
        document.querySelector('[role="dialog"]')
      )
        return;
      const key = event.key.toLowerCase();
      const action = /^[1-3]$/.test(key)
        ? actions[Number(key) - 1]
        : actions.find((item) =>
            key === 'f'
              ? item.type === 'fold'
              : key === 'c'
                ? ['check', 'call'].includes(item.type)
                : key === 'r'
                  ? item.type === 'raise'
                  : key === 'b'
                    ? item.type === 'bet'
                    : false,
          );
      if (action) {
        event.preventDefault();
        onAction(
          action.type === 'bet' || action.type === 'raise'
            ? { type: action.type, amount }
            : { type: action.type },
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboard, actions, amount, onAction]);
  return (
    <div className="table-action-dock live-actions">
      <div className="table-action-title">
        <strong>Your decision</strong>
        <span>{call ? `${chips(call.amount ?? 0)} to call` : 'You can check'}</span>
      </div>
      {aggressive && (
        <div className="bet-control">
          <label htmlFor="raise-size">{aggressive.type === 'bet' ? 'Bet' : 'Raise to'}</label>
          <input
            id="raise-size"
            aria-label="Bet or raise size"
            type="number"
            min={min}
            max={max}
            step={unit}
            value={amount}
            onChange={(e) => setLegal(Number(e.target.value))}
          />
          <input
            aria-label="Bet sizing slider"
            type="range"
            min={min}
            max={max}
            step={unit}
            value={amount}
            onChange={(e) => setLegal(Number(e.target.value))}
          />
          <select
            className="bet-preset-select"
            aria-label="Pot size preset"
            value=""
            onChange={(e) =>
              setLegal(
                e.target.value === 'all'
                  ? max
                  : hand.currentBet + (hand.pot + (call?.amount ?? 0)) * Number(e.target.value),
              )
            }
          >
            <option value="" disabled>
              Sizing
            </option>
            <option value=".33">33% pot</option>
            <option value=".5">50% pot</option>
            <option value="1">Pot</option>
            <option value="all">All-in</option>
          </select>
          <div className="bet-presets">
            {[0.33, 0.5, 1].map((fraction) => (
              <button
                key={fraction}
                onClick={() =>
                  setLegal(hand.currentBet + (hand.pot + (call?.amount ?? 0)) * fraction)
                }
              >
                {Math.round(fraction * 100)}% pot
              </button>
            ))}
            <button onClick={() => setLegal(max)}>All-in</button>
          </div>
        </div>
      )}
      <div className="table-action-buttons">
        {actions.map((action) => (
          <button
            key={action.type}
            className={action.type === 'fold' ? 'table-fold' : ''}
            onClick={() =>
              onAction(
                action.type === 'bet' || action.type === 'raise'
                  ? { type: action.type, amount }
                  : { type: action.type },
              )
            }
          >
            {action.type === 'fold'
              ? 'Fold'
              : action.type === 'check'
                ? 'Check'
                : action.type === 'call'
                  ? `Call ${chips(action.amount ?? 0)}`
                  : `${action.type === 'bet' ? 'Bet' : 'Raise to'} ${chips(amount)}`}
          </button>
        ))}
      </div>
      <span className="sr-only">Your remaining stack is {hero.stack} chips.</span>
    </div>
  );
}
