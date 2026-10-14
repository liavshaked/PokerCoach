import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHand, getAgentView, applyAction } from '../../engine/game';
import { analyzeDecision, summarizeHand } from '../../engine/analysis';
import type { CompletedHand, HeroDecision } from '../../features/table/types';
import { HandReport } from './HandReport';

function completedRecord(): CompletedHand {
  const initial = createHand({
    seed: 'review-render-gate',
    players: [
      { id: 'hero', name: 'You', stack: 100 },
      { id: 'bot-1', name: 'Opponent', stack: 100 },
    ],
    smallBlind: 0.5,
    bigBlind: 1,
  });
  const snapshot = {
    id: 'hero-choice',
    handId: initial.id,
    eventIndex: initial.events.length,
    createdAt: '2026-10-14T12:00:00.000Z',
    view: getAgentView(initial, 'hero'),
    chosenAction: { type: 'fold' as const },
  };
  const decision: HeroDecision = { ...snapshot, analysis: analyzeDecision(snapshot) };
  const state = applyAction(initial, { type: 'fold' });
  return {
    id: state.id,
    sessionId: 'review-session',
    state,
    decisions: [decision],
    report: summarizeHand([decision]),
    outcome: { heroNet: state.result!.netResults.hero, won: false, showdown: false },
    completedAt: '2026-10-14T12:00:01.000Z',
  };
}

describe('hand review presentation', () => {
  it('keeps prose coaching, recommendations, estimated equity and scores behind the reveal gate', () => {
    const record = completedRecord();
    const markup = renderToStaticMarkup(
      createElement(HandReport, { record, reveal: false, onReplay: () => undefined }),
    );
    expect(markup).toContain('Analysis is saved for your session review');
    expect(markup).not.toContain('What you did well');
    expect(markup).not.toContain('What to work on');
    expect(markup).not.toContain('estimated showdown share');
    expect(markup).not.toContain('Model score, coverage');
    expect(markup).not.toContain('A LINE TO COMPARE');
  });

  it('opens with teaching and leaves technical scoring collapsed once feedback is available', () => {
    const markup = renderToStaticMarkup(
      createElement(HandReport, {
        record: completedRecord(),
        reveal: true,
        onReplay: () => undefined,
      }),
    );
    expect(markup).toContain('What you did well');
    expect(markup).toContain('What to work on');
    expect(markup).toContain('A LINE TO COMPARE');
    expect(markup).toContain('Next time:');
    expect(markup).toContain(
      '<details class="report-score-details"><summary>Model score, coverage',
    );
    expect(markup).not.toContain('<details open');
    expect(markup).toContain('Replay key decision');
  });

  it('retains a readable report for saved records without the new narrative fields', () => {
    const record = completedRecord();
    delete record.report.summary;
    delete record.report.strengths;
    delete record.report.improvements;
    delete record.decisions[0].analysis.coaching;
    delete record.decisions[0].analysis.estimatedEquity;
    const markup = renderToStaticMarkup(
      createElement(HandReport, { record, reveal: true, onReplay: () => undefined }),
    );
    expect(markup).toContain('You made one decision');
    expect(markup).toContain('Replay this decision');
    expect(markup).not.toContain('undefined');
  });
});
