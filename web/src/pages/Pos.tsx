import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, money, toKobo, type Product, type Sale } from '../api';
import { ErrorBox, Modal } from '../components/ui';
import { Receipt } from './Receipt';

type Line = { product: Product; qty: number };
const METHODS = [['cash', 'Cash'], ['transfer', 'Transfer'], ['card', 'Card (POS)']] as const;

export function PosPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [cart, setCart] = useState<Line[]>([]);
  const [method, setMethod] = useState<'cash' | 'transfer' | 'card'>('cash');
  const [discount, setDiscount] = useState('');
  const [paid, setPaid] = useState('');
  const [customer, setCustomer] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const search = useRef<HTMLInputElement>(null);

  const load = useCallback(() => api<Product[]>('/products').then(setProducts).catch(setError), []);
  useEffect(() => { load(); search.current?.focus(); }, [load]);

  const categories = useMemo(() => ['All', ...new Set(products.map((p) => p.category ?? 'Other'))], [products]);
  const visible = products.filter((p) =>
    (category === 'All' || (p.category ?? 'Other') === category) &&
    (!q || `${p.name} ${p.sku} ${p.barcode ?? ''}`.toLowerCase().includes(q.toLowerCase())));

  const inCart = (id: number) => cart.find((l) => l.product.id === id)?.qty ?? 0;
  function add(p: Product, n = 1) {
    if (inCart(p.id) + n > p.on_hand) { setError(new Error(`Only ${p.on_hand} ${p.unit} of ${p.name} in stock`)); return; }
    setError(null);
    setCart((c) => (c.some((l) => l.product.id === p.id)
      ? c.map((l) => (l.product.id === p.id ? { ...l, qty: l.qty + n } : l)).filter((l) => l.qty > 0)
      : [...c, { product: p, qty: n }]));
  }

  // Barcode scanners type the code and press Enter
  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    const exact = products.find((p) => p.barcode === q.trim() || p.sku.toLowerCase() === q.trim().toLowerCase());
    const target = exact ?? (visible.length === 1 ? visible[0] : undefined);
    if (target) { add(target); setQ(''); }
  }

  const subtotal = cart.reduce((s, l) => s + l.qty * l.product.sell_price, 0);
  const disc = discount ? toKobo(discount) : 0;
  const total = Math.max(0, subtotal - (Number.isFinite(disc) ? disc : 0));
  const paidK = paid ? toKobo(paid) : 0;
  const change = method === 'cash' ? paidK - total : 0;
  const canCharge = cart.length > 0 && (method !== 'cash' || paidK >= total) && disc <= subtotal && !busy;

  async function charge() {
    setBusy(true);
    setError(null);
    try {
      const sale = await api<Sale>('/sales', {
        body: { items: cart.map((l) => ({ productId: l.product.id, qty: l.qty })), paymentMethod: method, discount: disc, amountPaid: method === 'cash' ? paidK : 0, customerName: customer || undefined },
      });
      setReceipt(sale);
      setCart([]); setDiscount(''); setPaid(''); setCustomer('');
      load();
    } catch (err) {
      setError(err);
      load();
    } finally {
      setBusy(false);
    }
  }

  const quickCash = [total, Math.ceil(total / 100000) * 100000, Math.ceil(total / 500000) * 500000].filter((v, i, a) => v > 0 && a.indexOf(v) === i);

  return (
    <div className="pos">
      <section className="pos-catalog">
        <div className="pos-search">
          <input ref={search} placeholder="Search or scan barcode…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} aria-label="Search products" />
        </div>
        <div className="chips">{categories.map((c) => <button key={c} className={`chip ${c === category ? 'on' : ''}`} onClick={() => setCategory(c)}>{c}</button>)}</div>
        <div className="tiles">
          {visible.map((p) => {
            const left = p.on_hand - inCart(p.id);
            return (
              <button key={p.id} className={`tile ${left <= 0 ? 'out' : ''}`} onClick={() => add(p)} disabled={left <= 0}>
                <span className="tile-name">{p.name}</span>
                <span className="tile-price">{money(p.sell_price)}</span>
                <span className={`tile-stock ${p.on_hand <= p.reorder_level ? 'low' : ''}`}>{left <= 0 ? 'Out of stock' : `${left} ${p.unit} left`}</span>
              </button>
            );
          })}
        </div>
      </section>

      <aside className="pos-cart">
        <h2>Current sale</h2>
        <ErrorBox error={error} />
        <div className="cart-lines">
          {cart.length === 0 && <p className="muted center">Tap a product or scan a barcode to start.</p>}
          {cart.map((l) => (
            <div className="cart-line" key={l.product.id}>
              <div><b>{l.product.name}</b><span className="muted">{money(l.product.sell_price)} × {l.qty}</span></div>
              <div className="qty">
                <button onClick={() => add(l.product, -1)} aria-label={`Remove one ${l.product.name}`}>−</button>
                <span>{l.qty}</span>
                <button onClick={() => add(l.product, 1)} aria-label={`Add one ${l.product.name}`}>+</button>
              </div>
              <b className="num">{money(l.qty * l.product.sell_price)}</b>
            </div>
          ))}
        </div>
        <div className="cart-totals">
          <div><span>Subtotal</span><span className="num">{money(subtotal)}</span></div>
          <label className="inline">Discount (₦)<input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" /></label>
          <div className="grand"><span>Total</span><span className="num">{money(total)}</span></div>
        </div>
        <div className="seg" role="radiogroup" aria-label="Payment method">
          {METHODS.map(([m, label]) => <button key={m} role="radio" aria-checked={method === m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>{label}</button>)}
        </div>
        {method === 'cash' && (
          <>
            <label className="inline">Amount received (₦)<input inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="0" /></label>
            <div className="chips">{quickCash.map((v) => <button key={v} className="chip" onClick={() => setPaid(String(v / 100))}>{money(v)}</button>)}</div>
            <div className={`change ${change < 0 ? 'neg' : ''}`}><span>Change</span><span className="num">{paid ? money(change) : '—'}</span></div>
          </>
        )}
        <label className="inline">Customer (optional)<input value={customer} onChange={(e) => setCustomer(e.target.value)} maxLength={80} /></label>
        <button className="btn btn-primary btn-block btn-lg" disabled={!canCharge} onClick={charge}>{busy ? 'Saving…' : `Charge ${money(total)}`}</button>
        {cart.length > 0 && <button className="link center" onClick={() => setCart([])}>Clear sale</button>}
      </aside>

      {receipt && <Modal title="Sale complete" onClose={() => { setReceipt(null); search.current?.focus(); }}><Receipt sale={receipt} /></Modal>}
    </div>
  );
}
