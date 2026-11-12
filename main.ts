// One-shot uptrend ride + sharp-dip bounce bot for btc-race-24h-20261112-1439.
// Long only, one position, full size. Every decision is a pure function of the
// closes seen so far: no clock, no environment, no Math.random, so two runs on
// the same data produce identical orders.
//
// Why this shape: the dev window (24h of 1-minute cbBTC bars, 2026-11-11
// 14:39 -> 2026-11-12 14:39 UTC, BTC -2.30% with a +1.08% rise in the first
// four hours, then a slow grind down and a -1.95% sell-off in the last four)
// punishes the usual families. Canonical RSI+Bollinger mean reversion loses
// -$46.52 there (19 trades: the dips keep dipping), plain RSI(14) loses
// -$48.21, EMA-cross 8/21 loses -$95.88, and the previous race's dip-buy
// (0.90% over 90 min, TP/SL 1.00%) loses -$25.17. What survives is two small,
// fast pieces, each tuned on this window over a plateau of nearby parameters
// (see BUILD_LOG.md), never a single knife-edge set:
//
//   1. Trend leg (one-shot): buy once, only when the close is above its
//      24-bar EMA and the 60-minute return is at least +0.50%. It fires
//      once, early in a rising window, and rides it with a 0.35% trailing
//      stop from the peak position value. It never re-enters, so a flat or
//      falling window leaves it in cash instead of churning.
//   2. Dip leg: buy when the close is at least 1.10% below the close 45
//      minutes ago, and sell the bounce at +0.40% over cost (or -0.75%
//      under it). The bounce here is fast: a wider take-profit holds into
//      the next leg down and loses.
//
// A full-size round trip costs ~26 bps in fees, slippage and impact, so the
// 0.40% dip target and the 0.35% trailing stop are sized just above that cost
// while staying small enough to fire in a choppy market. On the dev window
// this bot makes three round trips (trend + two dips) for +$8.42, 6 fills,
// 0.74% max drawdown, and it is positive in both halves of the window
// (+$5.56 first 12h, +$2.67 second 12h). The dev result is not a prediction
// for the unseen race window; it is only the gate the entry must clear.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

// --- parameters (bps = 1/100 of 1%) ---
const TREND_WIN = 60; // trailing window (bars) for the uptrend trigger
const TREND_MIN_BPS = 50; // enter when the 60-minute return is >= +0.50%
const TREND_EMA_SPAN = 24; // ... and the close sits above this EMA
const TRAIL_BPS = 35; // trend exit: 0.35% trailing stop from the peak value
const DIP_WIN = 45; // trailing window (bars) for the drop that triggers a dip-buy
const DIP_BPS = 110; // enter when the close is >= 1.10% below the close 45 bars ago
const DIP_TP_BPS = 40; // dip exit: +0.40% over cost
const DIP_SL_BPS = 75; // dip exit: -0.75% under cost
const MAX_SLIPPAGE_BPS = 100; // a fill may be at most 1.00% from the latest close

type Mode = 'trend' | 'dip' | null;

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
      // Dip mode (and any unexpected held state): fixed take-profit /
      // stop-loss on cost, in exact integer bps.
      const tookProfit = val * 10000n >= pos.cost * BigInt(10000 + DIP_TP_BPS);
      const stoppedOut = val * 10000n <= pos.cost * BigInt(10000 - DIP_SL_BPS);
      if (tookProfit || stoppedOut) {
        mode = null;
        peak = null;
        return [{ side: 'sell', symbol: sym, qty: pos.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Flat: look for an entry. Dip-buy first.
    const n = closes.length;
    if (n > DIP_WIN) {
      const ago = closes[n - 1 - DIP_WIN];
      // close <= ago * (1 - 1.10%): close * 10000 <= ago * 9890
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

    // One-shot trend leg: a genuine early rise — 60-minute return at least
    // +0.50% with the close above its 24-bar EMA. Fires at most once.
    if (!trendUsed && n > TREND_WIN && ema !== null) {
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
