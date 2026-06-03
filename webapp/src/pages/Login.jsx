import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import styles from './Login.module.css';

export default function Login() {
  const { login, error } = useAuth();
  const nav = useNavigate();
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await login(email, password);
      nav(user.role === 'super_admin' ? '/super' : '/devices');
    } catch {}
    setLoading(false);
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>⚡</span>
          <h1>MRI Monitor</h1>
          <p>Magnet Management System</p>
        </div>
        <form onSubmit={submit}>
          <label>Email</label>
          <input
            type="email" value={email} autoComplete="email"
            onChange={e => setEmail(e.target.value)} required
          />
          <label>Password</label>
          <input
            type="password" value={password} autoComplete="current-password"
            onChange={e => setPassword(e.target.value)} required
          />
          {error && <div className={styles.error}>{error}</div>}
          <button type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
