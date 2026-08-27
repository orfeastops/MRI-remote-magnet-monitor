// Company-scoped routes (company_admin + technician read-only)
const router           = require('express').Router();
const { v4: uuidv4 }  = require('uuid');
const db               = require('../db');
const { hashPassword } = require('../auth');
const requireCompanyAdmin = require('../middleware/requireCompanyAdmin');
const { getOnlineDeviceIds } = require('../ws/hub');

// ── Users ────────────────────────────────────────────────────────────────────

// GET /api/company/users
router.get('/users', async (req, res) => {
  res.json(await db.users.getByCompany(req.user.companyId));
});

// POST /api/company/users   body: { email, password, name?, role? }
// company_admin can create technicians (and other company_admins)
router.post('/users', requireCompanyAdmin, async (req, res) => {
  const { email, password, name, role = 'technician' } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (!['company_admin', 'technician'].includes(role)) return res.status(400).json({ error: 'invalid role' });

  const hash = await hashPassword(password);
  try {
    const result = await db.users.create(req.user.companyId, email.trim().toLowerCase(), hash, role, name || null);
    res.status(201).json({ id: result.lastInsertRowid, email, role, name: name || null });
  } catch (e) {
    if (e.message.includes('UNIQUE') || e.message.includes('duplicate')) return res.status(409).json({ error: 'Email already exists' });
    throw e;
  }
});

// PUT /api/company/users/:id   body: { name?, role?, password? }
router.put('/users/:id', requireCompanyAdmin, async (req, res) => {
  if (String(req.params.id) === String(req.user.userId)) {
    return res.status(400).json({ error: 'Cannot edit yourself via this endpoint' });
  }
  const { name, role, password } = req.body;
  const fields = {};
  if (name     !== undefined) fields.name = name;
  if (role     !== undefined) {
    if (!['company_admin', 'technician'].includes(role)) return res.status(400).json({ error: 'invalid role' });
    fields.role = role;
  }
  if (password !== undefined) fields.password_hash = await hashPassword(password);
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to update' });
  await db.users.update(req.params.id, req.user.companyId, fields);
  res.json({ ok: true });
});

// DELETE /api/company/users/:id
router.delete('/users/:id', requireCompanyAdmin, async (req, res) => {
  if (String(req.params.id) === String(req.user.userId)) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }
  await db.users.delete(req.params.id, req.user.companyId);
  res.json({ ok: true });
});

// ── Devices ──────────────────────────────────────────────────────────────────

// GET /api/company/devices
router.get('/devices', async (req, res) => {
  const onlineIds = new Set(getOnlineDeviceIds());
  const devs = (await db.devices.getByCompany(req.user.companyId)).map(d => ({
    ...d,
    sms_recipients: JSON.parse(d.sms_recipients || '[]'),
    online: onlineIds.has(d.id),
  }));
  res.json(devs);
});

// POST /api/company/devices   body: { name, apn?, sms_recipients? }
router.post('/devices', requireCompanyAdmin, async (req, res) => {
  const { name, apn = 'internet', sms_recipients = [] } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });

  const secret = uuidv4();
  const result = await db.devices.create(req.user.companyId, secret, name.trim(), apn, sms_recipients);
  res.status(201).json({
    id: result.lastInsertRowid,
    secret,  // shown once — technician programs this into firmware
    name: name.trim(),
    apn,
    sms_recipients,
    companyId: req.user.companyId,
  });
});

// PUT /api/company/devices/:id   body: { name?, apn?, sms_recipients? }
router.put('/devices/:id', requireCompanyAdmin, async (req, res) => {
  const allowed = ['name', 'apn', 'sms_recipients'];
  const fields  = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      fields[k] = k === 'sms_recipients' ? JSON.stringify(req.body[k]) : req.body[k];
    }
  }
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to update' });
  await db.devices.update(req.params.id, req.user.companyId, fields);
  res.json({ ok: true });
});

// DELETE /api/company/devices/:id
router.delete('/devices/:id', requireCompanyAdmin, async (req, res) => {
  await db.devices.delete(req.params.id, req.user.companyId);
  res.json({ ok: true });
});

// GET /api/company/devices/:id/history
router.get('/devices/:id/history', async (req, res) => {
  const dev = await db.devices.getById(req.params.id);
  if (!dev || dev.company_id !== req.user.companyId) return res.status(404).json({ error: 'Not found' });
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  res.json(await db.dataLog.history(dev.id, limit));
});

// GET /api/company/devices/:id/gpio
router.get('/devices/:id/gpio', async (req, res) => {
  const dev = await db.devices.getById(req.params.id);
  if (!dev || dev.company_id !== req.user.companyId) return res.status(404).json({ error: 'Not found' });
  res.json(await db.gpio.latest(dev.id));
});

// GET /api/company/devices/:id/alerts
router.get('/devices/:id/alerts', async (req, res) => {
  const dev = await db.devices.getById(req.params.id);
  if (!dev || dev.company_id !== req.user.companyId) return res.status(404).json({ error: 'Not found' });
  res.json(await db.alerts.getAll(dev.id));
});

// POST /api/company/devices/:id/alerts/:alertId/acknowledge
router.post('/devices/:id/alerts/:alertId/acknowledge', requireCompanyAdmin, async (req, res) => {
  const dev = await db.devices.getById(req.params.id);
  if (!dev || dev.company_id !== req.user.companyId) return res.status(404).json({ error: 'Device not found' });
  const alert = await db.alerts.getByIdWithCompany(req.params.alertId);
  if (!alert || alert.device_id !== dev.id) return res.status(404).json({ error: 'Alert not found' });
  await db.alerts.resolve(alert.id, alert.device_id);
  res.json({ ok: true });
});

module.exports = router;
