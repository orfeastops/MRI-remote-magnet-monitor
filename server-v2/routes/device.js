// Public device config endpoint — authenticated by device secret (no JWT)
// GET /api/device/config?secret=<device_secret>
// Returns the dynamic config the LilyGO downloads on boot.

const router = require('express').Router();
const db     = require('../db');

router.get('/config', (req, res) => {
  const secret = req.query.secret;
  if (!secret) return res.status(400).json({ error: 'secret required' });

  const device = db.devices.getBySecret(secret);
  if (!device) return res.status(404).json({ error: 'Unknown device' });

  db.devices.touchLastSeen(device.id);

  res.json({
    device_id:      device.id,
    name:           device.name,
    apn:            device.apn || 'internet',
    sms_recipients: JSON.parse(device.sms_recipients || '[]'),
    ws_url:         `wss://magnets.karnagio.org/ws?secret=${secret}`,
  });
});

module.exports = router;
