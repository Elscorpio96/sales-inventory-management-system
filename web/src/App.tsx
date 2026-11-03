import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api, type Role, type User } from './api';
import { LoginPage } from './pages/Login';
import { PosPage } from './pages/Pos';
import { DashboardPage } from './pages/Dashboard';
import { ProductsPage } from './pages/Products';
import { StockPage } from './pages/Stock';
import { SalesPage } from './pages/Sales';
import { UsersPage } from './pages/Users';

interface Session { user: User; businessName: string }
const SessionCtx = createContext<Session | null>(null);
export const useSession = () => useContext(SessionCtx)!;
export const can = (user: User, ...roles: Role[]) => roles.includes(user.role);

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const navigate = useNavigate();

  useEffect(() => {
    api<Session>('/auth/me').then(setSession).catch(() => setSession(null));
    const expired = () => { setSession(null); navigate('/login'); };
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, [navigate]);

  if (session === undefined) return <div className="boot">Loading…</div>;
  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage onLogin={(s) => { setSession(s); navigate(s.user.role === 'cashier' ? '/pos' : '/'); }} />} />
      </Routes>
    );
  }

  const { user } = session;
  const managers = can(user, 'owner', 'manager');
  return (
    <SessionCtx.Provider value={session}>
      <Shell onLogout={async () => { await api('/auth/logout', { method: 'POST' }); setSession(null); navigate('/login'); }}>
        <Routes>
          <Route path="/" element={managers ? <DashboardPage /> : <Navigate to="/pos" replace />} />
          <Route path="/pos" element={<PosPage />} />
          <Route path="/sales" element={<SalesPage />} />
          <Route path="/products" element={<ProductsPage />} />
          {managers && <Route path="/stock" element={<StockPage />} />}
          {can(user, 'owner') && <Route path="/users" element={<UsersPage />} />}
          <Route path="*" element={<Navigate to={managers ? '/' : '/pos'} replace />} />
        </Routes>
      </Shell>
    </SessionCtx.Provider>
  );
}

function Shell({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  const { user, businessName } = useSession();
  const managers = can(user, 'owner', 'manager');
  const link = (to: string, label: string, icon: string) => (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
      <span className="ico" aria-hidden="true">{icon}</span>{label}
    </NavLink>
  );
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={34} height={34} />
          <div><b>ShopLedger</b><span>{businessName}</span></div>
        </div>
        <nav>
          {managers && link('/', 'Dashboard', '◷')}
          {link('/pos', 'Point of sale', '▣')}
          {link('/sales', 'Sales', '≡')}
          {link('/products', 'Products', '▤')}
          {managers && link('/stock', 'Stock', '⇅')}
          {can(user, 'owner') && link('/users', 'Staff', '☺')}
        </nav>
        <div className="side-foot">
          <div><b>{user.name}</b><span className={`role role-${user.role}`}>{user.role}</span></div>
          <button className="link" onClick={onLogout}>Sign out</button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
