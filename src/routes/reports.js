const express = require('express');
const { getSettings } = require('../db');
const { round, dateParam, fail, csvCell, money } = require('../util');
const { requireRole } = require('../auth');
const { balanceSql, subscriberDues, creditAllocation } = require('../loyalty');
const { balances, supplierBalances } = require('../cashbook');
const { attendantNamesSql, closingCutoff } = require('../checkpoints');
const { periodReportPdf } = require('../periodReport');
const { withLiveStock } = require('../liveStock');

const manager = requireRole('manager');

// Sales are attributed to the day the shift was closed (station local time).
const DAY = "date(s.closed_at, 'localtime')";

module.exports = function reportRoutes(db) {
  const router = express.Router();

  // Subscribers pay their own price: the gap with the pump price, per closing day and product.
  // The meter amounts are at the pump price, so this is added to get the real sales.
  const surchargeStmt = db.prepare(
    `SELECT ${DAY} AS date, sa.product_id, SUM(sa.amount - sa.liters * r.unit_price) AS surcharge
     FROM sales sa JOIN shifts s ON s.id = sa.shift_id
     JOIN shift_readings r ON r.shift_id = sa.shift_id AND r.nozzle_id = sa.nozzle_id
     WHERE s.status != 'open' AND ${DAY} BETWEEN ? AND ?
     GROUP BY 1, sa.product_id`,
  );
  const surcharges = (from, to) => new Map(surchargeStmt.all(from, to).map((r) => [`${r.date}|${r.product_id}`, r.surcharge]));

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
      .all(today);
    const todaySurcharge = surcharges(today, today);
    for (const r of todayByProduct) {
      r.liters = round(r.liters);
      r.amount = round(r.amount + (todaySurcharge.get(`${today}|${r.id}`) || 0));
    }

    const last7 = db
      .prepare(
        `WITH RECURSIVE days(d) AS (SELECT date('now', 'localtime', '-6 days') UNION ALL SELECT date(d, '+1 day') FROM days WHERE d < date('now', 'localtime'))
         SELECT days.d AS date, COALESCE(SUM(s.total_amount), 0) AS amount, COALESCE(SUM(s.total_liters), 0) AS liters
         FROM days LEFT JOIN shifts s ON s.status != 'open' AND ${DAY} = days.d
         GROUP BY days.d ORDER BY days.d`,
      )
      .all()
      .map((r) => ({ ...r, amount: round(r.amount), liters: round(r.liters) }));

    const tanks = withLiveStock(
      db,
      db
        .prepare(
          `SELECT t.id, t.name, t.capacity, t.low_level, t.book_stock, p.id AS product_id, p.name AS product_name
           FROM tanks t JOIN products p ON p.id = t.product_id WHERE t.active = 1 ORDER BY t.id`,
        )
        .all(),
    );

    const openShifts = db
      .prepare(
        `SELECT s.id, s.opened_at, s.station_closed_at, COALESCE(${attendantNamesSql}, u.name) AS attendant_name,
           (SELECT group_concat(u2.name, ', ') FROM shift_attendants a JOIN users u2 ON u2.id = a.user_id WHERE a.shift_id = s.id AND a.left_at IS NULL) AS on_duty,
           (SELECT COALESCE(SUM(amount), 0) FROM sales WHERE shift_id = s.id AND kind = 'credit') AS credit_so_far
         FROM shifts s JOIN users u ON u.id = s.attendant_id
         WHERE s.status = 'open' ORDER BY s.id`,
      )
      .all();

    // Shifts closed in the last three days (their cash gap shows in the alerts).
    const recentlyClosed = db
      .prepare(
        `SELECT s.id, s.closed_at, s.variance, s.counted_at, s.total_amount, COALESCE(${attendantNamesSql}, u.name) AS attendant_name
         FROM shifts s JOIN users u ON u.id = s.attendant_id
         WHERE s.status = 'closed' AND (s.closed_at >= datetime('now', '-3 days') OR s.counted_at IS NULL) ORDER BY s.id`,
      )
      .all();

    const customers = db
      .prepare(
        `SELECT c.id, c.name, c.credit_limit,
           ROUND(${balanceSql('c.id')}, 2) AS balance
         FROM customers c WHERE c.active = 1`,
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
    for (const s of recentlyClosed) {
      if (!s.counted_at) alerts.push({ level: 'warning', text: `Poste n°${s.id} : argent à compter`, link: `#/postes/${s.id}` });
      else if (Math.abs(s.variance) > settings.cashTolerance) {
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
    // Credits granted by attendants beyond the limit, on the open shift or one closed in the last three days.
    const overLimit = db
      .prepare(
        `SELECT sa.amount, sa.shift_id, c.id AS customer_id, c.name AS customer_name, u.name AS attendant_name
         FROM sales sa JOIN shifts s ON s.id = sa.shift_id JOIN customers c ON c.id = sa.customer_id
         JOIN users u ON u.id = COALESCE(sa.user_id, s.attendant_id)
         WHERE sa.over_limit = 1 AND (s.status = 'open' OR s.closed_at >= datetime('now', '-3 days')) ORDER BY sa.id DESC`,
      )
      .all();
    for (const o of overLimit) {
      alerts.push({
        level: 'serious',
        text: `Crédit hors plafond accordé par ${o.attendant_name} à ${o.customer_name} (${o.amount.toFixed(2).replace('.', ',')} $)`,
        link: `#/postes/${o.shift_id}`,
      });
    }
    // Subscribers who have not paid last month within the grace days.
    for (const c of db.prepare("SELECT id, name FROM customers WHERE type = 'account' AND active = 1").all()) {
      const dues = subscriberDues(db, c.id, settings.subscriberGraceDays);
      if (dues.late) {
        alerts.push({
          level: 'critical',
          text: `${c.name} (abonné) n'a pas payé le mois précédent : ${dues.overdue.toFixed(2).replace('.', ',')} $`,
          link: `#/clients/${c.id}`,
        });
      }
    }
    for (const c of customers) {
      if (c.balance > c.credit_limit) {
        alerts.push({ level: 'warning', text: `${c.name} dépasse son plafond de crédit`, link: `#/clients/${c.id}` });
      }
    }
    const combos = db
      .prepare('SELECT COALESCE(SUM(loyalty_points), 0) AS total, COALESCE(SUM(loyalty_points >= ?), 0) AS redeemable FROM customers WHERE active = 1')
      .get(settings.comboThreshold);
    // Cancellations asked by attendants, waiting for the manager.
    const cancellations = db
      .prepare(
        `SELECT shift_id, COUNT(*) AS n FROM (
           SELECT shift_id FROM sales WHERE cancel_requested_at IS NOT NULL
           UNION ALL SELECT shift_id FROM payments WHERE cancel_requested_at IS NOT NULL
           UNION ALL SELECT shift_id FROM expenses WHERE cancel_requested_at IS NOT NULL)
         GROUP BY shift_id ORDER BY shift_id`,
      )
      .all();
    for (const t of db.prepare("SELECT shift_id, COUNT(*) AS n, ROUND(SUM(liters), 2) AS liters FROM pump_tests WHERE status = 'pending' GROUP BY shift_id ORDER BY shift_id").all()) {
      alerts.push({
        level: 'serious',
        text: `Poste n°${t.shift_id} : ${t.n > 1 ? `${t.n} tests de pompe` : '1 test de pompe'} (${String(t.liters).replace('.', ',')} L remis en cuve) à confirmer`,
        link: `#/postes/${t.shift_id}`,
      });
    }
    for (const c of cancellations) {
      alerts.push({
        level: 'serious',
        text: `Poste n°${c.shift_id} : ${c.n > 1 ? `${c.n} annulations demandées` : '1 annulation demandée'} par le pompiste, à valider`,
        link: `#/postes/${c.shift_id}`,
      });
    }
    const toReview = db.prepare('SELECT COUNT(*) AS n FROM customers WHERE needs_review = 1 AND active = 1').get().n;
    if (toReview) {
      alerts.push({
        level: 'warning',
        text: `${toReview} nouveau${toReview > 1 ? 'x' : ''} client${toReview > 1 ? 's' : ''} créé${toReview > 1 ? 's' : ''} à la pompe, fiche à compléter`,
        link: '#/clients',
      });
    }
    const due = openShifts.find((s) => s.opened_at < closingCutoff(db, settings.closingTime || '15:30'));
    if (due) alerts.push({ level: 'serious', text: `Poste n°${due.id} : la clôture de ${settings.closingTime || '15:30'} est à faire`, link: `#/postes/${due.id}` });
    const supplierDebt = round(supplierBalances(db).reduce((t, s) => t + Math.max(0, s.balance), 0));
    if (supplierDebt > 0) alerts.push({ level: 'warning', text: `${money(supplierDebt)} dus aux fournisseurs (livraisons à crédit)`, link: '#/cuves' });
    const todayExpenses = round(db.prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE expense_date = ?').get(today).v);

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
      cash: balances(db),
      supplierDebt,
      receivables: round(customers.reduce((t, c) => t + Math.max(0, c.balance), 0)),
      // Unpaid credit older than 30 days (payments settle the oldest credit first).
      receivablesOld: round(
        customers
          .filter((c) => c.balance > 0)
          .flatMap((c) => creditAllocation(db, c.id))
          .filter((s) => s.unpaid > 0 && (s.old || s.day < db.prepare("SELECT date('now', 'localtime', '-30 days') AS d").get().d))
          .reduce((t, s) => t + s.unpaid, 0),
      ),
      todayExpenses,
      toReview,
      combos: { total: combos.total, value: round(combos.total * settings.comboValue), redeemable: combos.redeemable },
      alerts,
    });
  });

  const period = (req) => {
    const from = dateParam(req.query.from, 'La date de début');
    const to = dateParam(req.query.to, 'La date de fin');
    if (!from || !to) fail(400, 'Choisissez une période.');
    if (from > to) fail(400, 'La date de début doit précéder la date de fin.');
    return { from, to };
  };

  // Per tank over a period: deliveries, litres sold (meters), dip variances, loss as a share of
  // the litres sold.
  function stockMovements(from, to) {
    return db
      .prepare(
        `SELECT t.id, t.name, p.name AS product, t.capacity, t.low_level, t.book_stock,
           (SELECT COALESCE(SUM(d.liters_received), 0) FROM deliveries d
             WHERE d.tank_id = t.id AND date(d.created_at, 'localtime') BETWEEN ? AND ?) AS delivered,
           (SELECT COALESCE(SUM(r.liters), 0) FROM shift_readings r JOIN shifts s ON s.id = r.shift_id
             WHERE r.tank_id = t.id AND s.status != 'open' AND ${DAY} BETWEEN ? AND ?) AS sold,
           (SELECT COALESCE(SUM(d.variance), 0) FROM dips d
             WHERE d.tank_id = t.id AND date(d.created_at, 'localtime') BETWEEN ? AND ?) AS dip_variance,
           (SELECT COUNT(*) FROM dips d WHERE d.tank_id = t.id AND date(d.created_at, 'localtime') BETWEEN ? AND ?) AS dips
         FROM tanks t JOIN products p ON p.id = t.product_id WHERE t.active = 1 ORDER BY t.id`,
      )
      .all(from, to, from, to, from, to, from, to)
      .map((t) => ({
        ...t,
        delivered: round(t.delivered),
        sold: round(t.sold),
        dip_variance: round(t.dip_variance),
        // A negative dip variance is fuel missing from the tank: shown as a positive loss.
        loss_pct: t.sold ? round((-t.dip_variance / t.sold) * 100, 2) : null,
      }));
  }

  // One period's figures: the Reports screen, its CSV export and the period PDF.
  function salesReport(from, to) {
    const settings = getSettings(db);

    const byDay = db
      .prepare(
        `SELECT ${DAY} AS date, p.id AS product_id, p.name AS product, ROUND(SUM(r.liters), 2) AS liters, ROUND(SUM(r.amount), 2) AS amount
         FROM shift_readings r JOIN shifts s ON s.id = r.shift_id JOIN products p ON p.id = r.product_id
         WHERE s.status != 'open' AND ${DAY} BETWEEN ? AND ?
         GROUP BY 1, p.id ORDER BY 1, p.id`,
      )
      .all(from, to);
    const surcharge = surcharges(from, to);
    for (const r of byDay) r.amount = round(r.amount + (surcharge.get(`${r.date}|${r.product_id}`) || 0));

    const byProduct = db
      .prepare(
        `SELECT p.id AS product_id, p.name AS product, ROUND(SUM(r.liters), 2) AS liters, ROUND(SUM(r.amount), 2) AS amount
         FROM shift_readings r JOIN shifts s ON s.id = r.shift_id JOIN products p ON p.id = r.product_id
         WHERE s.status != 'open' AND ${DAY} BETWEEN ? AND ?
         GROUP BY p.id ORDER BY p.id`,
      )
      .all(from, to);
    for (const p of byProduct) {
      for (const [key, value] of surcharge) if (key.endsWith(`|${p.product_id}`)) p.amount += value;
      p.amount = round(p.amount);
    }

    const byAttendant = db
      .prepare(
        // Shortages and surpluses are counted apart: summed together they would cancel out.
        `SELECT u.id AS attendant_id, u.name AS attendant, COUNT(*) AS shifts, ROUND(SUM(s.total_liters), 2) AS liters,
           ROUND(SUM(s.total_amount), 2) AS amount, ROUND(SUM(s.variance), 2) AS variance,
           SUM(ABS(s.variance) > ? + 0.001) AS outside,
           ROUND(SUM(CASE WHEN s.variance < 0 THEN s.variance ELSE 0 END), 2) AS shortages,
           ROUND(SUM(CASE WHEN s.variance > 0 THEN s.variance ELSE 0 END), 2) AS surpluses,
           MIN(s.variance) AS worst
         FROM shifts s JOIN users u ON u.id = s.attendant_id
         WHERE s.status != 'open' AND ${DAY} BETWEEN ? AND ?
         GROUP BY u.id ORDER BY amount DESC`,
      )
      .all(settings.cashTolerance, from, to);

    const money = db
      .prepare(
        `SELECT ROUND(COALESCE(SUM(cash), 0), 2) AS cash, ROUND(COALESCE(SUM(change_left), 0), 2) AS changeLeft,
           ROUND(COALESCE(SUM(credit_amount), 0), 2) AS credit, ROUND(COALESCE(SUM(variance), 0), 2) AS variance,
           ROUND(COALESCE(SUM(combo_amount), 0), 2) AS combos,
           ROUND(COALESCE(SUM(mobile_money), 0), 2) AS mobileMoney,
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


    const expensesByCategory = db
      .prepare(
        `SELECT category, ROUND(SUM(amount), 2) AS amount, COUNT(*) AS count
         FROM expenses WHERE expense_date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC`,
      )
      .all(from, to);
    const expenses = round(expensesByCategory.reduce((t, e) => t + e.amount, 0));

    // Estimated gross margin: litres sold × (selling price − weighted average purchase cost),
    // the cost coming from deliveries recorded with a purchase price up to the end of the period.
    const avgCost = db.prepare(
      `SELECT SUM(d.liters_received * d.unit_cost) / SUM(d.liters_received) AS cost
       FROM deliveries d JOIN tanks t ON t.id = d.tank_id
       WHERE t.product_id = ? AND d.unit_cost IS NOT NULL AND date(d.created_at, 'localtime') <= ?`,
    );
    let costOfSales = 0;
    let costKnown = true;
    for (const p of byProduct) {
      const cost = avgCost.get(p.product_id, to).cost;
      p.avg_cost = cost == null ? null : round(cost, 3);
      p.margin = cost == null ? null : round(p.amount - p.liters * cost);
      p.margin_per_liter = cost == null || !p.liters ? null : round(p.margin / p.liters, 3);
      if (cost == null) costKnown = false;
      else costOfSales += p.liters * cost;
    }
    const grossMargin = round(byProduct.reduce((t, p) => t + (p.margin ?? 0), 0));

    const shifts = db
      .prepare(
        `SELECT s.id, s.status, s.closed_at, s.total_liters, s.total_amount, s.credit_amount, s.payments_amount, s.expenses_amount,
           s.expected_amount, s.cash, s.mobile_money, s.variance, s.counted_at, COALESCE(${attendantNamesSql}, u.name) AS attendant
         FROM shifts s JOIN users u ON u.id = s.attendant_id
         WHERE s.status != 'open' AND ${DAY} BETWEEN ? AND ? ORDER BY s.closed_at`,
      )
      .all(from, to);

    return {
      from,
      to,
      totals: { ...money, payments, expenses, grossMargin, net: round(grossMargin - expenses), costKnown, costOfSales: round(costOfSales) },
      byDay,
      byProduct,
      byAttendant,
      deliveries,
      expensesByCategory,
      shifts,
      stock: stockMovements(from, to),
    };
  }

  router.get('/reports/sales', manager, (req, res) => {
    const { from, to } = period(req);
    const report = salesReport(from, to);
    if (req.query.format === 'csv') {
      const lines = ['Date;Produit;Litres;Montant (USD)'];
      for (const r of report.byDay) lines.push([r.date, csvCell(r.product), String(r.liters).replace('.', ','), String(r.amount).replace('.', ',')].join(';'));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="ventes_${from}_${to}.csv"`);
      return res.send(`﻿${lines.join('\r\n')}\r\n`);
    }
    res.json(report);
  });

  // The period's report as a PDF: summary, shifts, products, tanks, expenses, attendants.
  router.get('/reports/period.pdf', manager, (req, res) => {
    const { from, to } = period(req);
    const settings = getSettings(db);
    const pdf = periodReportPdf(salesReport(from, to), {
      stationName: settings.stationName,
      cashTolerance: settings.cashTolerance,
      combosEnabled: settings.combosEnabled,
    });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="rapport-${from}${from === to ? '' : `_${to}`}.pdf"`);
    res.send(pdf);
  });

  router.get('/reports/stock', manager, (req, res) => {
    const { from, to } = period(req);
    res.json(stockMovements(from, to));
  });

  return router;
};
