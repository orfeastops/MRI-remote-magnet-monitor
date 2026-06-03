import { useEffect, useState } from 'react';
import { api } from '../api';
import styles from './AdminPanel.module.css';

function Modal({ title, onClose, children }) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3>{title}</h3>
          <button onClick={onClose} className={styles.closeBtn}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function CompanyAdmin() {
  const [tab, setTab]           = useState('users');
  const [users, setUsers]       = useState([]);
  const [devices, setDevices]   = useState([]);
  const [showModal, setModal]   = useState(null); // 'user'|'device'
  const [editTarget, setEdit]   = useState(null);
  const [form, setForm]         = useState({});
  const [secret, setSecret]     = useState(null);
  const [err, setErr]           = useState('');

  const loadUsers   = () => api.users().then(setUsers).catch(() => {});
  const loadDevices = () => api.devices().then(setDevices).catch(() => {});

  useEffect(() => { loadUsers(); loadDevices(); }, []);

  function openUser(u = null) {
    setEdit(u);
    setForm(u ? { name: u.name || '', role: u.role } : { name: '', role: 'technician', email: '', password: '' });
    setErr('');
    setModal('user');
  }

  function openDevice(d = null) {
    setEdit(d);
    setForm(d ? { name: d.name, apn: d.apn, sms_recipients: d.sms_recipients.join(', ') }
              : { name: '', apn: 'internet', sms_recipients: '' });
    setErr('');
    setSecret(null);
    setModal('device');
  }

  async function saveUser() {
    setErr('');
    try {
      const body = { ...form };
      if (form.sms_recipients !== undefined) delete body.sms_recipients;
      if (editTarget) {
        await api.updateUser(editTarget.id, body);
      } else {
        await api.createUser(body);
      }
      setModal(null);
      loadUsers();
    } catch(e) { setErr(e.message); }
  }

  async function saveDevice() {
    setErr('');
    try {
      const sms = (form.sms_recipients || '').split(',').map(s => s.trim()).filter(Boolean);
      const body = { name: form.name, apn: form.apn, sms_recipients: sms };
      if (editTarget) {
        await api.updateDevice(editTarget.id, body);
        setModal(null);
      } else {
        const res = await api.createDevice(body);
        setSecret(res.secret);  // show once
      }
      loadDevices();
    } catch(e) { setErr(e.message); }
  }

  async function delUser(id)   { if (!confirm('Delete user?'))   return; await api.deleteUser(id);   loadUsers(); }
  async function delDevice(id) { if (!confirm('Delete device?')) return; await api.deleteDevice(id); loadDevices(); }

  const f = (k) => ({ value: form[k] || '', onChange: e => setForm(p => ({...p, [k]: e.target.value})) });

  return (
    <div className={styles.wrap}>
      <h2 className={styles.heading}>Company Admin</h2>

      <div className={styles.tabs}>
        {['users','devices'].map(t => (
          <button key={t} className={`${styles.tab} ${tab===t ? styles.activeTab:''}`}
            onClick={() => setTab(t)}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>
        ))}
      </div>

      {tab === 'users' && (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span>{users.length} users</span>
            <button className={styles.addBtn} onClick={() => openUser()}>+ Add User</button>
          </div>
          <table className={styles.table}>
            <thead><tr><th>Email</th><th>Name</th><th>Role</th><th></th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.name || '—'}</td>
                  <td><span className={`${styles.roleTag} ${u.role === 'company_admin' ? styles.admin : ''}`}>{u.role}</span></td>
                  <td>
                    <button className={styles.iconBtn} onClick={() => openUser(u)}>✎</button>
                    <button className={styles.iconBtn} onClick={() => delUser(u.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'devices' && (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <span>{devices.length} devices</span>
            <button className={styles.addBtn} onClick={() => openDevice()}>+ Add Device</button>
          </div>
          <table className={styles.table}>
            <thead><tr><th>Name</th><th>APN</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {devices.map(d => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>{d.apn}</td>
                  <td><span className={d.online ? styles.online : styles.offline}>{d.online ? '● Online' : '○ Offline'}</span></td>
                  <td>
                    <button className={styles.iconBtn} onClick={() => openDevice(d)}>✎</button>
                    <button className={styles.iconBtn} onClick={() => delDevice(d.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal === 'user' && (
        <Modal title={editTarget ? 'Edit User' : 'Add User'} onClose={() => setModal(null)}>
          {!editTarget && <><label>Email</label><input type="email" {...f('email')} /></>}
          <label>Name</label><input {...f('name')} />
          {!editTarget && <><label>Password</label><input type="password" {...f('password')} /></>}
          <label>Role</label>
          <select {...f('role')}>
            <option value="technician">Technician</option>
            <option value="company_admin">Company Admin</option>
          </select>
          {editTarget && <><label>New Password (leave blank to keep)</label><input type="password" {...f('password')} /></>}
          {err && <div className={styles.err}>{err}</div>}
          <button className={styles.saveBtn} onClick={saveUser}>Save</button>
        </Modal>
      )}

      {showModal === 'device' && (
        <Modal title={editTarget ? 'Edit Device' : 'Add Device'} onClose={() => { setModal(null); setSecret(null); }}>
          {secret ? (
            <div className={styles.secretBox}>
              <p>Device created! Copy this secret — it will <strong>not</strong> be shown again:</p>
              <code>{secret}</code>
              <button className={styles.saveBtn} onClick={() => { setModal(null); setSecret(null); }}>Done</button>
            </div>
          ) : (
            <>
              <label>Name</label><input {...f('name')} />
              <label>APN</label><input {...f('apn')} placeholder="internet" />
              <label>SMS Recipients (comma-separated)</label>
              <input {...f('sms_recipients')} placeholder="+306912345678, +306987654321" />
              {err && <div className={styles.err}>{err}</div>}
              <button className={styles.saveBtn} onClick={saveDevice}>
                {editTarget ? 'Save' : 'Create Device'}
              </button>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
