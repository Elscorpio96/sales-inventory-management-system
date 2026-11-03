import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, money, toKobo, when, type Product } from '../api';
import { ErrorBox, PageHead } from '../components/ui';

interface Movement { id: number; product_name: string; sku: string; type: string; qty: number; unit_cost: number | null; note: string | null; user_name: string; created_at: string; ref_id: number | null }
interface Supplier { id: number; name: string }
type Line = { productId: string; qty: string; unitCost: string };

export function StockPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [moves, setMoves] = useState<Movement[]>([]);
  const [tab, setTab] = useState<'receive' | 'adjust'>('receive');
  const [ok, setOk] = useState('');

  const load = useCallback(() => {
    api<Product[]>('/products').then(setProducts);
    api<Movement[]>('/inventory/movements').then(setMoves);
  }, []);
  useEffect(() => { load(); api<Supplier[]>('/suppliers').then(setSuppliers); }, [load]);
  const done = (msg: string) => { setOk(msg); load(); setTimeout(() => setOk(''), 4000); };

  return (
    <>
      <PageHead title="Stock" sub="Receive deliveries, correct counts and review the inventory ledger" />
      {ok && <div className="alert alert-ok" role="status">{ok}</div>}
      <div className="grid-2">
        <section className="card">
          <div className="seg mb">{(['receive', 'adjust'] as const).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'receive' ? 'Receive delivery' : 'Stock adjustment'}</button>)}</div>
          {tab === 'receive' ? <ReceiveForm products={products} suppliers={suppliers} onDone={done} /> : <AdjustForm products={products} onDone={done} />}
        </section>
        <section className="card">
          <h2>Inventory ledger</h2>
          <p className="muted small">Every change to stock is an append-only movement. Stock on hand is the sum of this ledger.</p>
          <div className="table-wrap tall">
            <table className="table compact">
              <thead><tr><th>When</th><th>Product</th><th>Type</th><th className="num">Qty</th><th>By</th></tr></thead>
              <tbody>{moves.map((m) => (
                <tr key={m.id}><td className="nowrap muted">{when(m.created_at)}</td><td>{m.product_name}</td>
                  <td><span className={`badge mv-${m.type}`}>{m.type}</span></td>
                  <td className={`num ${m.qty < 0 ? 'text-err' : 'text-ok'}`}>{m.qty > 0 ? '+' : ''}{m.qty}</td><td className="muted">{m.user_name}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

function ReceiveForm({ products, suppliers, onDone }: { products: Product[]; suppliers: Supplier[]; onDone: (m: string) => void }) {
  const blank: Line = { productId: '', qty: '', unitCost: '' };
  const [supplierId, setSupplierId] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<Line[]>([blank]);
  const [error, setError] = useState<unknown>(null);
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (toKobo(l.unitCost || '0') || 0), 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ totalCost: number }>('/inventory/receive', {
        body: {
          supplierId: supplierId ? Number(supplierId) : null, reference: reference || undefined,
          lines: lines.filter((l) => l.productId).map((l) => ({ productId: Number(l.productId), qty: Number(l.qty), unitCost: toKobo(l.unitCost || '0') })),
        },
      });
      setLines([blank]); setReference('');
      onDone(`Delivery received — ${money(r.totalCost)}`);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form onSubmit={submit} className="form">
      <ErrorBox error={error} />
      <div className="form-row">
        <label>Supplier<select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Delivery note / invoice no.<input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} /></label>
      </div>
      {lines.map((l, i) => (
        <div className="form-row lines" key={i}>
          <label>Product<select value={l.productId} onChange={(e) => {
            const p = products.find((x) => x.id === Number(e.target.value));
            setLine(i, { productId: e.target.value, unitCost: p?.cost_price ? String(p.cost_price / 100) : '' });
          }} required={i === 0}><option value="">Select…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.on_hand})</option>)}</select></label>
          <label>Qty<input value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} inputMode="numeric" required={!!l.productId} /></label>
          <label>Unit cost (₦)<input value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} inputMode="decimal" required={!!l.productId} /></label>
          {lines.length > 1 && <button type="button" className="icon-btn" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line">×</button>}
        </div>
      ))}
      <div className="row between">
        <button type="button" className="btn btn-sm" onClick={() => setLines([...lines, blank])}>+ Add line</button>
        <span>Total <b className="num">{money(total)}</b></span>
      </div>
      <button className="btn btn-primary">Receive stock</button>
    </form>
  );
}

function AdjustForm({ products, onDone }: { products: Product[]; onDone: (m: string) => void }) {
  const [productId, setProductId] = useState('');
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const p = products.find((x) => x.id === Number(productId));
  const diff = p && counted !== '' ? Number(counted) - p.on_hand : 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/inventory/adjust', { body: { productId: Number(productId), qty: diff, note } });
      setCounted(''); setNote('');
      onDone(`${p?.name}: stock corrected by ${diff > 0 ? '+' : ''}${diff}`);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <form onSubmit={submit} className="form">
      <ErrorBox error={error} />
      <label>Product<select value={productId} onChange={(e) => setProductId(e.target.value)} required><option value="">Select…</option>{products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <div className="form-row">
        <label>System quantity<input value={p ? `${p.on_hand} ${p.unit}` : ''} disabled /></label>
        <label>Physically counted<input value={counted} onChange={(e) => setCounted(e.target.value)} inputMode="numeric" required /></label>
      </div>
      {p && counted !== '' && <p className={diff < 0 ? 'text-err' : diff > 0 ? 'text-ok' : 'muted'}>Adjustment: {diff > 0 ? '+' : ''}{diff} {p.unit}</p>}
      <label>Reason<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Damaged in store, stock count" required maxLength={200} /></label>
      <button className="btn btn-primary" disabled={!diff}>Record adjustment</button>
    </form>
  );
}
