// Real live quotes via Twelve Data (https://twelvedata.com).
// To switch providers later, only this file needs to change — every
// other part of the app just calls getQuote(symbol) / getQuotes().

import fetch from 'node-fetch';
import db from '../db/index.js';

const API_KEY = process.env.TWELVE_DATA_API_KEY;
const BASE_URL = 'https://api.twelvedata.com';

const symbols = (process.env.DEFAULT_SYMBOLS || 'XAU/USD,EUR/USD,GBP/USD,USD/JPY')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const upsertCache = db.prepare(`
  INSERT INTO quote_cache (symbol, price, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(symbol) DO UPDATE SET price=excluded.price, updated_at=excluded.updated_at
`);

const readCache = db.prepare('SELECT * FROM quote_cache WHERE symbol = ?');
const readAllCache = db.prepare('SELECT * FROM quote_cache');
const insertHistory = db.prepare('INSERT INTO price_history (symbol, price, ts) VALUES (?, ?, ?)');

export const readHistory = db.prepare(
  'SELECT price, ts FROM price_history WHERE symbol = ? ORDER BY ts DESC LIMIT ?'
);

async function fetchQuoteFromProvider(symbol) {
  if (!API_KEY) throw new Error('TWELVE_DATA_API_KEY is not set in .env');
  const url = `${BASE_URL}/price?symbol=${encodeURIComponent(symbol)}&apikey=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === 'error' || !data.price) {
    throw new Error(`Twelve Data error for ${symbol}: ${data.message || 'unknown error'}`);
  }
  return parseFloat(data.price);
}

// Polls every `intervalMs` and updates the local cache, so every request
// served to the app is instant and we don't hit rate limits per-user.
export function startQuotePolling(intervalMs = 15000) {
  async function tick() {
    for (const symbol of symbols) {
      try {
        const price = await fetchQuoteFromProvider(symbol);
        const now = Date.now();
        upsertCache.run(symbol, price, now);
        insertHistory.run(symbol, price, now);
      } catch (err) {
        console.error(`[quotes] failed to update ${symbol}:`, err.message);
      }
    }
  }
  tick();
  setInterval(tick, intervalMs);
}

export function getQuote(symbol) {
  const row = readCache.get(symbol);
  if (!row) return null;
  return { symbol: row.symbol, price: row.price, updatedAt: row.updated_at };
}

export function getQuotes() {
  return readAllCache.all().map((row) => ({
    symbol: row.symbol,
    price: row.price,
    updatedAt: row.updated_at,
  }));
}

export function trackedSymbols() {
  return symbols;
}
