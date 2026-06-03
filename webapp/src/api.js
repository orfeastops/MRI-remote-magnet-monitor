const BASE = import.meta.env.PROD
  ? 'https://hetzner.karnagio.org'
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

  // Company scope
  devices:       ()                => req('GET',  '/api/company/devices'),
  createDevice:  (body)            => req('POST', '/api/company/devices',    body),
  updateDevice:  (id, body)        => req('PUT',  `/api/company/devices/${id}`, body),
  deleteDevice:  (id)              => req('DELETE', `/api/company/devices/${id}`),
  deviceHistory: (id, limit = 50)  => req('GET',  `/api/company/devices/${id}/history?limit=${limit}`),
  deviceGPIO:    (id)              => req('GET',  `/api/company/devices/${id}/gpio`),
  deviceAlerts:  (id)              => req('GET',  `/api/company/devices/${id}/alerts`),
  ackAlert:      (deviceId, alertId) => req('POST', `/api/company/devices/${deviceId}/alerts/${alertId}/acknowledge`),
  users:         ()                => req('GET',  '/api/company/users'),
  createUser:    (body)            => req('POST', '/api/company/users',  body),
  updateUser:    (id, body)        => req('PUT',  `/api/company/users/${id}`, body),
  deleteUser:    (id)              => req('DELETE', `/api/company/users/${id}`),

  // Super admin
  companies:     ()                => req('GET',  '/api/super/companies'),
  createCompany: (name)            => req('POST', '/api/super/companies', { name }),
  deleteCompany: (id)              => req('DELETE', `/api/super/companies/${id}`),
  createAdmin:   (companyId, body) => req('POST', `/api/super/companies/${companyId}/admins`, body),

  // Push
  vapidKey:      ()                => req('GET',  '/api/vapid-public-key'),
  pushSubscribe: (sub)             => req('POST', '/api/push/subscribe',   sub),
  pushUnsub:     (endpoint)        => req('DELETE', '/api/push/unsubscribe', { endpoint }),
};
