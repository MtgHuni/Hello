const express = require('express');
const { fail, num, str, oneOf, bool, round, dateParam } = require('../util');
const { requireRole, hashPassword, checkPasswordStrength } = require('../auth');

const manager = requireRole('manager');
const frNum = (n, digits = 2) => n.toLocaleString('fr-FR', { maximumFractionDigits: digits });

// Amount owed by the customer: credit sales minus payments received.
function customerBalance(db, customerId) {
  const row = db
    .prepare(
      `SELECT
         (SELECT COALESCE(SUM(amount), 0) FROM sales WHERE customer_id = ? AND kind = 'credit') -
         (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE customer_id = ?) AS balance`,
    )
    .get(customerId, customerId);
  return round(row.balance);
}

function customerRoutes(db) {
  const router = express.Router();

  const listSql = `
    SELECT c.*,
      ROUND((SELECT COALESCE(SUM(amount), 0) FROM sales WHERE customer_id = c.id AND kind = 'credit') -
            (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE customer_id = c.id), 2) AS balance,
      (SELECT MAX(created_at) FROM sales WHERE customer_id = c.id) AS last_purchase_at,
      (SELECT login FROM users WHERE customer_id = c.id) AS login
    FROM customers c`;

  // Statement: opening balance, dated movements over the period, closing balance.
  function account(id, from, to) {
    const customer = db.prepare(`${listSql} WHERE c.id = ?`).get(id);
    if (!customer) fail(404, 'Client introuvable.');
    const inRange = `(? IS NULL OR date(created_at, 'localtime') >= ?) AND (? IS NULL OR date(created_at, 'localtime') <= ?)`;
    const range = [from, from, to, to];

    const sales = db
      .prepare(
        `SELECT s.id, s.created_at, s.kind, s.liters, s.unit_price, s.amount, s.points, s.plate, p.name AS product_name
         FROM (SELECT * FROM sales WHERE customer_id = ? AND ${inRange}) s JOIN products p ON p.id = s.product_id
         ORDER BY s.created_at, s.id`,
      )
      .all(id, ...range);
    const payments = db
      .prepare(`SELECT id, created_at, amount, method, reference FROM payments WHERE customer_id = ? AND ${inRange} ORDER BY created_at, id`)
      .all(id, ...range);

    let opening = 0;
    if (from) {
      opening = db
        .prepare(
          `SELECT
             (SELECT COALESCE(SUM(amount), 0) FROM sales WHERE customer_id = ? AND kind = 'credit' AND date(created_at, 'localtime') < ?) -
             (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE customer_id = ? AND date(created_at, 'localtime') < ?) AS v`,
        )
        .get(id, from, id, from).v;
    }

    const movements = [
      ...sales.map((s) => ({
        date: s.created_at,
        type: 'sale',
        label: `${s.product_name} — ${frNum(s.liters)} L à ${frNum(s.unit_price, 3)} $/L${s.plate ? ` (${s.plate})` : ''}`,
        liters: s.liters,
        points: s.points,
        debit: s.kind === 'credit' ? s.amount : 0,
        amount: s.amount,
        credit: 0,
      })),
      ...payments.map((p) => ({
        date: p.created_at,
        type: 'payment',
        label: `Règlement ${p.method}${p.reference ? ` — ${p.reference}` : ''}`,
        debit: 0,
        credit: p.amount,
        amount: p.amount,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    let running = opening;
    for (const m of movements) {
      running = round(running + m.debit - m.credit);
      m.balance = running;
    }

    return {
      customer,
      period: { from, to },
      opening: round(opening),
      closing: round(running),
      totals: {
        liters: round(sales.reduce((t, s) => t + s.liters, 0)),
        purchases: round(sales.reduce((t, s) => t + s.amount, 0)),
        payments: round(payments.reduce((t, p) => t + p.amount, 0)),
        points: sales.reduce((t, s) => t + s.points, 0),
      },
      movements,
    };
  }

  router.get('/customers', requireRole('manager', 'attendant'), (req, res) => {
    const rows = db.prepare(`${listSql} ORDER BY c.name COLLATE NOCASE`).all();
    if (req.user.role === 'attendant') {
      // Attendants only need what the sale form shows.
      return res.json(
        rows
          .filter((c) => c.active)
          .map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            plate: c.plate,
            available: c.type === 'account' ? round(c.credit_limit - c.balance) : null,
          })),
      );
    }
    res.json(rows);
  });

  function customerFields(b, current = {}) {
    const type = oneOf(b.type ?? current.type, 'Le type de client', ['account', 'individual']);
    return {
      type,
      name: str(b.name ?? current.name, 'Le nom', { max: 120 }),
      phone: str(b.phone ?? current.phone, 'Le téléphone', { required: false, max: 40 }),
      email: str(b.email ?? current.email, "L'e-mail", { required: false, max: 120 }),
      address: str(b.address ?? current.address, "L'adresse", { required: false, max: 300 }),
      plate: str(b.plate ?? current.plate, "L'immatriculation", { required: false, max: 20 }),
      creditLimit: type === 'account' ? num(b.creditLimit ?? current.credit_limit ?? 0, 'Le plafond de crédit', { max: 1e8 }) : 0,
    };
  }

  router.post('/customers', manager, (req, res) => {
    const f = customerFields(req.body || {});
    const id = db
      .prepare('INSERT INTO customers (type, name, phone, email, address, plate, credit_limit) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(f.type, f.name, f.phone, f.email, f.address, f.plate, f.creditLimit).lastInsertRowid;
    res.status(201).json(db.prepare(`${listSql} WHERE c.id = ?`).get(id));
  });

  router.put('/customers/:id', manager, (req, res) => {
    const current = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!current) fail(404, 'Client introuvable.');
    const f = customerFields(req.body || {}, current);
    const active = bool(req.body?.active, !!current.active) ? 1 : 0;
    db.prepare(
      'UPDATE customers SET type = ?, name = ?, phone = ?, email = ?, address = ?, plate = ?, credit_limit = ?, active = ? WHERE id = ?',
    ).run(f.type, f.name, f.phone, f.email, f.address, f.plate, f.creditLimit, active, current.id);
    db.prepare('UPDATE users SET active = ? WHERE customer_id = ?').run(active, current.id);
    res.json(db.prepare(`${listSql} WHERE c.id = ?`).get(current.id));
  });

  router.get('/customers/:id', manager, (req, res) => {
    res.json(account(Number(req.params.id), dateParam(req.query.from, 'La date de début'), dateParam(req.query.to, 'La date de fin')));
  });

  router.post('/customers/:id/payments', manager, (req, res) => {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!customer) fail(404, 'Client introuvable.');
    const amount = round(num(req.body?.amount, 'Le montant', { min: 0.01, max: 1e8 }));
    const method = oneOf(req.body?.method, 'Le mode de règlement', ['espèces', 'virement', 'chèque', 'carte', 'mobile money']);
    const reference = str(req.body?.reference, 'La référence', { required: false, max: 100 });
    db.prepare('INSERT INTO payments (customer_id, amount, method, reference, user_id) VALUES (?, ?, ?, ?, ?)').run(
      customer.id,
      amount,
      method,
      reference,
      req.user.id,
    );
    res.status(201).json({ balance: customerBalance(db, customer.id) });
  });

  // Creates (or resets) the customer's own login to the client space.
  router.post('/customers/:id/login', manager, (req, res) => {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!customer) fail(404, 'Client introuvable.');
    const login = str(req.body?.login, "L'identifiant", { max: 100 });
    const hash = hashPassword(checkPasswordStrength(req.body?.password));
    const existing = db.prepare('SELECT id FROM users WHERE customer_id = ?').get(customer.id);
    const taken = db.prepare('SELECT id FROM users WHERE login = ?').get(login);
    if (taken && taken.id !== existing?.id) fail(409, 'Cet identifiant est déjà utilisé.');
    if (existing) {
      db.prepare('UPDATE users SET login = ?, password_hash = ?, name = ? WHERE id = ?').run(login, hash, customer.name, existing.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
    } else {
      db.prepare("INSERT INTO users (name, login, password_hash, role, customer_id, active) VALUES (?, ?, ?, 'customer', ?, ?)").run(
        customer.name,
        login,
        hash,
        customer.id,
        customer.active,
      );
    }
    res.json({ ok: true });
  });

  // Client space: a customer only ever sees their own account.
  router.get('/me/account', requireRole('customer'), (req, res) => {
    res.json(account(req.user.customer_id, dateParam(req.query.from, 'La date de début'), dateParam(req.query.to, 'La date de fin')));
  });

  return router;
}

module.exports = customerRoutes;
module.exports.customerBalance = customerBalance;
