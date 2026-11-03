-- Sales & Inventory Management System — SQLite schema
-- Money is stored as INTEGER kobo (1 naira = 100 kobo) to avoid floating-point errors.
-- Stock on hand is never stored: it is the sum of the stock_movements ledger.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'cashier')),
  active        INTEGER NOT NULL DEFAULT 1,
  token_version INTEGER NOT NULL DEFAULT 0,   -- bump to revoke all sessions
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY,
  sku           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  barcode       TEXT UNIQUE,
  name          TEXT NOT NULL,
  category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  unit          TEXT NOT NULL DEFAULT 'pcs',
  cost_price    INTEGER NOT NULL CHECK (cost_price >= 0),   -- weighted average, kobo
  sell_price    INTEGER NOT NULL CHECK (sell_price >= 0),   -- kobo
  reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT
);

CREATE TABLE IF NOT EXISTS purchases (
  id          INTEGER PRIMARY KEY,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  reference   TEXT,
  total_cost  INTEGER NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales (
  id             INTEGER PRIMARY KEY,
  receipt_no     TEXT UNIQUE,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  customer_name  TEXT,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'transfer', 'card')),
  subtotal       INTEGER NOT NULL,
  discount       INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total          INTEGER NOT NULL CHECK (total >= 0),
  amount_paid    INTEGER NOT NULL,
  change_due     INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided')),
  voided_by      INTEGER REFERENCES users(id),
  voided_at      TEXT,
  void_reason    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sale_items (
  id         INTEGER PRIMARY KEY,
  sale_id    INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  name       TEXT NOT NULL,              -- snapshot at time of sale
  qty        INTEGER NOT NULL CHECK (qty > 0),
  unit_price INTEGER NOT NULL,
  unit_cost  INTEGER NOT NULL,           -- cost at time of sale, for profit
  line_total INTEGER NOT NULL
);

-- The inventory ledger. qty is signed: +in, -out. Rows are never updated or deleted.
CREATE TABLE IF NOT EXISTS stock_movements (
  id         INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  type       TEXT NOT NULL CHECK (type IN ('opening', 'receive', 'sale', 'void', 'adjust')),
  qty        INTEGER NOT NULL CHECK (qty <> 0),
  unit_cost  INTEGER,
  ref_id     INTEGER,                    -- purchase id or sale id
  note       TEXT,
  user_id    INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIEW IF NOT EXISTS product_stock AS
  SELECT p.id AS product_id, COALESCE(SUM(m.qty), 0) AS on_hand
  FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id
  GROUP BY p.id;

CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_created     ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale   ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_prod   ON sale_items(product_id);
