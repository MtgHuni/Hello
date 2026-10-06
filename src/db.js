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
  type           TEXT NOT NULL CHECK (type IN ('account', 'individual')), -- account = abonné, individual = particulier
  name           TEXT NOT NULL,
  phone          TEXT,
  email          TEXT,
  address        TEXT,
  plate          TEXT,
  credit_limit   REAL NOT NULL DEFAULT 0, -- copied from the settings of the customer's category
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  login         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('manager', 'attendant', 'customer', 'owner', 'admin')),
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
  active INTEGER NOT NULL DEFAULT 1,
  subscriber_price REAL
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
  combo_amount    REAL,
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
  subscriber_price REAL,
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
  kind        TEXT NOT NULL CHECK (kind IN ('paid', 'credit', 'combo')),
  liters      REAL NOT NULL,
  unit_price  REAL NOT NULL,
  amount      REAL NOT NULL,
  points      INTEGER NOT NULL DEFAULT 0, -- combos awarded (a credit sale's only once fully paid)
  plate       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  over_limit  INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT 'attendant',
  points_due  INTEGER NOT NULL DEFAULT 0, -- combos earned by the litres bought
  combos_used INTEGER NOT NULL DEFAULT 0  -- combos spent (kind = 'combo')
);

-- Purchase started by a customer from their phone; becomes a sale once
-- an attendant confirms it.
CREATE TABLE IF NOT EXISTS purchase_requests (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  product_id  INTEGER NOT NULL REFERENCES products(id),
  liters      REAL,
  amount      REAL,
  payment     TEXT NOT NULL CHECK (payment IN ('paid', 'credit', 'combo')),
  plate       TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected', 'cancelled')),
  sale_id     INTEGER REFERENCES sales(id),
  handled_by  INTEGER REFERENCES users(id),
  handled_at  TEXT,
  note        TEXT,
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

CREATE TABLE IF NOT EXISTS expenses (
  id           INTEGER PRIMARY KEY,
  expense_date TEXT NOT NULL,
  category     TEXT NOT NULL,
  amount       REAL NOT NULL,
  description  TEXT NOT NULL,
  beneficiary  TEXT,
  method       TEXT NOT NULL,
  reference    TEXT,
  shift_id     INTEGER REFERENCES shifts(id),
  user_id      INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Debt a customer had before the app (the station's notebook): counted in the balance,
-- settled first by payments. Entered by the manager, or declared at the pump with a payment.
CREATE TABLE IF NOT EXISTS old_debts (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  amount      REAL NOT NULL CHECK (amount > 0),
  note        TEXT,
  shift_id    INTEGER REFERENCES shifts(id),
  user_id     INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_old_debts_customer ON old_debts(customer_id);

-- Cash book (src/cashbook.js): movements entered by hand on the cash or mobile money balance,
-- counts of the till, and payments of deliveries taken on credit.
CREATE TABLE IF NOT EXISTS cash_movements (
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL,
  account    TEXT NOT NULL CHECK (account IN ('cash', 'momo')),
  amount     REAL NOT NULL CHECK (amount >= 0),
  note       TEXT,
  user_id    INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS cash_counts (
  id         INTEGER PRIMARY KEY,
  account    TEXT NOT NULL CHECK (account IN ('cash', 'momo')),
  counted    REAL NOT NULL,
  book       REAL NOT NULL,
  note       TEXT,
  user_id    INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS supplier_payments (
  id         INTEGER PRIMARY KEY,
  supplier   TEXT NOT NULL,
  amount     REAL NOT NULL CHECK (amount > 0),
  method     TEXT NOT NULL,
  reference  TEXT,
  user_id    INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One shift runs from the 15:30 closing to the next, across the night (station closed 19:00–6:30).
-- Several attendants can be on it at once; they come and go (left_at: relief or evening closing).
CREATE TABLE IF NOT EXISTS shift_attendants (
  id        INTEGER PRIMARY KEY,
  shift_id  INTEGER NOT NULL REFERENCES shifts(id),
  user_id   INTEGER NOT NULL REFERENCES users(id),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  left_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_shift_attendants ON shift_attendants(shift_id, user_id);
-- Checkpoints inside a shift (src/checkpoints.js): relief, evening closing, morning opening,
-- each with every nozzle's index and the money passed on.
CREATE TABLE IF NOT EXISTS shift_checkpoints (
  id           INTEGER PRIMARY KEY,
  shift_id     INTEGER NOT NULL REFERENCES shifts(id),
  kind         TEXT NOT NULL CHECK (kind IN ('releve', 'fermeture', 'ouverture')),
  user_id      INTEGER REFERENCES users(id),
  cash         REAL NOT NULL DEFAULT 0,
  mobile_money REAL NOT NULL DEFAULT 0,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Fuel paid by mobile money, entered as it is paid (litres of one product at the shift's price):
-- the shift's mobile money is their total, plus the payments received by mobile money.
CREATE TABLE IF NOT EXISTS momo_sales (
  id                  INTEGER PRIMARY KEY,
  shift_id            INTEGER NOT NULL REFERENCES shifts(id),
  product_id          INTEGER NOT NULL REFERENCES products(id),
  liters              REAL NOT NULL CHECK (liters > 0),
  unit_price          REAL NOT NULL,
  amount              REAL NOT NULL,
  user_id             INTEGER REFERENCES users(id),
  client_ref          TEXT,
  cancel_requested_at TEXT,
  cancel_requested_by INTEGER REFERENCES users(id),
  cancel_reason       TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_momo_sales_shift ON momo_sales(shift_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_momo_sales_ref ON momo_sales(client_ref) WHERE client_ref IS NOT NULL;
-- Pump tests: fuel drawn at the pump (calibration…) and poured back into the tank. The meter
-- counted it: once the manager approves, these litres are not sold and stay in the tank.
CREATE TABLE IF NOT EXISTS pump_tests (
  id          INTEGER PRIMARY KEY,
  shift_id    INTEGER NOT NULL REFERENCES shifts(id),
  nozzle_id   INTEGER NOT NULL REFERENCES nozzles(id),
  liters      REAL NOT NULL CHECK (liters > 0),
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  user_id     INTEGER REFERENCES users(id),
  decided_by  INTEGER REFERENCES users(id),
  decided_at  TEXT,
  client_ref  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pump_tests_shift ON pump_tests(shift_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pump_tests_ref ON pump_tests(client_ref) WHERE client_ref IS NOT NULL;
-- Each tank at a shift's closing: litres sold from it and the book stock left (for the report).
CREATE TABLE IF NOT EXISTS shift_tank_stock (
  shift_id    INTEGER NOT NULL REFERENCES shifts(id),
  tank_id     INTEGER NOT NULL REFERENCES tanks(id),
  sold        REAL NOT NULL DEFAULT 0,
  stock_after REAL NOT NULL,
  PRIMARY KEY (shift_id, tank_id)
);
-- Relief reports each attendant has seen: the others get the report on their phone, even on duty.
CREATE TABLE IF NOT EXISTS checkpoint_seen (
  checkpoint_id INTEGER NOT NULL REFERENCES shift_checkpoints(id),
  user_id       INTEGER NOT NULL REFERENCES users(id),
  seen_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (checkpoint_id, user_id)
);
-- The dashboard's alerts as each user wants them (src/alerts.js): types switched off, alerts hidden
-- until their text changes.
CREATE TABLE IF NOT EXISTS alert_prefs (
  user_id INTEGER NOT NULL REFERENCES users(id),
  type    TEXT NOT NULL,
  PRIMARY KEY (user_id, type)
);
CREATE TABLE IF NOT EXISTS alert_hidden (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  key        TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key)
);
-- Suppliers and their contacts (deliveries and payments name them by their supplier column).
CREATE TABLE IF NOT EXISTS suppliers (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone      TEXT,
  email      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Meter indexes read during the open shift by a delivery or a dip: the fuel already sold
-- (latest index - opening index) is taken off the tank before the closing (src/liveStock.js).
CREATE TABLE IF NOT EXISTS stock_readings (
  id         INTEGER PRIMARY KEY,
  shift_id   INTEGER NOT NULL REFERENCES shifts(id),
  nozzle_id  INTEGER NOT NULL REFERENCES nozzles(id),
  meter      REAL NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('delivery', 'dip')),
  source_id  INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS checkpoint_readings (
  checkpoint_id INTEGER NOT NULL REFERENCES shift_checkpoints(id),
  nozzle_id     INTEGER NOT NULL REFERENCES nozzles(id),
  meter         REAL NOT NULL,
  PRIMARY KEY (checkpoint_id, nozzle_id)
);

-- E-mails (src/mail.js): every message, sent or only noted when Resend is not configured.
CREATE TABLE IF NOT EXISTS mail_log (
  id          INTEGER PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  kind        TEXT NOT NULL,
  to_addr     TEXT NOT NULL,
  subject     TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  error       TEXT,
  provider_id TEXT,
  user_id     INTEGER REFERENCES users(id),
  customer_id INTEGER REFERENCES customers(id)
);
CREATE INDEX IF NOT EXISTS idx_mail_log_created ON mail_log(created_at);
-- Mails each person switched off (src/mailer.js MAIL_KINDS): by account, and by customer record
-- (a customer without a login still gets receipts and statements).
CREATE TABLE IF NOT EXISTS mail_prefs (
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind    TEXT NOT NULL,
  PRIMARY KEY (user_id, kind)
);
CREATE TABLE IF NOT EXISTS customer_mail_prefs (
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  kind        TEXT NOT NULL,
  PRIMARY KEY (customer_id, kind)
);
-- One-time links sent by mail: password reset (1 hour), address confirmation (7 days).
CREATE TABLE IF NOT EXISTS mail_tokens (
  token_hash  TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('reset', 'verify')),
  user_id     INTEGER REFERENCES users(id),
  customer_id INTEGER REFERENCES customers(id),
  email       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);
-- Scheduled mails already done (a report, a statement, a reminder) and how far the event mails
-- (receipts, credits, prices) have read their table.
CREATE TABLE IF NOT EXISTS mail_jobs (
  job     TEXT PRIMARY KEY,
  done_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS mail_cursors (
  name    TEXT PRIMARY KEY,
  last_id INTEGER NOT NULL
);
-- Dashboard alerts already mailed to each person: an alert goes once, again only if it comes back.
CREATE TABLE IF NOT EXISTS mail_alerts_sent (
  user_id INTEGER NOT NULL REFERENCES users(id),
  key     TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
-- Devices each person signed in from (cookie « did »): a new one sends « Nouvelle connexion ».
CREATE TABLE IF NOT EXISTS known_devices (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  device_hash TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, device_hash)
);

-- Journal: who changed what (see src/audit.js).
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id    INTEGER REFERENCES users(id),
  category   TEXT NOT NULL,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  INTEGER,
  summary    TEXT NOT NULL,
  before     TEXT, -- JSON
  after      TEXT, -- JSON
  reason     TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_log(category);

CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_shifts_closed ON shifts(closed_at);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_shift ON sales(shift_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
`;

// Columns added after the first release: applied to existing databases on start.
const MIGRATIONS = [
  ['customers', 'needs_review', 'INTEGER NOT NULL DEFAULT 0'],
  ['customers', 'created_by', 'INTEGER REFERENCES users(id)'],
  ['sales', 'over_limit', 'INTEGER NOT NULL DEFAULT 0'],
  ['sales', 'source', "TEXT NOT NULL DEFAULT 'attendant'"],
  ['sales', 'points_due', 'INTEGER NOT NULL DEFAULT 0'],
  ['sales', 'combos_used', 'INTEGER NOT NULL DEFAULT 0'],
  ['products', 'subscriber_price', 'REAL'],
  ['shift_readings', 'subscriber_price', 'REAL'],
  ['shifts', 'combo_amount', 'REAL'],
  ['payments', 'shift_id', 'INTEGER REFERENCES shifts(id)'],
  ['shifts', 'payments_amount', 'REAL'],
  ['shifts', 'expenses_amount', 'REAL'],
  // Cancellation asked by the attendant, pending the manager's decision.
  ['sales', 'cancel_requested_at', 'TEXT'],
  ['sales', 'cancel_requested_by', 'INTEGER REFERENCES users(id)'],
  ['sales', 'cancel_reason', 'TEXT'],
  ['payments', 'cancel_requested_at', 'TEXT'],
  ['payments', 'cancel_requested_by', 'INTEGER REFERENCES users(id)'],
  ['payments', 'cancel_reason', 'TEXT'],
  ['expenses', 'cancel_requested_at', 'TEXT'],
  ['expenses', 'cancel_requested_by', 'INTEGER REFERENCES users(id)'],
  ['expenses', 'cancel_reason', 'TEXT'],
  ['price_history', 'subscriber_price', 'REAL'],
  // Money handed over at closing besides cash, in dollars.
  ['shifts', 'mobile_money', 'REAL'],
  // Price change scheduled for a date (src/prices.js).
  ['products', 'next_price', 'REAL'],
  ['products', 'next_subscriber_price', 'REAL'],
  ['products', 'next_price_at', 'TEXT'],
  ['products', 'next_price_by', 'INTEGER REFERENCES users(id)'],
  // Key sent by the attendant's form: sending it again returns the first record (no duplicate).
  ['sales', 'client_ref', 'TEXT'],
  ['payments', 'client_ref', 'TEXT'],
  ['expenses', 'client_ref', 'TEXT'],
  // Manager's remark on a closed shift, read by the attendant in their history.
  ['shifts', 'manager_comment_at', 'TEXT'],
  ['shifts', 'manager_comment_by', 'INTEGER REFERENCES users(id)'],
  ['shifts', 'comment_seen_at', 'TEXT'],
  // Delivery paid on the spot ('cash', from pay_method) or taken on credit from the supplier.
  ['deliveries', 'payment', 'TEXT'],
  ['deliveries', 'amount', 'REAL'],
  ['deliveries', 'pay_method', 'TEXT'],
  // Evening closing: the shift stays open, nothing is entered until the morning opening.
  ['shifts', 'station_closed_at', 'TEXT'],
  // Change (monnaie) left with the attendants at the closing, received by the next shift.
  ['shifts', 'change_left', 'REAL NOT NULL DEFAULT 0'],
  ['shifts', 'change_received', 'REAL NOT NULL DEFAULT 0'],
  ['shifts', 'counted_at', 'TEXT'], // the money counted after the closing (null: still to count)
  // Who entered the credit (several attendants share a shift).
  ['sales', 'user_id', 'INTEGER REFERENCES users(id)'],
  // Each subscriber's payment day: the month is paid before this day of the next month.
  ['customers', 'payment_day', 'INTEGER'],
  // E-mail of the team (a customer's is on their record), confirmed by a link (version 22).
  ['users', 'email', 'TEXT'],
  ['users', 'email_verified_at', 'TEXT'],
  ['customers', 'email_verified_at', 'TEXT'],
  // A delivery paid with the open shift's money: its expense on that shift (version 23).
  ['deliveries', 'expense_id', 'INTEGER REFERENCES expenses(id)'],
];

// Bumped with every schema change; recorded in PRAGMA user_version.
const SCHEMA_VERSION = 23;

function missingColumns(db) {
  return MIGRATIONS.filter(([table, column]) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    return !columns.includes(column);
  });
}

// All or nothing: a failed ALTER leaves the database as it was.
function addMissingColumns(db) {
  const missing = missingColumns(db);
  if (!missing.length) return;
  db.exec('BEGIN');
  try {
    for (const [table, column, definition] of missing) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const tableSql = (db, name) => db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)?.sql;

// Before changing a database that holds data, a full copy is kept next to it
// (station.db.avant-migration-AAAA-MM-JJ-HHMMSS), to roll back by hand if needed.
function backupBeforeMigration(db, file) {
  const outdated =
    db.prepare('PRAGMA user_version').get().user_version < SCHEMA_VERSION ||
    missingColumns(db).length > 0 || !tableSql(db, 'sales').includes("'combo'") || !(tableSql(db, 'purchase_requests') || "'combo'").includes("'combo'");
  const hasData = db.prepare('SELECT EXISTS (SELECT 1 FROM users) OR EXISTS (SELECT 1 FROM sales) AS v').get().v;
  if (!outdated || !hasData) return null;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  // Two updates in the same second (a restart loop) must not collide: VACUUM INTO never overwrites.
  let copy = `${file}.avant-migration-${stamp}`;
  for (let n = 2; fs.existsSync(copy); n++) copy = `${file}.avant-migration-${stamp}-${n}`;
  db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
  console.log(`Base sauvegardée avant mise à jour : ${copy}`);
  return copy;
}

const EXPENSE_CATEGORIES = [
  'Salaires',
  'Électricité',
  'Générateur',
  'Entretien et réparations',
  'Transport',
  'Taxes et impôts',
  'Loyer',
  'Fournitures',
  'Sécurité',
  'Communication',
  // A delivery paid with the open shift's money (deliveries.expense_id): already in the cost of
  // the fuel sold, so the reports' net result leaves it out.
  'Achat de carburant',
  'Autre',
];
const FUEL_PURCHASE = 'Achat de carburant';

const DEFAULT_SETTINGS = {
  station_name: 'Ma station',
  cash_tolerance: '1',
  stock_tolerance: '20',
  points_per_liter: '1', // combos per litre
  combo_value: '0.05', // value of one combo, in dollars
  combo_threshold: '100', // combos needed before they can be exchanged
  combos_enabled: '0', // '1' : combos are earned on paid-off credit and exchanged for fuel
  individual_credit_limit: '50',
  subscriber_credit_limit: '500',
  subscriber_grace_days: '5', // days after month end for subscribers to pay
  closing_time: '15:30', // the manager closes the shift every day at this time
  station_phone: '+243974105000', // shown at the bottom of the client space
};

// Rebuilds the sales table when its kind constraint is from an older release
// ('credit'/'loyalty', then 'paid'/'credit'): kinds are now paid, credit or combo
// (fuel exchanged for combos). Returns true when the table was rebuilt.
function migrateSalesKind(db) {
  const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sales'").get();
  if (sql.includes("'combo'")) return false;
  const count = () => db.prepare('SELECT COUNT(*) AS n FROM sales').get().n;
  const rowsBefore = count();
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE sales_new (
        id          INTEGER PRIMARY KEY,
        shift_id    INTEGER NOT NULL REFERENCES shifts(id),
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        nozzle_id   INTEGER NOT NULL REFERENCES nozzles(id),
        product_id  INTEGER NOT NULL REFERENCES products(id),
        kind        TEXT NOT NULL CHECK (kind IN ('paid', 'credit', 'combo')),
        liters      REAL NOT NULL,
        unit_price  REAL NOT NULL,
        amount      REAL NOT NULL,
        points      INTEGER NOT NULL DEFAULT 0,
        plate       TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        over_limit  INTEGER NOT NULL DEFAULT 0,
        source      TEXT NOT NULL DEFAULT 'attendant',
        points_due  INTEGER NOT NULL DEFAULT 0,
        combos_used INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO sales_new (id, shift_id, customer_id, nozzle_id, product_id, kind, liters, unit_price, amount, points, plate,
                             created_at, over_limit, source, points_due, combos_used)
        SELECT id, shift_id, customer_id, nozzle_id, product_id, CASE kind WHEN 'loyalty' THEN 'paid' ELSE kind END,
               liters, unit_price, amount, points, plate, created_at, over_limit, source,
               CASE WHEN points_due = 0 THEN points ELSE points_due END, combos_used
        FROM sales;
      DROP TABLE sales;
      ALTER TABLE sales_new RENAME TO sales;
      CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
      CREATE INDEX IF NOT EXISTS idx_sales_shift ON sales(shift_id);
    `);
    // Every sale must have been copied; links to missing rows are reported, not fatal.
    if (count() !== rowsBefore) throw new Error('Migration des ventes annulée : des ventes manquent après la copie.');
    const broken = db.prepare('PRAGMA foreign_key_check(sales)').all().length;
    if (broken) console.warn(`Migration des ventes : ${broken} vente(s) liée(s) à un élément absent.`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  return true;
}

// New roles: the owner (version 15, actionnaire: reads everything, changes nothing) and the
// admin (version 17: the manager plus the settings and the cash book). The users table is
// rebuilt with the wider constraint, every row and column kept.
const ROLES_CHECK = "CHECK (role IN ('manager', 'attendant', 'customer', 'owner', 'admin'))";
function migrateUserRoles(db) {
  const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (sql.includes("'admin'")) return;
  const count = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const rowsBefore = count();
  const create = sql.replace(/^CREATE TABLE "?users"?/, 'CREATE TABLE users_new').replace(/CHECK \(role IN \([^)]*\)\)/, ROLES_CHECK);
  if (!create.includes("'admin'")) throw new Error('Migration des utilisateurs : contrainte de rôle introuvable.');
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(create);
    db.exec('INSERT INTO users_new SELECT * FROM users; DROP TABLE users; ALTER TABLE users_new RENAME TO users;');
    if (count() !== rowsBefore) throw new Error('Migration des utilisateurs annulée : des comptes manquent après la copie.');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

// Purchase requests are short-lived (30 minutes): an outdated table is simply recreated.
function migrateRequests(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'purchase_requests'").get();
  if (row && !row.sql.includes("'combo'")) {
    db.exec('DROP TABLE purchase_requests');
    db.exec(SCHEMA);
  }
}

// Credit limits come from the settings of each category (particulier / abonné).
function syncCreditLimits(db) {
  const s = getSettings(db);
  db.prepare("UPDATE customers SET credit_limit = CASE type WHEN 'account' THEN ? ELSE ? END").run(s.subscriberCreditLimit, s.individualCreditLimit);
}

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  db.exec(SCHEMA);
  if (file !== ':memory:') backupBeforeMigration(db, file);
  addMissingColumns(db);
  const salesRebuilt = migrateSalesKind(db);
  if (salesRebuilt) addMissingColumns(db); // the rebuilt table only has the older columns
  migrateRequests(db);
  migrateUserRoles(db);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_payments_shift ON payments(shift_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_shift ON expenses(shift_id);
    CREATE INDEX IF NOT EXISTS idx_requests_status ON purchase_requests(status);
    CREATE INDEX IF NOT EXISTS idx_requests_customer ON purchase_requests(customer_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_ref ON sales(client_ref) WHERE client_ref IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_ref ON payments(client_ref) WHERE client_ref IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_ref ON expenses(client_ref) WHERE client_ref IS NOT NULL;`);
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insert.run(key, value);
  // Signs the « stop these mails » links (src/mailer.js): one random secret per station.
  insert.run('mail_secret', require('node:crypto').randomBytes(32).toString('hex'));
  syncCreditLimits(db);
  if (salesRebuilt) {
    // Credit sales only earn their combos once paid: recompute every balance.
    const { refreshCustomer } = require('./loyalty');
    for (const { id } of db.prepare('SELECT id FROM customers').all()) refreshCustomer(db, id);
  }
  if (version < 21) {
    // Version 21: every subscriber gets the station's payment day; the old « over the limit » flags
    // of particuliers mean nothing now that there is no credit limit.
    db.prepare("UPDATE customers SET payment_day = ? WHERE type = 'account' AND payment_day IS NULL").run(Number(db.prepare("SELECT value FROM settings WHERE key = 'subscriber_grace_days'").get()?.value) || 5);
    db.exec("UPDATE sales SET over_limit = 0 WHERE over_limit = 1 AND customer_id IN (SELECT id FROM customers WHERE type = 'individual')");
  }
  if (version < 20) {
    // Version 20: the reliefs made before are taken as seen by every attendant.
    db.exec(`INSERT OR IGNORE INTO checkpoint_seen (checkpoint_id, user_id)
      SELECT c.id, u.id FROM shift_checkpoints c CROSS JOIN users u WHERE u.role = 'attendant'`);
  }
  if (version < 18) {
    // Version 18: suppliers get a record (contacts) from the names already used.
    db.exec(`INSERT OR IGNORE INTO suppliers (name)
      SELECT TRIM(supplier) FROM deliveries WHERE supplier IS NOT NULL AND TRIM(supplier) != ''
      UNION SELECT TRIM(supplier) FROM supplier_payments`);
  }
  if (version < 17 && !db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) {
    // Version 17: the account that set the station up (the first manager) becomes the admin.
    db.exec("UPDATE users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM users WHERE role = 'manager')");
  }
  if (version < 16) {
    // Version 16: a closing may come before the money is counted; every earlier closing was counted.
    db.exec("UPDATE shifts SET counted_at = closed_at WHERE status != 'open' AND counted_at IS NULL");
  }
  if (version < 14) {
    // Version 14: the closing's cash is what is handed over, without the change left (it was counted in).
    db.exec('UPDATE shifts SET cash = ROUND(cash - change_left, 2) WHERE change_left > 0');
  }
  if (version < 11) {
    // Version 11: the manager's closing is final, there is no validation step any more.
    db.exec("UPDATE shifts SET status = 'closed' WHERE status = 'validated'");
  }
  if (version < 10) {
    // Version 10: a shift has attendants; the one who opened each existing shift worked on it.
    db.exec(`INSERT INTO shift_attendants (shift_id, user_id, joined_at, left_at)
      SELECT s.id, s.attendant_id, s.opened_at, s.closed_at FROM shifts s
      WHERE NOT EXISTS (SELECT 1 FROM shift_attendants a WHERE a.shift_id = s.id)`);
  }
  if (version < 6) {
    // Version 6: everything is counted in dollars and the combo programme starts switched off.
    db.exec("UPDATE settings SET value = '0' WHERE key = 'combos_enabled'; DELETE FROM settings WHERE key = 'cdf_rate';");
  }
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}

function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    stationName: s.station_name,
    cashTolerance: Number(s.cash_tolerance),
    stockTolerance: Number(s.stock_tolerance),
    combosPerLiter: Number(s.points_per_liter),
    comboValue: Number(s.combo_value),
    comboThreshold: Number(s.combo_threshold),
    combosEnabled: s.combos_enabled !== '0',
    individualCreditLimit: Number(s.individual_credit_limit),
    subscriberCreditLimit: Number(s.subscriber_credit_limit),
    subscriberGraceDays: Number(s.subscriber_grace_days),
    closingTime: s.closing_time,
    stationPhone: s.station_phone || '',
    expenseCategories: EXPENSE_CATEGORIES,
  };
}

module.exports = { openDb, getSettings, syncCreditLimits, EXPENSE_CATEGORIES, FUEL_PURCHASE, SCHEMA_VERSION };
