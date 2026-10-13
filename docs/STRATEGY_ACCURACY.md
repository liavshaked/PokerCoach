# Strategy accuracy and evaluation boundaries

FeltLab ships **no verified heads-up preflop chart, solver strategy, or GTO action-frequency policy**. The original 16 exercises remain illustrative. Generated drills explicitly separate exact calculations under stated assumptions from heuristic guidance.

## What is scored

| Training type                                | Evaluation                                                        | Mathematical scoring |
| -------------------------------------------- | ----------------------------------------------------------------- | -------------------- |
| Original curated spots                       | Scenario-specific educational judgment                            | No                   |
| Generated blind defense / facing a three-bet | Authored weighted heads-up range and hand-structure ranking       | No                   |
| Generated river call/fold                    | Exact weighted showdown equity against the displayed finite range | Yes                  |
| Pot odds                                     | Additional call divided by final pot after calling                | Yes                  |
| Drawing odds                                 | Probability of hitting one of the stated direct outs              | Yes                  |
| Bluff mathematics                            | Required fold probability for a hypothetical pure bluff           | Yes                  |

Heuristic results may be recorded as preferred, defensible or mistaken **within that teaching model**. They do not contribute to mathematical challenge accuracy. A mathematical score is not GTO accuracy. Only terminal river call/fold models support an EV-loss statistic.

## River model

1. Shuffle a normal 52-card deck with a versioned seed. Deal two hero cards and five board cards.
2. Build a legally replayable heads-up history with 100 BB starting stacks, two blind posts, valid betting order and covered bets.
3. Using **only the public board**, sample 48 distinct opponent holdings from the remaining 47 cards and rank their seven-card hands with the MIT `pokersolver` evaluator.
4. The top 16 sampled holdings form a modeled value group; the bottom 16 form a modeled bluff group. These are relative groups within a finite sample, not a claim that every low-ranked hand has zero equity against every hero holding.
5. Let `P` be the pot before the opponent's final bet and `B` the bet. Each value combo has weight 1. The baseline bluff/value weight ratio is `B / (P + B)`. This is the polar indifference relation for a pure bluff catcher; **it does not make the whole sampled range an equilibrium strategy**.
6. The tight profile multiplies bluff weights by one third; aggressive multiplies by 1.7. Recreational multiplies by 0.7 and includes the middle 16 holdings at weight 0.6. These fixed deviations are authored modeling assumptions, not observed player statistics.
7. Remove combinations blocked by hero cards, board or supplied dead cards. Renormalize the remaining weights. Every remaining combination is evaluated exactly; ties count half a pot.

The baseline, tight and aggressive models contain 32 weighted combinations before hero removal. Recreational contains 48. Range construction does not inspect hero strength. Hero cards are used only for legal removal and equity calculation. Calling closes betting and goes to showdown; no raises, future streets, side pots or rake are modeled.

```
equity = (winning weight + 0.5 × tied weight) / legal total weight
required equity = call / (current pot + call)
call EV = equity × (current pot + call) − call
fold EV = 0
```

The current pot already includes the opponent bet. Prior contributions are sunk. The larger-EV action is preferred; the other action remains defensible when its EV difference is at most 0.05 BB. Exact arithmetic against a supplied model does not establish that the modeled range is a good description of a real opponent. Earlier actions are legal but the generator does not infer a posterior betting range from their strategic likelihood.

## Preflop model

The generated preflop exercises are specifically 100 BB heads-up button/small blind versus big blind. They cover facing an open and facing a three-bet. Four-bet response drills and other stack depths are not supported. No six-max or full-ring chart is relabeled as heads-up data.

The authored structural score rewards pairs, high cards, suitedness and connectedness. All possible two-card combinations are enumerated, a profile-specific structural floor selects model membership, and smooth weights express stronger or weaker membership. Known hero cards are removed before comparing the hero score to the weighted model distribution.

**A structural percentile is not hand equity, action frequency, EV, or a solved strategy.** Price-sensitive authored thresholds select qualitative teaching preferences, with nearby alternatives marked defensible. This model cannot measure postflop equity realization or establish optimal mixed strategies. It is excluded from mathematical scoring. The user can inspect its range, assumptions and source label.

## Drawing and price drills

Math drills use separate answer objects; choosing a percentage does not pretend the player folded or called. Real legal poker actions remain in the scenario model solely to preserve state integrity.

A flush drill has four visible cards of one suit and nine unseen suited outs. Open-ended and gutshot families have eight and four direct straight outs respectively. The exercise explicitly asks about hitting those **direct outs**. Other possible improvement routes and whether the resulting hand actually wins are outside the question.

For one card, probability is `outs / unseen`. For two cards without replacement, it is `1 − ((unseen − outs) / unseen) × ((unseen − outs − 1) / (unseen − 1))`. The unseen deck is conditioned on visible cards only. A two-card chance does not imply that a flop call buys both cards. No unknown opponent holdings are treated as known dead cards.

A bluff drill prices a **hypothetical zero-equity bluff**, `bet / (pot before bet + bet)`. The visible hand may have showdown value; the drill does not recommend bluffing it. Pot-odds drills give the immediate price, not the actual equity or profitability of an earlier-street call.

## Verification and limitations

The automated engine suite includes 10,000 seeded generated scenarios across all supported street/type combinations and all four profiles. Each is reproduced from its seed, replayed and checked for unique cards, legal actions, pot and stack accounting, coherent provenance and available answers. Ranking tests cover wheels, full houses, flush kickers, board-playing ties and 250 independently calculated best-of-21 comparisons. Weighted-equity tests cover ties, blocked combinations and dead cards.

Frequency import support requires an identified reviewer or solver, a traceable reference, valid actions and probabilities totaling one within numerical tolerance. No distribution satisfying that contract is shipped as a real poker policy. A provenance string is a validation requirement, not independent verification of the source's truth.

A complete heads-up bot, postflop solver, verified range-chart pack, rake, unmatched all-ins and side pots are deferred. See `POKER_ENGINE_RESEARCH.md` for dependency and data-license research.
