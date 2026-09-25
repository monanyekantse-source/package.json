// Fetches real OHLC candles (not just tick prices) so the AI chart scanner
// has an actual price series to reason about — highs, lows, wicks, the
// shape of the last N bars — instead of a single number.

import fetch from 'node-fetch';
import db from '../db/index.js';
import { trackedSymbols } from './quotes.js';

const API_KEY = process.env.TWELVE_DATA_API_KEY;
const BASE_URL = 'https://api.twelvedata.com';
const INTERVAL = '1min';

const upsertCandle = db.prepare(`
  INSERT INTO candles (symbol, interval, open, high, low, close, ts)
  VALUES (@symbol, @interval, @open, @high, @low, @close, @ts)
  ON CONFLICT(symbol, interval, ts) DO UPDATE SET
    open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close
`);

export const readCandles = db.prepare(
  'SELECT open, high, low, close, ts FROM candles WHERE symbol = ? AND interval = ? ORDER BY ts DESC LIMIT ?'
);

async function fetchCandles(symbol, outputsize = 30) {
  const url = `${BASE_URL}/time_series?symbol=${encodeURIComponent(symbol)}&interval=${INTERVAL}&outputsize=${outputsize}&apikey=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === 'error' || !Array.isArray(data.values)) {
    throw new Error(`Twelve Data time_series error for ${symbol}: ${data.message || 'unknown error'}`);
  }
  return data.values.map((v) => ({
    symbol,
    interval: INTERVAL,
    open: parseFloat(v.open),
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
    ts: new Date(v.datetime + 'Z').getTime() || new Date(v.datetime).getTime(),
  }));
}

// Refreshes candle history every `intervalMs`. Twelve Data's free tier has
// a low request budget, so this defaults to a slower cadence than the raw
// tick-price polling in quotes.js.
export function startCandlePolling(intervalMs = 60000) {
  async function tick() {
    for (const symbol of trackedSymbols()) {
      try {
        const bars = await fetchCandles(symbol, 30);
        for (const bar of bars) upsertCandle.run(bar);
      } catch (err) {
        console.error(`[candles] failed to update ${symbol}:`, err.message);
      }
    }
  }
  tick();
  setInterval(tick, intervalMs);
}

// Newest-first array of {open,high,low,close,ts}
export function getRecentCandles(symbol, limit = 20) {
  return readCandles.all(symbol, INTERVAL, limit);
}
