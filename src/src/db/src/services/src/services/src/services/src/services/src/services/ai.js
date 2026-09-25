// Turns a raw scanner signal into a short plain-English explanation using
// Claude. Fully optional: if ANTHROPIC_API_KEY is unset, callers get a
// plain templated sentence instead — nothing else breaks.

import fetch from 'node-fetch';

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-6';

export async function explainSignal(signal) {
  const fallback = `${signal.side} signal on ${signal.symbol} at ${signal.price}: ${signal.reason}. Confidence ${signal.confidence}%.`;
  if (!API_KEY) return fallback;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 120,
        messages: [
          {
            role: 'user',
            content:
              `You are a terse trading-desk assistant. In 1-2 short sentences, plain English, ` +
              `no hype, explain this signal to a retail trader (not financial advice, just describing the setup): ` +
              `${JSON.stringify(signal)}`,
          },
        ],
      }),
    });
    const data = await res.json();
    const text = data?.content?.find((b) => b.type === 'text')?.text;
    return text ? text.trim() : fallback;
  } catch (err) {
    console.error('[ai] Claude call failed, using fallback text:', err.message);
    return fallback;
  }
}

// Real chart-pattern analysis: sends the actual last N OHLC candles (not
// just the indicator numbers) to Claude and asks it to read the price
// action the way a discretionary trader would — trend, structure,
// support/resistance being tested, obvious candle patterns — then combine
// that with the scanner's math-based signal into one short verdict.
//
// `candles` is newest-first [{open, high, low, close, ts}, ...].
export async function analyzeChart(symbol, candles, signal) {
  const fallback = signal
    ? `${signal.side} bias on ${symbol}: ${signal.reason}.`
    : `No clear signal on ${symbol} right now — price is chopping without a clean trend.`;
  if (!API_KEY) return { text: fallback, source: 'template' };
  if (!candles || candles.length < 5) return { text: 'Not enough candle history yet.', source: 'template' };

  // Oldest-first is easier for a model to read as "what happened, in order"
  const chronological = [...candles].reverse();
  const candleLines = chronological
    .map((c) => `t=${new Date(c.ts).toISOString().slice(11, 16)} O:${c.open} H:${c.high} L:${c.low} C:${c.close}`)
    .join('\n');

  const prompt =
    `You are a discretionary trading-desk assistant reading a 1-minute chart for ${symbol}.\n` +
    `Here are the last ${chronological.length} candles, oldest first:\n${candleLines}\n\n` +
    `The mechanical scanner (SMA crossover + RSI) currently says: ${signal ? JSON.stringify(signal) : 'no signal'}.\n\n` +
    `In 2-3 short sentences: describe the price structure (trend/range, any support-resistance being ` +
    `tested, any obvious candle pattern like an engulfing bar or a rejection wick), say whether that ` +
    `agrees or disagrees with the mechanical signal, and give one confidence word (low/medium/high). ` +
    `Plain language, no hype, not financial advice.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 220,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    const text = data?.content?.find((b) => b.type === 'text')?.text;
    return { text: text ? text.trim() : fallback, source: text ? 'claude' : 'template' };
  } catch (err) {
    console.error('[ai] chart analysis call failed, using fallback text:', err.message);
    return { text: fallback, source: 'template' };
  }
}
