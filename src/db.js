const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id             INTEGER PRIMARY KEY,
  type           TEXT NOT NULL CHECK (type IN ('account', 'individual')),
  name           TEXT NOT NULL,
  phone          TEXT,
  email          TEXT,
  address        TEXT,
  plate          TEXT,
  credit_limit   REAL NOT NULL DEFAULT 0,
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  login         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('manager', 'attendant', 'customer')),
  customer_id   INTEGER UNIQUE REFERENCES customers(id),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  price  REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS price_history (
  id         INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  price      REAL NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id    INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS tanks (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  capacity   REAL NOT NULL,
  low_level  REAL NOT NULL DEFAULT 0,
  book_stock REAL NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pumps (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS nozzles (
  id      INTEGER PRIMARY KEY,
  pump_id INTEGER NOT NULL REFERENCES pumps(id),
  tank_id INTEGER NOT NULL REFERENCES tanks(id),
  name    TEXT NOT NULL,
  meter   REAL NOT NULL DEFAULT 0,
  active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS shifts (
  id              INTEGER PRIMARY KEY,
  attendant_id    INTEGER NOT NULL REFERENCES users(id),
  status          TEXT NOT NULL CHECK (status IN ('open', 'closed', 'validated')),
  opened_at       TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at       TEXT,
  cash            REAL,
  card            REAL,
  total_liters    REAL,
  total_amount    REAL,
  credit_amount   REAL,
  expected_amount REAL,
  variance        REAL,
  notes           TEXT,
  validated_by    INTEGER REFERENCES users(id),
  validated_at    TEXT,
  manager_comment TEXT
);

CREATE TABLE IF NOT EXISTS shift_readings (
  id          INTEGER PRIMARY KEY,
  shift_id    INTEGER NOT NULL REFERENCES shifts(id),
  nozzle_id   INTEGER NOT NULL REFERENCES nozzles(id),
  product_id  INTEGER NOT NULL REFERENCES products(id),
  tank_id     INTEGER NOT NULL REFERENCES tanks(id),
  unit_price  REAL NOT NULL,
  start_meter REAL NOT NULL,
  end_meter   REAL,
  liters      REAL,
  amount      REAL,
  UNIQUE (shift_id, nozzle_id)
);

CREATE TABLE IF NOT EXISTS sales (
  id          INTEGER PRIMARY KEY,
  shift_id    INTEGER NOT NULL REFERENCES shifts(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  nozzle_id   INTEGER NOT NULL REFERENCES nozzles(id),
  product_id  INTEGER NOT NULL REFERENCES products(id),
  kind        TEXT NOT NULL CHECK (kind IN ('credit', 'loyalty')),
  liters      REAL NOT NULL,
  unit_price  REAL NOT NULL,
  amount      REAL NOT NULL,
  points      INTEGER NOT NULL DEFAULT 0,
  plate       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  amount      REAL NOT NULL,
  method      TEXT NOT NULL,
  reference   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  user_id     INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS deliveries (
  id              INTEGER PRIMARY KEY,
  tank_id         INTEGER NOT NULL REFERENCES tanks(id),
  supplier        TEXT,
  reference       TEXT,
  liters_ordered  REAL NOT NULL,
  liters_received REAL NOT NULL,
  unit_cost       REAL,
  book_before     REAL NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  user_id         INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS dips (
  id         INTEGER PRIMARY KEY,
  tank_id    INTEGER NOT NULL REFERENCES tanks(id),
  measured   REAL NOT NULL,
  book_stock REAL NOT NULL,
  variance   REAL NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id    INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_shifts_closed ON shifts(closed_at);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_shift ON sales(shift_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
`;

const DEFAULT_SETTINGS = {
  station_name: 'Ma station',
  cash_tolerance: '1',
  stock_tolerance: '20',
  points_per_liter: '1',
};

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insert.run(key, value);
  return db;
}

function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    stationName: s.station_name,
    cashTolerance: Number(s.cash_tolerance),
    stockTolerance: Number(s.stock_tolerance),
    pointsPerLiter: Number(s.points_per_liter),
  };
}

module.exports = { openDb, getSettings };
