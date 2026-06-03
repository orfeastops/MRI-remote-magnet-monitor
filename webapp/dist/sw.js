// MRI Monitor Service Worker
const CACHE = 'mri-v1';
const PRECACHE = ['/', '/index.html'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Network-first for API/WS, cache-first for static assets
  if (e.request.url.includes('/api/') || e.request.url.includes('/ws')) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// Web Push notification handler
self.addEventListener('push', e => {
  if (!e.data) return;
  let payload;
  try { payload = e.data.json(); } catch { payload = { title: 'MRI Alert', body: e.data.text() }; }

  e.waitUntil(
    self.registration.showNotification(payload.title || 'MRI Monitor', {
      body:    payload.body    || '',
      tag:     payload.tag     || 'mri-alert',
      icon:    '/icon-192.png',
      badge:   '/icon-192.png',
      vibrate: [200, 100, 200, 100, 400],
      data:    payload.data    || {},
      actions: [{ action: 'open', title: 'Open App' }],
      requireInteraction: payload.tag?.includes('quench'),
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'open' || !e.action) {
    const deviceId = e.notification.data?.deviceId;
    const url = deviceId ? `/devices/${deviceId}` : '/devices';
    e.waitUntil(
      clients.matchAll({ type: 'window' }).then(wins => {
        const existing = wins.find(w => w.url.includes(url));
        if (existing) return existing.focus();
        return clients.openWindow(url);
      })
    );
  }
});
