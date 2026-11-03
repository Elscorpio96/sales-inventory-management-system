import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, daysAgo, money, moneyShort, today } from '../api';
import { ErrorBox, PageHead } from '../components/ui';

interface Summary {
  sales: number; revenue: number; grossProfit: number; marginPct: number; averageSale: number; discounts: number;
  daily: { day: string; revenue: number; profit: number; sales: number }[];
  byPayment: { method: string; revenue: number; sales: number }[];
  topProducts: { product_id: number; name: string; qty: number; revenue: number; profit: number }[];
  byCategory: { category: string; revenue: number }[];
}
interface Inventory { products: number; units: number; cost_value: number; retail_value: number; lowStock: { id: number; name: string; sku: string; on_hand: number; reorder_level: number; unit: string }[] }

const RANGES = [['Today', 0], ['7 days', 6], ['30 days', 29]] as const;
const PAY_COLORS: Record<string, string> = { cash: '#e8590c', transfer: '#1c7ed6', card: '#7048e8' };

export function DashboardPage() {
  const [range, setRange] = useState(29);
  const [s, setS] = useState<Summary | null>(null);
  const [inv, setInv] = useState<Inventory | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<Summary>(`/reports/summary?from=${daysAgo(range)}&to=${today()}`).then(setS).catch(setError);
  }, [range]);
  useEffect(() => { api<Inventory>('/reports/inventory').then(setInv).catch(setError); }, []);

  const chartData = s?.daily.map((d) => ({ ...d, label: new Date(d.day + 'T12:00').toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }), revenueN: d.revenue / 100, profitN: d.profit / 100 })) ?? [];
  const payTotal = s?.byPayment.reduce((a, b) => a + b.revenue, 0) || 1;

  return (
    <>
      <PageHead title="Dashboard" sub="Sales performance and stock position">
        <div className="seg">{RANGES.map(([l, d]) => <button key={l} className={range === d ? 'on' : ''} onClick={() => setRange(d)}>{l}</button>)}</div>
      </PageHead>
      <ErrorBox error={error} />
      <div className="kpis">
        <Kpi label="Revenue" value={s ? money(s.revenue) : '…'} />
        <Kpi label="Gross profit" value={s ? money(s.grossProfit) : '…'} hint={s ? `${s.marginPct}% margin` : ''} />
        <Kpi label="Sales" value={s ? s.sales.toLocaleString() : '…'} hint={s ? `avg ${money(s.averageSale)}` : ''} />
        <Kpi label="Stock value (cost)" value={inv ? money(inv.cost_value) : '…'} hint={inv ? `retail ${moneyShort(inv.retail_value)}` : ''} />
      </div>

      <div className="grid-2">
        <section className="card span-2">
          <h2>Revenue &amp; profit</h2>
          <div className="chart">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e8590c" stopOpacity={0.25} /><stop offset="100%" stopColor="#e8590c" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} minTickGap={16} />
                <YAxis tickFormatter={(v: number) => moneyShort(v * 100)} tickLine={false} axisLine={false} fontSize={12} width={64} />
                <Tooltip formatter={(v) => money(Number(v) * 100)} />
                <Area type="monotone" dataKey="revenueN" name="Revenue" stroke="#e8590c" strokeWidth={2} fill="url(#rev)" />
                <Area type="monotone" dataKey="profitN" name="Profit" stroke="#2b8a3e" strokeWidth={2} fill="none" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="card">
          <h2>Top products</h2>
          <table className="table compact">
            <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Revenue</th><th className="num">Profit</th></tr></thead>
            <tbody>{s?.topProducts.map((p) => <tr key={p.product_id}><td>{p.name}</td><td className="num">{p.qty}</td><td className="num">{moneyShort(p.revenue)}</td><td className="num">{moneyShort(p.profit)}</td></tr>)}</tbody>
          </table>
        </section>

        <section className="card">
          <h2>Payment methods</h2>
          <div className="stack-bar" aria-hidden="true">
            {s?.byPayment.map((p) => <span key={p.method} style={{ width: `${(100 * p.revenue) / payTotal}%`, background: PAY_COLORS[p.method] }} />)}
          </div>
          <ul className="legend">
            {s?.byPayment.map((p) => (
              <li key={p.method}><i style={{ background: PAY_COLORS[p.method] }} /><span className="cap">{p.method}</span>
                <span className="muted">{p.sales} sales</span><b className="num">{money(p.revenue)}</b><span className="muted num">{Math.round((100 * p.revenue) / payTotal)}%</span></li>
            ))}
          </ul>
          <h2 className="mt">By category</h2>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={s?.byCategory.map((c) => ({ ...c, n: c.revenue / 100 }))} layout="vertical" margin={{ left: 8, right: 16 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="category" width={96} tickLine={false} axisLine={false} fontSize={12} />
              <Tooltip formatter={(v) => money(Number(v) * 100)} />
              <Bar dataKey="n" name="Revenue" radius={[0, 4, 4, 0]}>{s?.byCategory.map((c, i) => <Cell key={c.category} fill={i === 0 ? '#e8590c' : '#f4a26b'} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>

        <section className="card span-2">
          <div className="row between"><h2>Low stock <span className="badge badge-warn">{inv?.lowStock.length ?? 0}</span></h2><Link to="/stock" className="btn btn-sm">Receive stock</Link></div>
          {inv && inv.lowStock.length === 0 && <p className="muted">Everything is above its reorder level.</p>}
          <div className="low-grid">
            {inv?.lowStock.map((p) => (
              <div key={p.id} className="low-item">
                <div><b>{p.name}</b><span className="muted">{p.sku}</span></div>
                <div className="meter"><i style={{ width: `${Math.min(100, (100 * p.on_hand) / Math.max(1, p.reorder_level))}%` }} /></div>
                <span className={p.on_hand === 0 ? 'text-err' : 'text-warn'}>{p.on_hand} / {p.reorder_level} {p.unit}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

const Kpi = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="kpi"><span>{label}</span><b>{value}</b>{hint && <small className="muted">{hint}</small>}</div>
);
