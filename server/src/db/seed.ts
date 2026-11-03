/**
 * Demo data: a fictional neighbourhood supermarket with 30 days of trading history.
 * Deterministic (seeded RNG) so tests and screenshots are reproducible.
 *
 *   npm run seed            refuses if the database already has users
 *   npm run seed -- --force wipes and recreates
 */
import { rmSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { openDb, type DB } from './index.js';
import { loadConfig } from '../config.js';
import { createSale, voidSale } from '../modules/sales/service.js';
import { receiveStock } from '../modules/inventory/service.js';

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N = (naira: number) => Math.round(naira * 100);

// [sku, name, category, unit, cost ₦, price ₦, reorder, opening stock, popularity]
const PRODUCTS: [string, string, string, string, number, number, number, number, number][] = [
  ['GRC-001', 'Parboiled Rice 5kg', 'Groceries', 'bag', 7800, 9200, 10, 60, 6],
  ['GRC-002', 'Spaghetti 500g', 'Groceries', 'pack', 950, 1200, 40, 220, 9],
  ['GRC-003', 'Semolina 1kg', 'Groceries', 'pack', 1650, 2000, 20, 90, 5],
  ['GRC-004', 'Instant Noodles 70g', 'Groceries', 'pcs', 260, 350, 100, 900, 10],
  ['GRC-005', 'White Garri 2kg', 'Groceries', 'bag', 2300, 2800, 15, 70, 5],
  ['GRC-006', 'Honey Beans 1kg', 'Groceries', 'bag', 2100, 2600, 15, 60, 4],
  ['PRV-001', 'Granulated Sugar 1kg', 'Provisions', 'pack', 1500, 1850, 25, 120, 6],
  ['PRV-002', 'Evaporated Milk 160g', 'Provisions', 'tin', 620, 800, 60, 400, 8],
  ['PRV-003', 'Tomato Paste 210g', 'Provisions', 'tin', 480, 650, 50, 260, 7],
  ['PRV-004', 'Vegetable Oil 3L', 'Provisions', 'bottle', 6200, 7300, 10, 45, 4],
  ['PRV-005', 'Seasoning Cubes (100)', 'Provisions', 'pack', 1900, 2400, 20, 80, 5],
  ['PRV-006', 'Chocolate Drink 500g', 'Provisions', 'tin', 3100, 3800, 12, 50, 3],
  ['BEV-001', 'Table Water 75cl (12)', 'Beverages', 'pack', 1450, 1900, 20, 110, 7],
  ['BEV-002', 'Malt Drink 33cl', 'Beverages', 'can', 520, 700, 48, 300, 8],
  ['BEV-003', 'Soft Drink 50cl', 'Beverages', 'bottle', 330, 450, 48, 360, 9],
  ['BEV-004', 'Fruit Juice 1L', 'Beverages', 'carton', 1600, 2100, 15, 60, 4],
  ['HSE-001', 'Laundry Detergent 900g', 'Household', 'pack', 2200, 2750, 15, 70, 4],
  ['HSE-002', 'Dishwashing Liquid 750ml', 'Household', 'bottle', 1300, 1700, 15, 55, 3],
  ['HSE-003', 'Toilet Tissue (4 rolls)', 'Household', 'pack', 1500, 1950, 20, 80, 5],
  ['HSE-004', 'Insecticide Spray 300ml', 'Household', 'can', 2600, 3200, 8, 24, 2],
  ['PCR-001', 'Toothpaste 140g', 'Personal care', 'tube', 1100, 1450, 20, 75, 4],
  ['PCR-002', 'Bathing Soap 150g', 'Personal care', 'bar', 520, 700, 30, 140, 5],
  ['PCR-003', 'Body Lotion 400ml', 'Personal care', 'bottle', 3300, 4100, 8, 20, 2],
  ['PCR-004', 'Sanitary Pads (10)', 'Personal care', 'pack', 900, 1200, 20, 30, 3],
];

export const DEMO_USERS = {
  owner: { email: 'owner@demo.shop', password: 'Owner@12345' },
  manager: { email: 'manager@demo.shop', password: 'Manager@123' },
  cashier: { email: 'cashier@demo.shop', password: 'Cashier@123' },
};

export function seed(db: DB, { days = 30, now = new Date() } = {}) {
  const rand = rng(20261103);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;

  const hash = (pw: string) => bcrypt.hashSync(pw, 10);
  const addUser = (name: string, email: string, role: string, pw: string) =>
    Number(db.prepare('INSERT INTO users (name, email, role, password_hash) VALUES (?, ?, ?, ?)').run(name, email, role, hash(pw)).lastInsertRowid);
  const owner = addUser('Ngozi Adebayo', DEMO_USERS.owner.email, 'owner', DEMO_USERS.owner.password);
  const manager = addUser('Ibrahim Danladi', DEMO_USERS.manager.email, 'manager', DEMO_USERS.manager.password);
  const cashiers = [
    addUser('Blessing Okon', DEMO_USERS.cashier.email, 'cashier', DEMO_USERS.cashier.password),
    addUser('Yusuf Abdullahi', 'yusuf@demo.shop', 'cashier', DEMO_USERS.cashier.password),
  ];

  const supplierIds = ['Kano Wholesale Distributors', 'Lagos FMCG Depot', 'Bauchi Provisions Ltd'].map((n, i) =>
    Number(db.prepare('INSERT INTO suppliers (name, phone) VALUES (?, ?)').run(n, `080300000${i + 1}0`).lastInsertRowid));

  const catId = new Map<string, number>();
  for (const c of new Set(PRODUCTS.map((p) => p[2]))) catId.set(c, Number(db.prepare('INSERT INTO categories (name) VALUES (?)').run(c).lastInsertRowid));

  const start = new Date(now.getTime() - days * 86400_000);
  const stamp = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
  const setTime = (table: string, id: number, when: Date) => db.prepare(`UPDATE ${table} SET created_at = ? WHERE id = ?`).run(stamp(when), id);

  const products = PRODUCTS.map(([sku, name, cat, unit, cost, price, reorder, opening, pop], i) => {
    const pid = Number(db.prepare(`INSERT INTO products (sku, barcode, name, category_id, unit, cost_price, sell_price, reorder_level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(sku, `6150000${String(i + 1).padStart(5, '0')}`, name, catId.get(cat), unit, N(cost), N(price), reorder).lastInsertRowid);
    const mv = Number(db.prepare("INSERT INTO stock_movements (product_id, type, qty, unit_cost, note, user_id) VALUES (?, 'opening', ?, ?, 'Opening stock', ?)")
      .run(pid, opening, N(cost), owner).lastInsertRowid);
    setTime('stock_movements', mv, start);
    return { id: pid, cost: N(cost), pop, opening, reorder };
  });
  const weighted = products.flatMap((p) => Array(p.pop).fill(p) as typeof products);

  db.transaction(() => {
    for (let d = 0; d <= days; d++) { // the last iteration is today, up to the current time
      const day = new Date(start.getTime() + d * 86400_000);
      const weekend = [0, 6].includes(day.getUTCDay());

      // Weekly restock on Mondays for items that are running down (some deliberately left low)
      if (day.getUTCDay() === 1) {
        const lines = products
          .filter((p, i) => i % 7 !== 3) // never restock a few lines, so low-stock alerts appear
          .map((p) => ({ productId: p.id, qty: Math.round(p.opening * 0.5), unitCost: Math.round(p.cost * (1 + (rand() - 0.3) * 0.06)) }));
        const { purchaseId } = receiveStock(db, { supplierId: pick(supplierIds), reference: `DN-${1000 + d}`, lines }, manager);
        const when = new Date(day); when.setUTCHours(7, 30);
        setTime('purchases', purchaseId, when);
        db.prepare("UPDATE stock_movements SET created_at = ? WHERE type = 'receive' AND ref_id = ?").run(stamp(when), purchaseId);
      }

      const count = Math.round((weekend ? 34 : 24) + rand() * 12 + d * 0.3);
      for (let s = 0; s < count; s++) {
        const lineCount = 1 + Math.floor(rand() * 4);
        const items = new Map<number, number>();
        for (let l = 0; l < lineCount; l++) {
          const p = pick(weighted);
          items.set(p.id, (items.get(p.id) ?? 0) + 1 + Math.floor(rand() * (p.pop > 7 ? 4 : 2)));
        }
        const method = rand() < 0.45 ? 'cash' : rand() < 0.75 ? 'transfer' : 'card';
        try {
          const sale = createSale(db, {
            items: [...items].map(([productId, qty]) => ({ productId, qty })),
            paymentMethod: method, discount: 0, amountPaid: 100_000_000, customerName: rand() < 0.1 ? pick(['Mama Chidi', 'Alhaji Sule', 'Mrs. Bello', 'Tunde']) : undefined,
          }, pick(cashiers));
          if (method === 'cash') {
            const paid = Math.ceil(sale.total / 50000) * 50000; // customers pay in round ₦500s
            db.prepare('UPDATE sales SET amount_paid = ?, change_due = ? WHERE id = ?').run(paid, paid - sale.total, sale.id);
          }
          const when = new Date(day); when.setUTCHours(7 + Math.floor(rand() * 13), Math.floor(rand() * 60), Math.floor(rand() * 60));
          if (when > now) when.setTime(now.getTime() - Math.floor(rand() * 3600_000)); // today: keep sales in the past
          setTime('sales', sale.id, when);
          db.prepare("UPDATE stock_movements SET created_at = ? WHERE type = 'sale' AND ref_id = ?").run(stamp(when), sale.id);
          if (rand() < 0.012) {
            voidSale(db, sale.id, pick(['Customer changed mind', 'Wrong item scanned', 'Duplicate sale']), manager);
            db.prepare("UPDATE stock_movements SET created_at = ? WHERE type = 'void' AND ref_id = ?").run(stamp(when), sale.id);
            db.prepare('UPDATE sales SET voided_at = ? WHERE id = ?').run(stamp(when), sale.id);
          }
        } catch {
          // out of stock for this basket — the shopper leaves; fine for demo data
        }
      }
    }
  })();
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  const config = loadConfig({ ...process.env, JWT_SECRET: process.env.JWT_SECRET || 'x'.repeat(32) });
  if (process.argv.includes('--force')) for (const ext of ['', '-wal', '-shm']) rmSync(config.dbPath + ext, { force: true });
  const db = openDb(config.dbPath);
  if ((db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n > 0) {
    console.error('Database already has data. Use `npm run seed -- --force` to wipe and reseed.');
    process.exit(1);
  }
  seed(db);
  const n = (db.prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number }).n;
  console.log(`Demo data created in ${config.dbPath} (${n} sales over 30 days)`);
  for (const [role, u] of Object.entries(DEMO_USERS)) console.log(`  ${role.padEnd(8)} ${u.email} / ${u.password}`);
  db.close();
}
