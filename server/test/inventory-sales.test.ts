import { describe, expect, it, beforeEach } from 'vitest';
import { setup, login } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof setup>> & { owner: string };
let ctx: Ctx;

beforeEach(async () => {
  const s = await setup({ seeded: false });
  ctx = { ...s, owner: await login(s.app, 'owner') };
});

const api = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, cookie: string, payload?: object) =>
  ctx.app.inject({ method, url: `/api${url}`, headers: { cookie }, payload });

async function product(fields: Record<string, unknown> = {}) {
  const res = await api('POST', '/products', ctx.owner, { sku: 'TST-1', name: 'Test Item', sellPrice: 1000_00, costPrice: 600_00, reorderLevel: 5, openingStock: 10, ...fields });
  expect(res.statusCode).toBe(201);
  return res.json().id as number;
}
const stock = async (id: number) => (await api('GET', '/products', ctx.owner)).json().find((p: { id: number }) => p.id === id).on_hand as number;

describe('stock ledger', () => {
  it('opening stock is recorded as a movement', async () => {
    const id = await product();
    expect(await stock(id)).toBe(10);
    const mv = (await api('GET', `/inventory/movements?productId=${id}`, ctx.owner)).json();
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({ type: 'opening', qty: 10 });
  });

  it('receiving stock updates weighted-average cost', async () => {
    const id = await product(); // 10 @ ₦600
    const res = await api('POST', '/inventory/receive', ctx.owner, { lines: [{ productId: id, qty: 30, unitCost: 800_00 }] });
    expect(res.statusCode).toBe(201);
    expect(res.json().totalCost).toBe(30 * 800_00);
    const p = (await api('GET', '/products', ctx.owner)).json()[0];
    expect(p.on_hand).toBe(40);
    expect(p.cost_price).toBe(750_00); // (10×600 + 30×800) / 40
  });

  it('adjustments cannot take stock below zero', async () => {
    const id = await product();
    expect((await api('POST', '/inventory/adjust', ctx.owner, { productId: id, qty: -11, note: 'count' })).statusCode).toBe(400);
    expect((await api('POST', '/inventory/adjust', ctx.owner, { productId: id, qty: -2, note: 'Damaged' })).json().onHand).toBe(8);
  });
});

describe('sales', () => {
  it('prices come from the database, stock is deducted and change is computed', async () => {
    const id = await product();
    const res = await api('POST', '/sales', ctx.owner, { items: [{ productId: id, qty: 3 }], paymentMethod: 'cash', amountPaid: 5000_00, discount: 100_00 });
    expect(res.statusCode).toBe(201);
    const sale = res.json();
    expect(sale).toMatchObject({ subtotal: 3000_00, discount: 100_00, total: 2900_00, amount_paid: 5000_00, change_due: 2100_00, status: 'completed' });
    expect(sale.receipt_no).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(await stock(id)).toBe(7);
  });

  it('duplicate lines for the same product are merged before the stock check', async () => {
    const id = await product();
    const res = await api('POST', '/sales', ctx.owner, { items: [{ productId: id, qty: 6 }, { productId: id, qty: 6 }], paymentMethod: 'transfer' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('INSUFFICIENT_STOCK');
    expect(await stock(id)).toBe(10);
  });

  it('a failed line rolls back the whole sale', async () => {
    const a = await product();
    const b = await product({ sku: 'TST-2', openingStock: 1 });
    const res = await api('POST', '/sales', ctx.owner, { items: [{ productId: a, qty: 2 }, { productId: b, qty: 5 }], paymentMethod: 'card' });
    expect(res.statusCode).toBe(409);
    expect(await stock(a)).toBe(10);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM sales').get()).toEqual({ n: 0 });
  });

  it('rejects underpayment in cash and discounts larger than the subtotal', async () => {
    const id = await product();
    expect((await api('POST', '/sales', ctx.owner, { items: [{ productId: id, qty: 1 }], paymentMethod: 'cash', amountPaid: 500_00 })).statusCode).toBe(400);
    expect((await api('POST', '/sales', ctx.owner, { items: [{ productId: id, qty: 1 }], paymentMethod: 'card', discount: 2000_00 })).statusCode).toBe(400);
  });

  it('voiding returns stock through the ledger and cannot be done twice', async () => {
    const id = await product();
    const sale = (await api('POST', '/sales', ctx.owner, { items: [{ productId: id, qty: 4 }], paymentMethod: 'transfer' })).json();
    expect(await stock(id)).toBe(6);
    const v = await api('POST', `/sales/${sale.id}/void`, ctx.owner, { reason: 'Wrong item' });
    expect(v.json().status).toBe('voided');
    expect(await stock(id)).toBe(10);
    expect((await api('POST', `/sales/${sale.id}/void`, ctx.owner, { reason: 'again' })).statusCode).toBe(409);
    const types = ctx.db.prepare('SELECT type, qty FROM stock_movements WHERE product_id = ? ORDER BY id').all(id);
    expect(types).toEqual([{ type: 'opening', qty: 10 }, { type: 'sale', qty: -4 }, { type: 'void', qty: 4 }]);
  });

  it('profit uses the cost at the time of sale, not today\'s cost', async () => {
    const id = await product(); // cost ₦600
    await api('POST', '/sales', ctx.owner, { items: [{ productId: id, qty: 2 }], paymentMethod: 'transfer' });
    await api('POST', '/inventory/receive', ctx.owner, { lines: [{ productId: id, qty: 8, unitCost: 900_00 }] }); // avg cost rises
    const today = new Date().toISOString().slice(0, 10);
    const r = (await api('GET', `/reports/summary?from=2000-01-01&to=${today}`, ctx.owner)).json();
    expect(r.revenue).toBe(2000_00);
    expect(r.grossProfit).toBe(2000_00 - 2 * 600_00);
  });
});

describe('validation', () => {
  it('returns field-level errors', async () => {
    const res = await api('POST', '/products', ctx.owner, { sku: 'bad sku!', name: '', sellPrice: -5 });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('VALIDATION_ERROR');
    const fields = body.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['sku', 'name', 'sellPrice']));
  });

  it('rejects non-integer money', async () => {
    const res = await api('POST', '/products', ctx.owner, { sku: 'X1', name: 'X', sellPrice: 10.5 });
    expect(res.statusCode).toBe(400);
  });

  it('duplicate SKUs conflict', async () => {
    await product();
    expect((await api('POST', '/products', ctx.owner, { sku: 'tst-1', name: 'Dup', sellPrice: 1 })).statusCode).toBe(409);
  });
});
