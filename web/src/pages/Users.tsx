import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type Role } from '../api';
import { useSession } from '../App';
import { ErrorBox, PageHead } from '../components/ui';

interface Row { id: number; name: string; email: string; role: Role; active: number; created_at: string }

export function UsersPage() {
  const { user } = useSession();
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState({ name: '', email: '', role: 'cashier' as Role, password: '' });
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => api<Row[]>('/users').then(setRows).catch(setError), []);
  useEffect(() => { load(); }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try { await api('/users', { body: form }); setForm({ name: '', email: '', role: 'cashier', password: '' }); load(); } catch (err) { setError(err); }
  }
  const update = async (id: number, body: object) => { try { await api(`/users/${id}`, { method: 'PATCH', body }); load(); } catch (err) { setError(err); } };

  return (
    <>
      <PageHead title="Staff" sub="Owners manage everything · managers handle stock, voids and reports · cashiers sell" />
      <ErrorBox error={error} />
      <form className="card form-row" onSubmit={add}>
        <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
        <label>Role<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}><option value="cashier">Cashier</option><option value="manager">Manager</option><option value="owner">Owner</option></select></label>
        <label>Initial password<input type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="new-password" /></label>
        <button className="btn btn-primary">Add staff</button>
      </form>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className={r.active ? '' : 'dim'}>
              <td>{r.name}</td><td>{r.email}</td>
              <td>{r.id === user.id ? <span className={`role role-${r.role}`}>{r.role}</span> : (
                <select value={r.role} onChange={(e) => update(r.id, { role: e.target.value })} aria-label={`Role for ${r.name}`}>
                  <option value="cashier">cashier</option><option value="manager">manager</option><option value="owner">owner</option>
                </select>)}</td>
              <td><span className={`badge ${r.active ? 'badge-ok' : 'badge-err'}`}>{r.active ? 'active' : 'disabled'}</span></td>
              <td className="num">{r.id !== user.id && <button className="btn btn-sm" onClick={() => update(r.id, { active: !r.active })}>{r.active ? 'Disable' : 'Enable'}</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
