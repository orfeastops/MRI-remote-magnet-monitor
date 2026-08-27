import { useEffect, useState } from 'react';
import { api } from '../api';
import styles from './AdminPanel.module.css';

// Manager (company_admin) view — READ ONLY.
// Provisioning (adding/editing/removing users and devices) is done exclusively
// by the super_admin. Managers can only observe: who works here, what devices
// exist, and which technician is responsible for each one.
export default function CompanyAdmin() {
  const [tab, setTab]         = useState('devices');
  const [users, setUsers]     = useState([]);
  const [devices, setDevices] = useState([]);
  const [techsByDevice, setTechsByDevice] = useState({}); // deviceId -> [{id,email,name}]
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [u, d] = await Promise.all([api.users(), api.devices()]);
        setUsers(u);
        setDevices(d);
        // Fetch assigned technicians for each device, in parallel
        const entries = await Promise.all(
          d.map(async dev => {
            try { return [dev.id, await api.deviceTechnicians(dev.id)]; }
            catch { return [dev.id, []]; }
          })
        );
        setTechsByDevice(Object.fromEntries(entries));
      } catch {
        // leave lists empty on failure
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className={styles.wrap}><span className="spinner" /></div>;

  return (
    <div className={styles.wrap}>
      <h2 className={styles.heading}>Company Overview</h2>
      <p className={styles.readOnlyNote}>
        Read-only view. To add or change users, devices, or technician assignments, contact your account manager.
      </p>

      <div className={styles.tabs}>
        {['devices', 'users'].map(t => (
          <button key={t} className={`${styles.tab} ${tab === t ? styles.activeTab : ''}`}
            onClick={() => setTab(t)}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
        ))}
      </div>

      {tab === 'devices' && (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span>{devices.length} devices</span>
          </div>
          <table className={styles.table}>
            <thead><tr><th>Name</th><th>APN</th><th>Status</th><th>Technicians</th></tr></thead>
            <tbody>
              {devices.map(d => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>{d.apn}</td>
                  <td><span className={d.online ? styles.online : styles.offline}>{d.online ? '● Online' : '○ Offline'}</span></td>
                  <td>
                    {(techsByDevice[d.id] || []).length
                      ? techsByDevice[d.id].map(t => t.name || t.email).join(', ')
                      : <span className={styles.muted}>Unassigned</span>}
                  </td>
                </tr>
              ))}
              {devices.length === 0 && (
                <tr><td colSpan={4} className={styles.muted}>No devices yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'users' && (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span>{users.length} users</span>
          </div>
          <table className={styles.table}>
            <thead><tr><th>Email</th><th>Name</th><th>Role</th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.name || '—'}</td>
                  <td><span className={`${styles.roleTag} ${u.role === 'company_admin' ? styles.admin : ''}`}>
                    {u.role === 'company_admin' ? 'Manager' : 'Technician'}
                  </span></td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={3} className={styles.muted}>No users yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
