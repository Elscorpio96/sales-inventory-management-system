import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, money, toKobo, type Category, type Product } from '../api';
import { can, useSession } from '../App';
import { Empty, ErrorBox, Modal, PageHead } from '../components/ui';

export function ProductsPage() {
  const { user } = useSession();
  const manage = can(user, 'owner', 'manager');
  const [rows, setRows] = useState<Product[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [q, setQ] = useState('');
  const [low, setLow] = useState(false);
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (low) params.set('lowStock', '1');
    if (manage) params.set('includeInactive', '1');
    api<Product[]>(`/products?${params}`).then(setRows).catch(setError);
  }, [q, low, manage]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  useEffect(() => { api<Category[]>('/categories').then(setCats).catch(setError); }, []);

  return (
    <>
      <PageHead title="Products" sub={`${rows.length} products`}>
        {manage && <button className="btn btn-primary" onClick={() => setEditing({ unit: 'pcs', reorder_level: 0, active: 1 })}>+ New product</button>}
      </PageHead>
      <ErrorBox error={error} />
      <div className="toolbar">
        <input placeholder="Search name, SKU or barcode" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <label className="check"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Low stock only</label>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>SKU</th><th>Product</th><th>Category</th><th className="num">Price</th>{manage && <th className="num">Avg cost</th>}{manage && <th className="num">Margin</th>}<th className="num">On hand</th><th /></tr></thead>
          <tbody>
            {rows.map((p) => {
              const margin = p.cost_price !== undefined && p.sell_price ? Math.round((100 * (p.sell_price - p.cost_price)) / p.sell_price) : null;
              return (
                <tr key={p.id} className={p.active ? '' : 'dim'}>
                  <td className="mono">{p.sku}</td>
                  <td>{p.name}{!p.active && <span className="badge">inactive</span>}</td>
                  <td>{p.category ?? '—'}</td>
                  <td className="num">{money(p.sell_price)}</td>
                  {manage && <td className="num">{money(p.cost_price ?? 0)}</td>}
                  {manage && <td className={`num ${margin !== null && margin < 10 ? 'text-err' : ''}`}>{margin}%</td>}
                  <td className="num"><span className={p.on_hand <= p.reorder_level ? 'badge badge-warn' : ''}>{p.on_hand} {p.unit}</span></td>
                  <td className="num">{manage && <button className="btn btn-sm" onClick={() => setEditing(p)}>Edit</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <Empty>No products match.</Empty>}
      </div>
      {editing && <ProductForm product={editing} categories={cats} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

function ProductForm({ product, categories, onClose, onSaved }: { product: Partial<Product>; categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const isNew = !product.id;
  const [f, setF] = useState({
    sku: product.sku ?? '', barcode: product.barcode ?? '', name: product.name ?? '', categoryId: product.category_id ? String(product.category_id) : '',
    unit: product.unit ?? 'pcs', sellPrice: product.sell_price !== undefined ? String(product.sell_price / 100) : '',
    costPrice: '', reorderLevel: String(product.reorder_level ?? 0), openingStock: '', active: product.active !== 0,
  });
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const body: Record<string, unknown> = {
      sku: f.sku, barcode: f.barcode || null, name: f.name, categoryId: f.categoryId ? Number(f.categoryId) : null,
      unit: f.unit, sellPrice: toKobo(f.sellPrice || '0'), reorderLevel: Number(f.reorderLevel || 0),
    };
    if (isNew) {
      body.costPrice = toKobo(f.costPrice || '0');
      if (f.openingStock) body.openingStock = Number(f.openingStock);
    } else body.active = f.active;
    try {
      await api(isNew ? '/products' : `/products/${product.id}`, { method: isNew ? 'POST' : 'PUT', body });
      onSaved();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Modal title={isNew ? 'New product' : `Edit ${product.name}`} onClose={onClose}>
      <form onSubmit={save} className="form">
        <ErrorBox error={error} />
        <label>Name<input value={f.name} onChange={set('name')} required maxLength={120} /></label>
        <div className="form-row">
          <label>SKU<input value={f.sku} onChange={set('sku')} required maxLength={30} /></label>
          <label>Barcode<input value={f.barcode} onChange={set('barcode')} inputMode="numeric" /></label>
        </div>
        <div className="form-row">
          <label>Category<select value={f.categoryId} onChange={set('categoryId')}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Unit<input value={f.unit} onChange={set('unit')} required maxLength={20} /></label>
        </div>
        <div className="form-row">
          <label>Selling price (₦)<input value={f.sellPrice} onChange={set('sellPrice')} inputMode="decimal" required /></label>
          {isNew && <label>Cost price (₦)<input value={f.costPrice} onChange={set('costPrice')} inputMode="decimal" /></label>}
        </div>
        <div className="form-row">
          <label>Reorder level<input value={f.reorderLevel} onChange={set('reorderLevel')} inputMode="numeric" /></label>
          {isNew && <label>Opening stock<input value={f.openingStock} onChange={set('openingStock')} inputMode="numeric" /></label>}
        </div>
        {!isNew && <p className="muted small">Cost price is maintained automatically as a weighted average when stock is received.</p>}
        {!isNew && <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> Active (available for sale)</label>}
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary">Save</button></div>
      </form>
    </Modal>
  );
}
