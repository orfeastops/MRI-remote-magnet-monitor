const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcrypt');
const crypto  = require('crypto');
const db      = require('./db');

const ACCESS_TTL  = '15m';
const REFRESH_TTL = '30d';
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function isSuperAdmin(email, password) {
  return (
    email    === process.env.SUPERADMIN_EMAIL &&
    password === process.env.SUPERADMIN_PASSWORD
  );
}

function signAccess(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: ACCESS_TTL });
}

function signRefresh(payload) {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TTL });
}

function verifyAccess(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

function verifyRefresh(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}

async function checkPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// Creates access + refresh tokens, saves refresh to DB, sets cookies
async function issueTokens(res, payload) {
  const access  = signAccess(payload);
  const refresh = signRefresh(payload);
  const hash    = hashToken(refresh);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS).toISOString();

  await db.refreshTokens.save(payload.userId || null, payload.role === 'super_admin' ? 1 : 0, hash, expiresAt);

  const cookieOpts = { httpOnly: true, sameSite: 'lax', path: '/' };
  res.cookie('access_token',  access,  { ...cookieOpts, maxAge: 15 * 60 * 1000 });
  res.cookie('refresh_token', refresh, { ...cookieOpts, maxAge: REFRESH_TTL_MS });
}

function clearTokens(res) {
  res.clearCookie('access_token',  { httpOnly: true, sameSite: 'lax', path: '/' });
  res.clearCookie('refresh_token', { httpOnly: true, sameSite: 'lax', path: '/' });
}

module.exports = {
  isSuperAdmin, signAccess, verifyAccess, verifyRefresh,
  hashToken, hashPassword, checkPassword, issueTokens, clearTokens,
};
