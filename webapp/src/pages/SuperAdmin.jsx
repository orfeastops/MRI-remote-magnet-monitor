import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

export default function SuperAdmin() {
  const [companies, setCompanies] = useState([]);
  const [showModal, setModal]     = useState(null); // 'company'|'admin'
  const [targetCompany, setTarget] = useState(null);
  const [form, setForm]           = useState({});
  const [err, setErr]             = useState('');
  const nav = useNavigate();

  const load = () => api.companies().then(setCompanies).catch(() => {});
  useEffect(() => { load(); }, []);

  function openCompany() { setForm({ name: '' }); setErr(''); setModal('company'); }
  function openAdmin(c)  { setTarget(c); setForm({ email: '', password: '', name: '' }); setErr(''); setModal('admin'); }

  async function saveCompany() {
    setErr('');
    try { await api.createCompany(form.name); setModal(null); load(); }
    catch(e) { setErr(e.message); }
  }

  async function saveAdmin() {
    setErr('');
    try { await api.createAdmin(targetCompany.id, form); setModal(null); }
    catch(e) { setErr(e.message); }
  }

  async function del(id) {
    if (!confirm('Delete company and ALL its data?')) return;
    await api.deleteCompany(id).catch(() => {});
    load();
  }

  const f = (k) => ({ value: form[k] || '', onChange: e => setForm(p => ({...p, [k]: e.target.value})) });

  return (
    <div className={styles.wrap}>
      <h2 className={styles.heading}>Super Admin</h2>
      <div className={styles.sectionHead}>
        <span>{companies.length} companies</span>
        <button className={styles.addBtn} onClick={openCompany}>+ Add Company</button>
      </div>
      <table className={styles.table}>
        <thead><tr><th>Company</th><th>Created</th><th></th></tr></thead>
        <tbody>
          {companies.map(c => (
            <tr key={c.id} className={styles.clickableRow} onClick={() => nav(`/super/companies/${c.id}`)}>
              <td>{c.name}</td>
              <td>{new Date(c.created_at).toLocaleDateString()}</td>
              <td onClick={e => e.stopPropagation()}>
                <button className={styles.iconBtn} onClick={() => openAdmin(c)} title="Add admin">+ Admin</button>
                <button className={styles.iconBtn} onClick={() => del(c.id)} title="Delete">✕</button>
              </td>
            </tr>
          ))}
          {companies.length === 0 && (
            <tr><td colSpan={3} className={styles.muted}>No companies yet.</td></tr>
          )}
        </tbody>
      </table>

      {showModal === 'company' && (
        <Modal title="New Company" onClose={() => setModal(null)}>
          <label>Company Name</label>
          <input {...f('name')} autoFocus />
          {err && <div className={styles.err}>{err}</div>}
          <button className={styles.saveBtn} onClick={saveCompany}>Create</button>
        </Modal>
      )}

      {showModal === 'admin' && (
        <Modal title={`Add Admin — ${targetCompany?.name}`} onClose={() => setModal(null)}>
          <label>Email</label><input type="email" {...f('email')} />
          <label>Password</label><input type="password" {...f('password')} />
          <label>Name</label><input {...f('name')} />
          {err && <div className={styles.err}>{err}</div>}
          <button className={styles.saveBtn} onClick={saveAdmin}>Create Admin</button>
        </Modal>
      )}
    </div>
  );
}
