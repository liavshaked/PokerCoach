import { Bookmark, Play, ArrowRight, ShieldCheck, CheckCircle2, Lightbulb } from 'lucide-react';
import type { CompletedHand, HeroDecision } from '../../features/table/types';
import type { CoachingPoint } from '../../engine/analysis/types';
import { summarizeHand } from '../../engine/analysis';
import { chips } from '../poker/TableView';
import { Button } from '../ui/primitives';

const gradeLabels = {
  preferred: 'Model favors this choice',
  defensible: 'A reasonable option',
  mistaken: 'Worth another look',
};

export function DecisionReview({
  decision,
  onReplay,
  important = false,
}: {
  decision: HeroDecision;
  onReplay?: (eventIndex: number) => void;
  important?: boolean;
}) {
  const { analysis, chosenAction, view } = decision;
  const coaching = analysis.coaching;
  const callAmount = analysis.potOdds?.toCall;
  return (
    <article className={`decision-review${important ? ' key-decision' : ''}`}>
      <header>
        <h3>
          {view.table.street} · {chosenAction.type}
          {chosenAction.amount !== undefined
            ? `${chosenAction.type === 'bet' || chosenAction.type === 'raise' ? ' to' : ''} ${chips(chosenAction.amount)}`
            : chosenAction.type === 'call' && callAmount
              ? ` ${chips(callAmount)}`
              : ''}
        </h3>
        <span className="provenance-badge">
          {important
            ? 'Key decision'
            : analysis.grade
              ? gradeLabels[analysis.grade]
              : 'Review in words'}
        </span>
      </header>
      {coaching ? (
        <>
          <p className="decision-situation">{coaching.situation}</p>
          <p className="decision-verdict">
            <strong>{coaching.verdict}</strong>
          </p>
          <p>{coaching.why}</p>
          <div className="decision-alternative">
            <span className="eyebrow">A LINE TO COMPARE</span>
            <p>{coaching.alternative}</p>
          </div>
          <p>
            <strong>Next time:</strong> {coaching.takeaway}
          </p>
        </>
      ) : (
        <>
          <p>{analysis.explanation}</p>
          <p>
            <strong>{analysis.principle}</strong>
          </p>
        </>
      )}
      <details>
        <summary>How this review was calculated</summary>
        <p>
          {analysis.source.label} · {analysis.confidence} confidence.
        </p>
        {analysis.estimatedEquity && (
          <p>
            Estimated showdown share: {Math.round(analysis.estimatedEquity.share * 100)}% from{' '}
            {analysis.estimatedEquity.samples} simulated completions against{' '}
            {analysis.estimatedEquity.opponents} assumed opponent{' '}
            {analysis.estimatedEquity.opponents === 1 ? 'range' : 'ranges'}. Approximate sampling
            margin: ±{Math.round(analysis.estimatedEquity.samplingMargin * 100)} percentage points.
            This margin does not include uncertainty about the opponent ranges.
          </p>
        )}
        {analysis.potOdds && (
          <p>
            Immediate calling threshold: {(analysis.potOdds.requiredEquity * 100).toFixed(1)}%.{' '}
            {analysis.potOdds.explanation}
          </p>
        )}
        <p>{analysis.assumptions.join(' ')}</p>
        <p>
          {analysis.scored
            ? `Model agreement: ${analysis.score}/100. This measures agreement with the calculated training policy, not GTO accuracy or measured EV.`
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

function CoachingPoints({
  points,
  decisions,
  onReplay,
}: {
  points: CoachingPoint[];
  decisions: HeroDecision[];
  onReplay: (eventIndex?: number) => void;
}) {
  return points.map((point) => {
    const decision = decisions.find((item) => item.id === point.decisionId);
    // Keep the overview compact; the complete explanation follows in the decision review.
    const detail = point.detail
      .split(/(?<=\.)\s+(?=[A-Z])/)
      .slice(0, 2)
      .join(' ');
    return (
      <div className="coaching-point" key={point.decisionId}>
        <strong>{point.title}</strong>
        <p>{detail}</p>
        {decision && (
          <Button variant="ghost" onClick={() => onReplay(Math.max(0, decision.eventIndex - 1))}>
            <Play size={13} /> See the decision
          </Button>
        )}
      </div>
    );
  });
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
  const teaching = report.summary ? report : summarizeHand(record.decisions);
  const hero = record.state.players.find((player) => player.id === 'hero');
  const dealtPlayers = record.state.players.filter((player) => player.startingStack > 0).length;
  const keyDecision = record.decisions.find(
    (decision) => decision.id === report.mostImportantDecisionId,
  );
  return (
    <div className="hand-report">
      <div className="hand-result-banner">
        <div>
          <span className="eyebrow">
            HAND {record.state.handNumber} · {outcome.showdown ? 'SHOWDOWN' : 'WON THROUGH FOLDS'}
          </span>
          <h2>Your hand, explained.</h2>
          <p>
            {hero?.name ?? 'You'} · {dealtPlayers} players · virtual chips
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
          <section className="hand-coaching-summary">
            <p className="panel-description">
              {teaching.summary ??
                'Review the reasons behind your decisions, using only the information available at the time.'}
            </p>
            <div className="coaching-columns">
              <section className="content-panel">
                <h3>
                  <CheckCircle2 size={18} /> What you did well
                </h3>
                {teaching.strengths?.length ? (
                  <CoachingPoints
                    points={teaching.strengths}
                    decisions={record.decisions}
                    onReplay={onReplay}
                  />
                ) : (
                  <p className="panel-description">
                    {report.scoredDecisions === 0
                      ? 'This hand has no decisions the model can score confidently. The reviews below explain what to consider without inventing a positive grade.'
                      : 'There is no clear model-preferred choice to highlight in this hand. Use the comparisons below to find a stronger plan.'}
                  </p>
                )}
              </section>
              <section className="content-panel">
                <h3>
                  <Lightbulb size={18} /> What to work on
                </h3>
                {teaching.improvements?.length ? (
                  <CoachingPoints
                    points={teaching.improvements}
                    decisions={record.decisions}
                    onReplay={onReplay}
                  />
                ) : (
                  <p className="panel-description">
                    {teaching.lessons[0] ??
                      'There were no hero decisions in this hand. Play another hand to build your review.'}
                  </p>
                )}
              </section>
            </div>
          </section>
          {keyDecision && (
            <div className="report-coverage key-decision-shortcut">
              <div>
                <strong>Start with your {keyDecision.view.table.street} decision</strong>
                <p>
                  This decision involved the greatest pot and calling-price weight in your review.
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={() => onReplay(Math.max(0, keyDecision.eventIndex - 1))}
              >
                Replay key decision
                <Play size={14} />
              </Button>
            </div>
          )}
          <details className="report-score-details">
            <summary>Model score, coverage & assumptions</summary>
            <div className="report-metrics">
              <div>
                <strong>{report.score === null ? '—' : Math.round(report.score)}</strong>
                <span>{report.scoreLabel} / 100</span>
                <small>
                  {report.score === null
                    ? 'Insufficient scoring coverage'
                    : 'Training model; not GTO'}
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
                <span>Choices to revisit</span>
                <small>{report.strongDecisions} model-preferred choices</small>
              </div>
            </div>
            <p className="panel-description">
              {report.method} Confidence: {report.confidence}. Chips won or lost never determine
              your coaching score.
            </p>
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
          </details>
          <div className="decision-review-list">
            {record.decisions.map((decision) => (
              <DecisionReview
                key={decision.id}
                decision={decision}
                onReplay={onReplay}
                important={decision.id === report.mostImportantDecisionId}
              />
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
