import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import db from '../db/index.js';
import { signToken, requireAuth } from '../services/auth.js';

const router = Router();

const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const insertUser = db.prepare(
  'INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'
);
const findById = db.prepare('SELECT * FROM users WHERE id = ?');

router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (findByEmail.get(email)) return res.status(409).json({ error: 'Email already registered' });

  const id = nanoid();
  const hash = await bcrypt.hash(password, 10);
  insertUser.run(id, name || null, email, hash, Date.now());
  const user = { id, email };
  res.json({ token: signToken(user), user: { id, name, email } });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const row = findByEmail.get(email);
  if (!row) return res.status(401).json({ error: 'Invalid email or password' });

  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

  res.json({
    token: signToken(row),
    user: { id: row.id, name: row.name, email: row.email },
  });
});

router.get('/me', requireAuth, (req, res) => {
  const row = findById.get(req.userId);
  if (!row) return res.status(404).json({ error: 'User not found' });
  res.json({ id: row.id, name: row.name, email: row.email });
});

export default router;
