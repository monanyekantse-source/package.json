import { Router } from 'express';
import { nanoid } from 'nanoid';
import db from '../db/index.js';
import { requireAuth } from '../services/auth.js';
import { computeSignal } from '../services/scanner.js';
import { getRecentCandles } from '../services/candles.js';
import { analyzeChart } from '../services/ai.js';

const router = Router();

const insertLink = db.prepare(`
  INSERT INTO mt5_links (api_token, user_id, broker, server, mt5_login, account_type, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
`);
const listLinks = db.prepare('SELECT * FROM mt5_links WHERE user_id = ? ORDER BY created_at DESC');
const getScanConfig = db.prepare('SELECT * FROM scan_configs WHERE user_id = ?');

// Builds the "scan" object the app's applyLiveScan() renders into the
// Structure tab — real signal math (scanner.js) + real AI chart-pattern
// reading (ai.js analyzeChart, backed by real OHLC candles) instead of the
// app's built-in random demo data.
async function buildLiveScan(userId) {
  const cfg = getScanConfig.get(userId);
  if (!cfg) return null;

  const signal = computeSignal(cfg.symbol);
  const candles = getRecentCandles(cfg.symbol, 20);
  if (!signal || candles.length < 5) return null;

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const max = (arr, n) => Math.max(...arr.slice(0, n));
  const min = (arr, n) => Math.min(...arr.slice(0, n));

  const analysis = await analyzeChart(cfg.symbol, candles, signal);

  return {
    symbol: cfg.symbol,
    state: signal.side,
    confidence: signal.confidence,
    trend: signal.side === 'BUY' ? 'BULLISH' : signal.side === 'SELL' ? 'BEARISH' : 'NEUTRAL',
    price: signal.price,
    resistance1: max(highs, 5),
    resistance2: max(highs, Math.min(10, highs.length)),
    support3: min(lows, 5),
    support4: min(lows, Math.min(10, lows.length)),
    support5: min(lows, Math.min(15, lows.length)),
    support6: min(lows, Math.min(20, lows.length)),
    structure_text: analysis.text,
    timeframe: cfg.timeframe,
  };
}

// Called by the app's "Connect MT5 account" flow — registers the account
// and hands back a token. The EA (running on the user's own MT5 terminal)
// is given this same token so the backend can match its heartbeats/trades
// to the right user without ever touching the real MT5 password.
router.post('/link', requireAuth, (req, res) => {
  const { broker, server, mt5_login, account_type } = req.body || {};
  if (!mt5_login) return res.status(400).json({ error: 'mt5_login required' });

  const token = `lsx_${nanoid(24)}`;
  insertLink.run(token, req.userId, broker || null, server || null, String(mt5_login), account_type || 'Standard', Date.now());
  res.json({ link: { api_token: token, broker, server, mt5_login, account_type, status: 'pending' } });
});

// Polled by the app to see whether the EA has reported in yet. When an
// account is connected, this also attaches a real `scan` (see buildLiveScan)
// so the app's existing Structure/AI tab renders real data instead of demo.
router.get('/status', requireAuth, async (req, res) => {
  const links = listLinks.all(req.userId);
  const connected = links.find((l) => l.status === 'connected');
  if (connected) {
    try {
      const scan = await buildLiveScan(req.userId);
      if (scan) connected.scan = scan;
    } catch (err) {
      console.error('[mt5/status] buildLiveScan failed:', err.message);
    }
  }
  res.json({ links });
});

export default router;
