import type { DB } from '../../db/index.js';

/**
 * Business summary for a date range (inclusive, YYYY-MM-DD, server local dates).
 * Voided sales are excluded everywhere. Profit uses the cost recorded on each sale line.
 */
export function summary(db: DB, from: string, to: string) {
  const range = "date(s.created_at, 'localtime') BETWEEN date(?) AND date(?) AND s.status = 'completed'";

  const totals = db.prepare(`
    SELECT COUNT(*) AS sales, COALESCE(SUM(s.total), 0) AS revenue, COALESCE(SUM(s.discount), 0) AS discounts
    FROM sales s WHERE ${range}`).get(from, to) as { sales: number; revenue: number; discounts: number };

  const cost = (db.prepare(`
    SELECT COALESCE(SUM(i.qty * i.unit_cost), 0) AS cost FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE ${range}`)
    .get(from, to) as { cost: number }).cost;

  const daily = db.prepare(`
    SELECT date(s.created_at, 'localtime') AS day, COUNT(*) AS sales, SUM(s.total) AS revenue,
      SUM(s.total) - COALESCE((SELECT SUM(i.qty * i.unit_cost) FROM sale_items i JOIN sales s2 ON s2.id = i.sale_id
        WHERE date(s2.created_at, 'localtime') = date(s.created_at, 'localtime') AND s2.status = 'completed'), 0) AS profit
    FROM sales s WHERE ${range} GROUP BY day ORDER BY day`).all(from, to);

  const byPayment = db.prepare(`
    SELECT s.payment_method AS method, COUNT(*) AS sales, SUM(s.total) AS revenue
    FROM sales s WHERE ${range} GROUP BY s.payment_method ORDER BY revenue DESC`).all(from, to);

  const topProducts = db.prepare(`
    SELECT i.product_id, i.name, SUM(i.qty) AS qty, SUM(i.line_total) AS revenue, SUM(i.line_total - i.qty * i.unit_cost) AS profit
    FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE ${range}
    GROUP BY i.product_id ORDER BY revenue DESC LIMIT 8`).all(from, to);

  const byCategory = db.prepare(`
    SELECT COALESCE(c.name, 'Uncategorised') AS category, SUM(i.line_total) AS revenue
    FROM sale_items i JOIN sales s ON s.id = i.sale_id JOIN products p ON p.id = i.product_id
    LEFT JOIN categories c ON c.id = p.category_id WHERE ${range} GROUP BY category ORDER BY revenue DESC`).all(from, to);

  const grossProfit = totals.revenue - cost;
  return {
    from, to,
    sales: totals.sales,
    revenue: totals.revenue,
    discounts: totals.discounts,
    costOfGoods: cost,
    grossProfit,
    marginPct: totals.revenue ? Math.round((grossProfit / totals.revenue) * 1000) / 10 : 0,
    averageSale: totals.sales ? Math.round(totals.revenue / totals.sales) : 0,
    daily, byPayment, topProducts, byCategory,
  };
}

/** Current inventory position: valuation at cost and retail, and items at or below reorder level. */
export function inventoryStatus(db: DB) {
  const value = db.prepare(`
    SELECT COUNT(*) AS products, COALESCE(SUM(s.on_hand), 0) AS units,
      COALESCE(SUM(s.on_hand * p.cost_price), 0) AS cost_value, COALESCE(SUM(s.on_hand * p.sell_price), 0) AS retail_value
    FROM products p JOIN product_stock s ON s.product_id = p.id WHERE p.active = 1`).get();
  const lowStock = db.prepare(`
    SELECT p.id, p.sku, p.name, p.reorder_level, s.on_hand, p.unit
    FROM products p JOIN product_stock s ON s.product_id = p.id
    WHERE p.active = 1 AND s.on_hand <= p.reorder_level ORDER BY (s.on_hand * 1.0 / MAX(p.reorder_level, 1)), p.name`).all();
  return { ...(value as object), lowStock };
}
