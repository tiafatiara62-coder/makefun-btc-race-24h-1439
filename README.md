# BTC race bot — one-shot trend + dip bounce (btc-race-24h-20261112-1439)

Entry for make.fun's "Race a BTC trading bot live for 24 hours"
(`btc-race-24h-20261112-1439`). Long-only bot trading cbBTC/USDC on
1-minute bars with $1,000 of paper money. Runs on Node 22, standard
library only; `vendor/makefun-bars.ts` is the kit's SDK shim, copied
byte-for-byte.

## Strategy

Two small, fast pieces, tuned on the competition's dev window
(2026-11-11 14:39 -> 2026-11-12 14:39 UTC, BTC -2.30%):

1. **Trend leg (one-shot):** buy once, only when the close is above its
   24-bar EMA and the 60-minute return is at least +0.50%. Rides the
   rise with a 0.35% trailing stop from the peak position value. It
   never re-enters, so a flat or falling window leaves it in cash.
2. **Dip leg:** buy when the close is at least 1.10% below the close
   45 minutes ago; sell the bounce at +0.40% over cost (or -0.75%
   under it).

A full-size round trip costs ~26 bps in fees, slippage and impact, so
the 0.40% dip target and the 0.35% trailing stop are sized just above
that cost while staying small enough to fire in a choppy market.

## Dev-window result (official grade-local, process driver)

Net PnL **+$8.42** (+0.84%), 6 fills (3 round trips), fees $2.41,
max drawdown 0.74%. Positive in both halves of the window: +$5.56 in
the first 12h, +$2.67 in the second 12h. See `BUILD_LOG.md` in the
build workspace for the full sweep (1,000+ parameter sets tested) and
the runner-ups that were rejected.

## Revision: trailing stop 0.50% -> 0.35%

The first version trailed the trend leg at 0.50% and graded +$7.06.
A focused re-sweep of the trailing stop (15–60 bps, everything else
held at the chosen set) shows a smooth hill, not a spike: 25 bps
+$5.37, 30 bps +$9.20, 35 bps +$8.42, 40 bps +$8.23, 45 bps +$7.58,
50 bps +$7.06 — every value from 25 to 50 bps is positive in both
halves of the window, and the dip leg is untouched (H2 stays +$2.67
throughout). 35 bps is the middle of the hill's flat top (30–40 bps,
+$8.23 to +$9.20), so it was chosen over the peak at 30 bps: on the
unseen race window the exact peak will not transfer, and the middle
of a flat region is the least sensitive choice. Tighter than 25 bps
the trend leg stops banking anything (15–20 bps go negative in H1),
so the stop must stay above ~25 bps.

## Why not RSI+Bollinger

The canonical RSI(14)+Bollinger mean reversion loses -$46.52 on this
dev window (19 trades — the dips keep dipping), plain RSI(14) loses
-$48.21, and EMA-cross 8/21 loses -$95.88. Every window differs; the
numbers on this window decide, and they point at the trend+dip shape
above, not at RSI+BB.
