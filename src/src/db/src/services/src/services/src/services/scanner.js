// Real technical-analysis scanner. Replaces the app's demo/random signal
// generator with actual math over the price history collected by quotes.js.
//
// Strategy (intentionally simple and readable — tune freely):
//   - fast SMA(8) vs slow SMA(21) crossover for trend direction
//   - RSI(14) as a confidence filter (avoids buying overbought / selling oversold)
// This is a starting point, not investment advice — test on a demo MT5
// account before ever pointing it at a live one.

import { readHistory } from './quotes.js';

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(0, period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  // values[0] is most recent; walk backwards for chronological deltas
  for (let i = period; i >= 1; i--) {
    const delta = values[i - 1] - values[i];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// Returns null (no signal yet — not enough history) or:
// { side: 'BUY'|'SELL', confidence: 0-100, reason: string, price: number }
export function computeSignal(symbol) {
  const rows = readHistory.all(symbol, 60); // most recent 60 ticks, newest first
  if (rows.length < 22) return null;

  const prices = rows.map((r) => r.price);
  const latestPrice = prices[0];

  const fast = sma(prices, 8);
  const slow = sma(prices, 21);
  const rsiVal = rsi(prices, 14);
  if (fast === null || slow === null || rsiVal === null) return null;

  const spreadPct = ((fast - slow) / slow) * 100;
  let side = null;
  if (fast > slow && rsiVal < 70) side = 'BUY';
  else if (fast < slow && rsiVal > 30) side = 'SELL';
  if (!side) return null;

  // Confidence: bigger SMA spread + RSI further from the "avoid" extreme = higher.
  const confidence = Math.max(
    5,
    Math.min(95, Math.round(Math.abs(spreadPct) * 40 + Math.abs(50 - rsiVal)))
  );

  return {
    symbol,
    side,
    price: latestPrice,
    confidence,
    reason: `SMA8 ${fast.toFixed(4)} ${side === 'BUY' ? '>' : '<'} SMA21 ${slow.toFixed(4)}, RSI14 ${rsiVal.toFixed(1)}`,
  };
}
