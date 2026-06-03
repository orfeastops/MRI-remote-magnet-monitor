const { verifyAccess } = require('../auth');

// Parses access_token cookie and attaches req.user.
// req.user = { userId, companyId, role, email }
// For super-admin: { role: 'super_admin', email }
function requireAuth(req, res, next) {
  const token = req.cookies?.access_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = verifyAccess(token);
    next();
  } catch {
    res.status(401).json({ error: 'Token expired or invalid' });
  }
}

module.exports = requireAuth;
