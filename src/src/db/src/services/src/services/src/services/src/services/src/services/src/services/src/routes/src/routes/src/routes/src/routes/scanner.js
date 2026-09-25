import { Router } from 'express';
import { nanoid } from 'nanoid';
import db from '../db/index.js';
import { requireAuth } from '../services/auth.js';
import { computeSignal } from '../services/scanner.js';
import { explainSignal, analyzeChart } from '../services/ai.js';
import { getRecentCandles } from '../services/candles.js';

const router = Router();

const getConfig = db.prepare('SELECT * FROM scan_configs WHERE user_id = ?');
const upsertConfig = db.prepare(`
  INSERT INTO scan_configs (user_id, symbol, timeframe, lot, max_trades, active)
  VALUES (@user_id, @symbol, @timeframe, @lot, @max_trades, @active)
  ON CONFLICT(user_id) DO UPDATE SET
    symbol=excluded.symbol, timeframe=excluded.timeframe, lot=excluded.lot,
    max_trades=excluded.max_trades, active=excluded.active
`);
const countOpenTrades = db.prepare(
  "SELECT COUNT(*) as n FROM trades WHERE user_id = ? AND status = 'open'"
);
const insertTrade = db.prepare(`
  INSERT INTO trades (id, user_id, symbol, side, lot, open_price, status, source, opened_at)
  VALUES (@id, @user_id, @symbol, @side, @lot, @open_price, 'open', @source, @opened_at)
`);

// GET current config (creates a default one on first call)
router.get('/config', requireAuth, (req, res) => {
  let cfg = getConfig.get(req.userId);
  if (!cfg) {
    cfg = { user_id: req.userId, symbol: 'XAU/USD', timeframe: 'M1', lot: 0.01, max_trades: 3, active: 0 };
    upsertConfig.run(cfg);
  }
  res.json(cfg);
});

// PUT to update symbol/timeframe/lot/max trades and start/stop scanning
router.put('/config', requireAuth, (req, res) => {
  const existing = getConfig.get(req.userId) || {};
  const cfg = {
    user_id: req.userId,
    symbol: req.body.symbol ?? existing.symbol ?? 'XAU/USD',
    timeframe: req.body.timeframe ?? existing.timeframe ?? 'M1',
    lot: req.body.lot ?? existing.lot ?? 0.01,
    max_trades: req.body.max_trades ?? existing.max_trades ?? 3,
    active: req.body.active !== undefined ? (req.body.active ? 1 : 0) : existing.active ?? 0,
  };
  upsertConfig.run(cfg);
  res.json(cfg);
});

// GET the current real signal for the configured symbol, with AI commentary
router.get('/signal', requireAuth, async (req, res) => {
  const cfg = getConfig.get(req.userId);
  if (!cfg) return res.status(400).json({ error: 'No scan config set yet — call PUT /config first' });

  const signal = computeSignal(cfg.symbol);
  if (!signal) {
    return res.json({ signal: null, message: 'Not enough live price history yet — check back in a minute.' });
  }
  const commentary = await explainSignal(signal);
  res.json({ signal, commentary });
});

// GET real AI chart-pattern analysis: reads actual recent OHLC candles
// (not just the indicator numbers) and combines that with the mechanical
// signal into one verdict. This is the "AI chart scanner" screen.
router.get('/chart-analysis', requireAuth, async (req, res) => {
  const cfg = getConfig.get(req.userId);
  if (!cfg) return res.status(400).json({ error: 'No scan config set yet — call PUT /config first' });

  const candles = getRecentCandles(cfg.symbol, 20);
  if (candles.length < 5) {
    return res.json({ candles, analysis: null, message: 'Not enough candle history yet — check back in a minute.' });
  }
  const signal = computeSignal(cfg.symbol);
  const analysis = await analyzeChart(cfg.symbol, candles, signal);
  res.json({ symbol: cfg.symbol, candles, signal, analysis });
});

// POST to act on the current signal (opens a real trade row; MT5 EA picks it
// up via GET /trades/pending and reports back the fill via /trades/:id/fill)
router.post('/execute', requireAuth, (req, res) => {
  const cfg = getConfig.get(req.userId);
  if (!cfg) return res.status(400).json({ error: 'No scan config set' });

  const { n: openCount } = countOpenTrades.get(req.userId);
  if (openCount >= cfg.max_trades) {
    return res.status(409).json({ error: `Max trades (${cfg.max_trades}) already open` });
  }

  const signal = computeSignal(cfg.symbol);
  if (!signal) return res.status(409).json({ error: 'No active signal to execute' });

  const trade = {
    id: nanoid(),
    user_id: req.userId,
    symbol: cfg.symbol,
    side: signal.side,
    lot: cfg.lot,
    open_price: signal.price,
    source: 'scanner',
    opened_at: Date.now(),
  };
  insertTrade.run(trade);
  res.json({ trade, message: 'Trade queued — your MT5 EA will pick it up and report the real fill.' });
});

export default router;
