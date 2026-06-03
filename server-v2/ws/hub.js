const WebSocket = require('ws');
const cookie    = require('cookie');
const db        = require('../db');
const { verifyAccess } = require('../auth');
const { handleDeviceMessage }  = require('./deviceHandler');
const { handleBrowserMessage } = require('./browserHandler');

// deviceConnections: deviceId → ws
const deviceConnections = new Map();

// watchersByDevice: deviceId → Set<ws>
const watchersByDevice = new Map();

function getWatchers(deviceId) {
  if (!watchersByDevice.has(deviceId)) watchersByDevice.set(deviceId, new Set());
  return watchersByDevice.get(deviceId);
}

function addWatcher(deviceId, ws) {
  getWatchers(deviceId).add(ws);
}

function removeWatcher(deviceId, ws) {
  getWatchers(deviceId)?.delete(ws);
}

function broadcastToWatchers(deviceId, msg) {
  const str = JSON.stringify(msg);
  getWatchers(deviceId).forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(str);
  });
}

function sendToDevice(deviceId, msg) {
  const ws = deviceConnections.get(deviceId);
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// Returns true if the device is currently online
function isDeviceOnline(deviceId) {
  const ws = deviceConnections.get(deviceId);
  return ws ? ws.readyState === WebSocket.OPEN : false;
}

// ── Authentication helpers ────────────────────────────────────────────────────

function extractAccessToken(req) {
  const cookies = cookie.parse(req.headers.cookie || '');
  return cookies.access_token || null;
}

function extractDeviceSecret(req) {
  const url = new URL(req.url, 'http://localhost');
  return url.searchParams.get('secret') || null;
}

// ── Hub setup ─────────────────────────────────────────────────────────────────

function setupHub(server) {
  const wss = new WebSocket.Server({ server, path: '/ws', skipUTF8Validation: true });

  // Ping loop — terminate dead connections within ~20s
  const pingInterval = setInterval(() => {
    wss.clients.forEach(ws => {
      if (ws.isAlive === false) { ws.terminate(); return; }
      ws.isAlive = false;
      ws.ping();
    });
  }, 10000);
  wss.on('close', () => clearInterval(pingInterval));

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // ── Try device auth first (secret in query param) ──
    const secret = extractDeviceSecret(req);
    if (secret) {
      const deviceRow = db.devices.getBySecret(secret);
      if (!deviceRow) {
        ws.close(4001, 'Unknown device secret');
        return;
      }

      deviceConnections.set(deviceRow.id, ws);
      db.devices.touchLastSeen(deviceRow.id);
      console.log(`[HUB] Device online: ${deviceRow.id} (${deviceRow.name || 'unnamed'})`);

      broadcastOnlineStatus(deviceRow.id, true);

      const deviceCtx = {
        deviceRow,
        broadcastToWatchers,
        sendToDevice,
      };

      ws.on('message', (rawBuf) => {
        let msg;
        try {
          const raw = Buffer.isBuffer(rawBuf) ? rawBuf.toString('latin1') : rawBuf;
          msg = JSON.parse(raw);
        } catch { return; }
        handleDeviceMessage(msg, deviceCtx);
      });

      ws.on('close', () => {
        deviceConnections.delete(deviceRow.id);
        console.log(`[HUB] Device offline: ${deviceRow.id}`);
        broadcastOnlineStatus(deviceRow.id, false);
      });

      return;
    }

    // ── Browser auth (JWT cookie) ──
    const token = extractAccessToken(req);
    let user;
    try {
      user = verifyAccess(token);
    } catch {
      ws.close(4003, 'Unauthorized');
      return;
    }

    // super_admin has no companyId — they can only use REST, not WS device streams
    if (!user.companyId) {
      ws.close(4003, 'Super-admin cannot use device WebSocket');
      return;
    }

    console.log(`[HUB] Browser connected: ${user.email} (company ${user.companyId})`);

    const watchingDevices = new Set();

    const browserCtx = {
      user,
      wsClient: ws,
      watchingDevices,
      addWatcher,
      removeWatcher,
      sendToDevice,
    };

    ws.on('message', (rawBuf) => {
      let msg;
      try { msg = JSON.parse(rawBuf.toString()); }
      catch { return; }
      handleBrowserMessage(msg, browserCtx);
    });

    ws.on('close', () => {
      watchingDevices.forEach(deviceId => removeWatcher(deviceId, ws));
      console.log(`[HUB] Browser disconnected: ${user.email}`);
    });
  });

  return wss;
}

function broadcastOnlineStatus(deviceId, online) {
  const dev = db.devices.getById(deviceId);
  if (!dev) return;

  // Broadcast to all watchers of this device
  broadcastToWatchers(deviceId, {
    type: online ? 'device_online' : 'device_offline',
    deviceId,
  });
}

// Expose for REST routes that need online status
function getOnlineDeviceIds() {
  return [...deviceConnections.keys()];
}

module.exports = { setupHub, isDeviceOnline, getOnlineDeviceIds };
