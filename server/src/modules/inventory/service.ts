import type { DB } from '../../db/index.js';
import { badRequest, notFound } from '../../lib/errors.js';

export interface ReceiveLine { productId: number; qty: number; unitCost: number }

export function onHand(db: DB, productId: number): number {
  const row = db.prepare<[number], { on_hand: number }>('SELECT on_hand FROM product_stock WHERE product_id = ?').get(productId);
  if (!row) throw notFound('Product');
  return row.on_hand;
}

/**
 * Receive stock from a supplier. Writes one purchase and one ledger row per line,
 * and updates each product's weighted-average cost:
 *   newCost = (onHand × oldCost + qty × unitCost) / (onHand + qty)
 */
export function receiveStock(db: DB, input: { supplierId?: number | null; reference?: string; lines: ReceiveLine[] }, userId: number) {
  return db.transaction(() => {
    const totalCost = input.lines.reduce((s, l) => s + l.qty * l.unitCost, 0);
    const purchaseId = Number(db.prepare('INSERT INTO purchases (supplier_id, reference, total_cost, user_id) VALUES (?, ?, ?, ?)')
      .run(input.supplierId ?? null, input.reference ?? null, totalCost, userId).lastInsertRowid);
    const getCost = db.prepare<[number], { cost_price: number }>('SELECT cost_price FROM products WHERE id = ?');
    for (const l of input.lines) {
      const product = getCost.get(l.productId);
      if (!product) throw notFound(`Product #${l.productId}`);
      const stock = Math.max(0, onHand(db, l.productId));
      const newCost = Math.round((stock * product.cost_price + l.qty * l.unitCost) / (stock + l.qty));
      db.prepare("UPDATE products SET cost_price = ?, updated_at = datetime('now') WHERE id = ?").run(newCost, l.productId);
      db.prepare("INSERT INTO stock_movements (product_id, type, qty, unit_cost, ref_id, user_id) VALUES (?, 'receive', ?, ?, ?, ?)")
        .run(l.productId, l.qty, l.unitCost, purchaseId, userId);
    }
    return { purchaseId, totalCost };
  })();
}

/** Manual correction after a stock count (damage, theft, counting error). Cannot go below zero. */
export function adjustStock(db: DB, input: { productId: number; qty: number; note: string }, userId: number) {
  return db.transaction(() => {
    const current = onHand(db, input.productId);
    if (current + input.qty < 0) throw badRequest(`Adjustment would make stock negative (on hand: ${current})`);
    db.prepare("INSERT INTO stock_movements (product_id, type, qty, note, user_id) VALUES (?, 'adjust', ?, ?, ?)")
      .run(input.productId, input.qty, input.note, userId);
    return { onHand: current + input.qty };
  })();
}

export function movements(db: DB, productId?: number, limit = 100) {
  return db.prepare(`
    SELECT m.id, m.product_id, p.name AS product_name, p.sku, m.type, m.qty, m.unit_cost, m.ref_id, m.note,
           u.name AS user_name, m.created_at
    FROM stock_movements m JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.user_id
    WHERE (? IS NULL OR m.product_id = ?)
    ORDER BY m.created_at DESC, m.id DESC LIMIT ?`).all(productId ?? null, productId ?? null, limit);
}
