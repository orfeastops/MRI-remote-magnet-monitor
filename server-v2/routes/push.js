const router = require('express').Router();
const db     = require('../db');

// POST /api/push/subscribe   body: { endpoint, keys: { p256dh, auth } }
router.post('/subscribe', async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Invalid push subscription object' });
  }
  await db.pushSubs.save(req.user.userId, endpoint, keys);
  res.json({ ok: true });
});

// DELETE /api/push/unsubscribe   body: { endpoint }
router.delete('/unsubscribe', async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
  await db.pushSubs.delete(req.user.userId, endpoint);
  res.json({ ok: true });
});

module.exports = router;
