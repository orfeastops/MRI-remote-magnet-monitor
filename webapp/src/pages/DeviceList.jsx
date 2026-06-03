import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useWebSocket } from '../hooks/useWebSocket';
import styles from './DeviceList.module.css';

export default function DeviceList() {
  const [devices, setDevices]  = useState([]);
  const [loading, setLoading]  = useState(true);
  const nav = useNavigate();

  const load = useCallback(async () => {
    try { setDevices(await api.devices()); }
    catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Update online/offline via WebSocket broadcasts
  const onMsg = useCallback((msg) => {
    if (msg.type === 'device_online' || msg.type === 'device_offline') {
      setDevices(ds => ds.map(d =>
        d.id === msg.deviceId ? { ...d, online: msg.type === 'device_online' } : d
      ));
    }
  }, []);
  useWebSocket(onMsg);

  if (loading) return <div className={styles.center}><span className="spinner" /></div>;

  return (
    <div className={styles.wrap}>
      <h2 className={styles.heading}>Devices</h2>
      {devices.length === 0 && (
        <p className={styles.empty}>No devices configured yet.</p>
      )}
      <div className={styles.grid}>
        {devices.map(dev => (
          <button
            key={dev.id}
            className={styles.card}
            onClick={() => nav(`/devices/${dev.id}`)}
          >
            <div className={styles.topRow}>
              <span className={styles.name}>{dev.name || `Device ${dev.id}`}</span>
              <span className={`${styles.badge} ${dev.online ? styles.online : styles.offline}`}>
                {dev.online ? '● Online' : '○ Offline'}
              </span>
            </div>
            <div className={styles.meta}>
              <span>APN: {dev.apn || 'internet'}</span>
              {dev.last_seen && (
                <span>Last seen: {new Date(dev.last_seen).toLocaleString()}</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
