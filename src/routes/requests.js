const express = require('express');
const { fail, num, str, oneOf, round } = require('../util');
const { requireRole } = require('../auth');
const { getSettings } = require('../db');
const { createSale } = require('../sales');
const { customerBalance } = require('./customers');

const staff = requireRole('manager', 'attendant');
const customerOnly = requireRole('customer');

// A request not handled within this delay is no longer shown to attendants.
const FRESH = "created_at >= datetime('now', '-30 minutes')";

module.exports = function requestRoutes(db) {
  const router = express.Router();

  const select = `
    SELECT r.*, c.name AS customer_name, c.phone AS customer_phone, c.type AS customer_type, c.credit_limit, c.loyalty_points,
      p.name AS product_name, CASE c.type WHEN 'account' THEN COALESCE(cp.price, p.subscriber_price, p.price) ELSE p.price END AS current_price,
      CASE c.type WHEN 'account' THEN cp.price END AS own_price, u.name AS handled_by_name, s.points AS sale_points,
      s.liters AS sale_liters, s.amount AS sale_amount, s.combos_used AS sale_combos
    FROM purchase_requests r JOIN customers c ON c.id = r.customer_id JOIN products p ON p.id = r.product_id
    LEFT JOIN customer_prices cp ON cp.customer_id = c.id AND cp.product_id = p.id
    LEFT JOIN users u ON u.id = r.handled_by LEFT JOIN sales s ON s.id = r.sale_id`;

  // ---- Customer side -----------------------------------------------------

  // Latest request of the customer (pending, or handled in the last 30 minutes).
  router.get('/me/requests/current', customerOnly, (req, res) => {
    const row = db
      .prepare(`${select} WHERE r.customer_id = ? AND r.${FRESH} AND r.status != 'cancelled' ORDER BY r.id DESC LIMIT 1`)
      .get(req.user.customer_id);
    res.json(row || null);
  });

  router.post('/me/requests', customerOnly, (req, res) => {
    const b = req.body || {};
    const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND active = 1').get(req.user.customer_id);
    if (!customer) fail(403, 'Compte client désactivé.');
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(Number(b.productId));
    if (!product) fail(400, 'Choisissez un produit.');
    // Paying cash needs no request: the pump's indexes count it. Requests are on credit (or combos).
    if (b.payment === 'paid') fail(400, 'Préparez votre achat à crédit : un achat comptant se paie directement à la pompe.');
    const payment = oneOf(b.payment ?? 'credit', 'Le mode de paiement', ['credit', 'combo']);
    if (payment === 'credit' && customer.type !== 'account') {
      const owed = customerBalance(db, customer.id);
      if (owed > 0.001) fail(409, `Vous avez déjà un crédit non payé de ${String(round(owed).toFixed(2)).replace('.', ',')} $ : réglez-le avant un nouvel achat à crédit.`, 'has_credit');
    }
    const { comboThreshold, combosEnabled } = getSettings(db);
    if (payment === 'combo' && !combosEnabled) fail(400, 'Les combos sont désactivés.');
    if (payment === 'combo' && customer.loyalty_points < comboThreshold) {
      fail(400, `Il faut au moins ${comboThreshold} combos pour les échanger (vous en avez ${customer.loyalty_points}).`);
    }
    const byLiters = b.liters !== undefined && b.liters !== null && b.liters !== '';
    const liters = byLiters ? round(num(b.liters, 'Le nombre de litres', { min: 0.5, max: 2000 })) : null;
    const amount = byLiters ? null : round(num(b.amount, 'Le montant', { min: 0.5, max: 100000 }));
    const plate = str(b.plate, "L'immatriculation", { required: false, max: 20 }) ?? customer.plate;

    // One pending request per customer: a new one replaces the previous.
    db.prepare("UPDATE purchase_requests SET status = 'cancelled' WHERE customer_id = ? AND status = 'pending'").run(customer.id);
    const id = db
      .prepare('INSERT INTO purchase_requests (customer_id, product_id, liters, amount, payment, plate) VALUES (?, ?, ?, ?, ?, ?)')
      .run(customer.id, product.id, liters, amount, payment, plate).lastInsertRowid;
    if (plate && !customer.plate) db.prepare('UPDATE customers SET plate = ? WHERE id = ?').run(plate, customer.id);
    res.status(201).json(db.prepare(`${select} WHERE r.id = ?`).get(id));
  });

  router.delete('/me/requests/:id', customerOnly, (req, res) => {
    const r = db
      .prepare("UPDATE purchase_requests SET status = 'cancelled' WHERE id = ? AND customer_id = ? AND status = 'pending'")
      .run(req.params.id, req.user.customer_id);
    if (!r.changes) fail(409, 'Cette demande a déjà été traitée.');
    res.status(204).end();
  });

  // ---- Attendant side ----------------------------------------------------

  // The station's shift, if this attendant is on it and the station is open.
  const openShiftOf = (userId) =>
    db
      .prepare(
        `SELECT s.* FROM shifts s JOIN shift_attendants a ON a.shift_id = s.id AND a.user_id = ? AND a.left_at IS NULL
         WHERE s.status = 'open' AND s.station_closed_at IS NULL`,
      )
      .get(userId);

  // Pending requests for the products served in the attendant's open shift.
  router.get('/requests/pending', staff, (req, res) => {
    const shift = openShiftOf(req.user.id);
    if (!shift && req.user.role !== 'manager') return res.json([]);
    const rows = db
      .prepare(
        `${select} WHERE r.status = 'pending' AND r.${FRESH}
           AND (? IS NULL OR r.product_id IN (SELECT product_id FROM shift_readings WHERE shift_id = ?))
         ORDER BY r.id`,
      )
      .all(shift?.id ?? null, shift?.id ?? null);
    for (const r of rows) {
      r.balance = customerBalance(db, r.customer_id);
    }
    res.json(rows);
  });

  function getPending(id) {
    const request = db.prepare(`SELECT * FROM purchase_requests WHERE id = ? AND ${FRESH}`).get(id);
    if (!request) fail(404, 'Demande introuvable ou expirée.');
    if (request.status !== 'pending') fail(409, 'Cette demande a déjà été traitée.');
    return request;
  }

  // One tap: the request becomes a sale in the attendant's shift (quantity can be adjusted).
  router.post('/requests/:id/confirm', staff, (req, res) => {
    const request = getPending(req.params.id);
    const shift = openShiftOf(req.user.id);
    if (!shift) fail(409, 'Prenez d’abord le poste.');
    const b = req.body || {};
    const adjusted = b.liters !== undefined || b.amount !== undefined;
    const sale = createSale(db, shift, {
      customerId: request.customer_id,
      productId: request.product_id,
      nozzleId: b.nozzleId,
      liters: adjusted ? b.liters : request.liters,
      amount: adjusted ? b.amount : request.amount,
      payment: request.payment,
      userId: req.user.id,
      plate: request.plate,
      grantCredit: b.grantCredit === true,
      source: 'customer',
      afterInsert: (saleId) => {
        const r = db
          .prepare("UPDATE purchase_requests SET status = 'confirmed', sale_id = ?, handled_by = ?, handled_at = datetime('now') WHERE id = ? AND status = 'pending'")
          .run(saleId, req.user.id, request.id);
        if (!r.changes) fail(409, 'Cette demande a déjà été traitée.');
      },
    });
    res.status(201).json(sale);
  });

  router.post('/requests/:id/reject', staff, (req, res) => {
    const request = getPending(req.params.id);
    const note = str(req.body?.note, 'La raison', { required: false, max: 200 });
    db.prepare("UPDATE purchase_requests SET status = 'rejected', handled_by = ?, handled_at = datetime('now'), note = ? WHERE id = ?").run(
      req.user.id,
      note,
      request.id,
    );
    res.status(204).end();
  });

  return router;
};
