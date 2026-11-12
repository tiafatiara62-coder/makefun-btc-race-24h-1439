// One-shot early uptrend + deep-dip bounce + shallow rebound bot for
// btc-race-24h-20261112-1439. Long only, one position, full size. Every
// decision is a pure function of the closes seen so far: no clock, no
// environment, no Math.random, so two runs on the same data produce
// identical orders.
//
// Why this shape: the previous version of this bot (+$8.20 on this race's
// dev window, +$5.69 on the previous race's) is one-sided in a different
// way — its whole old-window profit is a single deep-dip trade, and it
// never trades at all in the second half of the new window. The race
// window (20:54 UTC 12 Nov -> 20:54 UTC 13 Nov) is unseen, so this
// version is tuned on BOTH dev windows instead of maximising one:
//
//   1. Trend leg (one-shot, opening hours only): buy once, only while the
//      bar index is below 240 (the first four hours of the window), when
//      the close is above its 24-bar EMA and the 60-minute return is at
//      least +0.50%. It rides the rise with a 0.35% trailing stop from the
//      peak position value and never re-enters. In both observed windows
//      the only profitable trend signal is the opening rise; a mid-window
//      trend signal is a rebound inside a down day and trails out at a
//      loss, so the leg is not allowed to fire after the opening hours.
//   2. Deep-dip leg: buy when the close is at least 1.30% below the close
//      60 minutes ago, and sell the bounce at +0.70% over cost (or -1.00%
//      under it). The deeper, slower dip with a wider take-profit and a
//      wider stop survives the noise long enough to bank the rebound on
//      both windows.
//   3. Shallow rebound leg: buy when the close is at least 0.70% below
//      the close 55 minutes ago AND the close has already bounced at
//      least 0.20% over the last 10 minutes, and sell at +0.80% over cost
//      (or -0.75% under it). The bounce-confirmation gate is what makes
//      this leg work: without it the leg buys into a falling knife, and
//      with a looser gate (+0.10–0.15% over 10 minutes) it fires in the
//      second half of the new window's grind-down and loses heavily there.
//      With the +0.20% gate it never fires on the new window at all, so
//      the new-window result is unchanged — but on the old window it
//      catches the strong mid-morning rebound (bars ~369–421) for +$9.69
//      on top of the deep-dip trade.
//
// What did NOT work, tested on both windows: a late-window dip leg
// (H2 only, 120–180-minute window, 1.30% drop) loses -$8.76 to -$12.05
// on the new window — the second half there is a slow bleed with only
// +42 bp of bounce at best, so every dip-buy that fires there stops
// out. The second half of the new window is untradeable for dip legs in
// this family; the bot stays flat there rather than bleed.
//
// A full-size round trip costs ~26 bps in fees, slippage and impact, so
// the 0.70–0.80% dip targets and the 0.35% trailing stop sit above that
// cost while staying small enough to fire in a choppy market. On the two
// dev windows this bot makes +$8.20 (new window, 4 fills, 0.62% max
// drawdown) and +$15.42 (old window, 4 fills, 1.00% max drawdown). The
// numbers come from a plateau, not a single knife-edge set: the shallow
// leg's fine grid (dip window 50–60, drop 60–75 bp, take-profit 70–90 bp,
// bounce gate +0.18–0.22% over 10 minutes) keeps the old window at
// $12.80–$15.42 in 33 of 108 points, the trailing-stop hill (25–45 bp)
// is smooth with 35 bp in the middle of its flat top, and the
// early-trend cap gives identical results for any cap between 120 and
// 360 bars. The dev results are still not a prediction for the unseen
// race window; they are only the gate the entry must clear, now on two
// windows instead of one.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

// --- parameters (bps = 1/100 of 1%) ---
const TREND_WIN = 60; // trailing window (bars) for the uptrend trigger
const TREND_MIN_BPS = 50; // enter when the 60-minute return is >= +0.50%
const TREND_EMA_SPAN = 24; // ... and the close sits above this EMA
const TRAIL_BPS = 35; // trend exit: 0.35% trailing stop from the peak value
const TREND_EARLY_CAP = 240; // trend leg fires only while bar index < 240
const DIP_WIN = 60; // trailing window (bars) for the drop that triggers a dip-buy
const DIP_BPS = 130; // enter when the close is >= 1.30% below the close 60 bars ago
const DIP_TP_BPS = 70; // dip exit: +0.70% over cost
const DIP_SL_BPS = 100; // dip exit: -1.00% under cost
const SHALLOW_WIN = 55; // trailing window (bars) for the shallow-dip trigger
const SHALLOW_DROP_BPS = 70; // enter when the close is >= 0.70% below the close 55 bars ago
const SHALLOW_UP_WIN = 10; // ... and the close has bounced over this many bars
const SHALLOW_UP_MIN_BPS = 20; // ... by at least +0.20% over those bars
const SHALLOW_TP_BPS = 80; // shallow exit: +0.80% over cost
const SHALLOW_SL_BPS = 75; // shallow exit: -0.75% under cost
const MAX_SLIPPAGE_BPS = 100; // a fill may be at most 1.00% from the latest close

type Mode = 'trend' | 'dip' | 'shallow' | null;

// EMA over closes, seeded as the mean of its first `span` closes (the
// standard seeding; identical on every run for the same closes).
interface Ema {
  warm: number[];
  val: number | null;
  k: number;
}

function emaInit(span: number): Ema {
  return { warm: [], val: null, k: 2 / (span + 1) };
}

function emaStep(e: Ema, span: number, close: number): number | null {
  if (e.val === null) {
    e.warm.push(close);
    if (e.warm.length === span) {
      let sum = 0;
      for (const c of e.warm) sum += c;
      e.val = sum / span;
    }
  } else {
    e.val += e.k * (close - e.val);
  }
  return e.val;
}

const closes: bigint[] = [];
const emaFast = emaInit(TREND_EMA_SPAN);
let mode: Mode = null;
let trendUsed = false; // the trend leg fires at most once per window
let peak: bigint | null = null; // peak position value while in trend mode

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    const sym = state.hello.symbols[0]?.symbol ?? 'CBBTC';
    const bar = batch.bars.find((b) => b.symbol === sym);
    if (bar === undefined) return []; // CBBTC absent this minute: no decision
    const close = BigInt(bar.c);
    closes.push(close);
    const ema = emaStep(emaFast, TREND_EMA_SPAN, Number(bar.c));
    const minNotional = BigInt(state.hello.fees.min_notional_quote_units);
    const barIndex = closes.length - 1; // 0-based index of this bar

    const pos = state.positions.get(sym);
    if (pos !== undefined && pos.qty > 0n) {
      const val = state.value(sym, pos.qty);
      if (mode === 'trend') {
        if (peak === null || val > peak) peak = val;
        // Trailing stop from the peak position value.
        if (peak !== null && val * 10000n <= peak * BigInt(10000 - TRAIL_BPS)) {
          mode = null;
          peak = null;
          return [{ side: 'sell', symbol: sym, qty: pos.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
        return [];
      }
      // Dip and shallow modes: fixed take-profit / stop-loss on cost,
      // in exact integer bps.
      const tp = mode === 'shallow' ? SHALLOW_TP_BPS : DIP_TP_BPS;
      const sl = mode === 'shallow' ? SHALLOW_SL_BPS : DIP_SL_BPS;
      const tookProfit = val * 10000n >= pos.cost * BigInt(10000 + tp);
      const stoppedOut = val * 10000n <= pos.cost * BigInt(10000 - sl);
      if (tookProfit || stoppedOut) {
        mode = null;
        peak = null;
        return [{ side: 'sell', symbol: sym, qty: pos.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Flat: look for an entry. Deep-dip buy first.
    const n = closes.length;
    if (n > DIP_WIN) {
      const ago = closes[n - 1 - DIP_WIN];
      // close <= ago * (1 - 1.30%): close * 10000 <= ago * 9870
      if (close * 10000n <= ago * BigInt(10000 - DIP_BPS)) {
        const amount = state.cash < state.weightRoom(sym) ? state.cash : state.weightRoom(sym);
        if (amount >= minNotional) {
          mode = 'dip';
          peak = null;
          return [{ side: 'buy', symbol: sym, notional_quote_units: amount, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
        return [];
      }
    }

    // Shallow rebound leg: a moderate drop that has already started to
    // bounce back. The bounce gate keeps it out of a falling knife.
    if (n > SHALLOW_WIN) {
      const ago = closes[n - 1 - SHALLOW_WIN];
      if (close * 10000n <= ago * BigInt(10000 - SHALLOW_DROP_BPS)) {
        const upAgo = closes[n - 1 - SHALLOW_UP_WIN];
        const rebounding = close * 10000n >= upAgo * BigInt(10000 + SHALLOW_UP_MIN_BPS);
        if (rebounding) {
          const amount = state.cash < state.weightRoom(sym) ? state.cash : state.weightRoom(sym);
          if (amount >= minNotional) {
            mode = 'shallow';
            peak = null;
            return [{ side: 'buy', symbol: sym, notional_quote_units: amount, max_slippage_bps: MAX_SLIPPAGE_BPS }];
          }
          return [];
        }
      }
    }

    // One-shot trend leg, opening hours only: a genuine early rise —
    // 60-minute return at least +0.50% with the close above its 24-bar
    // EMA, while the bar index is below 240. Fires at most once.
    if (!trendUsed && barIndex < TREND_EARLY_CAP && n > TREND_WIN && ema !== null) {
      const ago = closes[n - 1 - TREND_WIN];
      const rising = close * 10000n >= ago * BigInt(10000 + TREND_MIN_BPS);
      const aboveEma = Number(close) > ema;
      if (rising && aboveEma) {
        const amount = state.cash < state.weightRoom(sym) ? state.cash : state.weightRoom(sym);
        if (amount >= minNotional) {
          trendUsed = true;
          mode = 'trend';
          peak = null;
          return [{ side: 'buy', symbol: sym, notional_quote_units: amount, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
    }

    return [];
  },
});
