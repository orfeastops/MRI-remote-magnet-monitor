require('dotenv').config();
process.on('uncaughtException',  (err) => console.error('[UNCAUGHT]', err.message));
process.on('unhandledRejection', (err) => console.error('[UNHANDLED]', err));

const express    = require('express');
const http       = require('http');
const cookieParser = require('cookie-parser');
const webpush    = require('web-push');
const requireAuth        = require('./middleware/requireAuth');
const requireSuperAdmin  = require('./middleware/requireSuperAdmin');
const authRoutes         = require('./routes/auth');
const adminRoutes        = require('./routes/admin');
const companyRoutes      = require('./routes/companies');
const pushRoutes         = require('./routes/push');
const deviceRoutes       = require('./routes/device');
const { setupHub } = require('./ws/hub');
const db                 = require('./db');

// ── Validate required ENV ─────────────────────────────────────────────────────
const required = ['SUPERADMIN_EMAIL', 'SUPERADMIN_PASSWORD', 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'DB_SERVER', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
for (const k of required) {
  if (!process.env[k]) { console.error(`Missing ENV: ${k}`); process.exit(1); }
}

// ── VAPID setup ───────────────────────────────────────────────────────────────
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// ── Public routes (no auth required) ─────────────────────────────────────────
app.use('/api/auth',   authRoutes);
app.use('/api/device', deviceRoutes);  // device config, authenticated by device secret

// ── VAPID public key (needed by frontend to subscribe to push) ───────────────
app.get('/api/vapid-public-key', (_req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null });
});

// ── Protected routes ──────────────────────────────────────────────────────────
app.use(requireAuth);

// Super-admin
app.use('/api/super', requireSuperAdmin, adminRoutes);

// Company-scoped (company_admin + technician)
app.use('/api/company', companyRoutes);

// Push notifications
app.use('/api/push', pushRoutes);


// ── HTTP server + WebSocket hub ───────────────────────────────────────────────
const server = http.createServer(app);
setupHub(server);

// ── Periodic cleanup ──────────────────────────────────────────────────────────
setInterval(() => { db.refreshTokens.purge().catch(err => console.error('[PURGE]', err.message)); }, 60 * 60 * 1000); // every hour

const PORT = process.env.PORT || 3002;

// ── Ensure DB schema exists, then start listening ─────────────────────────────
db.ensureSchema()
  .then(() => {
    server.listen(PORT, () => console.log(`MRI Monitor v2 running on http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('[STARTUP] Failed to initialize database:', err.message);
    if (err.originalError) console.error('[STARTUP] originalError:', err.originalError.message || err.originalError);
    if (err.precedingErrors) {
      err.precedingErrors.forEach((e, i) => console.error(`[STARTUP] precedingError[${i}]:`, e.message));
    }
    console.error('[STARTUP] Full error:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
    process.exit(1);
  });
