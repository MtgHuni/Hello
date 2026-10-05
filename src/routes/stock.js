const express = require('express');
const { fail, num, str, oneOf, round, transaction } = require('../util');
const { requireRole } = require('../auth');
const { audit } = require('../audit');

const manager = requireRole('manager');

// Paid on the spot in cash (out of the cash book), taken on credit (a debt to the supplier), or
// already paid before the app (neither: it only made the stock).
const PAYMENT_LABEL = { cash: 'payée comptant', credit: 'à crédit', prepaid: 'déjà payée' };
function paymentOf(b) {
  const payment = oneOf(b.payment || 'cash', 'Le paiement', Object.keys(PAYMENT_LABEL));
  return { payment, payMethod: payment === 'cash' ? 'espèces' : null };
}
function checkCredit(payment, supplier, amount) {
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
    checkCredit(payment, supplier, amount);

    const id = transaction(db, () => {
      const r = db
        .prepare(
          `INSERT INTO deliveries (tank_id, supplier, reference, liters_ordered, liters_received, unit_cost, book_before, user_id, payment, amount, pay_method)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(tank.id, supplier, reference, ordered, received, unitCost ?? (amount ? round(amount / received, 4) : null), tank.book_stock, req.user.id, payment, amount, payMethod);
      db.prepare('UPDATE tanks SET book_stock = ? WHERE id = ?').run(round(tank.book_stock + received), tank.id);
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
    checkCredit(payment, supplier, amount);
    const after = { payment, pay_method: payMethod, supplier, reference, amount };
    transaction(db, () => {
      db.prepare('UPDATE deliveries SET payment = ?, pay_method = ?, supplier = ?, reference = ?, amount = ? WHERE id = ?').run(payment, payMethod, supplier, reference, amount, d.id);
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

  // A dip (physical measurement) is compared with the book stock, then becomes
  // the new reference: the variance is recorded and the book stock is reset.
  router.post('/dips', manager, (req, res) => {
    const tank = getTank(num(req.body?.tankId, 'La cuve', { integer: true, min: 1 }));
    const measured = num(req.body?.measured, 'Le volume mesuré', { max: tank.capacity * 1.05 });
    const note = str(req.body?.note, 'La note', { required: false, max: 300 });
    const variance = round(measured - tank.book_stock);

    const id = transaction(db, () => {
      const r = db
        .prepare('INSERT INTO dips (tank_id, measured, book_stock, variance, note, user_id) VALUES (?, ?, ?, ?, ?, ?)')
        .run(tank.id, measured, tank.book_stock, variance, note, req.user.id);
      db.prepare('UPDATE tanks SET book_stock = ? WHERE id = ?').run(measured, tank.id);
      return r.lastInsertRowid;
    });
    res.status(201).json(db.prepare('SELECT * FROM dips WHERE id = ?').get(id));
  });

  return router;
};
