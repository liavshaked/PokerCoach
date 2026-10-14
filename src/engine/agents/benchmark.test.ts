import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { benchmarkPolicy, runPolicyBenchmarks } from './benchmark';
import { applyAction, createHand, getAgentView, getLegalActions } from '../game';
import { policyDistribution } from './index';

function measureDecisionLatency() {
  const milliseconds: number[] = [];
  for (let trial = 0; trial < 30; trial += 1) {
    let hand = createHand({
      seed: `calculated-policy-cold-latency-${trial}`,
      players: Array.from({ length: 6 }, (_, index) => ({
        id: `p${index}`,
        name: `Seat ${index}`,
        stack: 100,
      })),
      smallBlind: 0.5,
      bigBlind: 1,
    });
    while (hand.street === 'preflop')
      hand = applyAction(hand, {
        type: getLegalActions(hand).some((action) => action.type === 'check') ? 'check' : 'call',
      });
    hand = applyAction(hand, { type: 'bet', amount: 4 });
    const view = getAgentView(hand, hand.actorId!);
    const started = performance.now();
    policyDistribution(view, { profile: 'balanced', difficulty: 'advanced' });
    milliseconds.push(performance.now() - started);
  }
  milliseconds.sort((a, b) => a - b);
  return {
    description:
      '30 distinct six-player flop decisions facing a bet, 128 samples, cold equity-cache entries; Node test host, not a phone/browser performance guarantee.',
    samples: milliseconds.length,
    medianMilliseconds: Number(milliseconds[15].toFixed(2)),
    p95Milliseconds: Number(milliseconds[28].toFixed(2)),
    maxMilliseconds: Number(milliseconds[29].toFixed(2)),
  };
}

describe('seeded policy measurement', () => {
  it('reports reproducible outcomes and intervals instead of declaring heuristic strength', () => {
    const one = benchmarkPolicy({ profile: 'balanced', difficulty: 'advanced' }, 12);
    const two = benchmarkPolicy({ profile: 'balanced', difficulty: 'advanced' }, 12);
    expect(one).toEqual(two);
    expect(one.hands).toBe(24);
    expect(one.showdownHands + one.foldHands).toBe(one.hands);
    expect(one.ci95Low).toBeLessThanOrEqual(one.meanBBPer100);
    expect(one.ci95High).toBeGreaterThanOrEqual(one.meanBBPer100);
  });

  it.runIf(process.env.FELTLAB_AI_BENCHMARK === '1')(
    'runs the substantial profile/difficulty benchmark and writes measured results',
    () => {
      const decisionTiming = measureDecisionLatency();
      const pairs = process.env.FELTLAB_AI_BENCHMARK_PAIRS
        ? Number(process.env.FELTLAB_AI_BENCHMARK_PAIRS)
        : 32;
      const results = runPolicyBenchmarks(pairs);
      expect(results).toHaveLength(9);
      expect(results.reduce((sum, result) => sum + result.hands, 0)).toBe(18 * pairs);
      writeFileSync(
        'docs/AI_CALCULATED_BENCHMARK.json',
        JSON.stringify(
          {
            runDate: '2026-10-14',
            model: 'feltlab-calculated-policy-v2',
            seedPrefix: 'feltlab-v3-benchmark-2026-10-13',
            decisionTiming,
            methodology: `${pairs} independent two-hand duplicate-deck blocks per case; policies swap seats. Stack resets to 100 BB every hand. Mean candidate net BB/hand × 100. Approximate 95% normal CI uses sample SD of paired-block means / sqrt(${pairs}). No rake. Measurements only apply against the current calculated balanced/intermediate reference. This bounded smoke benchmark is not a strength or difficulty-ranking validation.`,
            results,
          },
          null,
          2,
        ) + '\n',
      );
    },
    180000,
  );
});
