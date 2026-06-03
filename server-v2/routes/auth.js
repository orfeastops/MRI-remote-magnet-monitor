const router = require('express').Router();
const db     = require('../db');
const auth   = require('../auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  // Super-admin shortcut (no DB row)
  if (auth.isSuperAdmin(email, password)) {
    await auth.issueTokens(res, { role: 'super_admin', email });
    return res.json({ role: 'super_admin', email });
  }

  const user = db.users.getByEmail(email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await auth.checkPassword(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const payload = { userId: user.id, companyId: user.company_id, role: user.role, email: user.email };
  await auth.issueTokens(res, payload);
  res.json({ userId: user.id, companyId: user.company_id, role: user.role, email: user.email, name: user.name });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const token = req.cookies?.refresh_token;
  if (token) {
    const hash = auth.hashToken(token);
    db.refreshTokens.delete(hash);
  }
  auth.clearTokens(res);
  res.json({ ok: true });
});

// POST /api/auth/refresh
router.post('/refresh', (req, res) => {
  const token = req.cookies?.refresh_token;
  if (!token) return res.status(401).json({ error: 'No refresh token' });

  let payload;
  try { payload = auth.verifyRefresh(token); }
  catch { return res.status(401).json({ error: 'Refresh token invalid or expired' }); }

  const hash = auth.hashToken(token);
  const row  = db.refreshTokens.find(hash);
  if (!row) return res.status(401).json({ error: 'Refresh token revoked' });

  // Rotate: delete old, issue new pair
  db.refreshTokens.delete(hash);
  const { iat, exp, ...clean } = payload;
  auth.issueTokens(res, clean);
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', require('../middleware/requireAuth'), (req, res) => {
  res.json(req.user);
});

module.exports = router;
