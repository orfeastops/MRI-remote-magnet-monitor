// Company-scoped routes.
// company_admin (manager) role: READ-ONLY across the board.
// technician role: read-only, scoped to their assigned devices, plus alert acknowledgment.
// Creating/editing users, devices, and technician assignments is done exclusively
// by super_admin via routes/admin.js.
const router = require('express').Router();
const db     = require('../db');
const { getOnlineDeviceIds } = require('../ws/hub');

// ── Users (read-only) ────────────────────────────────────────────────────────

// GET /api/company/users
router.get('/users', async (req, res) => {
  res.json(await db.users.getByCompany(req.user.companyId));
});

// ── Devices ──────────────────────────────────────────────────────────────────

// GET /api/company/devices
// Manager: sees all devices in the company (read-only).
// Technician: sees only devices assigned to them.
router.get('/devices', async (req, res) => {
  const onlineIds = new Set(getOnlineDeviceIds());
  let devs = await db.devices.getByCompany(req.user.companyId);

  if (req.user.role === 'technician') {
    const assignedIds = new Set(await db.deviceTechnicians.getDeviceIdsForTechnician(req.user.userId));
    devs = devs.filter(d => assignedIds.has(d.id));
  }

  devs = devs.map(d => ({
    ...d,
    sms_recipients: JSON.parse(d.sms_recipients || '[]'),
    online: onlineIds.has(d.id),
  }));
  res.json(devs);
});

// Shared access check: device must belong to caller's company, and if caller
// is a technician, they must be assigned to it.
async function loadAccessibleDevice(req, deviceId) {
  const dev = await db.devices.getById(deviceId);
  if (!dev || dev.company_id !== req.user.companyId) return null;
  if (req.user.role === 'technician') {
    const assigned = await db.deviceTechnicians.isAssigned(dev.id, req.user.userId);
    if (!assigned) return null;
  }
  return dev;
}

// GET /api/company/devices/:id/history
router.get('/devices/:id/history', async (req, res) => {
  const dev = await loadAccessibleDevice(req, req.params.id);
  if (!dev) return res.status(404).json({ error: 'Not found' });
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  res.json(await db.dataLog.history(dev.id, limit));
});

// GET /api/company/devices/:id/gpio
router.get('/devices/:id/gpio', async (req, res) => {
  const dev = await loadAccessibleDevice(req, req.params.id);
  if (!dev) return res.status(404).json({ error: 'Not found' });
  res.json(await db.gpio.latest(dev.id));
});

// GET /api/company/devices/:id/alerts
router.get('/devices/:id/alerts', async (req, res) => {
  const dev = await loadAccessibleDevice(req, req.params.id);
  if (!dev) return res.status(404).json({ error: 'Not found' });
  res.json(await db.alerts.getAll(dev.id));
});

// GET /api/company/devices/:id/technicians
// Lets a manager see who is assigned to a device (read-only).
router.get('/devices/:id/technicians', async (req, res) => {
  const dev = await loadAccessibleDevice(req, req.params.id);
  if (!dev) return res.status(404).json({ error: 'Not found' });
  res.json(await db.deviceTechnicians.getForDevice(dev.id));
});

// POST /api/company/devices/:id/alerts/:alertId/acknowledge
// Only the technician assigned to this specific device can acknowledge.
router.post('/devices/:id/alerts/:alertId/acknowledge', async (req, res) => {
  if (req.user.role !== 'technician') {
    return res.status(403).json({ error: 'Only an assigned technician can acknowledge alerts' });
  }
  const dev = await loadAccessibleDevice(req, req.params.id);
  if (!dev) return res.status(404).json({ error: 'Device not found or not assigned to you' });

  const alert = await db.alerts.getByIdWithCompany(req.params.alertId);
  if (!alert || alert.device_id !== dev.id) return res.status(404).json({ error: 'Alert not found' });

  await db.alerts.resolve(alert.id, alert.device_id);
  res.json({ ok: true });
});

module.exports = router;
