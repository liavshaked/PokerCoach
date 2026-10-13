/** EV of calling relative to folding now (past contributions are sunk).
 * currentPot includes the opponent's bet. No future bets, and zero rake. */
export function callEV(equity: number, currentPot: number, toCall: number): number {
  if (
    ![equity, currentPot, toCall].every(Number.isFinite) ||
    equity < 0 ||
    equity > 1 ||
    currentPot < 0 ||
    toCall < 0
  )
    throw new Error('Invalid equity or chip amounts.');
  return equity * (currentPot + toCall) - toCall;
}
export const foldEV = (): number => 0;
/** Probability that at least one of a fixed set of outs appears. Assumes a
 * uniformly unknown deck and no information about the opponent's hole cards. */
export function drawProbability(outs: number, unseen: number, cardsToCome = 1): number {
  if (
    ![outs, unseen, cardsToCome].every(Number.isInteger) ||
    unseen < 1 ||
    outs < 0 ||
    outs > unseen ||
    cardsToCome < 1 ||
    cardsToCome > unseen
  )
    throw new Error('Invalid outs or unseen-card count.');
  let miss = 1;
  for (let i = 0; i < cardsToCome; i++) miss *= Math.max(0, unseen - outs - i) / (unseen - i);
  return 1 - miss;
}
/** A zero-showdown-value bluff risks bet to win potBeforeBet; no rake. */
export function bluffBreakEven(bet: number, potBeforeBet: number): number {
  if (![bet, potBeforeBet].every(Number.isFinite) || bet <= 0 || potBeforeBet <= 0)
    throw new Error('Bluff and pot must be positive finite amounts.');
  return bet / (potBeforeBet + bet);
}
