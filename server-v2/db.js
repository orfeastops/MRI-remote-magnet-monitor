const sql = require('mssql');
const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: true,               // required for Azure SQL
    trustServerCertificate: false,
  },
  connectionTimeout: 45000,
  requestTimeout: 45000,
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

const poolPromise = sql.connect(config)
  .then(pool => {
    console.log('[DB] Connected to Azure SQL Database');
    return pool;
  })
  .catch(err => {
    console.error('[DB] Connection failed:', err.message);
    throw err;
  });

async function getPool() {
  return poolPromise;
}

// ── Schema (idempotent) ────────────────────────────────────────────────────
async function ensureSchema() {
  const pool = await getPool();
  await pool.request().batch(`
    IF OBJECT_ID('companies', 'U') IS NULL
    CREATE TABLE companies (
      id         INT IDENTITY(1,1) PRIMARY KEY,
      name       NVARCHAR(255) NOT NULL,
      created_at DATETIME2 DEFAULT SYSUTCDATETIME()
    );

    IF OBJECT_ID('users', 'U') IS NULL
    CREATE TABLE users (
      id            INT IDENTITY(1,1) PRIMARY KEY,
      company_id    INT NOT NULL REFERENCES companies(id),
      email         NVARCHAR(255) UNIQUE NOT NULL,
      password_hash NVARCHAR(255) NOT NULL,
      role          NVARCHAR(50) NOT NULL CHECK(role IN ('company_admin','technician')),
      name          NVARCHAR(255),
      created_at    DATETIME2 DEFAULT SYSUTCDATETIME()
    );

    IF OBJECT_ID('devices', 'U') IS NULL
    CREATE TABLE devices (
      id             INT IDENTITY(1,1) PRIMARY KEY,
      company_id     INT NOT NULL REFERENCES companies(id),
      secret         NVARCHAR(255) UNIQUE NOT NULL,
      name           NVARCHAR(255),
      apn            NVARCHAR(255) DEFAULT 'internet',
      sms_recipients NVARCHAR(MAX) DEFAULT '[]',
      created_at     DATETIME2 DEFAULT SYSUTCDATETIME(),
      last_seen      DATETIME2
    );

    IF OBJECT_ID('data_log', 'U') IS NULL
    CREATE TABLE data_log (
      id        INT IDENTITY(1,1) PRIMARY KEY,
      device_id INT NOT NULL REFERENCES devices(id),
      raw       NVARCHAR(MAX) NOT NULL,
      ts        DATETIME2 DEFAULT SYSUTCDATETIME()
    );

    IF OBJECT_ID('gpio_states', 'U') IS NULL
    CREATE TABLE gpio_states (
      id        INT IDENTITY(1,1) PRIMARY KEY,
      device_id INT NOT NULL REFERENCES devices(id),
      pin       INT NOT NULL,
      state     INT NOT NULL,
      ts        DATETIME2 DEFAULT SYSUTCDATETIME()
    );

    IF OBJECT_ID('alerts', 'U') IS NULL
    CREATE TABLE alerts (
      id        INT IDENTITY(1,1) PRIMARY KEY,
      device_id INT NOT NULL REFERENCES devices(id),
      type      NVARCHAR(100) NOT NULL,
      message   NVARCHAR(MAX) NOT NULL,
      resolved  INT DEFAULT 0,
      ts        DATETIME2 DEFAULT SYSUTCDATETIME()
    );

    IF OBJECT_ID('push_subscriptions', 'U') IS NULL
    CREATE TABLE push_subscriptions (
      id         INT IDENTITY(1,1) PRIMARY KEY,
      user_id    INT NOT NULL REFERENCES users(id),
      endpoint   NVARCHAR(400) NOT NULL,
      keys       NVARCHAR(MAX) NOT NULL,
      created_at DATETIME2 DEFAULT SYSUTCDATETIME(),
      CONSTRAINT UQ_push_user_endpoint UNIQUE(user_id, endpoint)
    );

    IF OBJECT_ID('refresh_tokens', 'U') IS NULL
    CREATE TABLE refresh_tokens (
      id         INT IDENTITY(1,1) PRIMARY KEY,
      user_id    INT NULL,
      is_super   INT DEFAULT 0,
      token_hash NVARCHAR(255) UNIQUE NOT NULL,
      expires_at DATETIME2 NOT NULL,
      created_at DATETIME2 DEFAULT SYSUTCDATETIME()
    );

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_data_log_device')
      CREATE INDEX idx_data_log_device ON data_log(device_id, ts DESC);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_gpio_device')
      CREATE INDEX idx_gpio_device ON gpio_states(device_id, ts DESC);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_alerts_device')
      CREATE INDEX idx_alerts_device ON alerts(device_id, ts DESC);
  `);
  console.log('[DB] Schema ready');
}

// ── Companies ────────────────────────────────────────────────────────────────
const companies = {
  create: async (name) => {
    const pool = await getPool();
    const result = await pool.request()
      .input('name', sql.NVarChar, name)
      .query('INSERT INTO companies (name) OUTPUT INSERTED.id VALUES (@name)');
    return { lastInsertRowid: result.recordset[0].id };
  },
  getAll: async () => {
    const pool = await getPool();
    const result = await pool.request().query('SELECT * FROM companies ORDER BY name');
    return result.recordset;
  },
  getById: async (id) => {
    const pool = await getPool();
    const result = await pool.request().input('id', sql.Int, id)
      .query('SELECT * FROM companies WHERE id=@id');
    return result.recordset[0];
  },
  delete: async (id) => {
    const pool = await getPool();
    // Manual cascade (schema has no ON DELETE CASCADE, to avoid SQL Server's
    // multiple-cascade-paths restriction)
    await pool.request().input('id', sql.Int, id).query(`
      DELETE ps FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id WHERE u.company_id=@id;
      DELETE dl FROM data_log dl JOIN devices d ON d.id=dl.device_id WHERE d.company_id=@id;
      DELETE g  FROM gpio_states g  JOIN devices d ON d.id=g.device_id  WHERE d.company_id=@id;
      DELETE a  FROM alerts a       JOIN devices d ON d.id=a.device_id  WHERE d.company_id=@id;
      DELETE FROM devices WHERE company_id=@id;
      DELETE FROM users WHERE company_id=@id;
      DELETE FROM companies WHERE id=@id;
    `);
  },
};

// ── Users ────────────────────────────────────────────────────────────────────
const users = {
  create: async (companyId, email, hash, role, name) => {
    const pool = await getPool();
    const result = await pool.request()
      .input('companyId', sql.Int, companyId)
      .input('email', sql.NVarChar, email)
      .input('hash', sql.NVarChar, hash)
      .input('role', sql.NVarChar, role)
      .input('name', sql.NVarChar, name)
      .query(`INSERT INTO users (company_id,email,password_hash,role,name)
              OUTPUT INSERTED.id VALUES (@companyId,@email,@hash,@role,@name)`);
    return { lastInsertRowid: result.recordset[0].id };
  },
  getByEmail: async (email) => {
    const pool = await getPool();
    const result = await pool.request().input('email', sql.NVarChar, email)
      .query('SELECT * FROM users WHERE email=@email');
    return result.recordset[0];
  },
  getById: async (id) => {
    const pool = await getPool();
    const result = await pool.request().input('id', sql.Int, id)
      .query('SELECT * FROM users WHERE id=@id');
    return result.recordset[0];
  },
  getByCompany: async (companyId) => {
    const pool = await getPool();
    const result = await pool.request().input('companyId', sql.Int, companyId)
      .query('SELECT id,company_id,email,role,name,created_at FROM users WHERE company_id=@companyId');
    return result.recordset;
  },
  update: async (id, companyId, fields) => {
    const pool = await getPool();
    const request = pool.request().input('id', sql.Int, id).input('companyId', sql.Int, companyId);
    const sets = Object.keys(fields).map((k, i) => {
      request.input(`p${i}`, fields[k]);
      return `${k}=@p${i}`;
    }).join(',');
    await request.query(`UPDATE users SET ${sets} WHERE id=@id AND company_id=@companyId`);
  },
  delete: async (id, companyId) => {
    const pool = await getPool();
    await pool.request().input('id', sql.Int, id).input('companyId', sql.Int, companyId).query(`
      DELETE FROM push_subscriptions WHERE user_id=@id;
      DELETE FROM users WHERE id=@id AND company_id=@companyId;
    `);
  },
};

// ── Devices ──────────────────────────────────────────────────────────────────
const devices = {
  create: async (companyId, secret, name, apn, smsRecipients) => {
    const pool = await getPool();
    const result = await pool.request()
      .input('companyId', sql.Int, companyId)
      .input('secret', sql.NVarChar, secret)
      .input('name', sql.NVarChar, name)
      .input('apn', sql.NVarChar, apn)
      .input('sms', sql.NVarChar, JSON.stringify(smsRecipients || []))
      .query(`INSERT INTO devices (company_id,secret,name,apn,sms_recipients)
              OUTPUT INSERTED.id VALUES (@companyId,@secret,@name,@apn,@sms)`);
    return { lastInsertRowid: result.recordset[0].id };
  },
  getBySecret: async (secret) => {
    const pool = await getPool();
    const result = await pool.request().input('secret', sql.NVarChar, secret)
      .query('SELECT * FROM devices WHERE secret=@secret');
    return result.recordset[0];
  },
  getById: async (id) => {
    const pool = await getPool();
    const result = await pool.request().input('id', sql.Int, id)
      .query('SELECT * FROM devices WHERE id=@id');
    return result.recordset[0];
  },
  getByCompany: async (companyId) => {
    const pool = await getPool();
    const result = await pool.request().input('companyId', sql.Int, companyId)
      .query('SELECT * FROM devices WHERE company_id=@companyId ORDER BY name');
    return result.recordset;
  },
  update: async (id, companyId, fields) => {
    const pool = await getPool();
    const request = pool.request().input('id', sql.Int, id).input('companyId', sql.Int, companyId);
    const sets = Object.keys(fields).map((k, i) => {
      request.input(`p${i}`, fields[k]);
      return `${k}=@p${i}`;
    }).join(',');
    await request.query(`UPDATE devices SET ${sets} WHERE id=@id AND company_id=@companyId`);
  },
  touchLastSeen: async (id) => {
    const pool = await getPool();
    await pool.request().input('id', sql.Int, id)
      .query('UPDATE devices SET last_seen=SYSUTCDATETIME() WHERE id=@id');
  },
  delete: async (id, companyId) => {
    const pool = await getPool();
    await pool.request().input('id', sql.Int, id).input('companyId', sql.Int, companyId).query(`
      DELETE FROM data_log WHERE device_id=@id;
      DELETE FROM gpio_states WHERE device_id=@id;
      DELETE FROM alerts WHERE device_id=@id;
      DELETE FROM devices WHERE id=@id AND company_id=@companyId;
    `);
  },
};

// ── Data log ─────────────────────────────────────────────────────────────────
const dataLog = {
  save: async (deviceId, raw) => {
    const pool = await getPool();
    await pool.request().input('deviceId', sql.Int, deviceId).input('raw', sql.NVarChar, raw)
      .query('INSERT INTO data_log (device_id,raw) VALUES (@deviceId,@raw)');
  },
  history: async (deviceId, limit = 100) => {
    const pool = await getPool();
    const result = await pool.request().input('deviceId', sql.Int, deviceId).input('limit', sql.Int, limit)
      .query('SELECT TOP (@limit) * FROM data_log WHERE device_id=@deviceId ORDER BY ts DESC');
    return result.recordset;
  },
};

// ── GPIO ─────────────────────────────────────────────────────────────────────
const gpio = {
  save: async (deviceId, pin, state) => {
    const pool = await getPool();
    await pool.request().input('deviceId', sql.Int, deviceId).input('pin', sql.Int, pin).input('state', sql.Int, state)
      .query('INSERT INTO gpio_states (device_id,pin,state) VALUES (@deviceId,@pin,@state)');
  },
  latest: async (deviceId) => {
    const pool = await getPool();
    const result = await pool.request().input('deviceId', sql.Int, deviceId).query(`
      SELECT pin, state, ts FROM gpio_states g1
      WHERE device_id=@deviceId AND ts = (
        SELECT MAX(ts) FROM gpio_states g2 WHERE g2.device_id=g1.device_id AND g2.pin=g1.pin
      )`);
    return result.recordset;
  },
};

// ── Alerts ───────────────────────────────────────────────────────────────────
const alerts = {
  create: async (deviceId, type, message) => {
    const pool = await getPool();
    await pool.request().input('deviceId', sql.Int, deviceId).input('type', sql.NVarChar, type).input('message', sql.NVarChar, message)
      .query('INSERT INTO alerts (device_id,type,message) VALUES (@deviceId,@type,@message)');
  },
  getOpen: async (deviceId) => {
    const pool = await getPool();
    const result = await pool.request().input('deviceId', sql.Int, deviceId)
      .query('SELECT * FROM alerts WHERE device_id=@deviceId AND resolved=0 ORDER BY ts DESC');
    return result.recordset;
  },
  getAll: async (deviceId) => {
    const pool = await getPool();
    const result = await pool.request().input('deviceId', sql.Int, deviceId)
      .query('SELECT TOP (200) * FROM alerts WHERE device_id=@deviceId ORDER BY ts DESC');
    return result.recordset;
  },
  resolve: async (id, deviceId) => {
    const pool = await getPool();
    await pool.request().input('id', sql.Int, id).input('deviceId', sql.Int, deviceId)
      .query('UPDATE alerts SET resolved=1 WHERE id=@id AND device_id=@deviceId');
  },
  hasOpenByType: async (deviceId, type) => {
    const pool = await getPool();
    const result = await pool.request().input('deviceId', sql.Int, deviceId).input('type', sql.NVarChar, type)
      .query('SELECT id FROM alerts WHERE device_id=@deviceId AND type=@type AND resolved=0');
    return result.recordset.length > 0;
  },
  getByIdWithCompany: async (id) => {
    const pool = await getPool();
    const result = await pool.request().input('id', sql.Int, id).query(`
      SELECT a.*, d.company_id FROM alerts a JOIN devices d ON d.id=a.device_id WHERE a.id=@id`);
    return result.recordset[0];
  },
};

// ── Push subscriptions ───────────────────────────────────────────────────────
const pushSubs = {
  save: async (userId, endpoint, keys) => {
    const pool = await getPool();
    await pool.request()
      .input('userId', sql.Int, userId).input('endpoint', sql.NVarChar, endpoint).input('keys', sql.NVarChar, JSON.stringify(keys))
      .query(`MERGE push_subscriptions AS target
              USING (SELECT @userId AS user_id, @endpoint AS endpoint) AS src
              ON target.user_id = src.user_id AND target.endpoint = src.endpoint
              WHEN MATCHED THEN UPDATE SET keys=@keys
              WHEN NOT MATCHED THEN INSERT (user_id,endpoint,keys) VALUES (@userId,@endpoint,@keys);`);
  },
  delete: async (userId, endpoint) => {
    const pool = await getPool();
    await pool.request().input('userId', sql.Int, userId).input('endpoint', sql.NVarChar, endpoint)
      .query('DELETE FROM push_subscriptions WHERE user_id=@userId AND endpoint=@endpoint');
  },
  forUsers: async (userIds) => {
    if (!userIds.length) return [];
    const pool = await getPool();
    const request = pool.request();
    const placeholders = userIds.map((id, i) => { request.input(`u${i}`, sql.Int, id); return `@u${i}`; }).join(',');
    const result = await request.query(`SELECT * FROM push_subscriptions WHERE user_id IN (${placeholders})`);
    return result.recordset;
  },
};

// ── Refresh tokens ───────────────────────────────────────────────────────────
const refreshTokens = {
  save: async (userId, isSuper, hash, expiresAt) => {
    const pool = await getPool();
    await pool.request()
      .input('userId', sql.Int, userId).input('isSuper', sql.Int, isSuper ? 1 : 0)
      .input('hash', sql.NVarChar, hash).input('expiresAt', sql.DateTime2, new Date(expiresAt))
      .query('INSERT INTO refresh_tokens (user_id,is_super,token_hash,expires_at) VALUES (@userId,@isSuper,@hash,@expiresAt)');
  },
  find: async (hash) => {
    const pool = await getPool();
    const result = await pool.request().input('hash', sql.NVarChar, hash)
      .query('SELECT * FROM refresh_tokens WHERE token_hash=@hash AND expires_at > SYSUTCDATETIME()');
    return result.recordset[0];
  },
  delete: async (hash) => {
    const pool = await getPool();
    await pool.request().input('hash', sql.NVarChar, hash).query('DELETE FROM refresh_tokens WHERE token_hash=@hash');
  },
  purge: async () => {
    const pool = await getPool();
    await pool.request().query('DELETE FROM refresh_tokens WHERE expires_at <= SYSUTCDATETIME()');
  },
};

module.exports = { ensureSchema, companies, users, devices, dataLog, gpio, alerts, pushSubs, refreshTokens };
