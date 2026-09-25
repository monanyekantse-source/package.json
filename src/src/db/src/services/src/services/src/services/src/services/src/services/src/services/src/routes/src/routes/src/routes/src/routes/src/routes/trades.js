import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireEaSecret } from '../services/auth.js';

const router = Router();

const listTrades = db.prepare('SELECT * FROM trades WHERE user_id = ? ORDER BY opened_at DESC LIMIT 200');
const findTradeByUserAndLogin = db.prepare(`
  SELECT t.* FROM trades t
  JOIN mt5_links l ON l.user_id = t.user_id
  WHERE l.mt5_login = ? AND t.status = 'open' AND t.mt5_ticket IS NULL
  ORDER BY t.opened_at ASC
`);
const attachTicket = db.prepare('UPDATE trades SET mt5_ticket = ? WHERE id = ?');
const closeTrade = db.prepare(
  "UPDATE trades SET status='closed', close_price=?, pl=?, closed_at=? WHERE id = ?"
);
const findLinkByLogin = db.prepare('SELECT * FROM mt5_links WHERE mt5_login = ?');
const touchLink = db.prepare('UPDATE mt5_links SET last_seen_at=?, balance=?, equity=?, status=? WHERE mt5_login=?');

// ---- App-facing ----
router.get('/', requireAuth, (req, res) => {
  res.json({ trades: listTrades.all(req.userId) });
});

// ---- EA-facing (your MT5 Expert Advisor calls these, not the app) ----
// EA polls this to find scanner-generated trades it still needs to open.
router.get('/pending', requireEaSecret, (req, res) => {
  const { mt5_login } = req.query;
  if (!mt5_login) return res.status(400).json({ error: 'mt5_login query param required' });
  res.json({ trades: findTradeByUserAndLogin.all(mt5_login) });
});

// EA calls this once it has actually opened the order in MT5.
router.post('/:id/opened', requireEaSecret, (req, res) => {
  const { mt5_ticket } = req.body || {};
  if (!mt5_ticket) return res.status(400).json({ error: 'mt5_ticket required' });
  attachTicket.run(String(mt5_ticket), req.params.id);
  res.json({ ok: true });
});

// EA calls this when a trade closes in MT5, with the real fill numbers.
router.post('/:id/closed', requireEaSecret, (req, res) => {
  const { close_price, pl } = req.body || {};
  closeTrade.run(close_price ?? null, pl ?? null, Date.now(), req.params.id);
  res.json({ ok: true });
});

// EA heartbeat: reports account balance/equity so the app shows real numbers.
router.post('/heartbeat', requireEaSecret, (req, res) => {
  const { mt5_login, balance, equity } = req.body || {};
  if (!mt5_login) return res.status(400).json({ error: 'mt5_login required' });
  const link = findLinkByLogin.get(mt5_login);
  if (!link) return res.status(404).json({ error: 'No linked account for that mt5_login' });
  touchLink.run(Date.now(), balance ?? null, equity ?? null, 'connected', mt5_login);
  res.json({ ok: true });
});

export default router;
