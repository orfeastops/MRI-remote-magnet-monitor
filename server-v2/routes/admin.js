// Super-admin only routes — all require role: 'super_admin'.
// super_admin has full read+write access to every company: creates companies,
// managers, devices, and technician assignments. This is the ONLY role that
// can provision users/devices — company_admin (manager) is read-only.
const router          = require('express').Router();
const { v4: uuidv4 }  = require('uuid');
const db               = require('../db');
const { hashPassword } = require('../auth');

// ── Companies ────────────────────────────────────────────────────────────────

// GET /api/super/companies
router.get('/companies', async (req, res) => {
  res.json(await db.companies.getAll());
});

// POST /api/super/companies   body: { name }
router.post('/companies', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const result = await db.companies.create(name.trim());
  res.status(201).json({ id: result.lastInsertRowid, name: name.trim() });
});

// DELETE /api/super/companies/:id
router.delete('/companies/:id', async (req, res) => {
  await db.companies.delete(req.params.id);
  res.json({ ok: true });
});

// POST /api/super/companies/:id/admins   body: { email, password, name? }
// Creates a manager (company_admin) for that company.
router.post('/companies/:id/admins', async (req, res) => {
  const company = await db.companies.getById(req.params.id);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const hash = await hashPassword(password);
  try {
    const result = await db.users.create(company.id, email.trim().toLowerCase(), hash, 'company_admin', name || null);
    res.status(201).json({ id: result.lastInsertRowid, email, role: 'company_admin', companyId: company.id });
  } catch (e) {
    if (e.message.includes('UNIQUE') || e.message.includes('duplicate')) return res.status(409).json({ error: 'Email already exists' });
    throw e;
  }
});

// ── Company drill-down: users ─────────────────────────────────────────────────

async function requireCompany(req, res) {
  const company = await db.companies.getById(req.params.id);
  if (!company) { res.status(404).json({ error: 'Company not found' }); return null; }
  return company;
}

// GET /api/super/companies/:id/users
router.get('/companies/:id/users', async (req, res) => {
  const company = await requireCompany(req, res);
  if (!company) return;
  res.json(await db.users.getByCompany(company.id));
});

// POST /api/super/companies/:id/users   body: { email, password, name?, role }
// role must be 'company_admin' or 'technician'
router.post('/companies/:id/users', async (req, res) => {
  const company = await requireCompany(req, res);
  if (!company) return;

  const { email, password, name, role } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (!['company_admin', 'technician'].includes(role)) return res.status(400).json({ error: 'invalid role' });

  const hash = await hashPassword(password);
  try {
    const result = await db.users.create(company.id, email.trim().toLowerCase(), hash, role, name || null);
    res.status(201).json({ id: result.lastInsertRowid, email, role, name: name || null, companyId: company.id });
  } catch (e) {
    if (e.message.includes('UNIQUE') || e.message.includes('duplicate')) return res.status(409).json({ error: 'Email already exists' });
    throw e;
  }
});

// PUT /api/super/companies/:id/users/:userId   body: { name?, role?, password? }
router.put('/companies/:id/users/:userId', async (req, res) => {
  const company = await requireCompany(req, res);
  if (!company) return;

  const { name, role, password } = req.body;
  const fields = {};
  if (name     !== undefined) fields.name = name;
  if (role     !== undefined) {
    if (!['company_admin', 'technician'].includes(role)) return res.status(400).json({ error: 'invalid role' });
    fields.role = role;
  }
  if (password !== undefined) fields.password_hash = await hashPassword(password);
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to update' });

  await db.users.update(req.params.userId, company.id, fields);
  res.json({ ok: true });
});

// DELETE /api/super/companies/:id/users/:userId
router.delete('/companies/:id/users/:userId', async (req, res) => {
  const company = await requireCompany(req, res);
  if (!company) return;
  await db.users.delete(req.params.userId, company.id);
  res.json({ ok: true });
});

// ── Company drill-down: devices ───────────────────────────────────────────────

// GET /api/super/companies/:id/devices
router.get('/companies/:id/devices', async (req, res) => {
  const company = await requireCompany(req, res);
  if (!company) return;
  const devs = await db.devices.getByCompany(company.id);
  const withTechs = await Promise.all(devs.map(async d => ({
    ...d,
    sms_recipients: JSON.parse(d.sms_recipients || '[]'),
    technicians: await db.deviceTechnicians.getForDevice(d.id),
  })));
  res.json(withTechs);
});

// POST /api/super/companies/:id/devices
// body: { name, apn?, sms_recipients?, technician_ids? }
router.post('/companies/:id/devices', async (req, res) => {
  const company = await requireCompany(req, res);
  if (!company) return;

  const { name, apn = 'internet', sms_recipients = [], technician_ids = [] } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });

  const secret = uuidv4();
  const result = await db.devices.create(company.id, secret, name.trim(), apn, sms_recipients);
  if (technician_ids.length) {
    await db.deviceTechnicians.setForDevice(result.lastInsertRowid, technician_ids);
  }
  res.status(201).json({
    id: result.lastInsertRowid,
    secret, // shown once — technician programs this into firmware
    name: name.trim(),
    apn,
    sms_recipients,
    technician_ids,
    companyId: company.id,
  });
});

// PUT /api/super/companies/:id/devices/:deviceId
// body: { name?, apn?, sms_recipients?, technician_ids? }
router.put('/companies/:id/devices/:deviceId', async (req, res) => {
  const company = await requireCompany(req, res);
  if (!company) return;

  const allowed = ['name', 'apn', 'sms_recipients'];
  const fields  = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      fields[k] = k === 'sms_recipients' ? JSON.stringify(req.body[k]) : req.body[k];
    }
  }
  if (Object.keys(fields).length) {
    await db.devices.update(req.params.deviceId, company.id, fields);
  }
  if (req.body.technician_ids !== undefined) {
    await db.deviceTechnicians.setForDevice(req.params.deviceId, req.body.technician_ids);
  }
  res.json({ ok: true });
});

// DELETE /api/super/companies/:id/devices/:deviceId
router.delete('/companies/:id/devices/:deviceId', async (req, res) => {
  const company = await requireCompany(req, res);
  if (!company) return;
  await db.devices.delete(req.params.deviceId, company.id);
  res.json({ ok: true });
});

// GET /api/super/companies/:id/devices/:deviceId/history|gpio|alerts
router.get('/companies/:id/devices/:deviceId/history', async (req, res) => {
  const company = await requireCompany(req, res);
  if (!company) return;
  const dev = await db.devices.getById(req.params.deviceId);
  if (!dev || dev.company_id !== company.id) return res.status(404).json({ error: 'Not found' });
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  res.json(await db.dataLog.history(dev.id, limit));
});

router.get('/companies/:id/devices/:deviceId/gpio', async (req, res) => {
  const company = await requireCompany(req, res);
  if (!company) return;
  const dev = await db.devices.getById(req.params.deviceId);
  if (!dev || dev.company_id !== company.id) return res.status(404).json({ error: 'Not found' });
  res.json(await db.gpio.latest(dev.id));
});

router.get('/companies/:id/devices/:deviceId/alerts', async (req, res) => {
  const company = await requireCompany(req, res);
  if (!company) return;
  const dev = await db.devices.getById(req.params.deviceId);
  if (!dev || dev.company_id !== company.id) return res.status(404).json({ error: 'Not found' });
  res.json(await db.alerts.getAll(dev.id));
});

// POST /api/super/companies/:id/devices/:deviceId/alerts/:alertId/acknowledge
// super_admin can always acknowledge, as a fallback to the assigned technician.
router.post('/companies/:id/devices/:deviceId/alerts/:alertId/acknowledge', async (req, res) => {
  const company = await requireCompany(req, res);
  if (!company) return;
  const dev = await db.devices.getById(req.params.deviceId);
  if (!dev || dev.company_id !== company.id) return res.status(404).json({ error: 'Device not found' });
  const alert = await db.alerts.getByIdWithCompany(req.params.alertId);
  if (!alert || alert.device_id !== dev.id) return res.status(404).json({ error: 'Alert not found' });
  await db.alerts.resolve(alert.id, alert.device_id);
  res.json({ ok: true });
});

// ── Stats ──────────────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  const companies = await db.companies.getAll();
  res.json({ companies: companies.length });
});

module.exports = router;
