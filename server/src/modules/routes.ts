import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import type { DB } from '../db/index.js';
import type { Config } from '../config.js';
import { COOKIE } from '../plugins/auth.js';
import { AppError, conflict, isConstraint, notFound } from '../lib/errors.js';
import { adjustStock, movements, receiveStock } from './inventory/service.js';
import { createSale, getSale, listSales, voidSale } from './sales/service.js';
import { inventoryStatus, summary } from './reports/service.js';

const id = z.coerce.number().int().positive();
const kobo = z.number().int().min(0).max(100_000_000_00).describe('Amount in kobo (₦1 = 100)');
const text = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const role = z.enum(['owner', 'manager', 'cashier']);

const productBody = z.object({
  sku: text(30).regex(/^[A-Za-z0-9-]+$/, 'Letters, digits and dashes only'),
  barcode: z.string().trim().regex(/^\d{6,14}$/, '6–14 digits').nullable().optional(),
  name: text(120),
  categoryId: id.nullable().optional(),
  unit: text(20).default('pcs'),
  sellPrice: kobo,
  costPrice: kobo.optional().describe('Initial cost; afterwards maintained as a weighted average by stock receipts'),
  reorderLevel: z.number().int().min(0).max(1_000_000).default(0),
  openingStock: z.number().int().min(0).max(1_000_000).optional(),
});

/** Every API route. Grouped here so the permission model is visible in one place. */
export const routes: FastifyPluginAsyncZod<{ db: DB; config: Config }> = async (app, { db, config }) => {
  const anyone = { preHandler: app.authenticate };
  const managers = { preHandler: app.requireRole('owner', 'manager') };
  const owner = { preHandler: app.requireRole('owner') };

  // ---------------------------------------------------------------- auth
  app.post('/auth/login', {
    schema: { tags: ['auth'], body: z.object({ email: z.string().trim().email(), password: z.string().min(1).max(200) }) },
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(req.body.email) as
      { id: number; name: string; email: string; role: string; password_hash: string; active: number; token_version: number } | undefined;
    const ok = await bcrypt.compare(req.body.password, u?.password_hash ?? DUMMY_HASH);
    if (!u || !ok || !u.active) throw new AppError(401, 'Incorrect email or password', 'INVALID_CREDENTIALS');
    await app.issueSession(reply, u);
    return { user: { id: u.id, name: u.name, email: u.email, role: u.role } };
  });

  app.post('/auth/logout', { schema: { tags: ['auth'] } }, async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', { ...anyone, schema: { tags: ['auth'] } }, async (req) => ({ user: req.user, businessName: config.businessName }));

  app.post('/auth/password', {
    ...anyone,
    schema: { tags: ['auth'], body: z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200) }) },
  }, async (req, reply) => {
    const u = db.prepare('SELECT password_hash, token_version FROM users WHERE id = ?').get(req.user.id) as { password_hash: string; token_version: number };
    if (!(await bcrypt.compare(req.body.currentPassword, u.password_hash))) throw new AppError(400, 'Current password is incorrect', 'BAD_PASSWORD');
    db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(await bcrypt.hash(req.body.newPassword, 10), req.user.id);
    await app.issueSession(reply, { id: req.user.id, token_version: u.token_version + 1 }); // other devices are signed out
    return { ok: true };
  });

  // ---------------------------------------------------------------- users (owner)
  app.get('/users', { ...owner, schema: { tags: ['users'] } }, async () =>
    db.prepare('SELECT id, name, email, role, active, created_at FROM users ORDER BY role, name').all());

  app.post('/users', {
    ...owner,
    schema: { tags: ['users'], body: z.object({ name: text(80), email: z.string().trim().email(), role, password: z.string().min(8).max(200) }) },
  }, async (req, reply) => {
    try {
      const r = db.prepare('INSERT INTO users (name, email, role, password_hash) VALUES (?, ?, ?, ?)')
        .run(req.body.name, req.body.email, req.body.role, await bcrypt.hash(req.body.password, 10));
      reply.code(201);
      return { id: Number(r.lastInsertRowid) };
    } catch (e) {
      if (isConstraint(e)) throw conflict('That email is already registered');
      throw e;
    }
  });

  app.patch('/users/:id', {
    ...owner,
    schema: { tags: ['users'], params: z.object({ id }), body: z.object({ role: role.optional(), active: z.boolean().optional() }) },
  }, async (req) => {
    if (req.params.id === req.user.id) throw new AppError(400, 'You cannot change your own role or status', 'SELF_CHANGE');
    const r = db.prepare(`UPDATE users SET role = COALESCE(?, role), active = COALESCE(?, active), token_version = token_version + 1 WHERE id = ?`)
      .run(req.body.role ?? null, req.body.active === undefined ? null : Number(req.body.active), req.params.id);
    if (!r.changes) throw notFound('User');
    return { ok: true };
  });

  // ---------------------------------------------------------------- catalogue
  app.get('/categories', { ...anyone, schema: { tags: ['products'] } }, async () =>
    db.prepare('SELECT c.id, c.name, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS products FROM categories c ORDER BY name').all());

  app.post('/categories', { ...managers, schema: { tags: ['products'], body: z.object({ name: text(60) }) } }, async (req, reply) => {
    try {
      const r = db.prepare('INSERT INTO categories (name) VALUES (?)').run(req.body.name);
      reply.code(201);
      return { id: Number(r.lastInsertRowid), name: req.body.name };
    } catch (e) {
      if (isConstraint(e)) throw conflict('Category already exists');
      throw e;
    }
  });

  app.get('/products', {
    ...anyone,
    schema: {
      tags: ['products'],
      querystring: z.object({ q: z.string().max(60).optional(), categoryId: id.optional(), lowStock: z.enum(['1']).optional(), includeInactive: z.enum(['1']).optional() }),
    },
  }, async (req) => {
    const { q, categoryId, lowStock, includeInactive } = req.query;
    const showCost = req.user.role !== 'cashier';
    return db.prepare(`
      SELECT p.id, p.sku, p.barcode, p.name, p.category_id, c.name AS category, p.unit, p.sell_price,
        ${showCost ? 'p.cost_price,' : ''} p.reorder_level, p.active, s.on_hand
      FROM products p JOIN product_stock s ON s.product_id = p.id LEFT JOIN categories c ON c.id = p.category_id
      WHERE (? IS NULL OR p.name LIKE ? OR p.sku LIKE ? OR p.barcode = ?)
        AND (? IS NULL OR p.category_id = ?)
        AND (? IS NULL OR s.on_hand <= p.reorder_level)
        AND (? IS NOT NULL OR p.active = 1)
      ORDER BY p.name LIMIT 500`)
      .all(q ?? null, `%${q}%`, `%${q}%`, q ?? null, categoryId ?? null, categoryId ?? null, lowStock ?? null, includeInactive ?? null);
  });

  app.post('/products', { ...managers, schema: { tags: ['products'], body: productBody } }, async (req, reply) => {
    const b = req.body;
    try {
      const productId = db.transaction(() => {
        const pid = Number(db.prepare(`INSERT INTO products (sku, barcode, name, category_id, unit, cost_price, sell_price, reorder_level)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(b.sku, b.barcode ?? null, b.name, b.categoryId ?? null, b.unit, b.costPrice ?? 0, b.sellPrice, b.reorderLevel).lastInsertRowid);
        if (b.openingStock) {
          db.prepare("INSERT INTO stock_movements (product_id, type, qty, unit_cost, note, user_id) VALUES (?, 'opening', ?, ?, 'Opening stock', ?)")
            .run(pid, b.openingStock, b.costPrice ?? 0, req.user.id);
        }
        return pid;
      })();
      reply.code(201);
      return { id: productId };
    } catch (e) {
      if (isConstraint(e)) throw conflict('SKU or barcode already in use, or category does not exist');
      throw e;
    }
  });

  app.put('/products/:id', {
    ...managers,
    schema: { tags: ['products'], params: z.object({ id }), body: productBody.omit({ openingStock: true, costPrice: true }).extend({ active: z.boolean().default(true) }) },
  }, async (req) => {
    const b = req.body;
    try {
      const r = db.prepare(`UPDATE products SET sku = ?, barcode = ?, name = ?, category_id = ?, unit = ?, sell_price = ?, reorder_level = ?, active = ?,
        updated_at = datetime('now') WHERE id = ?`).run(b.sku, b.barcode ?? null, b.name, b.categoryId ?? null, b.unit, b.sellPrice, b.reorderLevel, Number(b.active), req.params.id);
      if (!r.changes) throw notFound('Product');
    } catch (e) {
      if (isConstraint(e)) throw conflict('SKU or barcode already in use');
      throw e;
    }
    return { ok: true };
  });

  // ---------------------------------------------------------------- inventory
  app.get('/suppliers', { ...managers, schema: { tags: ['inventory'] } }, async () => db.prepare('SELECT * FROM suppliers ORDER BY name').all());
  app.post('/suppliers', { ...managers, schema: { tags: ['inventory'], body: z.object({ name: text(80), phone: z.string().trim().max(20).optional() }) } }, async (req, reply) => {
    try {
      const r = db.prepare('INSERT INTO suppliers (name, phone) VALUES (?, ?)').run(req.body.name, req.body.phone ?? null);
      reply.code(201);
      return { id: Number(r.lastInsertRowid) };
    } catch (e) {
      if (isConstraint(e)) throw conflict('Supplier already exists');
      throw e;
    }
  });

  app.post('/inventory/receive', {
    ...managers,
    schema: {
      tags: ['inventory'],
      body: z.object({
        supplierId: id.nullable().optional(),
        reference: z.string().trim().max(60).optional(),
        lines: z.array(z.object({ productId: id, qty: z.number().int().positive().max(1_000_000), unitCost: kobo })).min(1).max(200),
      }),
    },
  }, async (req, reply) => {
    reply.code(201);
    return receiveStock(db, req.body, req.user.id);
  });

  app.post('/inventory/adjust', {
    ...managers,
    schema: { tags: ['inventory'], body: z.object({ productId: id, qty: z.number().int().refine((n) => n !== 0, 'Cannot be zero'), note: text(200) }) },
  }, async (req) => adjustStock(db, req.body, req.user.id));

  app.get('/inventory/movements', { ...managers, schema: { tags: ['inventory'], querystring: z.object({ productId: id.optional() }) } },
    async (req) => movements(db, req.query.productId));

  // ---------------------------------------------------------------- sales
  app.post('/sales', {
    ...anyone,
    schema: {
      tags: ['sales'],
      body: z.object({
        items: z.array(z.object({ productId: id, qty: z.number().int().positive().max(10_000) })).min(1).max(200),
        paymentMethod: z.enum(['cash', 'transfer', 'card']),
        discount: kobo.default(0),
        amountPaid: kobo.default(0),
        customerName: z.string().trim().max(80).optional(),
      }),
    },
  }, async (req, reply) => {
    if (req.body.discount > 0 && req.user.role === 'cashier' && req.body.discount > 500_000) {
      throw new AppError(403, 'Discounts above ₦5,000 need a manager', 'DISCOUNT_LIMIT');
    }
    reply.code(201);
    return createSale(db, req.body, req.user.id);
  });

  app.get('/sales', {
    ...anyone,
    schema: {
      tags: ['sales'],
      querystring: z.object({
        from: isoDate.optional(), to: isoDate.optional(), status: z.enum(['completed', 'voided']).optional(),
        q: z.string().max(40).optional(), page: z.coerce.number().int().min(1).default(1),
      }),
    },
  }, async (req) => {
    const pageSize = 25;
    // Cashiers only ever see their own sales
    const userId = req.user.role === 'cashier' ? req.user.id : undefined;
    const r = listSales(db, { ...req.query, userId, limit: pageSize, offset: (req.query.page - 1) * pageSize });
    return { ...r, page: req.query.page, pageSize };
  });

  app.get('/sales/export.csv', {
    ...managers,
    schema: { tags: ['sales'], querystring: z.object({ from: isoDate.optional(), to: isoDate.optional() }) },
  }, async (req, reply) => {
    const { rows } = listSales(db, { ...req.query, limit: 100_000, offset: 0 });
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v);
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const head = ['Receipt', 'Date', 'Cashier', 'Customer', 'Payment', 'Items', 'Total (NGN)', 'Status'];
    const lines = (rows as Record<string, unknown>[]).map((r) =>
      [r.receipt_no, r.created_at, r.cashier, r.customer_name, r.payment_method, r.items, (Number(r.total) / 100).toFixed(2), r.status].map(esc).join(','));
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="sales.csv"');
    return [head.join(','), ...lines].join('\r\n') + '\r\n';
  });

  app.get('/sales/:id', { ...anyone, schema: { tags: ['sales'], params: z.object({ id }) } }, async (req) => {
    const sale = getSale(db, req.params.id);
    if (req.user.role === 'cashier' && sale.user_id !== req.user.id) throw notFound('Sale');
    return sale;
  });

  app.post('/sales/:id/void', {
    ...managers,
    schema: { tags: ['sales'], params: z.object({ id }), body: z.object({ reason: text(200) }) },
  }, async (req) => voidSale(db, req.params.id, req.body.reason, req.user.id));

  // ---------------------------------------------------------------- reports
  app.get('/reports/summary', {
    ...managers,
    schema: { tags: ['reports'], querystring: z.object({ from: isoDate, to: isoDate }) },
  }, async (req) => {
    if (req.query.from > req.query.to) throw new AppError(400, '"from" must be on or before "to"', 'BAD_RANGE');
    return summary(db, req.query.from, req.query.to);
  });

  app.get('/reports/inventory', { ...managers, schema: { tags: ['reports'] } }, async () => inventoryStatus(db));
};

// bcrypt hash of a random value, so unknown emails take as long as wrong passwords
const DUMMY_HASH = bcrypt.hashSync(crypto.randomUUID(), 10);
