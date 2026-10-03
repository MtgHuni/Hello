const express = require('express');
const { getSettings } = require('../db');
const { fail, num, str, round, dateParam, transaction } = require('../util');
const { requireRole } = require('../auth');
const { customerBalance } = require('./customers');

const staff = requireRole('manager', 'attendant');
const money = (n) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

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
    if (shift.status === 'open') {
      shift.credit_amount = round(shift.sales.filter((s) => s.kind === 'credit').reduce((t, s) => t + s.amount, 0));
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
             s.expected_amount, s.cash, s.card, s.variance, u.name AS attendant_name,
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
            `SELECT n.id, n.meter, n.tank_id, t.product_id, p.price
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
        'INSERT INTO shift_readings (shift_id, nozzle_id, product_id, tank_id, unit_price, start_meter) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const n of nozzles) insert.run(shiftId, n.id, n.product_id, n.tank_id, n.price, n.meter);
      return shiftId;
    });
    res.status(201).json(shiftDetail(id));
  });

  // Customer sale during a shift: credit for account customers,
  // loyalty points for individuals (who pay cash or card as usual).
  router.post('/shifts/:id/sales', staff, (req, res) => {
    const shift = getOwnShift(req);
    const b = req.body || {};
    const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND active = 1').get(Number(b.customerId));
    if (!customer) fail(400, 'Client inconnu ou désactivé.');
    const reading = db
      .prepare('SELECT * FROM shift_readings WHERE shift_id = ? AND nozzle_id = ?')
      .get(shift.id, Number(b.nozzleId));
    if (!reading) fail(400, 'Ce pistolet ne fait pas partie de votre poste.');
    const liters = round(num(b.liters, 'Le nombre de litres', { min: 0.01, max: 100000 }));
    const plate = str(b.plate, "L'immatriculation", { required: false, max: 20 });
    const amount = round(liters * reading.unit_price);
    const kind = customer.type === 'account' ? 'credit' : 'loyalty';
    const settings = getSettings(db);
    const points = kind === 'loyalty' && settings.loyaltyEnabled ? Math.floor(liters * settings.pointsPerLiter) : 0;

    const id = transaction(db, () => {
      if (kind === 'credit') {
        const balance = customerBalance(db, customer.id);
        if (balance + amount > customer.credit_limit + 0.001) {
          fail(
            409,
            `Plafond de crédit dépassé : encours ${money(balance)}, plafond ${money(customer.credit_limit)}, disponible ${money(Math.max(0, customer.credit_limit - balance))}.`,
          );
        }
      }
      const r = db
        .prepare(
          `INSERT INTO sales (shift_id, customer_id, nozzle_id, product_id, kind, liters, unit_price, amount, points, plate)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(shift.id, customer.id, reading.nozzle_id, reading.product_id, kind, liters, reading.unit_price, amount, points, plate ?? customer.plate);
      if (points) db.prepare('UPDATE customers SET loyalty_points = loyalty_points + ? WHERE id = ?').run(points, customer.id);
      return r.lastInsertRowid;
    });
    res.status(201).json(db.prepare('SELECT * FROM sales WHERE id = ?').get(id));
  });

  router.delete('/shifts/:id/sales/:saleId', staff, (req, res) => {
    const shift = getOwnShift(req);
    const sale = db.prepare('SELECT * FROM sales WHERE id = ? AND shift_id = ?').get(req.params.saleId, shift.id);
    if (!sale) fail(404, 'Vente introuvable.');
    transaction(db, () => {
      db.prepare('DELETE FROM sales WHERE id = ?').run(sale.id);
      if (sale.points) {
        db.prepare('UPDATE customers SET loyalty_points = MAX(0, loyalty_points - ?) WHERE id = ?').run(sale.points, sale.customer_id);
      }
    });
    res.status(204).end();
  });

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
      let totalAmount = 0;
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
        const amount = round(liters * r.unit_price);
        totalLiters += liters;
        totalAmount += amount;
        db.prepare('UPDATE shift_readings SET end_meter = ?, liters = ?, amount = ? WHERE id = ?').run(end, liters, amount, r.id);
        db.prepare('UPDATE nozzles SET meter = ? WHERE id = ?').run(end, r.nozzle_id);
        db.prepare('UPDATE tanks SET book_stock = ROUND(book_stock - ?, 2) WHERE id = ?').run(liters, r.tank_id);
      }
      const creditAmount = round(sales.filter((s) => s.kind === 'credit').reduce((t, s) => t + s.amount, 0));
      const expected = round(totalAmount - creditAmount);
      db.prepare(
        `UPDATE shifts SET status = 'closed', closed_at = datetime('now'), cash = ?, card = ?, total_liters = ?,
           total_amount = ?, credit_amount = ?, expected_amount = ?, variance = ?, notes = ?
         WHERE id = ?`,
      ).run(cash, card, round(totalLiters), round(totalAmount), creditAmount, expected, round(cash + card - expected), notes, shift.id);
    });
    res.json(shiftDetail(shift.id));
  });

  router.post('/shifts/:id/validate', requireRole('manager'), (req, res) => {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
    if (!shift) fail(404, 'Poste introuvable.');
    if (shift.status !== 'closed') fail(409, 'Seul un poste clôturé peut être validé.');
    const comment = str(req.body?.comment, 'Le commentaire', { required: false, max: 500 });
    db.prepare(
      "UPDATE shifts SET status = 'validated', validated_by = ?, validated_at = datetime('now'), manager_comment = ? WHERE id = ?",
    ).run(req.user.id, comment, shift.id);
    res.json(shiftDetail(shift.id));
  });

  return router;
};
