import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useWebSocket } from '../hooks/useWebSocket';
import GPIOBar    from '../components/GPIOBar';
import TerminalTab  from '../components/TerminalTab';
import DashboardTab from '../components/DashboardTab';
import AlarmsTab    from '../components/AlarmsTab';
import styles from './DeviceDetail.module.css';

const TABS = ['Terminal', 'Dashboard', 'Alarms'];

export default function DeviceDetail() {
  const { id } = useParams();
  const nav    = useNavigate();
  const [device, setDevice]    = useState(null);
  const [tab, setTab]          = useState(0);
  const [gpioState, setGPIO]   = useState({});

  // xterm writes raw VT100 chunks; Dashboard keeps a rolling buffer
  const rawBufferRef  = useRef('');     // accumulates all data → used by Dashboard
  const [rawChunk, setRawChunk]       = useState(null);
  const [dashBuffer, setDashBuffer]   = useState('');

  // Load device meta
  useEffect(() => {
    api.devices().then(ds => {
      const d = ds.find(x => x.id === parseInt(id));
      setDevice(d ?? null);
    }).catch(() => {});
  }, [id]);

  // Load initial GPIO from REST
  useEffect(() => {
    api.deviceGPIO(id)
      .then(rows => {
        const map = {};
        rows.forEach(r => { map[r.pin] = r.state; });
        setGPIO(map);
      })
      .catch(() => {});
  }, [id]);

  const onMsg = useCallback((msg) => {
    if (msg.type === 'serial_data') {
      // Write raw chunk to xterm
      setRawChunk(msg.data);
      // Accumulate for Dashboard parser (keep last ~8 KB to capture a full screen)
      rawBufferRef.current = (rawBufferRef.current + msg.data).slice(-8192);
      setDashBuffer(rawBufferRef.current);
    }
    if (msg.type === 'gpio_update') {
      setGPIO(prev => ({ ...prev, ...msg.pins }));
    }
    if (msg.type === 'device_online' && msg.deviceId === parseInt(id)) {
      setDevice(d => d ? { ...d, online: true } : d);
    }
    if (msg.type === 'device_offline' && msg.deviceId === parseInt(id)) {
      setDevice(d => d ? { ...d, online: false } : d);
    }
  }, [id]);

  const { online, watch } = useWebSocket(onMsg);
  useEffect(() => { if (id) watch(parseInt(id)); }, [id, watch]);

  if (!device) return <div className={styles.center}><span className="spinner" /></div>;

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <button className={styles.back} onClick={() => nav('/devices')}>‹</button>
        <div className={styles.titleBlock}>
          <span className={styles.deviceName}>{device.name || `Device ${device.id}`}</span>
          <span className={`${styles.onlineBadge} ${device.online ? styles.online : styles.offline}`}>
            {device.online ? '● Online' : '○ Offline'}
          </span>
        </div>
        <span className={`${styles.wsIndicator} ${online ? styles.wsOn : ''}`} title="WebSocket">WS</span>
      </div>

      {/* GPIO bar — always visible */}
      <GPIOBar pins={gpioState} />

      {/* Tabs */}
      <div className={styles.tabs}>
        {TABS.map((t, i) => (
          <button key={t} className={`${styles.tab} ${tab === i ? styles.activeTab : ''}`}
            onClick={() => setTab(i)}>
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className={styles.content}>
        {tab === 0 && <TerminalTab rawData={rawChunk} />}
        {tab === 1 && <DashboardTab rawBuffer={dashBuffer} />}
        {tab === 2 && <AlarmsTab deviceId={parseInt(id)} gpioState={gpioState} />}
      </div>
    </div>
  );
}
