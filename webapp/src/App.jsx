import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Layout         from './components/Layout';
import Login          from './pages/Login';
import DeviceList     from './pages/DeviceList';
import DeviceDetail   from './pages/DeviceDetail';
import CompanyAdmin   from './pages/CompanyAdmin';
import SuperAdmin     from './pages/SuperAdmin';
import CompanyDetail  from './pages/CompanyDetail';

function RequireAuth({ children, roles }) {
  const { user } = useAuth();
  if (user === undefined) return <div className="loading-screen"><span className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/devices" replace />;
  return children;
}

function RequireGuest({ children }) {
  const { user } = useAuth();
  if (user === undefined) return <div className="loading-screen"><span className="spinner" /></div>;
  if (user) return <Navigate to={user.role === 'super_admin' ? '/super' : '/devices'} replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<RequireGuest><Login /></RequireGuest>} />
          <Route element={<RequireAuth><Layout /></RequireAuth>}>
            <Route index element={<Navigate to="/devices" replace />} />
            <Route path="/devices"     element={<DeviceList />} />
            <Route path="/devices/:id" element={<DeviceDetail />} />
            <Route path="/admin" element={
              <RequireAuth roles={['company_admin']}>
                <CompanyAdmin />
              </RequireAuth>
            } />
            <Route path="/super" element={
              <RequireAuth roles={['super_admin']}>
                <SuperAdmin />
              </RequireAuth>
            } />
            <Route path="/super/companies/:id" element={
              <RequireAuth roles={['super_admin']}>
                <CompanyDetail />
              </RequireAuth>
            } />
          </Route>
          <Route path="*" element={<Navigate to="/devices" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
