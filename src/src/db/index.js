import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', '..', 'data.sqlite'));

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mt5_links (
  api_token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  broker TEXT,
  server TEXT,
  mt5_login TEXT,
  account_type TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | connected | error
  balance REAL,
  equity REAL,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS scan_configs (
  user_id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL DEFAULT 'XAU/USD',
  timeframe TEXT NOT NULL DEFAULT 'M1',
  lot REAL NOT NULL DEFAULT 0.01,
  max_trades INTEGER NOT NULL DEFAULT 3,
  active INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  api_token TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL, -- BUY | SELL
  lot REAL NOT NULL,
  open_price REAL,
  close_price REAL,
  pl REAL,
  status TEXT NOT NULL DEFAULT 'open', -- open | closed | rejected
  source TEXT NOT NULL DEFAULT 'scanner', -- scanner | manual | news
  opened_at INTEGER NOT NULL,
  closed_at INTEGER,
  mt5_ticket TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS quote_cache (
  symbol TEXT PRIMARY KEY,
  price REAL NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  price REAL NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_history_symbol_ts ON price_history(symbol, ts);

-- WebAuthn / passkey credentials (Face ID, fingerprint, security keys)
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  credential_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  device_type TEXT,
  transports TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Temporary storage for in-flight WebAuthn challenges (short-lived)
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id TEXT PRIMARY KEY,          -- user_id for registration, or a login attempt id
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL,        -- 'register' | 'login'
  created_at INTEGER NOT NULL
);

-- Real OHLC candles (for AI chart-pattern analysis), separate from the
-- lightweight tick history used by the SMA/RSI scanner.
CREATE TABLE IF NOT EXISTS candles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  ts INTEGER NOT NULL,
  UNIQUE(symbol, interval, ts)
);
CREATE INDEX IF NOT EXISTS idx_candles_symbol_interval_ts ON candles(symbol, interval, ts);
`);

export default db;
