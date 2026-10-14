import { Bookmark, Play, ArrowRight, ShieldCheck } from 'lucide-react';
import type { CompletedHand, HeroDecision } from '../../features/table/types';
import { chips } from '../poker/TableView';
import { Button } from '../ui/primitives';

const gradeLabels = {
  preferred: 'Strong model fit',
  defensible: 'Reasonable alternative',
  mistaken: 'Model disagreement',
};
export function DecisionReview({
  decision,
  onReplay,
}: {
  decision: HeroDecision;
  onReplay?: (eventIndex: number) => void;
}) {
  const { analysis, chosenAction, view } = decision;
  return (
    <article className="decision-review">
      <header>
        <h3>
          {view.table.street} · {chosenAction.type}
          {chosenAction.amount !== undefined
            ? `${chosenAction.type === 'bet' || chosenAction.type === 'raise' ? ' to' : ''} ${chips(chosenAction.amount)}`
            : ''}
        </h3>
        <span className="provenance-badge">{analysis.source.label}</span>
      </header>
      <p>
        Pot {chips(view.table.pot)} chips ·{' '}
        {view.table.players.find((player) => player.id === view.playerId)?.position} ·{' '}
        {chips(view.table.players.find((player) => player.id === view.playerId)?.stack ?? 0)}{' '}
        behind.{' '}
        <strong>
          {analysis.scored ? 'Model preference' : 'Illustrative model line'}:{' '}
          {analysis.recommendedActions
            .map(
              (action) =>
                `${action.type}${action.amount === undefined ? '' : `${action.type === 'bet' || action.type === 'raise' ? ' to' : ''} ${chips(action.amount)}`}`,
            )
            .join(' / ')}
          .
        </strong>
      </p>
      <p>{analysis.explanation}</p>
      <div className="decision-review-details">
        <span>{analysis.grade ? gradeLabels[analysis.grade] : 'Not scored'}</span>
        <span>{analysis.confidence} confidence</span>
        {analysis.potOdds && (
          <span>Immediate price {(analysis.potOdds.requiredEquity * 100).toFixed(1)}%</span>
        )}
      </div>
      <p>
        <strong>{analysis.principle}</strong>
      </p>
      <details>
        <summary>Assumptions & evaluation</summary>
        <p>{analysis.assumptions.join(' ')}</p>
        {analysis.potOdds && <p>{analysis.potOdds.explanation}</p>}
        <p>
          {analysis.scored
            ? `Model agreement: ${analysis.score}/100. This measures agreement with an authored policy, not GTO accuracy or measured EV.`
            : 'No numerical strategy score is assigned to this decision.'}
        </p>
      </details>
      {onReplay && (
        <Button variant="secondary" onClick={() => onReplay(Math.max(0, decision.eventIndex - 1))}>
          <Play size={14} />
          Replay this decision
        </Button>
      )}
    </article>
  );
}
export function HandReport({
  record,
  reveal,
  onReplay,
  onSave,
  onNext,
  saved = false,
}: {
  record: CompletedHand;
  reveal: boolean;
  onReplay: (eventIndex?: number) => void;
  onSave?: () => void;
  onNext?: () => void;
  saved?: boolean;
}) {
  const { report, outcome } = record;
  const hero = record.state.players[0];
  return (
    <div className="hand-report">
      <div className="hand-result-banner">
        <div>
          <span className="eyebrow">
            HAND {record.state.handNumber} · {outcome.showdown ? 'SHOWDOWN' : 'WON THROUGH FOLDS'}
          </span>
          <h2>{outcome.won ? 'A pot comes your way.' : 'Every hand has a lesson.'}</h2>
          <p>
            {hero?.name ?? 'You'} · {record.state.players.length} players · virtual chips
          </p>
        </div>
        <span className="hand-net">
          {outcome.heroNet >= 0 ? '+' : ''}
          {chips(outcome.heroNet)}
        </span>
      </div>
      <div className="report-actions">
        {onNext && (
          <Button onClick={onNext}>
            Next hand
            <ArrowRight size={16} />
          </Button>
        )}
        <Button variant="secondary" onClick={() => onReplay()}>
          <Play size={15} />
          Replay hand
        </Button>
        {onSave && (
          <Button variant="secondary" onClick={onSave} disabled={saved}>
            <Bookmark size={15} />
            {saved ? 'Hand saved' : 'Save hand'}
          </Button>
        )}
      </div>
      {!reveal ? (
        <div className="pending-review">
          <ShieldCheck size={20} />
          <p>
            Analysis is saved for your session review. Finish the table session to unlock decision
            feedback. Chip results are separate from decision quality.
          </p>
        </div>
      ) : (
        <>
          <div className="report-metrics">
            <div>
              <strong>{report.score === null ? '—' : `${Math.round(report.score)}`}</strong>
              <span>{report.scoreLabel} / 100</span>
              <small>
                {report.score === null
                  ? 'Insufficient scoring coverage'
                  : 'Authored policy; not GTO'}
              </small>
            </div>
            <div>
              <strong>{Math.round(report.coverage * 100)}%</strong>
              <span>Scoring coverage</span>
              <small>
                {report.scoredDecisions}/{report.totalDecisions} decisions scored
              </small>
            </div>
            <div>
              <strong>{report.totalDecisions}</strong>
              <span>Your decisions</span>
              <small>{report.evaluatedDecisions} reviewed</small>
            </div>
            <div>
              <strong>{report.notableMistakes}</strong>
              <span>Model disagreements</span>
              <small>{report.strongDecisions} strong model fits</small>
            </div>
          </div>
          <div className="report-coverage">
            <ShieldCheck size={15} /> {report.method} Confidence: {report.confidence}. Chips won or
            lost never determine your coaching score.
          </div>
          <div className="report-streets">
            {report.streets.map((street) => (
              <div key={street.street}>
                <strong>{street.street}</strong>
                <span>
                  {street.assessment} · {street.scored}/{street.decisions} scored
                </span>
              </div>
            ))}
          </div>
          {report.lessons.length > 0 && (
            <section className="content-panel">
              <span className="eyebrow">TAKE THIS TO YOUR NEXT HAND</span>
              {report.lessons.map((lesson) => (
                <p key={lesson} className="panel-description">
                  {lesson}
                </p>
              ))}
            </section>
          )}
          {report.mostImportantDecisionId && (
            <div className="report-coverage">
              <strong>Key decision to revisit</strong>
              <p>
                The highest importance decision in this model is highlighted by its replay shortcut.
              </p>
              <Button
                variant="secondary"
                onClick={() =>
                  onReplay(
                    Math.max(
                      0,
                      (record.decisions.find(
                        (decision) => decision.id === report.mostImportantDecisionId,
                      )?.eventIndex ?? 1) - 1,
                    ),
                  )
                }
              >
                Replay key decision
                <Play size={14} />
              </Button>
            </div>
          )}
          <div className="decision-review-list">
            {record.decisions.map((decision) => (
              <DecisionReview key={decision.id} decision={decision} onReplay={onReplay} />
            ))}
          </div>
          {record.decisions.length === 0 && (
            <p className="panel-description">
              There were no hero decisions in this hand. No coaching score is assigned.
            </p>
          )}
        </>
      )}
    </div>
  );
}
