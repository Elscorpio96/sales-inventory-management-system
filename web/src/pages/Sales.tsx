import { useCallback, useEffect, useState } from 'react';
import { api, money, when, type Sale, type SaleSummary } from '../api';
import { can, useSession } from '../App';
import { Empty, ErrorBox, Modal, PageHead } from '../components/ui';
import { Receipt } from './Receipt';

export function SalesPage() {
  const { user } = useSession();
  const manage = can(user, 'owner', 'manager');
  const [data, setData] = useState<{ rows: SaleSummary[]; total: number; page: number; pageSize: number } | null>(null);
  const [filters, setFilters] = useState({ from: '', to: '', status: '', q: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Sale | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    const p = new URLSearchParams(Object.entries({ ...filters, page: String(page) }).filter(([, v]) => v));
    api<typeof data>(`/sales?${p}`).then(setData).catch(setError);
  }, [filters, page]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setPage(1); setFilters({ ...filters, [k]: e.target.value }); };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const csv = `/api/sales/export.csv?${new URLSearchParams(Object.entries({ from: filters.from, to: filters.to }).filter(([, v]) => v))}`;

  return (
    <>
      <PageHead title={manage ? 'Sales' : 'My sales'} sub={data ? `${data.total.toLocaleString()} sales` : ''}>
        {manage && <a className="btn" href={csv}>Export CSV</a>}
      </PageHead>
      <ErrorBox error={error} />
      <div className="toolbar">
        <input placeholder="Receipt no. or customer" value={filters.q} onChange={set('q')} aria-label="Search" />
        <label className="inline-label">From<input type="date" value={filters.from} onChange={set('from')} /></label>
        <label className="inline-label">To<input type="date" value={filters.to} onChange={set('to')} /></label>
        <select value={filters.status} onChange={set('status')} aria-label="Status"><option value="">All statuses</option><option value="completed">Completed</option><option value="voided">Voided</option></select>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Receipt</th><th>Date</th><th>Cashier</th><th>Payment</th><th className="num">Items</th><th className="num">Total</th><th>Status</th></tr></thead>
          <tbody>{data?.rows.map((s) => (
            <tr key={s.id} className={`clickable ${s.status === 'voided' ? 'dim' : ''}`} onClick={() => api<Sale>(`/sales/${s.id}`).then(setOpen).catch(setError)}>
              <td className="mono">{s.receipt_no}</td><td className="nowrap">{when(s.created_at)}</td><td>{s.cashier}</td>
              <td className="cap">{s.payment_method}</td><td className="num">{s.items}</td><td className="num"><b>{money(s.total)}</b></td>
              <td><span className={`badge ${s.status === 'voided' ? 'badge-err' : 'badge-ok'}`}>{s.status}</span></td>
            </tr>
          ))}</tbody>
        </table>
        {data?.rows.length === 0 && <Empty>No sales found.</Empty>}
      </div>
      {pages > 1 && (
        <div className="pager">
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
          <span className="muted">Page {page} of {pages}</span>
          <button className="btn btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}
      {open && (
        <Modal title={open.receipt_no} onClose={() => setOpen(null)}>
          <Receipt sale={open} />
          {manage && open.status === 'completed' && <VoidForm sale={open} onDone={(s) => { setOpen(s); load(); }} />}
        </Modal>
      )}
    </>
  );
}

function VoidForm({ sale, onDone }: { sale: Sale; onDone: (s: Sale) => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  return (
    <form className="void-form no-print" onSubmit={async (e) => {
      e.preventDefault();
      if (!window.confirm(`Void ${sale.receipt_no}? Items will be returned to stock.`)) return;
      try { onDone(await api<Sale>(`/sales/${sale.id}/void`, { body: { reason } })); } catch (err) { setError(err); }
    }}>
      <ErrorBox error={error} />
      <label>Void this sale — reason<input value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={200} placeholder="e.g. Customer returned items" /></label>
      <button className="btn btn-danger">Void sale</button>
    </form>
  );
}
