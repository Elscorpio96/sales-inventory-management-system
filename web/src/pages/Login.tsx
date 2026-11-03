import { useState, type FormEvent } from 'react';
import { api, type User } from '../api';
import { ErrorBox } from '../components/ui';

export function LoginPage({ onLogin }: { onLogin: (s: { user: User; businessName: string }) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/login', { body: { email, password } });
      onLogin(await api('/auth/me'));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand brand-dark"><img src="/favicon.svg" alt="" width={40} height={40} /><div><b>ShopLedger</b><span>Sales &amp; inventory</span></div></div>
        <h1>Sign in</h1>
        <ErrorBox error={error} />
        <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {import.meta.env.VITE_DEMO === '1' && (
          <div className="demo">
            <b>Demo accounts</b>
            {[['Owner', 'owner@demo.shop', 'Owner@12345'], ['Manager', 'manager@demo.shop', 'Manager@123'], ['Cashier', 'cashier@demo.shop', 'Cashier@123']].map(([r, e, p]) => (
              <button type="button" key={r} className="link" onClick={() => { setEmail(e!); setPassword(p!); }}>{r}: {e}</button>
            ))}
          </div>
        )}
      </form>
    </div>
  );
}
