"""Independent development-only NLHE rules oracle; no application/backend dependency.

All fixture amounts are integer chip units. Clockwise seats start at index zero,
and bet/raise amounts are total street commitments. Only local JSON is read.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from importlib.metadata import version
from pathlib import Path

from pokerkit import Automation, HandHistory, Mode, NoLimitTexasHoldem

AUTOMATIONS = (
    Automation.ANTE_POSTING,
    Automation.BET_COLLECTION,
    Automation.BLIND_OR_STRADDLE_POSTING,
    Automation.RUNOUT_COUNT_SELECTION,
    Automation.HOLE_CARDS_SHOWING_OR_MUCKING,
    Automation.HAND_KILLING,
    Automation.CHIPS_PUSHING,
    Automation.CHIPS_PULLING,
)
STREETS = {"preflop": 0, "flop": 1, "turn": 2, "river": 3}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def validate_hand(hand: dict) -> tuple[int, str]:
    stacks = hand["startingStacks"]
    count = len(stacks)
    require(count in (2, 3, 6), "Unsupported player count")
    require(all(type(x) is int and x > 0 for x in stacks), "Invalid starting stacks")
    button = hand["button"]
    require(type(button) is int and 0 <= button < count, "Invalid button")
    sb, bb = hand["smallBlind"], hand["bigBlind"]
    require(type(sb) is int and type(bb) is int and 0 < sb <= bb, "Invalid blinds")
    require(len(hand["holeCards"]) == count, "Missing hole cards")
    require(all(len(cards) == 2 for cards in hand["holeCards"]), "Invalid hole cards")
    require(len(hand["board"]) in (0, 3, 4, 5), "Invalid board length")
    cards = [card for pair in hand["holeCards"] for card in pair] + hand["board"]
    require(len(set(cards)) == len(cards), "Duplicate known cards")
    # PokerKit seats start left of the button. In HU it swaps supplied blinds,
    # giving PK seat 0 the big blind and PK seat 1 the button/small blind.
    order = [(button + 1 + offset) % count for offset in range(count)]
    game = NoLimitTexasHoldem(
        AUTOMATIONS, False, 0, (sb, bb, *([0] * (count - 2))), bb,
        mode=Mode.CASH_GAME,
    )
    state = game([stacks[seat] for seat in order], count)
    for pk_seat, seat in enumerate(order):
        state.deal_hole("".join(hand["holeCards"][seat]), pk_seat)
    board_offset = 0

    def deal_pending_board() -> None:
        nonlocal board_offset
        for _ in range(8):
            if state.can_burn_card():
                state.burn_card("??")
            if not state.can_deal_board():
                return
            card_count = state.board_dealing_count
            next_cards = hand["board"][board_offset:board_offset + card_count]
            require(len(next_cards) == card_count, "Engine omitted required board cards")
            state.deal_board("".join(next_cards))
            board_offset += card_count
        raise ValueError("Board progression failed to terminate")

    decisions = 0
    for action in hand["actions"]:
        deal_pending_board()
        step = f"action {decisions + 1} {action['street']} seat {action['seat']}"
        require(state.status, f"{step}: PokerKit hand already finished")
        require(state.street_index == STREETS[action["street"]], f"{step}: street mismatch")
        require(state.actor_index == order.index(action["seat"]), f"{step}: actor mismatch")
        expected = action.get("expected")
        if expected:
            actual_stacks = [state.stacks[order.index(seat)] for seat in range(count)]
            require(actual_stacks == expected["stacks"], f"{step}: stacks {actual_stacks} != {expected['stacks']}")
            require(state.checking_or_calling_amount == expected["callAmount"], f"{step}: call amount mismatch")
            can_raise = state.can_complete_bet_or_raise_to()
            require(can_raise == expected["raiseAllowed"], f"{step}: raise permission {can_raise} != {expected['raiseAllowed']}")
            if can_raise:
                require(state.min_completion_betting_or_raising_to_amount == expected["minRaiseTo"], f"{step}: minimum raise mismatch")
                require(state.max_completion_betting_or_raising_to_amount == expected["maxRaiseTo"], f"{step}: maximum raise mismatch")
        if action["kind"] == "fold":
            state.fold()
        elif action["kind"] in ("call", "check"):
            require((state.checking_or_calling_amount == 0) == (action["kind"] == "check"), f"{step}: check/call mismatch")
            state.check_or_call()
        elif action["kind"] in ("bet", "raise"):
            require(type(action["amount"]) is int, f"{step}: noninteger raise")
            state.complete_bet_or_raise_to(action["amount"])
        else:
            raise ValueError(f"{step}: unknown action")
        decisions += 1
    deal_pending_board()
    require(not state.status, "PokerKit hand has not finished")
    require(board_offset == len(hand["board"]), "Engine dealt extra board cards")
    actual = [state.stacks[order.index(seat)] for seat in range(count)]
    require(actual == hand["expectedFinalStacks"], f"Final stacks {actual} != {hand['expectedFinalStacks']}")
    require(sum(actual) == sum(stacks), "Chip conservation failed")
    # Independently serialize PokerKit's completed hand and replay PHH notation.
    phh = HandHistory.from_game_state(game, state).dumps()
    replay = list(HandHistory.loads(phh))[-1]
    require(replay.stacks == state.stacks and not replay.status, "PHH replay mismatch")
    return decisions, phh


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixtures", nargs="?", type=Path, default=Path("test-results/pokerkit-fixtures.json"))
    parser.add_argument("--phh-directory", type=Path, help="Optionally retain independent PHH replay artifacts")
    args = parser.parse_args()
    require(version("pokerkit") == "0.7.7", "Use the pinned scripts/requirements-pokerkit.txt environment")
    document = json.loads(args.fixtures.read_text(encoding="utf-8"))
    require(document.get("version") == 1 and isinstance(document.get("hands"), list), "Invalid fixture format")
    require(0 < len(document["hands"]) <= 10000, "Expected 1–10000 hands")
    counts: Counter[int] = Counter()
    decisions = 0
    if args.phh_directory:
        args.phh_directory.mkdir(parents=True, exist_ok=True)
    for index, hand in enumerate(document["hands"]):
        try:
            hand_decisions, phh = validate_hand(hand)
        except Exception as error:
            print(f"FAIL hand {index} {hand.get('id', '<unknown>')}: {error}", file=sys.stderr)
            return 1
        decisions += hand_decisions
        counts[len(hand["startingStacks"])] += 1
        if args.phh_directory:
            (args.phh_directory / f"hand-{index:05d}.phh").write_text(phh, encoding="utf-8")
    print(f"PokerKit {version('pokerkit')}: PASS {sum(counts.values())} complete hands, {decisions} decisions; seats {dict(sorted(counts.items()))}; PHH replays passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
