import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { usePushNotifications } from '../hooks/usePushNotifications';
import styles from './Layout.module.css';

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const { supported, subscribed, subscribe, unsubscribe } = usePushNotifications();

  async function handleLogout() {
    await logout();
    nav('/login');
  }

  const isAdmin = user?.role === 'company_admin' || user?.role === 'super_admin';
  const isSuper = user?.role === 'super_admin';

  return (
    <div className={styles.shell}>
      <nav className={styles.nav}>
        <span className={styles.brand}>⚡ MRI</span>
        <div className={styles.links}>
          <NavLink to="/devices" className={({ isActive }) => isActive ? styles.active : ''}>Devices</NavLink>
          {isAdmin && <NavLink to="/admin" className={({ isActive }) => isActive ? styles.active : ''}>Admin</NavLink>}
          {isSuper  && <NavLink to="/super" className={({ isActive }) => isActive ? styles.active : ''}>Super</NavLink>}
        </div>
        <div className={styles.actions}>
          {supported && (
            <button
              className={`${styles.bellBtn} ${subscribed ? styles.bellOn : ''}`}
              onClick={subscribed ? unsubscribe : subscribe}
              title={subscribed ? 'Disable notifications' : 'Enable push notifications'}
            >
              {subscribed ? '🔔' : '🔕'}
            </button>
          )}
          <button className={styles.logout} onClick={handleLogout}>Sign out</button>
        </div>
      </nav>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
