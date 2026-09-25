import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth.js';
import webauthnRoutes from './routes/webauthn.js';
import quotesRoutes from './routes/quotes.js';
import scannerRoutes from './routes/scanner.js';
import tradesRoutes from './routes/trades.js';
import mt5Routes from './routes/mt5.js';
import { startQuotePolling } from './services/quotes.js';
import { startCandlePolling } from './services/candles.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

app.use('/api/auth', authRoutes);
app.use('/api/auth/webauthn', webauthnRoutes);
app.use('/api/quotes', quotesRoutes);
app.use('/api/scanner', scannerRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/mt5', mt5Routes);

const PORT = process.env.PORT || 8080;

if (!process.env.TWELVE_DATA_API_KEY) {
  console.warn('[startup] TWELVE_DATA_API_KEY is not set — quotes/candles will not update. Copy .env.example to .env and fill it in.');
} else {
  startQuotePolling();
  startCandlePolling();
}

app.listen(PORT, () => {
  console.log(`L ScalpX backend listening on http://localhost:${PORT}`);
});
