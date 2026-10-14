# Calculated poker opponents

The current opponent model is `feltlab-calculated-policy-v2`, implemented in `src/engine/agents/`. It combines a bounded showdown simulation with explicit range and betting assumptions. Six personalities and four difficulty settings remain operational. No LLM, external service, paid API or downloaded research policy is required. This is a local training opponent, with no claim of solver optimality or professional strength.

## What a decision calculates

`estimateSituation(view, samples = 128)` samples plausible opponent holdings and remaining board cards, evaluates the resulting best-five hands, and estimates the acting player's share at showdown. A positive-weight range is constructed for every live opponent from public preflop entries and public postflop calls, bets and raises. Large or repeated aggression favors stronger value holdings while retaining authored draw/bluff weight. Checked and unentered ranges remain broad. Known cards block impossible holdings; sampled opponents cannot share cards. Randomized assignment order reduces seat-order effects in the sequential range approximation.

This estimate uses **assumed ranges**, not actual hidden cards. The accompanying standard error measures simulation noise only; uncertainty about the range model can be much larger. The model does not infer an exact joint Bayesian posterior or claim GTO frequencies. Folded, unrevealed cards remain unknown. There is no use of future game cards or information revealed later in the hand.

For a call, the calculation caps eligible contributions at the player's contribution after calling. Inaccessible side pots are excluded from the price, and estimated showdown shares are weighted across eligible pot layers. Opponents who can fund a layer are assumed to contest it. The immediate break-even price is `call / (currently eligible pot + call)`. Future calls, folds, bets, rake and tournament payout utility are excluded. The policy therefore does not label the estimate as actual call EV.

The action policy compares this estimate with the call price. Before the river, it also applies an explicitly authored equity-realization discount for position and multiple opponents. All-in runouts and river calls do not receive this future-betting discount. Pot-relative sizing changes with estimated value, board coordination, profile and stack-to-pot ratio; strong short-stack value hands can commit their remaining stack. Every amount is rounded and clamped to the game engine's legal bounds.

Preflop hand structure and position remain selection inputs. A high raw showdown share does not by itself justify playing an early-position holding through several betting rounds. A forced all-in call is evaluated primarily through its modeled showdown share and actual price. Postflop selection uses sampled showdown outcomes instead of treating an ordinal made-hand score as equity. Hand-category, draw and blocker features explain the context and help choose pressure/sizing; they remain distinct from the simulation result.

## Information and runtime boundary

Policies accept only `AgentView`: the public table, the acting player's own two cards and legal actions. Public views omit private opponent cards, future deck order, burns, deal seeds and hidden event data. A coordinator supplies one independent `randomValue` draw for action sampling. Policies never receive the deck seed or policy stream seed.

The estimator's deterministic sampling seed is derived only from public range summaries, own cards and the visible board. Price-only changes preserve the same simulation draws, so a larger call does not accidentally get a more favorable estimate from fresh sampling noise. A bounded 384-entry cache is shared by opponent policy and coaching. Sampling is restricted to 32-256 trials; the shipped policy and coach use 128.

A small exact standard Hold'em rank helper handles simulation samples. Actual game settlement still uses the existing `pokersolver` integration. The helper is differentially tested against that evaluator in 2,000 seeded random 5-7-card comparisons plus wheel, full-house, flush and board-tie cases. Range features are prepared once per range instead of rebuilding board maps for every candidate holding.

The measured cold six-player flop calculation in the checked-in benchmark took a median **9.76 ms**, p95 **15.52 ms**, and maximum **24.55 ms** over 30 distinct decisions on the Node test host. This is a development measurement, not a phone or browser guarantee. Browser flow tests cover the actual interface separately.

Public observations contain action counts, preflop entry counts and river-bet responses. They contain no private-card truth. A determined user can inspect their own offline browser storage; that does not change what the application passes to policies.

## Personalities and difficulty

| Profile              | Entry / three-bet structure floors | Aggression | Bluff coefficient | Distinct behavior                                              |
| -------------------- | ---------------------------------: | ---------: | ----------------: | -------------------------------------------------------------- |
| Balanced regular     |                            27 / 43 |       0.62 |              0.10 | Selective entries and restrained pressure                      |
| Tight aggressive     |                            32 / 47 |       0.72 |             0.035 | Narrower continuations and stronger value lines                |
| Loose aggressive     |                            21 / 37 |       0.88 |              0.24 | Wider entries, larger sizes and more pressure                  |
| Patient recreational |                            20 / 51 |       0.16 |             0.015 | Wider calls, smaller bets and few three-bets                   |
| Tricky aggressive    |                            25 / 40 |       0.77 |              0.20 | Delayed flop value and draw/blocker pressure                   |
| Observant regular    |                            28 / 43 |       0.68 |              0.10 | Selective baseline plus bounded public-observation adjustments |

These coefficients define an authored behavior model; they are not population estimates or solved action frequencies. The same public-range calculation supports every personality, while selection thresholds, call tolerance, aggression and sizing produce different choices.

- **Beginner:** more tolerant calls and simplified position/pressure treatment.
- **Intermediate:** position and drawing potential affect selection.
- **Advanced:** also responds to repeated aggression, multiple opponents and coordinated boards.
- **Expert:** also changes blocker-sensitive preflop three-bet selection and postflop bluff construction. It enables the observant profile's bounded adaptation.

An observant expert can multiply its river bluff coefficient by at most 1.6 after at least eight publicly observed river-bet opportunities with more than 65% folds. It widens call tolerance by 0.035 after at least 30 actions with more than 40% bets/raises. These are modest behavioral adjustments, not statistical claims about a player's true strategy. A higher difficulty label is not a measured strength ranking.

## Continuous table and review integration

The table maintains stack ownership across hands, eliminates busted players and rotates play among remaining seats until a champion remains. Policies exclude folded and eliminated players from sampled opposition. An eliminated player cannot re-enter through an invented range or rebuy. The table controller owns animation delays, automatic dealing, pausing and fast-forward; the policy supplies only one legal action at a time.

`decisionToken` includes hand identity, event count and acting player. Stale timers cannot apply a second action after the decision changes. Pausing, reviewing and replaying preserve authoritative history. Coaching reuses the same calculation but explains position, price, range assumptions, chosen action and a practical alternative in ordinary language. Outcome and later-revealed cards are not inputs to the earlier decision review.

Numeric coaching remains **model agreement**, with explicit coverage limits. A sampled range estimate does not make a multiway/all-in score or an EV-loss claim automatically trustworthy. Feedback timing continues to gate review visibility during live play and deferred sessions. See [STRATEGY_SCORING.md](STRATEGY_SCORING.md) for review and aggregation rules.

## Current benchmark and historical results

[AI_CALCULATED_BENCHMARK.json](AI_CALCULATED_BENCHMARK.json) records a bounded run of **576 complete heads-up hands** for the current calculated policy, measured on October 14, 2026: nine profile/difficulty cases, each with 32 independent two-hand blocks. Within a block the policies swap seats on the same deck. Each hand begins with 100 BB stacks, blinds 0.5/1, and no rake. Public-observation history resets between independent blocks.

Each candidate is compared with the current balanced/intermediate reference. Approximate 95% intervals use the standard deviation of paired-block means divided by the square root of the block count, multiplied by 1.96. All intervals in this small run include zero. The run verifies reproducible outcomes and legal complete play; it does **not** establish superiority, tournament strength, exploitability, a difficulty ranking or an improvement over the previous model. Some balanced difficulty results are identical in this small sample; tests separately exercise the specific conditions where their policies differ.

The older [V3_AI_BENCHMARK.json](V3_AI_BENCHMARK.json) contains 9,000 hands for `feltlab-range-policy-v1`. It is preserved as a historical artifact and does not describe the current calculated model. The new model has not been matched against the old model in a strength experiment.

Reproduce the bounded current run in PowerShell:

```powershell
$env:FELTLAB_AI_BENCHMARK='1'
$env:FELTLAB_AI_BENCHMARK_PAIRS='32'
npm.cmd test -- src/engine/agents/benchmark.test.ts
Remove-Item Env:FELTLAB_AI_BENCHMARK
Remove-Item Env:FELTLAB_AI_BENCHMARK_PAIRS
```

Increasing paired blocks improves sampling precision at additional runtime. The ordinary suite runs a smaller reproducibility check, complete hands across all formats/profiles/difficulties, public-information isolation checks, price sensitivity, card blocking, strong/weak holdings, exact board ties and side-pot eligibility tests. Future solver-backed or trained agents must declare their supported formats, action abstractions, source and validation before replacing this policy.
