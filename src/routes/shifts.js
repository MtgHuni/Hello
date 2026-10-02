const express = require('express');
const { EXPENSE_CATEGORIES } = require('../db');
const { fail, num, str, oneOf, round, dateParam, transaction } = require('../util');
const { requireRole } = require('../auth');
const { customerBalance } = require('./customers');
const { createSale } = require('../sales');
const { refreshCustomer } = require('../loyalty');

const staff = requireRole('manager', 'attendant');

module.exports = function shiftRoutes(db) {
  const router = express.Router();

  function shiftDetail(id) {
    const shift = db
      .prepare(
        `SELECT s.*, u.name AS attendant_name, v.name AS validated_by_name
         FROM shifts s JOIN users u ON u.id = s.attendant_id LEFT JOIN users v ON v.id = s.validated_by
         WHERE s.id = ?`,
      )
      .get(id);
    if (!shift) return null;
    shift.readings = db
      .prepare(
        `SELECT r.*, n.name AS nozzle_name, pu.name AS pump_name, p.name AS product_name
         FROM shift_readings r JOIN nozzles n ON n.id = r.nozzle_id JOIN pumps pu ON pu.id = n.pump_id
         JOIN products p ON p.id = r.product_id
         WHERE r.shift_id = ? ORDER BY pu.id, n.id`,
      )
      .all(id);
    shift.sales = db
      .prepare(
        `SELECT sa.*, c.name AS customer_name, c.type AS customer_type, p.name AS product_name
         FROM sales sa JOIN customers c ON c.id = sa.customer_id JOIN products p ON p.id = sa.product_id
         WHERE sa.shift_id = ? ORDER BY sa.id`,
      )
      .all(id);
    shift.payments = db
      .prepare(
        `SELECT pa.*, c.name AS customer_name FROM payments pa JOIN customers c ON c.id = pa.customer_id
         WHERE pa.shift_id = ? ORDER BY pa.id`,
      )
      .all(id);
    shift.expenses = db.prepare('SELECT * FROM expenses WHERE shift_id = ? ORDER BY id').all(id);
    shift.pending_cancellations = pendingCancellations(id);
    if (shift.status === 'open') {
      shift.credit_amount = round(shift.sales.filter((s) => s.kind === 'credit').reduce((t, s) => t + s.amount, 0));
      shift.combo_amount = round(shift.sales.filter((s) => s.kind === 'combo').reduce((t, s) => t + s.amount, 0));
      shift.payments_amount = round(shift.payments.reduce((t, p) => t + p.amount, 0));
      shift.expenses_amount = round(shift.expenses.reduce((t, e) => t + e.amount, 0));
    }
    return shift;
  }

  function getOwnShift(req, { open = true } = {}) {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
    if (!shift) fail(404, 'Poste introuvable.');
    if (req.user.role !== 'manager' && shift.attendant_id !== req.user.id) fail(403, 'Ce poste ne vous appartient pas.');
    if (open && shift.status !== 'open') fail(409, 'Ce poste est déjà clôturé.');
    return shift;
  }

  router.get('/shifts', staff, (req, res) => {
    const from = dateParam(req.query.from, 'La date de début');
    const to = dateParam(req.query.to, 'La date de fin');
    const status = ['open', 'closed', 'validated'].includes(req.query.status) ? req.query.status : null;
    const attendant = req.user.role === 'manager' ? null : req.user.id;
    res.json(
      db
        .prepare(
          `SELECT s.id, s.status, s.opened_at, s.closed_at, s.total_liters, s.total_amount, s.credit_amount,
             s.expected_amount, s.payments_amount, s.expenses_amount, s.cash, s.card, s.variance, u.name AS attendant_name,
             (SELECT COUNT(*) FROM sales sa WHERE sa.shift_id = s.id AND sa.over_limit = 1) AS over_limit_count,
             (SELECT group_concat(DISTINCT pu.name) FROM shift_readings r JOIN nozzles n ON n.id = r.nozzle_id
              JOIN pumps pu ON pu.id = n.pump_id WHERE r.shift_id = s.id) AS pumps
           FROM shifts s JOIN users u ON u.id = s.attendant_id
           WHERE (? IS NULL OR s.status = ?)
             AND (? IS NULL OR s.attendant_id = ?)
             AND (? IS NULL OR date(s.opened_at, 'localtime') >= ?)
             AND (? IS NULL OR date(s.opened_at, 'localtime') <= ?)
           ORDER BY s.id DESC LIMIT 300`,
        )
        .all(status, status, attendant, attendant, from, from, to, to),
    );
  });

  router.get('/shifts/current', staff, (req, res) => {
    const row = db.prepare("SELECT id FROM shifts WHERE attendant_id = ? AND status = 'open'").get(req.user.id);
    res.json(row ? shiftDetail(row.id) : null);
  });

  router.get('/shifts/:id', staff, (req, res) => {
    getOwnShift(req, { open: false });
    res.json(shiftDetail(req.params.id));
  });

  // Opening a shift snapshots each nozzle's meter and the current price,
  // so a price change during the shift only applies to the next one.
  router.post('/shifts', staff, (req, res) => {
    const pumpIds = Array.isArray(req.body?.pumpIds) ? req.body.pumpIds.map(Number) : [];
    if (!pumpIds.length) fail(400, 'Choisissez au moins une pompe.');

    const id = transaction(db, () => {
      if (db.prepare("SELECT 1 FROM shifts WHERE attendant_id = ? AND status = 'open'").get(req.user.id)) {
        fail(409, 'Vous avez déjà un poste ouvert.');
      }
      const nozzles = [];
      for (const pumpId of pumpIds) {
        const pump = db.prepare('SELECT * FROM pumps WHERE id = ? AND active = 1').get(pumpId);
        if (!pump) fail(400, 'Pompe inconnue ou désactivée.');
        const own = db
          .prepare(
            `SELECT n.id, n.meter, n.tank_id, t.product_id, p.price, COALESCE(p.subscriber_price, p.price) AS subscriber_price
             FROM nozzles n JOIN tanks t ON t.id = n.tank_id JOIN products p ON p.id = t.product_id
             WHERE n.pump_id = ? AND n.active = 1`,
          )
          .all(pumpId);
        if (!own.length) fail(400, `${pump.name} n'a aucun pistolet actif.`);
        for (const n of own) {
          const busy = db
            .prepare(
              `SELECT 1 FROM shift_readings r JOIN shifts s ON s.id = r.shift_id
               WHERE s.status = 'open' AND r.nozzle_id = ?`,
            )
            .get(n.id);
          if (busy) fail(409, `${pump.name} est déjà utilisée dans un autre poste ouvert.`);
          nozzles.push(n);
        }
      }
      const shiftId = Number(
        db.prepare("INSERT INTO shifts (attendant_id, status) VALUES (?, 'open')").run(req.user.id).lastInsertRowid,
      );
      const insert = db.prepare(
        'INSERT INTO shift_readings (shift_id, nozzle_id, product_id, tank_id, unit_price, subscriber_price, start_meter) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      for (const n of nozzles) insert.run(shiftId, n.id, n.product_id, n.tank_id, n.price, n.subscriber_price, n.meter);
      return shiftId;
    });
    res.status(201).json(shiftDetail(id));
  });

  // Customer sale entered by the attendant (paid or on credit; always earns points).
  router.post('/shifts/:id/sales', staff, (req, res) => {
    const shift = getOwnShift(req);
    res.status(201).json(createSale(db, shift, { ...(req.body || {}), source: 'attendant' }));
  });

  // A customer settling their account at the pump: the money goes into the shift's cash.
  router.post('/shifts/:id/payments', staff, (req, res) => {
    const shift = getOwnShift(req);
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(req.body?.customerId));
    if (!customer) fail(400, 'Choisissez un client.');
    const amount = round(num(req.body?.amount, 'Le montant', { min: 0.01, max: 1e8 }));
    const method = oneOf(req.body?.method ?? 'espèces', 'Le mode de règlement', ['espèces', 'mobile money', 'carte']);
    const reference = str(req.body?.reference, 'La référence', { required: false, max: 100 });
    const id = transaction(db, () => {
      const r = db
        .prepare('INSERT INTO payments (customer_id, amount, method, reference, user_id, shift_id) VALUES (?, ?, ?, ?, ?, ?)')
        .run(customer.id, amount, method, reference, req.user.id, shift.id);
      refreshCustomer(db, customer.id); // paid-off credit sales now earn their combos
      return r.lastInsertRowid;
    });
    res.status(201).json({ id: Number(id), balance: customerBalance(db, customer.id) });
  });

  // Small expense paid from the shift's cash (deducted from the amount to hand over).
  router.post('/shifts/:id/expenses', staff, (req, res) => {
    const shift = getOwnShift(req);
    const category = oneOf(req.body?.category, 'La catégorie', EXPENSE_CATEGORIES);
    const amount = round(num(req.body?.amount, 'Le montant', { min: 0.01, max: 1e7 }));
    const description = str(req.body?.description, 'La description', { max: 300 });
    const beneficiary = str(req.body?.beneficiary, 'Le bénéficiaire', { required: false, max: 120 });
    const id = db
      .prepare(
        `INSERT INTO expenses (expense_date, category, amount, description, beneficiary, method, shift_id, user_id)
         VALUES (date('now', 'localtime'), ?, ?, ?, ?, 'espèces', ?, ?)`,
      )
      .run(category, amount, description, beneficiary, shift.id, req.user.id).lastInsertRowid;
    res.status(201).json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(id));
  });

  // ---- Cancelling an operation: the attendant asks, the manager decides ----

  const CANCELLABLE = {
    sales: { table: 'sales', missing: 'Vente introuvable.' },
    payments: { table: 'payments', missing: 'Règlement introuvable.' },
    expenses: { table: 'expenses', missing: 'Dépense introuvable.' },
  };

  function cancellable(req, shift) {
    const k = CANCELLABLE[req.params.kind];
    if (!k) fail(404, 'Opération introuvable.');
    const item = db.prepare(`SELECT * FROM ${k.table} WHERE id = ? AND shift_id = ?`).get(req.params.itemId, shift.id);
    if (!item) fail(404, k.missing);
    return { table: k.table, item };
  }

  // The operation stays counted until the manager validates its cancellation.
  router.post('/shifts/:id/:kind/:itemId/cancel', staff, (req, res) => {
    const shift = getOwnShift(req);
    const { table, item } = cancellable(req, shift);
    if (item.cancel_requested_at) fail(409, 'L’annulation a déjà été demandée au gérant.');
    const reason = str(req.body?.reason, 'La raison', { required: false, max: 200 });
    db.prepare(`UPDATE ${table} SET cancel_requested_at = datetime('now'), cancel_requested_by = ?, cancel_reason = ? WHERE id = ?`).run(
      req.user.id,
      reason,
      item.id,
    );
    res.status(202).json({ pending: true });
  });

  // Manager: cancels the operation (whether or not it was asked), also after the shift is closed.
  router.delete('/shifts/:id/:kind/:itemId', requireRole('manager'), (req, res) => {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
    if (!shift) fail(404, 'Poste introuvable.');
    if (shift.status === 'validated') fail(409, 'Ce poste est déjà validé : il ne peut plus être modifié.');
    const { table, item } = cancellable(req, shift);
    transaction(db, () => {
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(item.id);
      if (item.customer_id) refreshCustomer(db, item.customer_id);
      if (shift.status === 'closed') reconcile(shift.id);
    });
    res.status(204).end();
  });

  // Manager: refuses the cancellation, the operation stays.
  router.post('/shifts/:id/:kind/:itemId/keep', requireRole('manager'), (req, res) => {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
    if (!shift) fail(404, 'Poste introuvable.');
    const { table, item } = cancellable(req, shift);
    db.prepare(`UPDATE ${table} SET cancel_requested_at = NULL, cancel_requested_by = NULL, cancel_reason = NULL WHERE id = ?`).run(item.id);
    res.status(204).end();
  });

  // Amounts of a closed shift, from its meter readings and its operations.
  function reconcile(shiftId) {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId);
    const readings = db.prepare('SELECT * FROM shift_readings WHERE shift_id = ?').all(shiftId);
    const sales = db.prepare('SELECT * FROM sales WHERE shift_id = ?').all(shiftId);
    // Subscribers pay a higher price than the pump price used for the meters.
    const unitPrices = new Map(readings.map((r) => [r.nozzle_id, r.unit_price]));
    const surcharge = round(sales.reduce((t, s) => t + (s.amount - s.liters * unitPrices.get(s.nozzle_id)), 0));
    const totalAmount = round(readings.reduce((t, r) => t + (r.amount || 0), 0) + surcharge);
    const creditAmount = round(sales.filter((s) => s.kind === 'credit').reduce((t, s) => t + s.amount, 0));
    const comboAmount = round(sales.filter((s) => s.kind === 'combo').reduce((t, s) => t + s.amount, 0));
    const paymentsAmount = round(db.prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM payments WHERE shift_id = ?').get(shiftId).v);
    const expensesAmount = round(db.prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE shift_id = ?').get(shiftId).v);
    // To hand over = fuel sold − sold on credit − exchanged for combos
    //               + account payments received − expenses paid from the till.
    const expected = round(totalAmount - creditAmount - comboAmount + paymentsAmount - expensesAmount);
    db.prepare(
      `UPDATE shifts SET total_amount = ?, credit_amount = ?, combo_amount = ?, payments_amount = ?, expenses_amount = ?, expected_amount = ?, variance = ?
       WHERE id = ?`,
    ).run(totalAmount, creditAmount, comboAmount, paymentsAmount, expensesAmount, expected, round(shift.cash + shift.card - expected), shiftId);
  }

  const pendingCancellations = (shiftId) =>
    ['sales', 'payments', 'expenses'].reduce(
      (n, table) => n + db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE shift_id = ? AND cancel_requested_at IS NOT NULL`).get(shiftId).n,
      0,
    );

  // Closing = reconciliation: litres from meters, expected money vs declared money,
  // then meters and tank book stocks move forward.
  router.post('/shifts/:id/close', staff, (req, res) => {
    const shift = getOwnShift(req);
    const b = req.body || {};
    const cash = round(num(b.cash, 'Le montant en espèces', { max: 1e8 }));
    const card = round(num(b.card ?? 0, 'Le montant par carte', { max: 1e8 }));
    const notes = str(b.notes, 'La remarque', { required: false, max: 500 });
    const ends = new Map((Array.isArray(b.readings) ? b.readings : []).map((r) => [Number(r.nozzleId), r.endMeter]));

    transaction(db, () => {
      const readings = db
        .prepare(
          `SELECT r.*, n.name AS nozzle_name FROM shift_readings r JOIN nozzles n ON n.id = r.nozzle_id
           WHERE r.shift_id = ?`,
        )
        .all(shift.id);
      const sales = db.prepare('SELECT * FROM sales WHERE shift_id = ?').all(shift.id);

      let totalLiters = 0;
      for (const r of readings) {
        const end = num(ends.get(r.nozzle_id), `L'index de fin (${r.nozzle_name})`, { max: 1e12 });
        if (end < r.start_meter) {
          fail(400, `L'index de fin (${r.nozzle_name}) ne peut pas être inférieur à l'index de début (${r.start_meter}).`);
        }
        const liters = round(end - r.start_meter);
        const customerLiters = sales.filter((s) => s.nozzle_id === r.nozzle_id).reduce((t, s) => t + s.liters, 0);
        if (customerLiters > liters + 0.001) {
          fail(400, `${r.nozzle_name} : les ventes clients (${round(customerLiters)} L) dépassent les litres du compteur (${liters} L).`);
        }
        totalLiters += liters;
        db.prepare('UPDATE shift_readings SET end_meter = ?, liters = ?, amount = ? WHERE id = ?').run(end, liters, round(liters * r.unit_price), r.id);
        db.prepare('UPDATE nozzles SET meter = ? WHERE id = ?').run(end, r.nozzle_id);
        db.prepare('UPDATE tanks SET book_stock = ROUND(book_stock - ?, 2) WHERE id = ?').run(liters, r.tank_id);
      }
      db.prepare(
        "UPDATE shifts SET status = 'closed', closed_at = datetime('now'), cash = ?, card = ?, total_liters = ?, notes = ? WHERE id = ?",
      ).run(cash, card, round(totalLiters), notes, shift.id);
      reconcile(shift.id);
    });
    res.json(shiftDetail(shift.id));
  });

  router.post('/shifts/:id/validate', requireRole('manager'), (req, res) => {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
    if (!shift) fail(404, 'Poste introuvable.');
    if (shift.status !== 'closed') fail(409, 'Seul un poste clôturé peut être validé.');
    const pending = pendingCancellations(shift.id);
    if (pending) fail(409, `Décidez d’abord ${pending > 1 ? `des ${pending} annulations demandées` : 'de l’annulation demandée'} sur ce poste.`);
    const comment = str(req.body?.comment, 'Le commentaire', { required: false, max: 500 });
    db.prepare(
      "UPDATE shifts SET status = 'validated', validated_by = ?, validated_at = datetime('now'), manager_comment = ? WHERE id = ?",
    ).run(req.user.id, comment, shift.id);
    res.json(shiftDetail(shift.id));
  });

  return router;
};
