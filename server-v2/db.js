const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'database-v2.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    email        TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role         TEXT NOT NULL CHECK(role IN ('company_admin','technician')),
    name         TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS devices (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id     INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    secret         TEXT UNIQUE NOT NULL,
    name           TEXT,
    apn            TEXT DEFAULT 'internet',
    sms_recipients TEXT DEFAULT '[]',
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen      DATETIME
  );

  CREATE TABLE IF NOT EXISTS data_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    raw       TEXT NOT NULL,
    ts        DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS gpio_states (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    pin       INTEGER NOT NULL,
    state     INTEGER NOT NULL,
    ts        DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    type      TEXT NOT NULL,
    message   TEXT NOT NULL,
    resolved  INTEGER DEFAULT 0,
    ts        DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint   TEXT NOT NULL,
    keys       TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, endpoint)
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    is_super   INTEGER DEFAULT 0,
    token_hash TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_data_log_device ON data_log(device_id, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_gpio_device     ON gpio_states(device_id, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_alerts_device   ON alerts(device_id, ts DESC);
`);

// ── Companies ────────────────────────────────────────────────────────────────
const companies = {
  create:  (name)   => db.prepare('INSERT INTO companies (name) VALUES (?)').run(name),
  getAll:  ()       => db.prepare('SELECT * FROM companies ORDER BY name').all(),
  getById: (id)     => db.prepare('SELECT * FROM companies WHERE id=?').get(id),
  delete:  (id)     => db.prepare('DELETE FROM companies WHERE id=?').run(id),
};

// ── Users ────────────────────────────────────────────────────────────────────
const users = {
  create:      (companyId, email, hash, role, name) =>
    db.prepare('INSERT INTO users (company_id,email,password_hash,role,name) VALUES (?,?,?,?,?)').run(companyId, email, hash, role, name),
  getByEmail:  (email)            => db.prepare('SELECT * FROM users WHERE email=?').get(email),
  getById:     (id)               => db.prepare('SELECT * FROM users WHERE id=?').get(id),
  getByCompany:(companyId)        => db.prepare("SELECT id,company_id,email,role,name,created_at FROM users WHERE company_id=?").all(companyId),
  update:      (id, companyId, fields) => {
    const sets = Object.keys(fields).map(k => `${k}=?`).join(',');
    return db.prepare(`UPDATE users SET ${sets} WHERE id=? AND company_id=?`).run(...Object.values(fields), id, companyId);
  },
  delete:      (id, companyId)    => db.prepare('DELETE FROM users WHERE id=? AND company_id=?').run(id, companyId),
};

// ── Devices ──────────────────────────────────────────────────────────────────
const devices = {
  create:      (companyId, secret, name, apn, smsRecipients) =>
    db.prepare('INSERT INTO devices (company_id,secret,name,apn,sms_recipients) VALUES (?,?,?,?,?)').run(companyId, secret, name, apn, JSON.stringify(smsRecipients || [])),
  getBySecret: (secret)           => db.prepare('SELECT * FROM devices WHERE secret=?').get(secret),
  getById:     (id)               => db.prepare('SELECT * FROM devices WHERE id=?').get(id),
  getByCompany:(companyId)        => db.prepare('SELECT * FROM devices WHERE company_id=? ORDER BY name').all(companyId),
  update:      (id, companyId, fields) => {
    const sets = Object.keys(fields).map(k => `${k}=?`).join(',');
    return db.prepare(`UPDATE devices SET ${sets} WHERE id=? AND company_id=?`).run(...Object.values(fields), id, companyId);
  },
  touchLastSeen: (id)             => db.prepare('UPDATE devices SET last_seen=CURRENT_TIMESTAMP WHERE id=?').run(id),
  delete:      (id, companyId)    => db.prepare('DELETE FROM devices WHERE id=? AND company_id=?').run(id, companyId),
};

// ── Data log ─────────────────────────────────────────────────────────────────
const dataLog = {
  save:    (deviceId, raw)        => db.prepare('INSERT INTO data_log (device_id,raw) VALUES (?,?)').run(deviceId, raw),
  history: (deviceId, limit = 100)=> db.prepare('SELECT * FROM data_log WHERE device_id=? ORDER BY ts DESC LIMIT ?').all(deviceId, limit),
};

// ── GPIO ─────────────────────────────────────────────────────────────────────
const gpio = {
  save:    (deviceId, pin, state) => db.prepare('INSERT INTO gpio_states (device_id,pin,state) VALUES (?,?,?)').run(deviceId, pin, state),
  latest:  (deviceId)             => db.prepare('SELECT pin, state, ts FROM gpio_states WHERE device_id=? GROUP BY pin HAVING ts=MAX(ts)').all(deviceId),
};

// ── Alerts ───────────────────────────────────────────────────────────────────
const alerts = {
  create:  (deviceId, type, message) => db.prepare('INSERT INTO alerts (device_id,type,message) VALUES (?,?,?)').run(deviceId, type, message),
  getOpen: (deviceId)             => db.prepare('SELECT * FROM alerts WHERE device_id=? AND resolved=0 ORDER BY ts DESC').all(deviceId),
  getAll:  (deviceId)             => db.prepare('SELECT * FROM alerts WHERE device_id=? ORDER BY ts DESC LIMIT 200').all(deviceId),
  resolve: (id, deviceId)         => db.prepare('UPDATE alerts SET resolved=1 WHERE id=? AND device_id=?').run(id, deviceId),
  hasOpenByType: (deviceId, type) => !!db.prepare('SELECT id FROM alerts WHERE device_id=? AND type=? AND resolved=0').get(deviceId, type),
  getByIdWithCompany: (id) => db.prepare('SELECT a.*, d.company_id FROM alerts a JOIN devices d ON d.id=a.device_id WHERE a.id=?').get(id),
};

// ── Push subscriptions ───────────────────────────────────────────────────────
const pushSubs = {
  save:    (userId, endpoint, keys) =>
    db.prepare('INSERT OR REPLACE INTO push_subscriptions (user_id,endpoint,keys) VALUES (?,?,?)').run(userId, endpoint, JSON.stringify(keys)),
  delete:  (userId, endpoint)     => db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?').run(userId, endpoint),
  forUsers:(userIds)              => {
    if (!userIds.length) return [];
    const qs = userIds.map(() => '?').join(',');
    return db.prepare(`SELECT * FROM push_subscriptions WHERE user_id IN (${qs})`).all(...userIds);
  },
};

// ── Refresh tokens ───────────────────────────────────────────────────────────
const refreshTokens = {
  save:   (userId, isSuper, hash, expiresAt) =>
    db.prepare('INSERT INTO refresh_tokens (user_id,is_super,token_hash,expires_at) VALUES (?,?,?,?)').run(userId, isSuper ? 1 : 0, hash, expiresAt),
  find:   (hash)    => db.prepare('SELECT * FROM refresh_tokens WHERE token_hash=? AND expires_at > CURRENT_TIMESTAMP').get(hash),
  delete: (hash)    => db.prepare('DELETE FROM refresh_tokens WHERE token_hash=?').run(hash),
  purge:  ()        => db.prepare("DELETE FROM refresh_tokens WHERE expires_at <= CURRENT_TIMESTAMP").run(),
};

module.exports = { companies, users, devices, dataLog, gpio, alerts, pushSubs, refreshTokens };
