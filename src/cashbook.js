// Cash book: two separate balances, cash (espèces) and mobile money. Mobile money only
// reaches the till when it is withdrawn (a transfer). Most entries come from what the app
// already records (closed shifts, payments and expenses outside a shift, deliveries paid on
// the spot, supplier payments); the manager adds the rest by hand (cash_movements).
const { round, money, fail } = require('./util');
const { attendantNamesSql, shiftMovements, movementsTotal } = require('./checkpoints');

const ACCOUNTS = { cash: 'Espèces', momo: 'Mobile money' };
// Payment methods that move one of the two balances.
const ACCOUNT_OF_METHOD = { espèces: 'cash', 'mobile money': 'momo' };

// Manual movements: label, sign, and which balance they may touch.
const KINDS = {
  opening: { label: 'Solde de départ (comptage)', sign: 1, accounts: ['cash', 'momo'] },
  apport: { label: 'Apport du propriétaire', sign: 1, accounts: ['cash', 'momo'] },
  retrait_proprio: { label: 'Retrait du propriétaire', sign: -1, accounts: ['cash', 'momo'] },
  // No bank any more: kept only to read movements entered before.
  versement_banque: { label: 'Versement à la banque', sign: -1, accounts: ['cash'], old: true },
  retrait_banque: { label: 'Retrait à la banque', sign: 1, accounts: ['cash'], old: true },
  retrait_momo: { label: 'Retrait du mobile money vers la caisse', sign: 0, accounts: ['momo'] }, // transfer
  frais_momo: { label: 'Frais mobile money', sign: -1, accounts: ['momo'] },
  autre_entree: { label: 'Entrée', sign: 1, accounts: ['cash', 'momo'] },
  autre_sortie: { label: 'Sortie', sign: -1, accounts: ['cash', 'momo'] },
};


// What a manual movement does to the money of a shift's till: an entry or exit of the cash ±,
// mobile money withdrawn into the cash +; nothing otherwise (0: it cannot go in a shift).
function shiftSign(kind, account) {
  if (kind === 'retrait_momo') return 1;
  if (account !== 'cash' || kind === 'opening') return 0;
  return KINDS[kind]?.sign || 0;
}

// Every entry of both balances, oldest first: { account, at, day, in, out, label, source, id, link }.
function allEntries(db) {
  const entries = [];
  const push = (e) => {
    // A zero count still starts the book over.
    if (!e.account || (!(e.in || e.out) && e.kind !== 'opening')) return;
    entries.push({ in: 0, out: 0, ...e, in: round(e.in || 0), out: round(e.out || 0) });
  };

  for (const s of db
    .prepare(
      `SELECT s.id, s.closed_at AS at, date(s.closed_at, 'localtime') AS day, s.cash, s.change_left, s.francs, s.mobile_money, s.counted_at, COALESCE(${attendantNamesSql}, u.name) AS attendant,
         (SELECT COALESCE(SUM(e.amount), 0) FROM expenses e WHERE e.shift_id = s.id) AS spent
       FROM shifts s JOIN users u ON u.id = s.attendant_id WHERE s.status != 'open'`,
    )
    .all()) {
    const base = { at: s.at, day: s.day, source: 'shift', id: s.id, link: `#/postes/${s.id}` };
    // The cash handed over (the change left with the attendants stays with them, the francs with the
    // manager: both come back in the next shift's cash), plus what was
    // spent from it during the shift: those expenses go out on their own lines.
    const paidIn = s.cash;
    const moved = movementsTotal(shiftMovements(db, s.id));
    const detail = [s.counted_at ? null : 'argent à compter', s.change_left ? `monnaie laissée aux pompistes ${money(s.change_left)}` : null, s.francs ? `francs gardés à changer ${money(s.francs)}` : null, s.spent ? `avec les dépenses du poste (${money(s.spent)})` : null, moved ? `sans les mouvements de caisse déjà comptés (${money(moved)})` : null].filter(Boolean).join(', ');
    push({ ...base, account: 'cash', in: round(paidIn + s.spent - moved), label: `Clôture du poste n°${s.id} (${s.attendant})${detail ? ` : ${detail}` : ''}` });
    push({ ...base, account: 'momo', in: s.mobile_money, label: `Mobile money du poste n°${s.id} (${s.attendant})` });
  }

  for (const p of db
    .prepare(
      `SELECT p.id, p.created_at AS at, date(p.created_at, 'localtime') AS day, p.amount, p.method, p.reference, c.id AS customer_id, c.name
       FROM payments p JOIN customers c ON c.id = p.customer_id WHERE p.shift_id IS NULL`,
    )
    .all()) {
    push({ at: p.at, day: p.day, account: ACCOUNT_OF_METHOD[p.method], in: p.amount, label: `Règlement de ${p.name}${p.reference ? ` (${p.reference})` : ''}`, source: 'payment', id: p.id, link: `#/clients/${p.customer_id}` });
  }

  for (const e of db
    .prepare("SELECT id, created_at AS at, expense_date AS day, amount, method, category, description, shift_id FROM expenses")
    .all()) {
    push({
      at: e.at,
      day: e.day,
      account: ACCOUNT_OF_METHOD[e.method],
      out: e.amount,
      label: `Dépense${e.shift_id ? ` du poste n°${e.shift_id}` : ''} · ${e.category} : ${e.description}`,
      source: 'expense',
      id: e.id,
      link: e.shift_id ? `#/postes/${e.shift_id}` : '#/depenses',
    });
  }

  for (const d of db
    .prepare(
      `SELECT d.id, d.created_at AS at, date(d.created_at, 'localtime') AS day, d.amount, d.pay_method, d.supplier, d.reference, t.name AS tank
       FROM deliveries d JOIN tanks t ON t.id = d.tank_id WHERE d.payment = 'cash' AND d.amount > 0`,
    )
    .all()) {
    push({
      at: d.at,
      day: d.day,
      account: ACCOUNT_OF_METHOD[d.pay_method],
      out: d.amount,
      label: `Livraison payée comptant · ${d.tank}${d.supplier ? `, ${d.supplier}` : ''}${d.reference ? ` (bon ${d.reference})` : ''}`,
      source: 'delivery',
      id: d.id,
      link: '#/cuves',
    });
  }

  for (const p of db.prepare("SELECT id, created_at AS at, date(created_at, 'localtime') AS day, supplier, amount, method, reference FROM supplier_payments").all()) {
    push({ at: p.at, day: p.day, account: ACCOUNT_OF_METHOD[p.method], out: p.amount, label: `Paiement au fournisseur ${p.supplier}${p.reference ? ` (${p.reference})` : ''}`, source: 'supplier_payment', id: p.id, link: '#/cuves' });
  }

  for (const m of db.prepare("SELECT id, created_at AS at, date(created_at, 'localtime') AS day, kind, account, amount, note, shift_id FROM cash_movements").all()) {
    const kind = KINDS[m.kind];
    if (!kind) continue;
    const label = `${kind.label}${m.note ? ` : ${m.note}` : ''}${m.shift_id ? ` (caisse du poste n°${m.shift_id})` : ''}`;
    // An entry or exit of the cash can be put in (or taken out of) the money of a shift.
    const shiftable = shiftSign(m.kind, m.account) !== 0;
    const base = { at: m.at, day: m.day, source: 'movement', id: m.id, kind: m.kind, shift_id: m.shift_id, shiftable };
    if (m.kind === 'retrait_momo') {
      push({ ...base, account: 'momo', out: m.amount, label });
      push({ ...base, account: 'cash', in: m.amount, label });
    } else {
      push({ ...base, account: m.account, [kind.sign > 0 ? 'in' : 'out']: m.amount, label });
    }
  }

  const isOpening = (e) => (e.kind === 'opening' ? 1 : 0);
  return entries.sort((a, b) => a.day.localeCompare(b.day) || a.at.localeCompare(b.at) || isOpening(b) - isOpening(a));
}

// The entries of one balance. The latest opening count resets it: what came before is history.
function accountEntries(db, account) {
  const list = allEntries(db).filter((e) => e.account === account);
  let start = -1;
  list.forEach((e, i) => {
    if (e.kind === 'opening') start = i;
  });
  return start < 0 ? list : list.slice(start);
}

const sum = (list, key) => round(list.reduce((t, e) => t + e[key], 0));

function lastCount(db, account, balance) {
  const c = db
    .prepare('SELECT c.*, u.name AS user_name FROM cash_counts c LEFT JOIN users u ON u.id = c.user_id WHERE account = ? ORDER BY c.id DESC LIMIT 1')
    .get(account);
  return c ? { ...c, diff: round(c.counted - c.book), current: balance } : null;
}

// One balance over a period: opening, movements with a running balance, a line per day.
function cashbook(db, { account = 'cash', from, to }) {
  const list = accountEntries(db, account);
  const before = list.filter((e) => from && e.day < from);
  const inRange = list.filter((e) => (!from || e.day >= from) && (!to || e.day <= to));
  const opening = round(sum(before, 'in') - sum(before, 'out'));
  let running = opening;
  const movements = inRange.map((e) => {
    running = round(running + e.in - e.out);
    return { ...e, balance: running };
  });
  const days = [];
  for (const m of movements) {
    let d = days.at(-1);
    if (!d || d.day !== m.day) {
      d = { day: m.day, start: round(m.balance - m.in + m.out), in: 0, out: 0, end: 0 };
      days.push(d);
    }
    d.in = round(d.in + m.in);
    d.out = round(d.out + m.out);
    d.end = m.balance;
  }
  return {
    account,
    accountLabel: ACCOUNTS[account],
    from,
    to,
    opening,
    in: sum(inRange, 'in'),
    out: sum(inRange, 'out'),
    closing: running,
    movements,
    days,
  };
}

// Today's balance of both accounts, with the last count of each.
function balances(db) {
  const out = {};
  for (const account of Object.keys(ACCOUNTS)) {
    const list = accountEntries(db, account);
    const balance = round(sum(list, 'in') - sum(list, 'out'));
    out[account] = {
      label: ACCOUNTS[account],
      balance,
      hasOpening: list.some((e) => e.kind === 'opening'),
      lastCount: lastCount(db, account, balance),
    };
  }
  return out;
}

// An expense « Paiement fournisseur » names the supplier paid: its record's spelling, or a refusal.
function supplierOf(db, category, beneficiary) {
  const { SUPPLIER_PAYMENT } = require('./db');
  if (category !== SUPPLIER_PAYMENT) return beneficiary;
  const s = beneficiary && db.prepare('SELECT name FROM suppliers WHERE lower(trim(name)) = lower(trim(?))').get(beneficiary);
  if (!s) fail(400, 'Indiquez dans « Payé à » le fournisseur payé, tel qu’il est enregistré dans Cuves → Fournisseurs.', 'supplier_unknown');
  return s.name;
}

// Expenses that paid a supplier (in the shift's money or outside a shift).
function supplierExpenses(db) {
  const { SUPPLIER_PAYMENT } = require('./db');
  return db
    .prepare(
      `SELECT e.id, e.created_at, s.name AS supplier, e.amount, e.shift_id,
         CASE WHEN e.shift_id IS NOT NULL THEN 'dépense du poste n°' || e.shift_id ELSE 'dépense' END AS method
       FROM expenses e JOIN suppliers s ON lower(trim(s.name)) = lower(trim(e.beneficiary))
       WHERE e.category = ? AND e.id NOT IN (SELECT expense_id FROM deliveries WHERE expense_id IS NOT NULL)`,
    )
    .all(SUPPLIER_PAYMENT);
}

// Every supplier with its contacts, and what the station owes it: deliveries taken on credit minus
// payments (in Cuves → Fournisseurs, or as an expense « Paiement fournisseur »).
function supplierBalances(db) {
  const rows = new Map();
  const row = (name) => {
    const key = name.trim().toLowerCase();
    if (!rows.has(key)) rows.set(key, { id: null, name: name.trim(), phone: null, email: null, owed: 0, paid: 0, balance: 0, last_delivery_at: null });
    return rows.get(key);
  };
  for (const s of db.prepare('SELECT id, name, phone, email FROM suppliers ORDER BY name COLLATE NOCASE').all()) Object.assign(row(s.name), s);
  for (const d of db.prepare("SELECT supplier, amount, created_at FROM deliveries WHERE payment = 'credit' AND supplier IS NOT NULL ORDER BY id").all()) {
    const r = row(d.supplier);
    r.owed = round(r.owed + d.amount);
    r.last_delivery_at = d.created_at;
  }
  for (const p of [...db.prepare('SELECT supplier, amount FROM supplier_payments').all(), ...supplierExpenses(db)]) {
    const r = row(p.supplier);
    r.paid = round(r.paid + p.amount);
  }
  return [...rows.values()].map((r) => ({ ...r, balance: round(r.owed - r.paid) })).sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
}

module.exports = { ACCOUNTS, ACCOUNT_OF_METHOD, KINDS, shiftSign, cashbook, balances, supplierBalances, supplierExpenses, supplierOf };
