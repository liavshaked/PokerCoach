# Operational poker opponents

V3 runs six local opponent personalities through `src/engine/agents/index.ts`. They use the authored `feltlab-range-policy-v1` model. These are conditional range/holding policies, not an LLM, solver strategy, trained research model, professional-strength claim, or GTO implementation.

## Information boundary

The game engine gives each policy an `AgentView`: the public table, that actor's two private cards, and current legal actions. Public players omit live hole cards; public events omit dealt private cards, seeds, burn cards and the future deck. Only actual showdown cards become public. Policies never receive `GameState`, the UI hero projection, another player's hidden hand or future board cards. Policies receive only a random **draw**, not any deck or policy seed. The coordinator owns an independently generated, persisted policy stream, so policy randomness cannot reveal the deck's master seed. Public hand identifiers are opaque. Tests alter hidden cards/deck order and verify identical views and deterministic decisions.

Public observations store action counts, one voluntary preflop entry per hand, aggression, calls/folds, and responses to river bets. They do not store cards or inferred private truth. In an offline browser, a determined user can inspect internal local state; this does not change the application's and policies' explicit information boundaries.

## Coherent personalities

| Profile              | Entry / three-bet structure floors | Aggression coefficient | Bluff coefficient | Behavior                                               |
| -------------------- | ---------------------------------: | ---------------------: | ----------------: | ------------------------------------------------------ |
| Balanced regular     |                            27 / 43 |                   0.62 |              0.10 | Selective position-aware entries; restrained pressure  |
| Tight aggressive     |                            32 / 47 |                   0.72 |             0.035 | Narrow continuations, stronger value lines             |
| Loose aggressive     |                            21 / 37 |                   0.88 |              0.24 | Wider entries, larger bets, more pressure              |
| Patient recreational |                            20 / 51 |                   0.16 |             0.015 | Wide calls, small bets, few three-bets/bluffs          |
| Tricky aggressive    |                            25 / 40 |                   0.77 |              0.20 | Delayed flop value, draw aggression, relevant blockers |
| Observant regular    |                            28 / 43 |                   0.68 |              0.10 | Selective baseline plus bounded expert adaptation      |

These coefficients are authored inputs to a conditional model. They are **not** action-frequency recommendations, population estimates, equity values or source-backed preflop charts. The existing V2 preflop structure function supplies an ordinal card score. Position, earlier raises and price change its entry threshold; several large preflop raises tighten continuing requirements.

Postflop features include the actual best-five hand category from `pokersolver`, top/over/underpairs, potential straight/flush draws, paired/coordinated boards and ace flush blockers. Their combined strength remains an ordinal feature, never an equity estimate. Active-player count, visible aggression, effective stack-to-pot ratio and position affect action weights. Multi-way play becomes more selective and bluff weight decreases. The size model uses distinct profile fractions and preflop raise multipliers, then clamps/rounds to engine-certified legal bounds, including short all-ins.

Randomness samples the resulting conditional action distribution using a reproducible seed. It does not randomly select among legal actions without reference to the holding and public situation. Every selected action passes the same authoritative rules engine as hero actions.

## Difficulty and adaptation

- **Beginner:** no position adjustment or draw bonus; more tolerant calls; simplified aggression responses.
- **Intermediate:** position and potential draws influence the policy.
- **Advanced:** additionally uses multi-way pressure, repeated aggression and board coordination.
- **Expert:** additionally favors relevant ace blockers in preflop three-bet selection and constrains postflop bluffs toward draws/nut-flush blockers, reducing unstructured bluffs. It also enables adaptation for the observant profile. Tests verify a different balanced advanced/expert distribution; this label is not a measured strength ranking.

The observant expert increases its river bluff coefficient by at most 1.6 after at least eight public river-bet opportunities with more than 65% folds against the active opponents. It widens its ordinal defense tolerance by 0.035 after at least 30 public actions with more than 40% bets/raises. Adjustments are deliberately bounded, do not assert population significance, and remain conditioned on board/holding/pot features. Tests check both sample thresholds and the absence of adaptation at lower difficulties.

## Table integration and persistence

`useTableStore` creates 2-, 3- or 6-player games, defaulting to six seats and 100 BB. `stepBot(decisionToken)` advances **one** actor; the UI schedules its delay. A token includes hand ID, event count and actor ID, so repeated/stale timers and double-clicks cannot act twice, even across consecutive hero turns on different streets. Pause/resume preserves the exact actor and history. Next-hand creation rotates the button and respects engine rebuy/sit-out rules.

`feltlab-table-v3` is separate from both V2 progress keys. Persisted hands contain authoritative event histories and compact hero-decision metadata. Restoration replays the events, reconstructs each prior actor information set and reruns deterministic analysis; supplied snapshots/grades are not trusted. Recent history retains 60 hands; the notebook independently retains up to 100 saved full hands with notes, tags and review marks. These retention limits do not cap how many hands a session can play. Export includes event histories for replay and original recorded decisions. Reset preserves table configuration and leaves V2 history untouched.

Cumulative `totals` retain completed-hand count, hero-decision count (including unfinished hands) and net chips across sessions independently of recent-history retention. These are activity/outcome counts, not coaching grades. Coaching trends based on retained histories must be labeled as recent rather than lifetime. Damaged timestamp metadata does not lose real actions: they are reconstructed from authoritative events with an explicitly unknown timestamp. Counters cannot fall below deduplicated known histories; fully pruned pre-counter history cannot be recovered or invented.

Feedback timing is centralized: instant, after the complete hand, or after ending the session. Session-review records remain suppressed while their session is active, including notebook entry points. Unknown opponent cards remain unknown in replay unless actually revealed at showdown.

## Measured policy benchmark

The reproducible run and confidence intervals are stored in [V3_AI_BENCHMARK.json](V3_AI_BENCHMARK.json). The benchmark executes **9,000 complete heads-up hands**: nine profile/difficulty cases, each with 500 independent two-hand blocks. Within a block the deck seed is repeated and the policies swap seats. Blinds are 0.5/1, stacks reset to 100 BB each hand, positions rotate, and there is no rake. Observation history resets per independent block, so the experiment does not measure long-session adaptation. Adaptation is tested separately against supplied public observations.

Each result is candidate net BB per hand ×100 against a balanced/intermediate reference. The approximate 95% interval uses the standard deviation of the 500 paired-block means divided by √500, multiplied by 1.96. The pairing accounts for within-block dependence; intervals remain approximate and apply to this reference/format only. They do not measure exploitability, equilibrium quality, professional strength or multi-way strength. Difficulty changes need not improve returns against this particular opponent.

Measured on October 13, 2026, with the shipped independent policy stream:

| Candidate                     | BB / 100 hands | Approximate 95% interval |
| ----------------------------- | -------------: | ------------------------ |
| Balanced / beginner           |          26.45 | −13.00 to 65.90          |
| Balanced / intermediate       |          21.60 | −10.77 to 53.97          |
| Balanced / advanced           |          18.25 | −13.38 to 49.88          |
| Balanced / expert             |          18.35 | −13.27 to 49.97          |
| Tight aggressive / expert     |          10.85 | −27.42 to 49.12          |
| Loose aggressive / expert     |          31.30 | −15.77 to 78.37          |
| Patient recreational / expert |         −23.55 | −48.27 to 1.17           |
| Tricky / expert               |          23.85 | −9.27 to 56.97           |
| Observant / expert            |          22.65 | −8.85 to 54.15           |

Every interval includes zero. This run does **not** establish superiority over the reference or a reliable difficulty ranking. Its self-play control also includes zero, as expected. Larger independent experiments against multiple policies and humans are needed before making stronger quality claims.

Reproduce in PowerShell:

```powershell
$env:FELTLAB_AI_BENCHMARK='1'
npm.cmd test -- src/engine/agents/benchmark.test.ts
Remove-Item Env:FELTLAB_AI_BENCHMARK
```

The ordinary test suite runs a smaller deterministic benchmark check. External solver-backed or trained agents are extension points; no such full-game policy is registered in this release. Any future adapter must declare supported player counts, stack/action abstractions, exact state matching and traceable source/model provenance before being used or benchmarked.
