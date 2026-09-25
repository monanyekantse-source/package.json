import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'insecure-dev-secret';

export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, SECRET, { expiresIn: '30d' });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });
  try {
    const payload = jwt.verify(token, SECRET);
    req.userId = payload.sub;
    req.userEmail = payload.email;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireEaSecret(req, res, next) {
  const secret = req.headers['x-ea-secret'];
  if (!secret || secret !== process.env.EA_SHARED_SECRET) {
    return res.status(401).json({ error: 'Bad or missing EA secret' });
  }
  next();
    }
