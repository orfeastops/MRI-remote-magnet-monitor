import { useState, useEffect } from 'react';
import { api } from '../api';

function urlBase64ToUint8Array(base64) {
  const b64 = (base64 + '='.repeat((4 - base64.length % 4) % 4))
    .replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export function usePushNotifications() {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    setSupported('PushManager' in window && 'serviceWorker' in navigator);
  }, []);

  async function subscribe() {
    try {
      const { key } = await api.vapidKey();
      if (!key) return;
      const reg  = await navigator.serviceWorker.ready;
      const sub  = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      const json = sub.toJSON();
      await api.pushSubscribe({ endpoint: json.endpoint, keys: json.keys });
      setSubscribed(true);
    } catch (e) {
      console.error('Push subscribe failed:', e);
    }
  }

  async function unsubscribe() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.pushUnsub(sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch {}
  }

  // Check current subscription state
  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.ready.then(reg =>
      reg.pushManager.getSubscription().then(s => setSubscribed(!!s))
    ).catch(() => {});
  }, [supported]);

  return { supported, subscribed, subscribe, unsubscribe };
}
