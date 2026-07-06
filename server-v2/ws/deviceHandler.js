const db      = require('../db');
const webpush = require('web-push');

// GPIO pins we care about
const QUENCH_PIN  = 35;
const ALARM_PINS  = [32, 34, 35];

// Called by hub.js when a message arrives from an authenticated LilyGO device
function handleDeviceMessage(msg, ctx) {
  const { deviceRow, broadcastToWatchers, sendToDevice } = ctx;

  if (msg.type === 'serial_data') {
    db.dataLog.save(deviceRow.id, msg.data);
    db.devices.touchLastSeen(deviceRow.id);
    broadcastToWatchers(deviceRow.id, {
      type: 'serial_data',
      deviceId: deviceRow.id,
      data: msg.data,
      ts: new Date().toISOString(),
    });
  }

  if (msg.type === 'gpio_update') {
    // msg.pins = { "32": 0, "34": 1, "35": 0 }
    const pins = msg.pins || {};
    for (const [pinStr, state] of Object.entries(pins)) {
      const pin = parseInt(pinStr);
      if (!ALARM_PINS.includes(pin)) continue;
      db.gpio.save(deviceRow.id, pin, state ? 1 : 0);
    }

    broadcastToWatchers(deviceRow.id, {
      type: 'gpio_update',
      deviceId: deviceRow.id,
      pins,
      ts: new Date().toISOString(),
    });

    // Quench detection (GPIO 35 HIGH = quench active)
    if (pins['35'] === 1 || pins[35] === 1) {
      createAlert(deviceRow, 'quench', 'QUENCH DETECTED — magnet ramping down!');
    }
    // Alarm pin 32 — INPUT_PULLUP, LOW (0) = active
    if (pins['32'] === 0 || pins[32] === 0) {
      createAlert(deviceRow, 'alarm_32', 'Alarm pin 32 active');
    }
    // Alarm pin 34
    if (pins['34'] === 1 || pins[34] === 1) {
      createAlert(deviceRow, 'alarm_34', 'Alarm pin 34 active');
    }
  }

  if (msg.type === 'status') {
    // msg: { battery_mv, signal_rssi, on_mains }
    broadcastToWatchers(deviceRow.id, {
      type: 'device_status',
      deviceId: deviceRow.id,
      battery_mv: msg.battery_mv,
      signal_rssi: msg.signal_rssi,
      on_mains: msg.on_mains,
      ts: new Date().toISOString(),
    });

    if (msg.battery_mv !== undefined && msg.on_mains === false && msg.battery_mv < 3400) {
      createAlert(deviceRow, 'low_battery', `Low battery: ${msg.battery_mv}mV`);
    }
  }
}

function createAlert(deviceRow, type, message) {
  if (db.alerts.hasOpenByType(deviceRow.id, type)) return; // deduplicate
  db.alerts.create(deviceRow.id, type, message);
  sendPushToCompany(deviceRow, type, message);
  console.log(`[ALERT] Device ${deviceRow.id} (${deviceRow.name}): ${message}`);
}

function sendPushToCompany(deviceRow, alertType, message) {
  // Get all users in the same company
  const companyUsers = db.users.getByCompany(deviceRow.company_id);
  const userIds = companyUsers.map(u => u.id);
  if (!userIds.length) return;

  const subs = db.pushSubs.forUsers(userIds);
  if (!subs.length) return;

  const payload = JSON.stringify({
    title: `MRI Alert — ${deviceRow.name || 'Device ' + deviceRow.id}`,
    body: message,
    tag: `${deviceRow.id}-${alertType}`,
    data: { deviceId: deviceRow.id, alertType },
  });

  for (const sub of subs) {
    let keys;
    try { keys = JSON.parse(sub.keys); } catch { continue; }
    webpush.sendNotification({ endpoint: sub.endpoint, keys }, payload)
      .catch(err => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription expired — remove it
          db.pushSubs.delete(sub.user_id, sub.endpoint);
        }
      });
  }
}

module.exports = { handleDeviceMessage };
