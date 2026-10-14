# Hand replay and saved review

FeltLab V3 replays the actual recorded table. The full-hand player and the preserved spot-drill player share visual controls, but use different history adapters. A spot ends at its training decision; it is never displayed as a completed simulated hand.

## Full-hand reconstruction

`src/engine/game` owns the rules, event stream and reconstruction. Events record hand initialization, blinds, private dealing, player actions, board/burn dealing, uncalled refunds and settlement. `replayHand(events, eventCount)` reduces the requested prefix through the same rules path used during play. Invalid actions, changed chip payments and inconsistent settlement data are rejected.

`src/components/replay/game-replay.ts` builds one frame per event. Each frame is the state **after that event**, accompanied by an action label, street, actor seat and event index. It uses `getPublicView(state, 0)` before creating the table presentation. Neither React nor the replay controls recalculate side pots, winners or legal actions.

The hero's dealt cards are visible to the hero. Other players' cards remain concealed until a real showdown; folded cards remain concealed. A prefix before the flop/turn/river cannot display those later board cards. The replay's source record contains the full local hand, so these projections are a presentation and agent-information boundary, not cryptographic secrecy from the device owner.

`serializeHand` saves a versioned event document. `deserializeHand` reconstructs it instead of trusting a saved chip snapshot. Table persistence also reconstructs each recorded hero decision from its pre-action event prefix and reevaluates its analysis. Decision metadata is not accepted as an independent source of scores.

## Delivered controls and entry points

- Shared visual table showing seats, stacks, street commitments, pot, board, dealer, actor, folds, all-ins and winners.
- First/previous/next/last event, play/pause, timeline scrubbing and 0.5×/1×/2× playback.
- Street shortcuts and a selectable recorded-event list.
- Replay of the live hand so far; opening it from the table pauses bot progression.
- Replay from a completed-hand report, progress history and saved notebook.
- Decision links that open the decision's preceding frame, while whole-hand review can begin at the initial event.
- Dialog focus management and accessible control labels through the existing UI primitives.

Advancing the replay does not submit an action, change the live hand, or create another scored attempt. Leaving replay returns to the review/table context; a paused live table resumes through its own control. Playback currently uses fixed per-event timing rather than recording the original thinking delays.

## Practice-spot replay

`src/features/practice/spot-replay.ts` folds the scenario's authoritative action history. Posts/calls add chips; bets/raises set total street commitment. Streets reveal only the known board prefix for that street. The final frame returns to the training decision with the hero acting. It does not invent later actions, a showdown or opponent hole cards.

Both curated and generated spots remain training exercises with their own provenance. Mathematical answer choices do not become poker betting actions. Replaying either a spot or a full hand does not inflate first-attempt progress.

## Notebook and progress

Completed hands can be saved with notes, tags and a review marker. The notebook supports search, street filtering, marked-only filtering, review, replay and removal. It also preserves saved practice spots separately. Current limits are **60 recent complete hands, 100 explicitly saved full hands and 30 saved spots**. They are local device records, not a cloud archive.

Full-hand progress separates lifetime activity counters from retained analysis. The lifetime hand counter increases only when a hand completes; the lifetime hero-decision counter includes every accepted hero action, including actions in unfinished or abandoned hands. These counters persist on the device until progress is reset.

Charts and scoring use retained completed-hand records, deduplicating a saved hand and its recent-history entry by the underlying hand ID. Unfinished hands never enter those comparisons. The view states the retained hand/decision counts and exposes model scoring coverage, unavailable scores, a chronological trend of up to 12 revealed hands with accessible values, 2/3/6-seat sample comparisons, street comparisons and a focused-practice callback driven by revealed model disagreements. Unavailable trend values remain gaps. Small samples and differing coverage are identified; the UI does not infer improvement or relative skill from them.

`canRevealHandRecord` enforces session-review timing across reports and progress: records from the active deferred-review session stay unscored in the UI until that session ends. Chip outcomes and replay remain available. Older completed sessions can still be reviewed. Model feedback is distinct from mathematical facts such as immediate pot odds, and no full-hand GTO score or measured EV-loss claim is made.

JSON export is available for local backup. Full-hand exports contain private cards and the deterministic initialization needed to reconstruct the hand; there is no redacted public-share format. A user-facing third-party hand-history importer is not implemented.

## Evidence and limits

`src/engine/game/game.test.ts` covers replay/serialization, invalid event imports, information boundaries and rules edge cases. `src/features/table/store.test.ts` covers decision recording, stale-action rejection, feedback timing and storage restoration. The optional PokerKit oracle independently passed **600 full hands, 6,294 decisions and 600 PHH round trips**; setup and exact scope are in [V3 external tools](V3_EXTERNAL_TOOLS.md).

The replay has no editable branches, alternative-action simulator, side-by-side runouts or solver strategy overlays. It displays the original recorded line. A future what-if feature must create a separate branch with its own seed and provenance and must not alter original history or progress. Room-history import, redacted sharing and cross-device synchronization remain deferred; see [the V4 roadmap](V4_ROADMAP.md).
