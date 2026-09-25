import { Router } from 'express';
import { requireAuth } from '../services/auth.js';
import { getQuote, getQuotes, trackedSymbols } from '../services/quotes.js';

const router = Router();

router.get('/', requireAuth, (req, res) => {
  res.json({ symbols: trackedSymbols(), quotes: getQuotes() });
});

router.get('/:symbol', requireAuth, (req, res) => {
  const q = getQuote(decodeURIComponent(req.params.symbol));
  if (!q) return res.status(404).json({ error: 'No quote yet for that symbol (still warming up?)' });
  res.json(q);
});

export default router;
