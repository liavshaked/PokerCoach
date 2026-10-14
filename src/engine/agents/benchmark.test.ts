import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { benchmarkPolicy, runPolicyBenchmarks } from './benchmark';

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
      const results = runPolicyBenchmarks(500);
      expect(results).toHaveLength(9);
      expect(results.reduce((sum, result) => sum + result.hands, 0)).toBe(9000);
      writeFileSync(
        'docs/V3_AI_BENCHMARK.json',
        JSON.stringify(
          {
            runDate: '2026-10-13',
            model: 'feltlab-range-policy-v1',
            seedPrefix: 'feltlab-v3-benchmark-2026-10-13',
            methodology:
              '500 independent two-hand duplicate-deck blocks per case; policies swap seats. Stack resets to100BB every hand. Mean candidate netBB/hand×100. Approximate95% normal CI uses sample SD of paired-block means /sqrt(500). No rake. Measurements only apply against the balanced/intermediate reference.',
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
