const AZURE_BACKEND = 'https://remotemrimonitor-gvfwc9fccxbgh6an.australiaeast-01.azurewebsites.net';

const BASE = import.meta.env.PROD
  ? (import.meta.env.VITE_API_URL || AZURE_BACKEND)
  : '';   // dev proxy handles it

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data;
}

export const api = {
  // Auth
  login:   (email, password)       => req('POST', '/api/auth/login',   { email, password }),
  logout:  ()                      => req('POST', '/api/auth/logout'),
  refresh: ()                      => req('POST', '/api/auth/refresh'),
  me:      ()                      => req('GET',  '/api/auth/me'),

  // ── Company scope (read-only for manager; technician sees only assigned devices) ──
  devices:            ()                  => req('GET',  '/api/company/devices'),
  deviceHistory:      (id, limit = 50)    => req('GET',  `/api/company/devices/${id}/history?limit=${limit}`),
  deviceGPIO:         (id)                => req('GET',  `/api/company/devices/${id}/gpio`),
  deviceAlerts:       (id)                => req('GET',  `/api/company/devices/${id}/alerts`),
  deviceTechnicians:  (id)                => req('GET',  `/api/company/devices/${id}/technicians`),
  // Only succeeds for the technician assigned to that device (enforced server-side)
  ackAlert:           (deviceId, alertId) => req('POST', `/api/company/devices/${deviceId}/alerts/${alertId}/acknowledge`),
  users:              ()                  => req('GET',  '/api/company/users'),

  // ── Super admin: companies ──────────────────────────────────────────────────
  companies:     ()                => req('GET',  '/api/super/companies'),
  createCompany: (name)            => req('POST', '/api/super/companies', { name }),
  deleteCompany: (id)              => req('DELETE', `/api/super/companies/${id}`),
  createAdmin:   (companyId, body) => req('POST', `/api/super/companies/${companyId}/admins`, body),

  // ── Super admin: drill-down into a company (full read+write) ────────────────
  superCompanyUsers:   (companyId)               => req('GET',    `/api/super/companies/${companyId}/users`),
  superCreateUser:     (companyId, body)         => req('POST',   `/api/super/companies/${companyId}/users`, body),
  superUpdateUser:     (companyId, userId, body) => req('PUT',    `/api/super/companies/${companyId}/users/${userId}`, body),
  superDeleteUser:     (companyId, userId)       => req('DELETE', `/api/super/companies/${companyId}/users/${userId}`),

  superCompanyDevices: (companyId)                 => req('GET',    `/api/super/companies/${companyId}/devices`),
  superCreateDevice:   (companyId, body)           => req('POST',   `/api/super/companies/${companyId}/devices`, body),
  superUpdateDevice:   (companyId, deviceId, body) => req('PUT',    `/api/super/companies/${companyId}/devices/${deviceId}`, body),
  superDeleteDevice:   (companyId, deviceId)       => req('DELETE', `/api/super/companies/${companyId}/devices/${deviceId}`),

  superDeviceHistory:  (companyId, deviceId, limit = 50) =>
    req('GET', `/api/super/companies/${companyId}/devices/${deviceId}/history?limit=${limit}`),
  superDeviceGPIO:     (companyId, deviceId) => req('GET', `/api/super/companies/${companyId}/devices/${deviceId}/gpio`),
  superDeviceAlerts:   (companyId, deviceId) => req('GET', `/api/super/companies/${companyId}/devices/${deviceId}/alerts`),
  superAckAlert:       (companyId, deviceId, alertId) =>
    req('POST', `/api/super/companies/${companyId}/devices/${deviceId}/alerts/${alertId}/acknowledge`),

  // Push
  vapidKey:      ()                => req('GET',  '/api/vapid-public-key'),
  pushSubscribe: (sub)             => req('POST', '/api/push/subscribe',   sub),
  pushUnsub:     (endpoint)        => req('DELETE', '/api/push/unsubscribe', { endpoint }),
};
