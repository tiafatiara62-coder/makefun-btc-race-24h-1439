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
   rise with a 0.50% trailing stop from the peak position value. It
   never re-enters, so a flat or falling window leaves it in cash.
2. **Dip leg:** buy when the close is at least 1.10% below the close
   45 minutes ago; sell the bounce at +0.40% over cost (or -0.75%
   under it).

A full-size round trip costs ~26 bps in fees, slippage and impact, so
the 0.40% dip target and the 0.50% trailing stop are sized just above
that cost while staying small enough to fire in a choppy market.

## Dev-window result (official grade-local, process driver)

Net PnL **+$7.06** (+0.71%), 6 fills (3 round trips), fees $2.41,
max drawdown 0.9%. Positive in both halves of the window: +$4.39 in
the first 12h, +$2.67 in the second 12h. See `BUILD_LOG.md` in the
build workspace for the full sweep (1,000+ parameter sets tested) and
the runner-ups that were rejected.

## Why not RSI+Bollinger

The canonical RSI(14)+Bollinger mean reversion loses -$46.52 on this
dev window (19 trades — the dips keep dipping), plain RSI(14) loses
-$48.21, and EMA-cross 8/21 loses -$95.88. Every window differs; the
numbers on this window decide, and they point at the trend+dip shape
above, not at RSI+BB.
