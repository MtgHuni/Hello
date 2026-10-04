const express = require('express');
const { fail, num, str, oneOf, bool, round, dateParam, transaction } = require('../util');
const { requireRole, hashPassword, checkPasswordStrength } = require('../auth');
const { getSettings, syncCreditLimits } = require('../db');
const { refreshCustomer, subscriberDues } = require('../loyalty');

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
      (SELECT login FROM users WHERE customer_id = c.id) AS login,
      (SELECT name FROM users WHERE id = c.created_by) AS created_by_name,
      (SELECT COUNT(*) FROM sales WHERE customer_id = c.id AND over_limit = 1) AS over_limit_count
    FROM customers c`;

  // Statement: opening balance, dated movements over the period, closing balance.
  function account(id, from, to) {
    const customer = db.prepare(`${listSql} WHERE c.id = ?`).get(id);
    if (!customer) fail(404, 'Client introuvable.');
    const inRange = `(? IS NULL OR date(created_at, 'localtime') >= ?) AND (? IS NULL OR date(created_at, 'localtime') <= ?)`;
    const range = [from, from, to, to];

    const sales = db
      .prepare(
        `SELECT s.id, s.created_at, s.kind, s.liters, s.unit_price, s.amount, s.points, s.points_due, s.combos_used, s.plate, s.over_limit, p.name AS product_name
         FROM (SELECT * FROM sales WHERE customer_id = ? AND ${inRange}) s JOIN products p ON p.id = s.product_id
         ORDER BY s.created_at, s.id`,
      )
      .all(id, ...range);
    const payments = db
      .prepare(
        `SELECT p.id, p.created_at, p.amount, p.method, p.reference, p.shift_id
         FROM (SELECT * FROM payments WHERE customer_id = ? AND ${inRange}) p ORDER BY p.created_at, p.id`,
      )
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
        label:
          s.kind === 'combo'
            ? `${s.product_name} — ${frNum(s.liters)} L échangés contre ${s.combos_used} combos`
            : `${s.product_name} — ${frNum(s.liters)} L à ${frNum(s.unit_price, 3)} $/L${s.plate ? ` (${s.plate})` : ''} — ${
                s.kind === 'credit' ? `à crédit${s.over_limit ? ' (hors plafond)' : ''}${s.points_due && !s.points ? ', combos à l’encaissement' : ''}` : 'payé'
              }`,
        liters: s.liters,
        points: s.points,
        combosUsed: s.combos_used,
        debit: s.kind === 'credit' ? s.amount : 0,
        amount: s.amount,
        credit: 0,
      })),
      ...payments.map((p) => ({
        date: p.created_at,
        type: 'payment',
        label: `Règlement ${p.method}${p.reference ? ` — ${p.reference}` : ''}${p.shift_id ? ` (encaissé à la pompe, poste n°${p.shift_id})` : ''}`,
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

    const settings = getSettings(db);
    return {
      customer,
      balance: customerBalance(db, customer.id), // today, whatever the period shown
      dues: customer.type === 'account' ? subscriberDues(db, customer.id, settings.subscriberGraceDays) : null,
      combos: {
        balance: customer.loyalty_points,
        value: round(customer.loyalty_points * settings.comboValue),
        threshold: settings.comboThreshold,
        pending: db.prepare("SELECT COALESCE(SUM(points_due), 0) AS v FROM sales WHERE customer_id = ? AND kind = 'credit' AND points = 0").get(customer.id).v,
      },
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
      const graceDays = getSettings(db).subscriberGraceDays;
      // Attendants only need what the sale form shows.
      return res.json(
        rows
          .filter((c) => c.active)
          .map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            plate: c.plate,
            phone: c.phone,
            points: c.loyalty_points,
            balance: c.balance,
            available: round(c.credit_limit - c.balance),
            late: c.type === 'account' && c.balance > 0 ? subscriberDues(db, c.id, graceDays).late : false,
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
    };
  }

  // Quick creation at the pump: name only. The customer is a particulier (with the
  // particulier credit limit) flagged for the manager to complete the record.
  router.post('/customers/quick', requireRole('manager', 'attendant'), (req, res) => {
    const name = str(req.body?.name, 'Le nom du client', { max: 120 });
    const existing = db.prepare('SELECT id FROM customers WHERE name = ? COLLATE NOCASE AND active = 1').get(name);
    if (existing) fail(409, 'Un client porte déjà ce nom : choisissez-le dans la liste.', 'duplicate');
    const limit = getSettings(db).individualCreditLimit;
    const id = db
      .prepare("INSERT INTO customers (type, name, credit_limit, needs_review, created_by) VALUES ('individual', ?, ?, 1, ?)")
      .run(name, limit, req.user.id).lastInsertRowid;
    res.status(201).json({ id: Number(id), name, type: 'individual', plate: null, points: 0, balance: 0, available: limit, late: false });
  });

  router.post('/customers', manager, (req, res) => {
    const f = customerFields(req.body || {});
    const id = db
      .prepare('INSERT INTO customers (type, name, phone, email, address, plate) VALUES (?, ?, ?, ?, ?, ?)')
      .run(f.type, f.name, f.phone, f.email, f.address, f.plate).lastInsertRowid;
    syncCreditLimits(db);
    res.status(201).json(db.prepare(`${listSql} WHERE c.id = ?`).get(id));
  });

  router.put('/customers/:id', manager, (req, res) => {
    const current = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!current) fail(404, 'Client introuvable.');
    const f = customerFields(req.body || {}, current);
    const active = bool(req.body?.active, !!current.active) ? 1 : 0;
    db.prepare(
      'UPDATE customers SET type = ?, name = ?, phone = ?, email = ?, address = ?, plate = ?, active = ?, needs_review = 0 WHERE id = ?',
    ).run(f.type, f.name, f.phone, f.email, f.address, f.plate, active, current.id);
    syncCreditLimits(db);
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
    transaction(db, () => {
      db.prepare('INSERT INTO payments (customer_id, amount, method, reference, user_id) VALUES (?, ?, ?, ?, ?)').run(customer.id, amount, method, reference, req.user.id);
      refreshCustomer(db, customer.id); // paid-off credit sales now earn their combos
    });
    res.status(201).json({ balance: customerBalance(db, customer.id) });
  });

  // Creates (or resets) the customer's own login to the client space.
  router.post('/customers/:id/login', manager, async (req, res) => {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!customer) fail(404, 'Client introuvable.');
    const login = str(req.body?.login, "L'identifiant", { max: 100 });
    const hash = await hashPassword(checkPasswordStrength(req.body?.password));
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
