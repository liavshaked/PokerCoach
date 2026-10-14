import { useMemo, useState } from 'react';
import { ArrowRight, Bookmark, Play, ShieldCheck, Spade, Target } from 'lucide-react';
import { HandReport } from '../../components/feedback/HandReport';
import { HandReplay } from '../../components/replay/HandReplay';
import { gameReplayFrames } from '../../components/replay/game-replay';
import { Button, Dialog, EmptyState } from '../../components/ui/primitives';
import { summarizeHand } from '../../engine/analysis';
import type { GameState } from '../../engine/game';
import type { Street } from '../../types/poker';
import { RECENT_HAND_LIMIT, SAVED_HAND_LIMIT, useTableStore } from './store';
import { canRevealHandRecord, type CompletedHand } from './types';

const streetLabels: Record<Street, string> = {
  preflop: 'Preflop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
};

export function FullHandProgress({ onPractice }: { onPractice: (street?: Street) => void }) {
  const store = useTableStore();
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [replay, setReplay] = useState<{ hand: GameState; index: number } | null>(null);
  const records = useMemo(() => {
    // A saved hand and its recent-history entry are one hand, not two attempts.
    const unique = new Map<string, CompletedHand>();
    for (const record of [...store.savedHands, ...store.hands]) {
      if (record.state.result) unique.set(record.state.id, record);
    }
    return [...unique.values()].sort(
      (a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt),
    );
  }, [store.savedHands, store.hands]);
  const visibleRecords = records.filter((record) =>
    canRevealHandRecord(store.config, record, store.session),
  );
  const heldHands = records.length - visibleRecords.length;
  const decisions = visibleRecords.flatMap((record) => record.decisions);
  const retainedDecisions = records.reduce((total, record) => total + record.decisions.length, 0);
  const report = summarizeHand(decisions);
  const trend = visibleRecords.slice(0, 12).reverse();
  const formats = ([2, 3, 6] as const).map((count) => {
    const hands = records.filter((record) => record.state.config.players.length === count);
    const revealed = hands.filter((record) =>
      canRevealHandRecord(store.config, record, store.session),
    );
    return {
      count,
      hands: hands.length,
      decisions: hands.reduce((total, record) => total + record.decisions.length, 0),
      revealedHands: revealed.length,
      report: summarizeHand(revealed.flatMap((record) => record.decisions)),
    };
  });
  const streets = report.streets.map((street) => {
    const comparisons = decisions.filter(
      (decision) =>
        decision.view.table.street === street.street &&
        decision.analysis.scored &&
        decision.analysis.level === 'model',
    );
    const disagreements = comparisons.filter((decision) => decision.analysis.grade === 'mistaken');
    const important = [...disagreements].sort(
      (a, b) => b.analysis.importance - a.analysis.importance,
    )[0];
    return {
      ...street,
      comparisons: comparisons.length,
      disagreements: disagreements.length,
      rate: comparisons.length ? disagreements.length / comparisons.length : 0,
      principle: important?.analysis.principle,
    };
  });
  const weakness = [...streets]
    .filter((street) => street.disagreements > 0)
    .sort((a, b) => b.rate - a.rate || b.disagreements - a.disagreements)[0];
  const review = records.find((record) => record.state.id === reviewId) ?? null;
  const frames = useMemo(() => (replay ? gameReplayFrames(replay.hand) : []), [replay]);
  const openReplay = (record: CompletedHand, frameIndex?: number) => {
    setReviewId(null);
    setReplay({
      hand: record.state,
      index: Math.max(0, frameIndex ?? 0),
    });
  };

  return (
    <section className="fullhand-progress" aria-labelledby="fullhand-progress-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">YOUR COMPLETE HANDS</span>
          <h2 id="fullhand-progress-title">Decisions that add up.</h2>
        </div>
        <span className="provenance-badge">
          <ShieldCheck size={13} />
          Authored policy model
        </span>
      </div>
      <div className="report-metrics">
        <div>
          <strong>{store.totals.hands}</strong>
          <span>Lifetime completed hands</span>
          <small>Tracked on this device since reset</small>
        </div>
        <div>
          <strong>{store.totals.decisions}</strong>
          <span>Lifetime hero decisions</span>
          <small>Includes actions in unfinished hands</small>
        </div>
        <div>
          <strong aria-label={report.score === null ? 'Model score unavailable' : undefined}>
            {report.score === null ? '—' : Math.round(report.score)}
          </strong>
          <span>Model agreement / 100</span>
          <small>
            {report.score === null
              ? heldHands && !decisions.length
                ? 'Unavailable until session review'
                : 'Unavailable: insufficient supported coverage'
              : 'Confidence and importance weighted'}
          </small>
        </div>
        <div>
          <strong aria-label={!decisions.length ? 'Scoring coverage unavailable' : undefined}>
            {decisions.length ? `${Math.round(report.coverage * 100)}%` : '—'}
          </strong>
          <span>Scoring coverage</span>
          <small>
            {decisions.length
              ? `${report.scoredDecisions}/${decisions.length} revealed decisions scored`
              : 'Unavailable: no revealed decisions'}
          </small>
        </div>
      </div>
      <p className="panel-description">
        Review history retains {records.length} complete hands and {retainedDecisions} hero
        decisions, with up to {RECENT_HAND_LIMIT} recent hands plus {SAVED_HAND_LIMIT} saved hands,
        counted once. Scores and charts use revealed records only. Lifetime decisions also include
        actions from hands ended before completion. Spot drills are tracked separately. Model
        agreement is an authored policy comparison, not GTO accuracy or EV loss.
      </p>
      {!records.length ? (
        <EmptyState
          icon={<Spade size={27} />}
          title={
            store.totals.hands
              ? 'Build your next hand review.'
              : 'Your first full hand starts here.'
          }
          action={
            <a className="button button-primary" href="#table">
              Take a seat
              <ArrowRight size={16} />
            </a>
          }
        >
          Finish a hand at the AI table to see your decisions, scoring coverage and a visual replay
          here. Spot-drill results are tracked separately below.
        </EmptyState>
      ) : (
        <>
          {heldHands > 0 && (
            <div className="pending-review" role="status">
              <ShieldCheck size={18} />
              <p>
                {heldHands} {heldHands === 1 ? 'hand is' : 'hands are'} waiting for session review.
                Finish the table session to reveal those scores and coaching details. The
                comparisons below use only revealed hands.
              </p>
              <a className="button button-secondary" href="#table">
                Return to your table
                <ArrowRight size={15} />
              </a>
            </div>
          )}
          <div className="progress-comparison">
            <section className="content-panel" aria-labelledby="fullhand-trend-title">
              <h3 id="fullhand-trend-title">Recent model agreement</h3>
              {trend.length ? (
                <>
                  <div className="fullhand-chart" aria-hidden="true">
                    {trend.map((record) => (
                      <div
                        key={record.state.id}
                        title={`Hand ${record.state.handNumber}: ${record.report.score === null ? 'score unavailable' : `${Math.round(record.report.score)}/100 model agreement`}; ${Math.round(record.report.coverage * 100)}% scoring coverage`}
                        style={
                          record.report.score === null
                            ? {
                                height: '100%',
                                background: 'transparent',
                                borderBottom: '2px dashed #748f60',
                              }
                            : { height: `${record.report.score}%`, minHeight: '2px' }
                        }
                      />
                    ))}
                  </div>
                  <p className="panel-description">
                    Up to 12 revealed hands, oldest to newest. A dashed baseline means the score is
                    unavailable. Coverage varies; this small sample cannot establish improvement.
                  </p>
                  <details className="replay-event-list">
                    <summary>Read scores and coverage</summary>
                    <ol>
                      {trend.map((record) => (
                        <li key={record.state.id}>
                          <p className="panel-description">
                            Hand {record.state.handNumber} ·{' '}
                            {new Date(record.completedAt).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                            })}
                            :{' '}
                            {record.report.score === null
                              ? 'model score unavailable'
                              : `${Math.round(record.report.score)}/100 model agreement`}
                            ; {record.report.scoredDecisions}/{record.report.totalDecisions}{' '}
                            decisions scored ({Math.round(record.report.coverage * 100)}% coverage).
                          </p>
                        </li>
                      ))}
                    </ol>
                  </details>
                </>
              ) : (
                <p className="panel-description">
                  The trend is unavailable until a completed hand's analysis is revealed.
                </p>
              )}
            </section>
            <section className="content-panel" aria-labelledby="fullhand-formats-title">
              <h3 id="fullhand-formats-title">Heads-up and multi-player tables</h3>
              <div className="session-hand-list">
                {formats.map((format) => (
                  <div className="report-coverage" key={format.count}>
                    <strong>
                      {format.count === 2 ? 'Heads-up' : `${format.count}-seat table`}
                    </strong>
                    <p>
                      {format.hands} hands · {format.decisions} hero decisions
                    </p>
                    <p>
                      {format.report.score === null
                        ? 'Model agreement unavailable'
                        : `${Math.round(format.report.score)}/100 weighted model agreement`}
                    </p>
                    <small>
                      {format.report.scoredDecisions}/{format.report.totalDecisions} revealed
                      decisions scored · {format.revealedHands}/{format.hands} hands revealed
                    </small>
                  </div>
                ))}
              </div>
              <p className="panel-description">
                Grouped by configured table size. Busted seats may sit out. Different cards,
                coverage and sample sizes make these descriptions, not a ranking of your skill.
              </p>
            </section>
          </div>
          {decisions.length > 0 && (
            <>
              <div className="report-coverage">
                <ShieldCheck size={15} /> {report.method} Unsupported decisions remain qualitative.
                No measured full-hand EV loss is available.
              </div>
              <div className="report-streets" aria-label="Complete-hand progress by street">
                {streets.map((street) => (
                  <div key={street.street}>
                    <strong>{streetLabels[street.street]}</strong>
                    <span>
                      {street.decisions} decisions · {street.scored} scored
                    </span>
                    <p className="panel-description">
                      {street.score === null
                        ? street.decisions
                          ? 'Score unavailable; read the qualitative review.'
                          : 'No decisions yet.'
                        : `${street.score}/100 model agreement`}
                    </p>
                    {street.comparisons > 0 && (
                      <span>
                        {street.disagreements}/{street.comparisons} model disagreements
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {weakness ? (
                <div className="recommendation-card">
                  <div>
                    <span className="eyebrow">A FOCUS FOR YOUR NEXT SESSION</span>
                    <p>
                      <strong>
                        Revisit {streetLabels[weakness.street].toLowerCase()} decisions.
                      </strong>{' '}
                      {weakness.disagreements} of {weakness.comparisons} scored choices disagreed
                      with the model. {weakness.principle}
                    </p>
                    <p>
                      This is a direction for review, not proof of a strategic leak
                      {weakness.comparisons < 10 ? '; the sample is still small' : ''}.
                    </p>
                  </div>
                  <Button onClick={() => onPractice(weakness.street)}>
                    <Target size={16} />
                    Practice {streetLabels[weakness.street].toLowerCase()}
                  </Button>
                </div>
              ) : (
                <div className="recommendation-card">
                  <div>
                    <strong>Keep building a useful sample.</strong>
                    <p>
                      {report.scoredDecisions
                        ? 'No model disagreements are recorded in the revealed hands. Review the assumptions and keep exploring different streets.'
                        : 'These decisions need qualitative review. Focused drills can isolate the price, draw or range assumption behind a choice.'}
                    </p>
                  </div>
                  <Button variant="secondary" onClick={() => onPractice()}>
                    <Target size={16} />
                    Open focused practice
                  </Button>
                </div>
              )}
            </>
          )}
          <div className="section-heading">
            <h3>Review a complete hand</h3>
            <a href="#notebook" className="button button-ghost">
              <Bookmark size={15} />
              Hand notebook
            </a>
          </div>
          <div className="session-hand-list">
            {records.slice(0, 8).map((record) => {
              const reveal = canRevealHandRecord(store.config, record, store.session);
              return (
                <button key={record.state.id} onClick={() => setReviewId(record.state.id)}>
                  <span>
                    <strong>
                      Hand {record.state.handNumber} ·{' '}
                      {record.state.players.filter((player) => player.startingStack > 0).length}{' '}
                      players
                    </strong>
                    <small>
                      {new Date(record.completedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}{' '}
                      · {record.decisions.length} decisions ·{' '}
                      {reveal
                        ? record.report.score === null
                          ? 'Model score unavailable'
                          : `${Math.round(record.report.score)}/100 model agreement`
                        : 'Analysis after session review'}
                    </small>
                  </span>
                  <Play size={17} aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <p className="panel-description">
            Save the hands you want to revisit. Add notes, tags and review marks in your{' '}
            <a href="#notebook">hand notebook</a>.
          </p>
        </>
      )}
      <Dialog
        className="replay-dialog"
        open={Boolean(review)}
        onOpenChange={(open) => {
          if (!open) setReviewId(null);
        }}
        title="Hand performance"
        description="Review the actual decisions and the model's coverage before drawing a conclusion."
      >
        {review && (
          <HandReport
            record={review}
            reveal={canRevealHandRecord(store.config, review, store.session)}
            onReplay={(eventIndex) => openReplay(review, eventIndex)}
            onSave={() => store.saveHand(review.state.id)}
            saved={store.savedHands.some((record) => record.handId === review.state.id)}
          />
        )}
      </Dialog>
      <Dialog
        className="replay-dialog"
        open={Boolean(replay)}
        onOpenChange={(open) => {
          if (!open) setReplay(null);
        }}
        title="Visual hand replay"
        description="Move through the recorded actions. Opponent cards and future streets stay hidden until they were revealed."
      >
        {replay && (
          <HandReplay
            key={`${replay.hand.id}-${replay.index}`}
            frames={frames}
            initialIndex={replay.index}
            onClose={() => {
              setReviewId(replay.hand.id);
              setReplay(null);
            }}
          />
        )}
      </Dialog>
    </section>
  );
}

export default FullHandProgress;
