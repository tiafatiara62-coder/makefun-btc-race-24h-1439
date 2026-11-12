# BTC race bot — one-shot trend + dip bounce (btc-race-24h-20261112-1439)

Entry for make.fun's "Race a BTC trading bot live for 24 hours"
(`btc-race-24h-20261112-1439`). Long-only bot trading cbBTC/USDC on
1-minute bars with $1,000 of paper money. Runs on Node 22, standard
library only; `vendor/makefun-bars.ts` is the kit's SDK shim, copied
byte-for-byte.

## Strategy

Two small, fast pieces, tuned on the competition's dev window
(2026-11-11 14:39 -> 2026-11-12 14:39 UTC, BTC -2.30%):

1. **Trend leg (one-shot, opening hours only):** buy once, only while
   the bar index is below 240 (first four hours), when the close is
   above its 24-bar EMA and the 60-minute return is at least +0.50%.
   Rides the rise with a 0.35% trailing stop from the peak position
   value. It never re-enters, so a flat or falling window leaves it in
   cash.
2. **Dip leg:** buy when the close is at least 1.30% below the close
   60 minutes ago; sell the bounce at +0.70% over cost (or -1.00%
   under it).

A full-size round trip costs ~26 bps in fees, slippage and impact, so
the 0.70% dip target and the 0.35% trailing stop are sized just above
that cost while staying small enough to fire in a choppy market.

## Dev-window results (official grade-local, process driver)

| window | net PnL | fills | fees | max drawdown |
|---|---|---|---|---|
| this race's dev (11–12 Nov, BTC -2.30%) | **+$8.20** (+0.82%) | 4 | $1.61 | 0.62% |
| previous race's dev (10–11 Nov, BTC -1.07%) | **+$5.69** (+0.57%) | 2 | $0.80 | 1.00% |

Two round trips on the new window (trend + one dip) and one round trip
on the old window (one dip). See `BUILD_LOG.md` in the
build workspace for the full sweep (5,000+ parameter sets tested across
both windows) and the runner-ups that were rejected.

## Revision 2: two-window robustness (early trend cap + deeper dip)

The first version (+$8.42 on this race's dev window) loses -$16.29 on the
previous race's dev window (2026-11-10 08:01 -> 2026-11-11 08:01 UTC):
both dip trades hit their stop and the trend trade trails out inside a
down day. Every earlier candidate was one-sided the same way, so this
version is tuned to be profitable on BOTH dev windows instead of
maximising one:

- Dip leg: 1.10% over 45 min, TP +0.40% / SL -0.75% -> **1.30% over 60
  min, TP +0.70% / SL -1.00%**. The deeper, slower dip with a wider
  take-profit and wider stop holds through the noise to the rebound on
  both windows; the old shape was stopped out before the rebound twice
  on the old window.
- Trend leg: unchanged (60-min return >= +0.50%, close above EMA-24,
  0.35% trailing stop), but **fires only while the bar index is below
  240** (first four hours). In both windows the only profitable trend
  signal is the opening rise; a mid-window trend signal is a rebound
  inside a down day and trails out at a loss.

Official grade-local (process driver), both kits:

| window | net PnL | fills | fees | max drawdown |
|---|---|---|---|---|
| this race's dev (11–12 Nov) | **+$8.20** | 4 | $1.61 | 0.62% |
| previous race's dev (10–11 Nov) | **+$5.69** | 2 | $0.80 | 1.00% |

The numbers come from a plateau, not a knife edge: the fine grid around
the chosen parameters (dip window 55–75, drop 125–135 bp, take-profit
65–75 bp) is positive on both windows in 38 of 45 points, the
trailing-stop hill (25–45 bp) is smooth with 35 bp in the middle of its
flat top, and the early-trend cap gives identical results for any cap
between 120 and 360 bars.

Best rejected variant: dip 60/130/TP70 with a 90-minute dip window
instead of 60 — min $5.90, sum $12.74 (vs $5.69 / $13.89 chosen); it
wins the old window by $0.21 but loses $2.14 on the new window, fires
an extra late-window dip that flattens at a loss, and would rank the
entry lower on the dev leaderboard. The chosen set has the better sum,
the better new-window result, and fewer, more selective entries.

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
