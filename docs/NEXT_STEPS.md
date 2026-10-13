# Next steps

FeltLab V2 is a local procedural decision trainer. Full-hand heads-up play is deliberately deferred: the existing rules validate decision histories, but a complete game requires a separately tested state machine, all-in runouts, settlement, and an opponent policy for every reachable state. A profile used to construct a range is not that bot.

## Next milestone: verified strategy packs

1. Obtain or produce a redistribution-cleared, genuinely heads-up 100 BB preflop pack. Include positions, rake, bet sizing, effective stacks, policy frequencies, solver settings, and review evidence. Do not relabel a six-max button chart as heads-up.
2. Investigate offline river CFR packs, starting with the MIT Noam Brown project. Pin source versions and archive solver configuration, convergence evidence, exploitability checks, and independent reference comparisons with each pack.
3. Add a versioned pack importer that rejects mismatched game parameters, invalid frequencies, and absent provenance. Keep numerical tolerances and valid mixed actions in scoring.
4. Compare generated river exercises against independently generated reference fixtures. Current arithmetic is exact for its stated finite range; the realism of that range is a separate modeling question.

## Product refinements

- Test on a physical iPhone in Safari and installed standalone mode. Automated browser screenshots verify layout, but cannot prove actual notch, browser toolbar, keyboard, and touch behavior on every device.
- Expand draw families and supported decision categories with explicit evaluators. Value betting and general postflop mixed strategies remain unavailable until defensible models exist.
- Add local import with a preview and schema validation. Export is available now; cross-device sync is not.
- Keep bounded browser history visible to users: the latest 2,000 generated attempts and 200 generated session summaries are retained. Export before archiving longer-term study records.
- Consider worker reuse/prefetch only after profiling real mobile devices. Generation is currently bounded, cancellable, and off the UI thread.

## Full-hand mode prerequisites

Implement a separate game reducer with exhaustive tests for turn order, blinds, minimum raises and reopening rules, short all-ins, showdown, ties, uncalled chips, and bankroll conservation. Connect an opponent through the public-state/private-hand boundary. Benchmark the policy against simple baselines and label its limitations. Only then expose Heads-Up Practice as playable gameplay.
