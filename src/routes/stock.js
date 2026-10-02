const express = require('express');
const { fail, num, str, round, transaction } = require('../util');
const { requireRole } = require('../auth');

const manager = requireRole('manager');

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

    const id = transaction(db, () => {
      const r = db
        .prepare(
          `INSERT INTO deliveries (tank_id, supplier, reference, liters_ordered, liters_received, unit_cost, book_before, user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(tank.id, supplier, reference, ordered, received, unitCost, tank.book_stock, req.user.id);
      db.prepare('UPDATE tanks SET book_stock = ? WHERE id = ?').run(round(tank.book_stock + received), tank.id);
      return r.lastInsertRowid;
    });
    res.status(201).json(db.prepare('SELECT * FROM deliveries WHERE id = ?').get(id));
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
