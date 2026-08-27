const db = require('../db');

// Called by hub.js when a message arrives from an authenticated browser client
async function handleBrowserMessage(msg, ctx) {
  const { user, wsClient, watchingDevices, addWatcher, removeWatcher, sendToDevice } = ctx;

  if (msg.type === 'watch') {
    // Subscribe to a device's live stream
    const deviceId = parseInt(msg.deviceId);
    const dev = await db.devices.getById(deviceId);
    if (!dev || dev.company_id !== user.companyId) return; // can only watch own company devices
    addWatcher(deviceId, wsClient);
    watchingDevices.add(deviceId);
  }

  if (msg.type === 'unwatch') {
    const deviceId = parseInt(msg.deviceId);
    removeWatcher(deviceId, wsClient);
    watchingDevices.delete(deviceId);
  }

  if (msg.type === 'command') {
    // Only company_admin can send commands
    if (user.role !== 'company_admin') return;
    const deviceId = parseInt(msg.deviceId);
    const dev = await db.devices.getById(deviceId);
    if (!dev || dev.company_id !== user.companyId) return;
    sendToDevice(deviceId, { type: 'command', cmd: msg.cmd });
  }
}

module.exports = { handleBrowserMessage };
