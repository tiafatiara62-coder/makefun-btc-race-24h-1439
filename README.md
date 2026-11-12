# BTC race bot — trend + deep dip + shallow rebound (btc-race-24h-20261112-1439)

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
2. **Deep-dip leg:** buy when the close is at least 1.30% below the
   close 60 minutes ago; sell the bounce at +0.70% over cost (or -1.00%
   under it).
3. **Shallow rebound leg:** buy when the close is at least 0.70% below
   the close 55 minutes ago AND has already bounced at least 0.20%
   over the last 10 minutes; sell at +0.80% over cost (or -0.75% under
   it). The bounce gate keeps it out of a falling knife: without it the
   leg buys into the drop, and with a looser gate it fires in the second
   half of the new window's grind-down and loses there. With the +0.20%
   gate it never fires on the new window, but on the old window it
   catches the strong mid-morning rebound for +$9.69.

A full-size round trip costs ~26 bps in fees, slippage and impact, so
the 0.70% dip target and the 0.35% trailing stop are sized just above
that cost while staying small enough to fire in a choppy market.

## Dev-window results (official grade-local, process driver)

| window | net PnL | fills | fees | max drawdown |
|---|---|---|---|---|
| this race's dev (11–12 Nov, BTC -2.30%) | **+$8.20** (+0.82%) | 4 | $1.61 | 0.62% |
| previous race's dev (10–11 Nov, BTC -1.07%) | **+$15.42** (+1.54%) | 4 | $1.61 | 1.00% |

Two round trips on each window (new: trend + one deep dip; old: one
shallow rebound + one deep dip). See `BUILD_LOG.md` in the
build workspace for the full sweep (5,000+ parameter sets tested across
both windows) and the runner-ups that were rejected.

## Revision 3: shallow rebound leg with bounce gate

The two-window version (+$8.20 new / +$5.69 old) left the whole
old-window profit on a single deep-dip trade. A sweep of a second dip
leg (216 combos, then a 576-combo refinement) found a shallow rebound
shape that adds a second old-window trade without touching the new
window at all:

- **New leg:** 55-minute window, drop >= 0.70%, bounce gate +0.20%
  over 10 minutes, TP +0.80% / SL -0.75%. It buys the old window's
  mid-morning rebound (bars ~369–421, +$9.69) and never fires on the
  new window, where the same gate stays shut.
- The gate is the leg: with a looser bounce gate (+0.10–0.15%) the leg
  fires in the new window's second-half grind-down and loses -$11 to
  -$13 there; with a stricter gate (+0.30%) it never fires on either
  window. A late-window dip leg (H2 only, 120–180-minute window) was
  also tested and loses -$8.76 to -$12.05 on the new window — the
  second half there is a slow bleed with at most +42 bp of bounce, so
  no dip leg can trade it profitably; the bot stays flat there.

Official grade-local (process driver), both kits:

| window | net PnL | fills | fees | max drawdown |
|---|---|---|---|---|
| this race's dev (11–12 Nov) | **+$8.20** | 4 | $1.61 | 0.62% |
| previous race's dev (10–11 Nov) | **+$15.42** | 4 | $1.61 | 1.00% |

Min $8.20 / sum $23.62, up from $5.69 / $13.89 — the min is now set by
the new window instead of the old one. The numbers come from a
plateau, not a knife edge: the shallow leg's fine grid (dip window
50–60, drop 60–75 bp, take-profit 70–90 bp, bounce gate +0.18–0.22%
over 10 minutes) keeps the old window at $12.80–$15.42 in 33 of 108
points, and the trailing-stop hill (25–45 bp) is smooth with 35 bp in
the middle of its flat top (the 30 bp peak, +$8.98, was not taken:
it is one trend trade's exit timing, and the middle of the hill is the
more robust choice).

Best rejected variant: the same shallow leg with a 30 bp trailing
stop — min $8.98, sum $24.40. Rejected because the extra $0.78 is one
trend trade's exit on the new window; the chosen 35 bp keeps the
robust middle of the trail hill.

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
