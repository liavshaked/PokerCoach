import { applyAction, createHand, getAgentView, validateGameState } from '../game';
import { seededRandom } from '../generation/random';
import { chooseAgentAction, observePublicAction } from './index';
import type { AgentDifficulty, AgentProfileId, PublicObservations } from './index';

export interface BenchmarkCase {
  profile: AgentProfileId;
  difficulty: AgentDifficulty;
}
export interface BenchmarkResult extends BenchmarkCase {
  reference: 'balanced / intermediate';
  pairedSeeds: number;
  hands: number;
  meanBBPer100: number;
  ci95Low: number;
  ci95High: number;
  showdownHands: number;
  foldHands: number;
}
export const benchmarkCases: BenchmarkCase[] = [
  ...(['beginner', 'intermediate', 'advanced', 'expert'] as const).map((difficulty) => ({
    profile: 'balanced' as const,
    difficulty,
  })),
  ...(['tight-aggressive', 'loose-aggressive', 'passive', 'tricky', 'exploitative'] as const).map(
    (profile) => ({ profile, difficulty: 'expert' as const }),
  ),
];

/** Independent seeded two-hand blocks swap policy seats on identical decks. No bankroll elimination bias. */
export function benchmarkPolicy(candidate: BenchmarkCase, pairedSeeds = 500): BenchmarkResult {
  if (!Number.isInteger(pairedSeeds) || pairedSeeds < 2 || pairedSeeds > 10000)
    throw new Error('Benchmark needs 2–10,000 independent paired seeds.');
  const samples: number[] = [];
  let showdownHands = 0;
  let foldHands = 0;
  for (let trial = 0; trial < pairedSeeds; trial += 1) {
    // Reset observation history per independent block; carry only between its two paired hands.
    let observations: PublicObservations = {};
    let blockNet = 0;
    for (const candidateSeat of [0, 1]) {
      const seed = `feltlab-v3-benchmark-2026-10-13:${trial}`;
      let state = createHand({
        seed,
        players: [
          { id: 'p0', name: 'Seat 0', stack: 100 },
          { id: 'p1', name: 'Seat 1', stack: 100 },
        ],
        buttonSeat: trial % 2,
        smallBlind: 0.5,
        bigBlind: 1,
        chipUnit: 0.5,
      });
      let actions = 0;
      while (!state.result) {
        const actor = state.actorId!;
        const isCandidate = actor === `p${candidateSeat}`;
        const view = getAgentView(state, actor);
        const policy = isCandidate
          ? candidate
          : { profile: 'balanced' as const, difficulty: 'intermediate' as const };
        const action = chooseAgentAction(view, {
          ...policy,
          observations,
          randomValue: seededRandom(
            `independent-policy-stream:${trial}:${candidateSeat}:${state.events.length}:${actor}`,
          )(),
        });
        observations = observePublicAction(observations, view, action);
        state = applyAction(state, action);
        if (++actions > 150) throw new Error('Benchmark encountered a nonterminating hand.');
      }
      if (!validateGameState(state).valid)
        throw new Error('Benchmark encountered invalid chip accounting.');
      blockNet += state.result.netResults[`p${candidateSeat}`];
      if (state.result.reason === 'showdown') showdownHands += 1;
      else foldHands += 1;
    }
    samples.push(blockNet / 2);
  }
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance =
    samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (samples.length - 1);
  const halfWidth = 1.96 * Math.sqrt(variance / samples.length);
  return {
    ...candidate,
    reference: 'balanced / intermediate',
    pairedSeeds,
    hands: pairedSeeds * 2,
    meanBBPer100: Number((mean * 100).toFixed(2)),
    ci95Low: Number(((mean - halfWidth) * 100).toFixed(2)),
    ci95High: Number(((mean + halfWidth) * 100).toFixed(2)),
    showdownHands,
    foldHands,
  };
}

export function runPolicyBenchmarks(pairedSeeds = 500): BenchmarkResult[] {
  return benchmarkCases.map((candidate) => benchmarkPolicy(candidate, pairedSeeds));
}
