import { describe, expect, it } from 'vitest';
import { setup, login } from './helpers.js';

describe('authentication', () => {
  it('rejects requests without a session', async () => {
    const { app } = await setup();
    expect((await app.inject({ url: '/api/products' })).statusCode).toBe(401);
  });

  it('sets an HttpOnly SameSite=Strict cookie and rejects wrong passwords', async () => {
    const { app } = await setup();
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'owner@demo.shop', password: 'nope' } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'owner@demo.shop', password: 'Owner@12345' } });
    const c = ok.cookies[0]!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Strict');
  });

  it('rejects form-encoded bodies (no CSRF via HTML forms)', async () => {
    const { app } = await setup();
    const cookie = await login(app, 'owner');
    const res = await app.inject({ method: 'POST', url: '/api/categories', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'name=Hack' });
    expect(res.statusCode).toBe(415);
  });

  it('deactivating a user revokes their existing session immediately', async () => {
    const { app, db } = await setup();
    const owner = await login(app, 'owner');
    const cashier = await login(app, 'cashier');
    const id = (db.prepare("SELECT id FROM users WHERE email = 'cashier@demo.shop'").get() as { id: number }).id;
    expect((await app.inject({ url: '/api/products', headers: { cookie: cashier } })).statusCode).toBe(200);
    await app.inject({ method: 'PATCH', url: `/api/users/${id}`, headers: { cookie: owner }, payload: { active: false } });
    expect((await app.inject({ url: '/api/products', headers: { cookie: cashier } })).statusCode).toBe(401);
  });

  it('changing password signs out other sessions', async () => {
    const { app } = await setup();
    const a = await login(app, 'manager');
    const b = await login(app, 'manager');
    const res = await app.inject({ method: 'POST', url: '/api/auth/password', headers: { cookie: a }, payload: { currentPassword: 'Manager@123', newPassword: 'NewPassword#1' } });
    expect(res.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/auth/me', headers: { cookie: b } })).statusCode).toBe(401);
  });

  it('rate limits login attempts', async () => {
    const { app } = await setup();
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'x@y.co', password: 'bad' } })).statusCode;
    expect(last).toBe(429);
  });
});

describe('role-based access', () => {
  it('cashiers cannot manage products, stock, users or reports', async () => {
    const { app } = await setup();
    const cookie = await login(app, 'cashier');
    const calls: [string, string, object?][] = [
      ['POST', '/api/products', { sku: 'A', name: 'A', sellPrice: 1 }],
      ['POST', '/api/inventory/adjust', { productId: 1, qty: 1, note: 'x' }],
      ['GET', '/api/users'],
      ['GET', '/api/reports/summary?from=2026-01-01&to=2026-01-02'],
      ['POST', '/api/sales/1/void', { reason: 'x' }],
    ];
    for (const [method, url, payload] of calls) {
      const res = await app.inject({ method: method as 'GET', url, headers: { cookie }, payload });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('cashiers do not see cost prices and only see their own sales', async () => {
    const { app, db } = await setup();
    const cookie = await login(app, 'cashier');
    const products = (await app.inject({ url: '/api/products', headers: { cookie } })).json();
    expect(products[0]).not.toHaveProperty('cost_price');
    const me = (db.prepare("SELECT id FROM users WHERE email = 'cashier@demo.shop'").get() as { id: number }).id;
    const sales = (await app.inject({ url: '/api/sales', headers: { cookie } })).json();
    expect(sales.total).toBeGreaterThan(0);
    const owners = db.prepare('SELECT DISTINCT user_id FROM sales WHERE id IN (' + sales.rows.map((r: { id: number }) => r.id).join(',') + ')').all();
    expect(owners).toEqual([{ user_id: me }]);
    const other = db.prepare('SELECT id FROM sales WHERE user_id <> ? LIMIT 1').get(me) as { id: number };
    expect((await app.inject({ url: `/api/sales/${other.id}`, headers: { cookie } })).statusCode).toBe(404);
  });

  it('managers can void but not manage users', async () => {
    const { app } = await setup();
    const cookie = await login(app, 'manager');
    expect((await app.inject({ url: '/api/users', headers: { cookie } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/reports/inventory', headers: { cookie } })).statusCode).toBe(200);
  });

  it('owners cannot lock themselves out', async () => {
    const { app, db } = await setup();
    const cookie = await login(app, 'owner');
    const id = (db.prepare("SELECT id FROM users WHERE role = 'owner'").get() as { id: number }).id;
    expect((await app.inject({ method: 'PATCH', url: `/api/users/${id}`, headers: { cookie }, payload: { active: false } })).statusCode).toBe(400);
  });
});

describe('reports and export', () => {
  it('summary totals agree with the raw sales table', async () => {
    const { app, db } = await setup();
    const cookie = await login(app, 'owner');
    const r = (await app.inject({ url: '/api/reports/summary?from=2000-01-01&to=2100-01-01', headers: { cookie } })).json();
    const raw = db.prepare("SELECT COUNT(*) AS n, SUM(total) AS t FROM sales WHERE status = 'completed'").get() as { n: number; t: number };
    expect(r.sales).toBe(raw.n);
    expect(r.revenue).toBe(raw.t);
    expect(r.daily.reduce((s: number, d: { revenue: number }) => s + d.revenue, 0)).toBe(raw.t);
    expect(r.byPayment.reduce((s: number, d: { revenue: number }) => s + d.revenue, 0)).toBe(raw.t);
  });

  it('inventory valuation and low-stock list', async () => {
    const { app } = await setup();
    const cookie = await login(app, 'manager');
    const inv = (await app.inject({ url: '/api/reports/inventory', headers: { cookie } })).json();
    expect(inv.retail_value).toBeGreaterThan(inv.cost_value);
    for (const p of inv.lowStock) expect(p.on_hand).toBeLessThanOrEqual(p.reorder_level);
  });

  it('CSV export neutralises formula injection', async () => {
    const { app, db } = await setup();
    db.prepare("UPDATE sales SET customer_name = '=HYPERLINK(\"x\")' WHERE id = 1").run();
    const cookie = await login(app, 'owner');
    const res = await app.inject({ url: '/api/sales/export.csv', headers: { cookie } });
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.body).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('serves OpenAPI documentation', async () => {
    const { app } = await setup();
    const res = await app.inject({ url: '/api/docs/json' });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().paths)).toContain('/api/sales');
  });
});

describe('static web app', () => {
  it('serves index.html for client routes but 404s for missing API routes and assets', async () => {
    const { mkdtempSync, writeFileSync, mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
    const { openDb } = await import('../src/db/index.js');
    const { buildApp } = await import('../src/app.js');
    const { config } = await import('./helpers.js');
    const app = await buildApp(openDb(':memory:'), { ...config, webDist: dir });
    expect((await app.inject({ url: '/pos' })).body).toContain('id="root"');
    expect((await app.inject({ url: '/api/nope' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/assets/missing.js' })).statusCode).toBe(404);
  });
});
