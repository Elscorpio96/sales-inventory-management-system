import type { DB } from '../../db/index.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';

export type PaymentMethod = 'cash' | 'transfer' | 'card';
export interface SaleInput {
  items: { productId: number; qty: number }[];
  paymentMethod: PaymentMethod;
  discount: number;      // kobo
  amountPaid: number;    // kobo
  customerName?: string;
}

interface ProductRow { id: number; name: string; sell_price: number; cost_price: number; active: number; on_hand: number }

/**
 * Record a sale atomically: price lines from the database (never trust client prices),
 * check stock for every line, write the sale, its items and the ledger rows.
 * SQLite serialises write transactions, so two tills cannot oversell the same stock.
 */
export function createSale(db: DB, input: SaleInput, userId: number) {
  return db.transaction(() => {
    // Merge duplicate lines for the same product
    const qtyByProduct = new Map<number, number>();
    for (const i of input.items) qtyByProduct.set(i.productId, (qtyByProduct.get(i.productId) ?? 0) + i.qty);

    const getProduct = db.prepare<[number], ProductRow>(`
      SELECT p.id, p.name, p.sell_price, p.cost_price, p.active, s.on_hand
      FROM products p JOIN product_stock s ON s.product_id = p.id WHERE p.id = ?`);

    const lines = [...qtyByProduct].map(([productId, qty]) => {
      const p = getProduct.get(productId);
      if (!p || !p.active) throw notFound(`Product #${productId}`);
      if (p.on_hand < qty) throw new AppError(409, `Not enough stock for ${p.name}: ${p.on_hand} available, ${qty} requested`, 'INSUFFICIENT_STOCK');
      return { p, qty, lineTotal: p.sell_price * qty };
    });

    const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
    if (input.discount > subtotal) throw badRequest('Discount cannot exceed the subtotal');
    const total = subtotal - input.discount;
    if (input.paymentMethod === 'cash' && input.amountPaid < total) throw badRequest('Amount paid is less than the total');
    const amountPaid = input.paymentMethod === 'cash' ? input.amountPaid : total;
    const change = amountPaid - total;

    const saleId = Number(db.prepare(`
      INSERT INTO sales (user_id, customer_name, payment_method, subtotal, discount, total, amount_paid, change_due)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, input.customerName || null, input.paymentMethod, subtotal, input.discount, total, amountPaid, change).lastInsertRowid);
    const year = new Date().getFullYear();
    const receiptNo = `INV-${year}-${String(saleId).padStart(6, '0')}`;
    db.prepare('UPDATE sales SET receipt_no = ? WHERE id = ?').run(receiptNo, saleId);

    const insItem = db.prepare('INSERT INTO sale_items (sale_id, product_id, name, qty, unit_price, unit_cost, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insMove = db.prepare("INSERT INTO stock_movements (product_id, type, qty, unit_cost, ref_id, user_id) VALUES (?, 'sale', ?, ?, ?, ?)");
    for (const l of lines) {
      insItem.run(saleId, l.p.id, l.p.name, l.qty, l.p.sell_price, l.p.cost_price, l.lineTotal);
      insMove.run(l.p.id, -l.qty, l.p.cost_price, saleId, userId);
    }
    return getSale(db, saleId);
  })();
}

/** Void a sale: mark it voided and return every item to stock through the ledger. */
export function voidSale(db: DB, saleId: number, reason: string, userId: number) {
  return db.transaction(() => {
    const sale = db.prepare<[number], { status: string }>('SELECT status FROM sales WHERE id = ?').get(saleId);
    if (!sale) throw notFound('Sale');
    if (sale.status === 'voided') throw new AppError(409, 'This sale has already been voided', 'ALREADY_VOIDED');
    db.prepare("UPDATE sales SET status = 'voided', voided_by = ?, voided_at = datetime('now'), void_reason = ? WHERE id = ?").run(userId, reason, saleId);
    const items = db.prepare<[number], { product_id: number; qty: number; unit_cost: number }>('SELECT product_id, qty, unit_cost FROM sale_items WHERE sale_id = ?').all(saleId);
    const insMove = db.prepare("INSERT INTO stock_movements (product_id, type, qty, unit_cost, ref_id, note, user_id) VALUES (?, 'void', ?, ?, ?, ?, ?)");
    for (const i of items) insMove.run(i.product_id, i.qty, i.unit_cost, saleId, reason, userId);
    return getSale(db, saleId);
  })();
}

export interface SaleRow {
  id: number; receipt_no: string; user_id: number; customer_name: string | null; payment_method: PaymentMethod;
  subtotal: number; discount: number; total: number; amount_paid: number; change_due: number;
  status: 'completed' | 'voided'; void_reason: string | null; voided_at: string | null; created_at: string;
  cashier: string; voided_by_name: string | null;
}

export function getSale(db: DB, saleId: number) {
  const sale = db.prepare(`
    SELECT s.*, u.name AS cashier, v.name AS voided_by_name FROM sales s
    JOIN users u ON u.id = s.user_id LEFT JOIN users v ON v.id = s.voided_by WHERE s.id = ?`).get(saleId) as SaleRow | undefined;
  if (!sale) throw notFound('Sale');
  const items = db.prepare('SELECT product_id, name, qty, unit_price, line_total FROM sale_items WHERE sale_id = ? ORDER BY id').all(saleId);
  return { ...sale, items };
}

export interface SaleFilter { from?: string; to?: string; userId?: number; status?: string; q?: string; limit: number; offset: number }

export function listSales(db: DB, f: SaleFilter) {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.from) { where.push("date(s.created_at, 'localtime') >= date(?)"); args.push(f.from); }
  if (f.to) { where.push("date(s.created_at, 'localtime') <= date(?)"); args.push(f.to); }
  if (f.userId) { where.push('s.user_id = ?'); args.push(f.userId); }
  if (f.status) { where.push('s.status = ?'); args.push(f.status); }
  if (f.q) { where.push('(s.receipt_no LIKE ? OR s.customer_name LIKE ?)'); args.push(`%${f.q}%`, `%${f.q}%`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM sales s ${w}`).get(...args) as { n: number }).n;
  const rows = db.prepare(`
    SELECT s.id, s.receipt_no, s.customer_name, s.payment_method, s.total, s.status, s.created_at, u.name AS cashier,
      (SELECT SUM(qty) FROM sale_items i WHERE i.sale_id = s.id) AS items
    FROM sales s JOIN users u ON u.id = s.user_id ${w}
    ORDER BY s.created_at DESC, s.id DESC LIMIT ? OFFSET ?`).all(...args, f.limit, f.offset);
  return { total, rows };
}
