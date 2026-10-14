const express = require('express');
const { fail, num, str, oneOf, round, transaction } = require('../util');
const { requireRole } = require('../auth');
const { audit } = require('../audit');
const { openMeters, soldByTank } = require('../liveStock');
const { SUPPLIER_PAYMENT } = require('../db');

const manager = requireRole('manager');

// Paid on the spot in cash (out of the cash book), with the open shift's money (an expense of that
// shift, deducted from what the attendants hand over), taken on credit (a debt to the supplier), or
// already paid before the app (neither: it only made the stock).
const PAYMENT_LABEL = { cash: 'payée comptant', shift: 'payée avec l’argent du poste', credit: 'à crédit', prepaid: 'déjà payée' };
function paymentOf(b) {
  const payment = oneOf(b.payment || 'cash', 'Le paiement', Object.keys(PAYMENT_LABEL));
  return { payment, payMethod: payment === 'cash' || payment === 'shift' ? 'espèces' : null };
}
function checkPayment(payment, supplier, amount) {
  if (payment === 'shift' && !supplier) fail(400, 'Indiquez le fournisseur payé avec l’argent du poste.');
  if (payment === 'shift' && !amount) fail(400, 'Indiquez le prix d’achat : c’est ce qui sort de l’argent du poste.');
  if (payment !== 'credit') return;
  if (!supplier) fail(400, 'Indiquez le fournisseur : la livraison à crédit devient une dette envers lui.');
  if (!amount) fail(400, 'Indiquez le montant dû : c’est ce que la station devra au fournisseur.');
}

module.exports = function stockRoutes(db) {
  const router = express.Router();

  const getTank = (id) => {
    const tank = db.prepare('SELECT * FROM tanks WHERE id = ?').get(id);
    if (!tank) fail(400, 'Cuve inconnue.');
    return tank;
  };

  // A supplier named on a delivery gets a record (for its contacts), under its first spelling.
  const supplierName = (name) => {
    if (!name) return name;
    db.prepare('INSERT OR IGNORE INTO suppliers (name) VALUES (?)').run(name);
    return db.prepare('SELECT name FROM suppliers WHERE name = ?').get(name).name;
  };

  // During the open shift, a delivery or a dip reads the index of the nozzles fed by the tank:
  // the fuel sold so far comes off the stock (src/liveStock.js). Without an index, the last one taken counts.
  function stockNow(tank, given) {
    const list = Array.isArray(given) ? given : [];
    const meters = openMeters(db);
    const fresh = new Map();
    for (const m of meters.filter((x) => x.tankId === tank.id)) {
      const g = list.find((x) => Number(x.nozzleId) === m.nozzleId);
      if (g === undefined || g.meter === '' || g.meter == null) continue;
      const meter = round(num(g.meter, `L’index (${m.label})`, { max: 1e12 }));
      if (meter < m.latest - 0.001) fail(400, `L’index (${m.label}) ne peut pas être inférieur au dernier relevé (${m.latest}).`);
      fresh.set(m.nozzleId, meter);
    }
    const sold = soldByTank(db, meters, fresh).get(tank.id) || 0;
    const readings = meters.filter((m) => fresh.has(m.nozzleId)).map((m) => ({ shiftId: m.shiftId, nozzleId: m.nozzleId, meter: fresh.get(m.nozzleId) }));
    return { sold, live: round(tank.book_stock - sold), readings };
  }
  // A delivery paid with the shift's money is an expense of the open shift.
  const openShift = () => {
    const shift = db.prepare("SELECT * FROM shifts WHERE status = 'open' ORDER BY id DESC LIMIT 1").get();
    if (!shift) fail(409, 'Aucun poste ouvert : la livraison ne peut pas être payée avec l’argent du poste.', 'no_open_shift');
    return shift;
  };
  const shiftExpense = (req, { tank, liters, supplier, reference, amount }) =>
    Number(
      db
        .prepare(
          `INSERT INTO expenses (expense_date, category, amount, description, beneficiary, method, reference, shift_id, user_id)
           VALUES (date('now', 'localtime'), ?, ?, ?, ?, 'espèces', ?, ?, ?)`,
        )
        .run(SUPPLIER_PAYMENT, amount, `Livraison ${tank.name}, ${liters} L`, supplier, reference, openShift().id, req.user.id).lastInsertRowid,
    );
  // The expense of a delivery can only change while its shift is open (a closed shift is reconciled).
  const linkedExpense = (d) => {
    const e = d.expense_id && db.prepare('SELECT e.*, s.status AS shift_status FROM expenses e JOIN shifts s ON s.id = e.shift_id WHERE e.id = ?').get(d.expense_id);
    if (e && e.shift_status !== 'open') fail(409, `Le poste n°${e.shift_id} est clôturé : corrigez la dépense depuis sa fiche.`, 'shift_closed');
    return e;
  };

  const saveReadings = (readings, source, sourceId) => {
    for (const r of readings) db.prepare('INSERT INTO stock_readings (shift_id, nozzle_id, meter, source, source_id) VALUES (?, ?, ?, ?, ?)').run(r.shiftId, r.nozzleId, r.meter, source, sourceId);
  };

  // The indexes to ask at a delivery or a dip: the open shift's nozzles, each with its last index.
  router.get('/stock/meters', manager, (req, res) => {
    res.json(openMeters(db).map((m) => ({ nozzleId: m.nozzleId, tankId: m.tankId, label: m.label, latest: m.latest })));
  });

  router.get('/deliveries', manager, (req, res) => {
    res.json(
      db
        .prepare(
          `SELECT d.*, t.name AS tank_name, p.name AS product_name, u.name AS user_name
           FROM deliveries d JOIN tanks t ON t.id = d.tank_id JOIN products p ON p.id = t.product_id
           LEFT JOIN users u ON u.id = d.user_id
           WHERE (? IS NULL OR d.tank_id = ?)
           ORDER BY d.id DESC LIMIT 200`,
        )
        .all(req.query.tankId ?? null, req.query.tankId ?? null),
    );
  });

  // A delivery adds the litres actually received (measured) to the book stock;
  // the gap with the litres ordered is the supplier shortfall.
  router.post('/deliveries', manager, (req, res) => {
    const b = req.body || {};
    const tank = getTank(num(b.tankId, 'La cuve', { integer: true, min: 1 }));
    const ordered = num(b.litersOrdered, 'Les litres commandés', { min: 0.01, max: 1e7 });
    const received = num(b.litersReceived ?? ordered, 'Les litres reçus', { min: 0.01, max: 1e7 });
    const unitCost = num(b.unitCost, "Le prix d'achat", { required: false, max: 1000 });
    const supplier = str(b.supplier, 'Le fournisseur', { required: false, max: 100 });
    const reference = str(b.reference, 'La référence', { required: false, max: 100 });
    const { payment, payMethod } = paymentOf(b);
    const computed = unitCost ? round(unitCost * received) : null;
    const amount = b.amount === undefined || b.amount === '' || b.amount === null ? computed : round(num(b.amount, 'Le montant de la facture', { min: 0.01, max: 1e9 }));
    checkPayment(payment, supplier, amount);
    if (payment === 'shift') openShift();
    const { live, readings } = stockNow(tank, b.meters);
    if (live + received > tank.capacity + 0.5 && !b.force) {
      fail(409, `${tank.name} contiendrait ${round(live + received)} L pour une capacité de ${tank.capacity} L (stock actuel ${live} L + ${received} L reçus). Vérifiez l’index et les litres reçus.`, 'over_capacity');
    }

    const id = transaction(db, () => {
      const r = db
        .prepare(
          `INSERT INTO deliveries (tank_id, supplier, reference, liters_ordered, liters_received, unit_cost, book_before, user_id, payment, amount, pay_method)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(tank.id, supplierName(supplier), reference, ordered, received, unitCost ?? (amount ? round(amount / received, 4) : null), live, req.user.id, payment, amount, payMethod);
      if (payment === 'shift') {
        const expenseId = shiftExpense(req, { tank, liters: received, supplier: supplierName(supplier), reference, amount });
        db.prepare('UPDATE deliveries SET expense_id = ? WHERE id = ?').run(expenseId, r.lastInsertRowid);
      }
      db.prepare('UPDATE tanks SET book_stock = ? WHERE id = ?').run(round(tank.book_stock + received), tank.id);
      saveReadings(readings, 'delivery', Number(r.lastInsertRowid));
      return r.lastInsertRowid;
    });
    res.status(201).json(db.prepare('SELECT * FROM deliveries WHERE id = ?').get(id));
  });

  // The payment of a delivery can be corrected (e.g. old deliveries entered to set the stock).
  // The litres stay: they made the stock.
  router.put('/deliveries/:id', manager, (req, res) => {
    const d = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(req.params.id);
    if (!d) fail(404, 'Livraison introuvable.');
    const b = req.body || {};
    const { payment, payMethod } = paymentOf(b);
    const supplier = b.supplier === undefined ? d.supplier : str(b.supplier, 'Le fournisseur', { required: false, max: 100 });
    const reference = b.reference === undefined ? d.reference : str(b.reference, 'La référence', { required: false, max: 100 });
    const amount = b.amount === undefined ? d.amount : b.amount === '' || b.amount === null ? null : round(num(b.amount, 'Le montant', { min: 0.01, max: 1e9 }));
    checkPayment(payment, supplier, amount);
    const expense = linkedExpense(d);
    const after = { payment, pay_method: payMethod, supplier, reference, amount };
    transaction(db, () => {
      let expenseId = d.expense_id;
      if (payment === 'shift' && expense) {
        db.prepare('UPDATE expenses SET amount = ?, beneficiary = ?, reference = ? WHERE id = ?').run(amount, supplierName(supplier), reference, expense.id);
      } else if (payment === 'shift') {
        const tank = db.prepare('SELECT * FROM tanks WHERE id = ?').get(d.tank_id);
        expenseId = shiftExpense(req, { tank, liters: d.liters_received, supplier: supplierName(supplier), reference, amount });
      } else if (expense) {
        expenseId = null;
      }
      db.prepare('UPDATE deliveries SET payment = ?, pay_method = ?, supplier = ?, reference = ?, amount = ?, expense_id = ? WHERE id = ?').run(payment, payMethod, supplierName(supplier), reference, amount, expenseId, d.id);
      if (expense && payment !== 'shift') db.prepare('DELETE FROM expenses WHERE id = ?').run(expense.id);
      audit(db, req, {
        category: 'donnees',
        action: 'delivery_payment',
        entity: 'deliveries',
        id: d.id,
        summary: `Livraison du ${d.created_at.slice(0, 10)} (${d.liters_received} L) : paiement corrigé, ${PAYMENT_LABEL[d.payment] || '—'} → ${PAYMENT_LABEL[payment]}`,
        before: { payment: d.payment, pay_method: d.pay_method, supplier: d.supplier, reference: d.reference, amount: d.amount },
        after,
      });
    });
    res.json(db.prepare('SELECT * FROM deliveries WHERE id = ?').get(d.id));
  });

  router.get('/dips', manager, (req, res) => {
    res.json(
      db
        .prepare(
          `SELECT d.*, t.name AS tank_name, u.name AS user_name
           FROM dips d JOIN tanks t ON t.id = d.tank_id LEFT JOIN users u ON u.id = d.user_id
           WHERE (? IS NULL OR d.tank_id = ?)
           ORDER BY d.id DESC LIMIT 200`,
        )
        .all(req.query.tankId ?? null, req.query.tankId ?? null),
    );
  });

  // A dip (physical measurement) is compared with the stock now, then becomes the new reference:
  // the variance is recorded and the book stock is reset. During the open shift, the fuel sold so far
  // stays in the book stock until the closing takes it off.
  router.post('/dips', manager, (req, res) => {
    const tank = getTank(num(req.body?.tankId, 'La cuve', { integer: true, min: 1 }));
    const measured = num(req.body?.measured, 'Le volume mesuré', { max: tank.capacity * 1.05 });
    const note = str(req.body?.note, 'La note', { required: false, max: 300 });
    const { sold, live, readings } = stockNow(tank, req.body?.meters);
    const variance = round(measured - live);

    const id = transaction(db, () => {
      const r = db
        .prepare('INSERT INTO dips (tank_id, measured, book_stock, variance, note, user_id) VALUES (?, ?, ?, ?, ?, ?)')
        .run(tank.id, measured, live, variance, note, req.user.id);
      db.prepare('UPDATE tanks SET book_stock = ? WHERE id = ?').run(round(measured + sold), tank.id);
      saveReadings(readings, 'dip', Number(r.lastInsertRowid));
      return r.lastInsertRowid;
    });
    res.status(201).json(db.prepare('SELECT * FROM dips WHERE id = ?').get(id));
  });

  return router;
};
