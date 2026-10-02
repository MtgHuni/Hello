const express = require('express');
const { getSettings } = require('../db');
const { round, dateParam, fail } = require('../util');
const { requireRole } = require('../auth');

const manager = requireRole('manager');

// Sales are attributed to the day the shift was closed (station local time).
const DAY = "date(s.closed_at, 'localtime')";

module.exports = function reportRoutes(db) {
  const router = express.Router();

  router.get('/dashboard', manager, (req, res) => {
    const settings = getSettings(db);
    const today = db.prepare("SELECT date('now', 'localtime') AS d").get().d;

    const todayByProduct = db
      .prepare(
        `SELECT p.id, p.name, COALESCE(SUM(r.liters), 0) AS liters, COALESCE(SUM(r.amount), 0) AS amount
         FROM products p
         LEFT JOIN (SELECT r.* FROM shift_readings r JOIN shifts s ON s.id = r.shift_id
                    WHERE s.status != 'open' AND ${DAY} = ?) r ON r.product_id = p.id
         WHERE p.active = 1 GROUP BY p.id ORDER BY p.id`,
      )
      .all(today)
      .map((r) => ({ ...r, liters: round(r.liters), amount: round(r.amount) }));

    const last7 = db
      .prepare(
        `WITH RECURSIVE days(d) AS (SELECT date('now', 'localtime', '-6 days') UNION ALL SELECT date(d, '+1 day') FROM days WHERE d < date('now', 'localtime'))
         SELECT days.d AS date, COALESCE(SUM(s.total_amount), 0) AS amount, COALESCE(SUM(s.total_liters), 0) AS liters
         FROM days LEFT JOIN shifts s ON s.status != 'open' AND ${DAY} = days.d
         GROUP BY days.d ORDER BY days.d`,
      )
      .all()
      .map((r) => ({ ...r, amount: round(r.amount), liters: round(r.liters) }));

    const tanks = db
      .prepare(
        `SELECT t.id, t.name, t.capacity, t.low_level, t.book_stock, p.id AS product_id, p.name AS product_name
         FROM tanks t JOIN products p ON p.id = t.product_id WHERE t.active = 1 ORDER BY t.id`,
      )
      .all();

    const openShifts = db
      .prepare(
        `SELECT s.id, s.opened_at, u.name AS attendant_name FROM shifts s JOIN users u ON u.id = s.attendant_id
         WHERE s.status = 'open' ORDER BY s.id`,
      )
      .all();

    const toValidate = db
      .prepare(
        `SELECT s.id, s.closed_at, s.variance, s.total_amount, u.name AS attendant_name
         FROM shifts s JOIN users u ON u.id = s.attendant_id WHERE s.status = 'closed' ORDER BY s.id`,
      )
      .all();

    const customers = db
      .prepare(
        `SELECT c.id, c.name, c.credit_limit,
           ROUND((SELECT COALESCE(SUM(amount), 0) FROM sales WHERE customer_id = c.id AND kind = 'credit') -
                 (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE customer_id = c.id), 2) AS balance
         FROM customers c WHERE c.type = 'account' AND c.active = 1`,
      )
      .all();

    const recentDips = db
      .prepare(
        `SELECT d.id, d.variance, d.created_at, t.name AS tank_name FROM dips d JOIN tanks t ON t.id = d.tank_id
         WHERE d.created_at >= datetime('now', '-7 days') AND ABS(d.variance) > ? ORDER BY d.id DESC`,
      )
      .all(settings.stockTolerance);

    const alerts = [];
    for (const t of tanks) {
      if (t.book_stock <= t.low_level) {
        alerts.push({ level: 'critical', text: `${t.name} : stock bas (${round(t.book_stock)} L, seuil ${t.low_level} L)`, link: '#/cuves' });
      }
    }
    for (const s of toValidate) {
      if (Math.abs(s.variance) > settings.cashTolerance) {
        alerts.push({
          level: 'serious',
          text: `Poste n°${s.id} (${s.attendant_name}) : écart de caisse de ${s.variance.toFixed(2).replace('.', ',')} $`,
          link: `#/postes/${s.id}`,
        });
      }
    }
    for (const d of recentDips) {
      alerts.push({ level: 'serious', text: `${d.tank_name} : écart de jaugeage de ${String(d.variance).replace('.', ',')} L`, link: '#/cuves' });
    }
    for (const c of customers) {
      if (c.balance > c.credit_limit) {
        alerts.push({ level: 'warning', text: `${c.name} dépasse son plafond de crédit`, link: `#/clients/${c.id}` });
      }
    }

    res.json({
      today,
      settings,
      todayByProduct,
      todayTotal: {
        liters: round(todayByProduct.reduce((t, p) => t + p.liters, 0)),
        amount: round(todayByProduct.reduce((t, p) => t + p.amount, 0)),
      },
      last7,
      tanks,
      openShifts,
      toValidate: toValidate.length,
      receivables: round(customers.reduce((t, c) => t + Math.max(0, c.balance), 0)),
      alerts,
    });
  });

  router.get('/reports/sales', manager, (req, res) => {
    const from = dateParam(req.query.from, 'La date de début');
    const to = dateParam(req.query.to, 'La date de fin');
    if (!from || !to) fail(400, 'Choisissez une période.');
    if (from > to) fail(400, 'La date de début doit précéder la date de fin.');

    const byDay = db
      .prepare(
        `SELECT ${DAY} AS date, p.name AS product, ROUND(SUM(r.liters), 2) AS liters, ROUND(SUM(r.amount), 2) AS amount
         FROM shift_readings r JOIN shifts s ON s.id = r.shift_id JOIN products p ON p.id = r.product_id
         WHERE s.status != 'open' AND ${DAY} BETWEEN ? AND ?
         GROUP BY 1, p.id ORDER BY 1, p.id`,
      )
      .all(from, to);

    const byProduct = db
      .prepare(
        `SELECT p.name AS product, ROUND(SUM(r.liters), 2) AS liters, ROUND(SUM(r.amount), 2) AS amount
         FROM shift_readings r JOIN shifts s ON s.id = r.shift_id JOIN products p ON p.id = r.product_id
         WHERE s.status != 'open' AND ${DAY} BETWEEN ? AND ?
         GROUP BY p.id ORDER BY p.id`,
      )
      .all(from, to);

    const byAttendant = db
      .prepare(
        `SELECT u.name AS attendant, COUNT(*) AS shifts, ROUND(SUM(s.total_liters), 2) AS liters,
           ROUND(SUM(s.total_amount), 2) AS amount, ROUND(SUM(s.variance), 2) AS variance
         FROM shifts s JOIN users u ON u.id = s.attendant_id
         WHERE s.status != 'open' AND ${DAY} BETWEEN ? AND ?
         GROUP BY u.id ORDER BY amount DESC`,
      )
      .all(from, to);

    const money = db
      .prepare(
        `SELECT ROUND(COALESCE(SUM(cash), 0), 2) AS cash, ROUND(COALESCE(SUM(card), 0), 2) AS card,
           ROUND(COALESCE(SUM(credit_amount), 0), 2) AS credit, ROUND(COALESCE(SUM(variance), 0), 2) AS variance,
           ROUND(COALESCE(SUM(total_amount), 0), 2) AS amount, ROUND(COALESCE(SUM(total_liters), 0), 2) AS liters
         FROM shifts s WHERE s.status != 'open' AND ${DAY} BETWEEN ? AND ?`,
      )
      .get(from, to);

    const deliveries = db
      .prepare(
        `SELECT p.name AS product, ROUND(SUM(d.liters_received), 2) AS liters,
           ROUND(SUM(d.liters_received - d.liters_ordered), 2) AS shortfall,
           ROUND(SUM(d.liters_received * COALESCE(d.unit_cost, 0)), 2) AS cost
         FROM deliveries d JOIN tanks t ON t.id = d.tank_id JOIN products p ON p.id = t.product_id
         WHERE date(d.created_at, 'localtime') BETWEEN ? AND ?
         GROUP BY p.id ORDER BY p.id`,
      )
      .all(from, to);

    const payments = db
      .prepare(
        `SELECT ROUND(COALESCE(SUM(amount), 0), 2) AS total FROM payments WHERE date(created_at, 'localtime') BETWEEN ? AND ?`,
      )
      .get(from, to).total;

    if (req.query.format === 'csv') {
      const lines = ['Date;Produit;Litres;Montant (USD)'];
      for (const r of byDay) lines.push([r.date, r.product, String(r.liters).replace('.', ','), String(r.amount).replace('.', ',')].join(';'));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="ventes_${from}_${to}.csv"`);
      return res.send(`﻿${lines.join('\r\n')}\r\n`);
    }

    res.json({ from, to, totals: { ...money, payments }, byDay, byProduct, byAttendant, deliveries });
  });

  return router;
};
