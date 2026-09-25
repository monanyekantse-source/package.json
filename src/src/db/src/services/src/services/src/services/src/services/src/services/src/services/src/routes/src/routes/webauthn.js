import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, signToken } from '../services/auth.js';
import {
  startRegistration,
  finishRegistration,
  startAuthentication,
  finishAuthentication,
  userHasPasskey,
} from '../services/webauthn.js';

const router = Router();
const findById = db.prepare('SELECT * FROM users WHERE id = ?');

// --- Add a passkey to an already-logged-in account (Account screen: "Enable Face ID / fingerprint") ---
router.post('/register/options', requireAuth, async (req, res) => {
  try {
    const user = findById.get(req.userId);
    const options = await startRegistration(user);
    res.json(options);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/register/verify', requireAuth, async (req, res) => {
  try {
    const user = findById.get(req.userId);
    await finishRegistration(user, req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/status', requireAuth, (req, res) => {
  res.json({ hasPasskey: userHasPasskey(req.userId) });
});

// --- Log in with Face ID / fingerprint instead of a password ---
router.post('/login/options', async (req, res) => {
  try {
    const { attemptId, options } = await startAuthentication();
    res.json({ attemptId, options });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/login/verify', async (req, res) => {
  try {
    const { attemptId, response } = req.body || {};
    if (!attemptId || !response) return res.status(400).json({ error: 'attemptId and response required' });
    const userId = await finishAuthentication(attemptId, response);
    const user = findById.get(userId);
    res.json({ token: signToken(user), user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
