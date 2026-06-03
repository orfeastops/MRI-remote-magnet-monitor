import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';
import styles from './AlarmsTab.module.css';

export default function AlarmsTab({ deviceId, gpioState }) {
  const { user }        = useAuth();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const canAck = user?.role === 'company_admin' || user?.role === 'super_admin';

  useEffect(() => {
    api.deviceAlerts(deviceId)
      .then(setAlerts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [deviceId]);

  async function ack(alertId) {
    try {
      await api.ackAlert(deviceId, alertId);
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, resolved: 1 } : a));
    } catch {}
  }

  const pins = gpioState ?? {};
  const p32  = pins[32] ?? pins['32'];
  const p34  = pins[34] ?? pins['34'];
  const p35  = pins[35] ?? pins['35'];

  const gpioRows = [
    { label: 'PIN 1 — General Alarm (GPIO32)', active: p32 === 0, val: p32 },
    { label: 'PIN 2 — Secondary Alarm (GPIO34)', active: p34 === 1, val: p34 },
    { label: 'QUENCH (GPIO35) — CRITICAL',      active: p35 === 1, val: p35, critical: true },
  ];

  return (
    <div className={styles.wrap}>
      {/* Live GPIO panel */}
      <section className={styles.section}>
        <h3>Live GPIO Status</h3>
        {gpioRows.map(row => (
          <div key={row.label} className={`${styles.gpioRow} ${row.active ? (row.critical ? styles.critical : styles.alarm) : styles.normal}`}>
            <span className={styles.dot}>●</span>
            <span className={styles.gpioLabel}>{row.label}</span>
            <span className={styles.gpioVal}>
              {row.val !== undefined
                ? (row.active ? (row.critical ? 'QUENCH!' : 'ALARM') : 'NORMAL')
                : '—'}
            </span>
          </div>
        ))}
      </section>

      {/* Alert history */}
      <section className={styles.section}>
        <h3>Alert History</h3>
        {loading && <p className={styles.muted}>Loading…</p>}
        {!loading && alerts.length === 0 && <p className={styles.muted}>No alerts recorded.</p>}
        {alerts.map(a => (
          <div key={a.id} className={`${styles.alertRow} ${a.resolved ? styles.resolved : styles.open}`}>
            <div className={styles.alertInfo}>
              <span className={styles.alertType}>{a.type.replace(/_/g, ' ').toUpperCase()}</span>
              <span className={styles.alertMsg}>{a.message}</span>
              <span className={styles.alertTime}>{new Date(a.ts).toLocaleString()}</span>
            </div>
            {!a.resolved && canAck && (
              <button className={styles.ackBtn} onClick={() => ack(a.id)}>Acknowledge</button>
            )}
            {a.resolved && <span className={styles.resolvedBadge}>✓ Acknowledged</span>}
          </div>
        ))}
      </section>
    </div>
  );
}
