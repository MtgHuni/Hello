const express = require('express');
const { getSettings, SUPPLIER_PAYMENT } = require('../db');
const { round, dateParam, fail, csvCell, money, transaction } = require('../util');
const { requireRole } = require('../auth');
const { balanceSql, subscriberDues, creditAllocation } = require('../loyalty');
const { ACCOUNTS, balances, cashbook, supplierBalances } = require('../cashbook');
const { attendantNamesSql, closingCutoff } = require('../checkpoints');
const { periodReportPdf } = require('../periodReport');
const { withLiveStock } = require('../liveStock');
const { ALERT_TYPES, userAlerts } = require('../alerts');
const { mailUsage } = require('../mail');
const { aiEnabled } = require('../claude');
const { financeAdvice, financeReportPdf } = require('../financeReport');

const manager = requireRole('manager');

// Sales are attributed to the day the shift was closed (station local time).
const DAY = "date(s.closed_at, 'localtime')";

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

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

  // Each manager (or owner) chooses their alerts: types switched off, alerts hidden until they change.
  router.put('/alerts', requireRole('manager', 'owner'), (req, res) => {
    const b = req.body || {};
    const off = (Array.isArray(b.off) ? b.off : []).filter((t) => Object.hasOwn(ALERT_TYPES, t));
    const hidden = (Array.isArray(b.hidden) ? b.hidden : []).filter((a) => typeof a?.key === 'string' && typeof a?.text === 'string').slice(0, 200);
    transaction(db, () => {
      db.prepare('DELETE FROM alert_prefs WHERE user_id = ?').run(req.user.id);
      db.prepare('DELETE FROM alert_hidden WHERE user_id = ?').run(req.user.id);
      for (const t of off) db.prepare('INSERT INTO alert_prefs (user_id, type) VALUES (?, ?)').run(req.user.id, t);
      for (const a of hidden) db.prepare('INSERT OR REPLACE INTO alert_hidden (user_id, key, text) VALUES (?, ?, ?)').run(req.user.id, a.key.slice(0, 100), a.text.slice(0, 500));
    });
    res.json({ ok: true });
  });

  // The station's alerts (stock, closings, money, subscribers…), before each user's choices:
  // the dashboard shows them, the mail jobs send the new ones (src/mailJobs.js).
  function stationAlerts(settings = getSettings(db)) {
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
          alerts.push({ type: 'stock_bas', key: `stock_bas:${t.id}`, level: 'critical', text: `${t.name} : stock bas (${round(t.book_stock)} L, seuil ${t.low_level} L)`, link: '#/cuves' });
        }
      }
      for (const s of recentlyClosed) {
        if (!s.counted_at) alerts.push({ type: 'argent_a_compter', key: `argent_a_compter:${s.id}`, level: 'warning', text: `Poste n°${s.id} : argent à compter`, link: `#/postes/${s.id}` });
        else if (Math.abs(s.variance) > settings.cashTolerance) {
          alerts.push({
            type: 'ecart_caisse',
            key: `ecart_caisse:${s.id}`,
            level: 'serious',
            text: `Poste n°${s.id} (${s.attendant_name}) : écart de caisse de ${s.variance.toFixed(2).replace('.', ',')} $`,
            link: `#/postes/${s.id}`,
          });
        }
      }
      for (const d of recentDips) {
        alerts.push({ type: 'ecart_jaugeage', key: `ecart_jaugeage:${d.id}`, level: 'serious', text: `${d.tank_name} : écart de jaugeage de ${String(d.variance).replace('.', ',')} L`, link: '#/cuves' });
      }
      // Credits granted by attendants to a late subscriber, on the open shift or one closed in the last three days.
      const overLimit = db
        .prepare(
          `SELECT sa.id, sa.amount, sa.shift_id, c.id AS customer_id, c.name AS customer_name, u.name AS attendant_name
           FROM sales sa JOIN shifts s ON s.id = sa.shift_id JOIN customers c ON c.id = sa.customer_id
           JOIN users u ON u.id = COALESCE(sa.user_id, s.attendant_id)
           WHERE sa.over_limit = 1 AND c.type = 'account' AND (s.status = 'open' OR s.closed_at >= datetime('now', '-3 days')) ORDER BY sa.id DESC`,
        )
        .all();
      for (const o of overLimit) {
        alerts.push({
          type: 'credit_retard',
          key: `credit_retard:${o.id}`,
          level: 'serious',
          text: `Crédit accordé par ${o.attendant_name} à ${o.customer_name}, abonné en retard (${o.amount.toFixed(2).replace('.', ',')} $)`,
          link: `#/postes/${o.shift_id}`,
        });
      }
      // Subscribers who have not paid last month within the grace days.
      for (const c of db.prepare("SELECT id, name FROM customers WHERE type = 'account' AND active = 1").all()) {
        const dues = subscriberDues(db, c.id, settings.subscriberGraceDays);
        if (dues.late) {
          alerts.push({
            type: 'abonne_retard',
            key: `abonne_retard:${c.id}`,
            level: 'critical',
            text: `${c.name} (abonné) n'a pas payé le mois précédent : ${dues.overdue.toFixed(2).replace('.', ',')} $`,
            link: `#/clients/${c.id}`,
          });
        }
      }
      // Mails: from 80 % of the day's or the month's limit.
      const usage = mailUsage(db);
      for (const [period, label] of [['day', 'aujourd’hui'], ['month', 'ce mois']]) {
        const { count, limit } = usage[period];
        if (count < limit * 0.8) continue;
        alerts.push({
          type: 'mails_limite',
          key: `mails_limite:${period}`,
          level: count >= limit ? 'critical' : 'warning',
          text: `Mails : ${count} envoyés ${label} sur ${limit.toLocaleString('fr-FR')} permis`,
          link: '#/reglages',
        });
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
          type: 'tests_pompe',
          key: `tests_pompe:${t.shift_id}`,
          level: 'serious',
          text: `Poste n°${t.shift_id} : ${t.n > 1 ? `${t.n} tests de pompe` : '1 test de pompe'} (${String(t.liters).replace('.', ',')} L remis en cuve) à confirmer`,
          link: `#/postes/${t.shift_id}`,
        });
      }
      for (const c of cancellations) {
        alerts.push({
          type: 'annulations',
          key: `annulations:${c.shift_id}`,
          level: 'serious',
          text: `Poste n°${c.shift_id} : ${c.n > 1 ? `${c.n} annulations demandées` : '1 annulation demandée'} par le pompiste, à valider`,
          link: `#/postes/${c.shift_id}`,
        });
      }
      const toReview = db.prepare('SELECT COUNT(*) AS n FROM customers WHERE needs_review = 1 AND active = 1').get().n;
      if (toReview) {
        alerts.push({
          type: 'clients_a_completer',
          key: 'clients_a_completer',
          level: 'warning',
          text: `${toReview} nouveau${toReview > 1 ? 'x' : ''} client${toReview > 1 ? 's' : ''} créé${toReview > 1 ? 's' : ''} à la pompe, fiche à compléter`,
          link: '#/clients',
        });
      }
      const due = openShifts.find((s) => s.opened_at < closingCutoff(db, settings.closingTime || '15:30'));
      if (due) alerts.push({ type: 'cloture', key: `cloture:${due.id}`, level: 'serious', text: `Poste n°${due.id} : la clôture de ${settings.closingTime || '15:30'} est à faire`, link: `#/postes/${due.id}` });
      const supplierDebt = round(supplierBalances(db).reduce((t, s) => t + Math.max(0, s.balance), 0));
      if (supplierDebt > 0) alerts.push({ type: 'fournisseurs', key: 'fournisseurs', level: 'warning', text: `${money(supplierDebt)} dus aux fournisseurs (livraisons à crédit)`, link: '#/cuves' });
    return { tanks, openShifts, customers, combos, alerts, toReview, supplierDebt };
  }
  router.stationAlerts = stationAlerts;

  // What the customers owe, and the part of it older than 30 days (payments settle the oldest credit first).
  function receivables(customers) {
    const cutoff = db.prepare("SELECT date('now', 'localtime', '-30 days') AS d").get().d;
    return {
      total: round(customers.reduce((t, c) => t + Math.max(0, c.balance), 0)),
      old: round(
        customers
          .filter((c) => c.balance > 0)
          .flatMap((c) => creditAllocation(db, c.id))
          .filter((s) => s.unpaid > 0 && (s.old || s.day < cutoff))
          .reduce((t, s) => t + s.unpaid, 0),
      ),
    };
  }

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

    const { tanks, openShifts, customers, combos, alerts, toReview, supplierDebt } = stationAlerts(settings);
    const todayExpenses = round(db.prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE expense_date = ?').get(today).v);

    const shown = userAlerts(db, req.user.id, alerts);
    const owed = receivables(customers);
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
      receivables: owed.total,
      receivablesOld: owed.old,
      todayExpenses,
      toReview,
      combos: { total: combos.total, value: round(combos.total * settings.comboValue), redeemable: combos.redeemable },
      alerts: shown.visible,
      alertsManage: shown.manage,
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

  // Weighted average purchase cost of a product: deliveries recorded with a price up to a day.
  const avgCost = db.prepare(
    `SELECT SUM(d.liters_received * d.unit_cost) / SUM(d.liters_received) AS cost
     FROM deliveries d JOIN tanks t ON t.id = d.tank_id
     WHERE t.product_id = ? AND d.unit_cost IS NOT NULL AND date(d.created_at, 'localtime') <= ?`,
  );

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
        `SELECT ROUND(COALESCE(SUM(cash), 0), 2) AS cash, ROUND(COALESCE(SUM(change_left), 0), 2) AS changeLeft, ROUND(COALESCE(SUM(francs), 0), 2) AS francs,
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
      // A supplier paid by an expense (a delivery or its debt) is fuel already in the cost of sales.
      totals: { ...money, payments, expenses, grossMargin, net: round(grossMargin - expenses + (expensesByCategory.find((e) => e.category === SUPPLIER_PAYMENT)?.amount || 0)), costKnown, costOfSales: round(costOfSales) },
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
  // Also mailed to the team every Monday (the week) and on the 1st (the month).
  function periodPdf(from, to) {
    const settings = getSettings(db);
    const report = { ...salesReport(from, to), cashbook: Object.keys(ACCOUNTS).map((account) => cashbook(db, { account, from, to })) };
    return { report, pdf: periodReportPdf(report, { stationName: settings.stationName, cashTolerance: settings.cashTolerance, combosEnabled: settings.combosEnabled }) };
  }
  router.periodPdf = periodPdf;
  router.salesReport = salesReport;

  router.get('/reports/period.pdf', manager, (req, res) => {
    const { from, to } = period(req);
    const { pdf } = periodPdf(from, to);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="rapport-${from}${from === to ? '' : `_${to}`}.pdf"`);
    res.send(pdf);
  });

  router.get('/reports/stock', manager, (req, res) => {
    const { from, to } = period(req);
    res.json(stockMovements(from, to));
  });

  // ---------- Financial report of a period, with Claude's advice (src/financeReport.js) ----------

  // A period in a line: what the trend and the comparisons need.
  const brief = (r) => {
    const t = r.totals;
    return {
      from: r.from,
      to: r.to,
      amount: t.amount,
      liters: t.liters,
      grossMargin: t.costKnown ? t.grossMargin : null,
      expenses: t.expenses,
      net: t.costKnown ? t.net : null,
      credit: t.credit,
      payments: t.payments,
      cash: t.cash,
      mobileMoney: t.mobileMoney,
      variance: t.variance,
      shifts: r.shifts.length,
    };
  };

  const daysIn = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5) + 1;
  // Whole calendar months (from a 1st to a month's last day): how many, else 0.
  const wholeMonths = (from, to) =>
    from.endsWith('-01') && addDays(to, 1).endsWith('-01') ? (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1 : 0;
  // The period just before, as long; whole months go back by whole months.
  function periodBefore(from, to) {
    const months = wholeMonths(from, to);
    if (!months) return [addDays(from, -daysIn(from, to)), addDays(from, -1)];
    const d = new Date(`${from}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - months);
    return [d.toISOString().slice(0, 10), addDays(from, -1)];
  }

  // Everything the adviser reads for a period: the period in detail, the one before, the six before
  // as a trend, and the position now: money, what customers owe and what is owed to suppliers, the
  // tanks and their days of stock, prices against costs, the open alerts.
  function financeFigures(from, to) {
    const settings = getSettings(db);
    const today = db.prepare("SELECT date('now', 'localtime') AS d").get().d;
    const days = daysIn(from, to);
    const current = salesReport(from, to);
    const trend = [];
    let previous = null;
    for (let p = periodBefore(from, to); trend.length < 6; p = periodBefore(...p)) {
      const r = salesReport(...p);
      previous ||= r;
      trend.unshift(brief(r));
    }

    const { tanks, customers, supplierDebt, alerts } = stationAlerts(settings);
    const moved = new Map(current.stock.map((t) => [t.id, t]));
    const stock = tanks.map((t) => {
      const m = moved.get(t.id) || {};
      const daily = (m.sold || 0) / days;
      const cost = avgCost.get(t.product_id, today).cost;
      return {
        tank: t.name,
        product: t.product_name,
        stock: round(t.book_stock),
        capacity: t.capacity,
        low_level: t.low_level,
        sold: m.sold || 0,
        delivered: m.delivered || 0,
        dips: m.dips || 0,
        dip_variance: m.dip_variance || 0,
        loss_pct: m.loss_pct ?? null,
        days_left: daily ? round(t.book_stock / daily, 1) : null,
        value: cost == null ? null : round(t.book_stock * cost),
      };
    });
    const prices = db
      .prepare('SELECT id, name, price, subscriber_price FROM products WHERE active = 1 ORDER BY id')
      .all()
      .map((p) => {
        const cost = avgCost.get(p.id, today).cost;
        return { product: p.name, price: p.price, subscriber_price: p.subscriber_price, avg_cost: cost == null ? null : round(cost, 3), margin_per_liter: cost == null ? null : round(p.price - cost, 3) };
      });
    const cash = balances(db);
    const owed = receivables(customers);
    // The rhythm of the period, both products together: by day, by month beyond a month.
    const rhythm = [];
    for (const d of current.byDay) {
      const key = days > 31 ? d.date.slice(0, 7) : d.date;
      const last = rhythm.at(-1);
      if (last?.date === key) Object.assign(last, { liters: round(last.liters + d.liters), amount: round(last.amount + d.amount) });
      else rhythm.push({ date: key, liters: d.liters, amount: d.amount });
    }

    return {
      from,
      to,
      period: {
        ...brief(current),
        days,
        // The last day is still under way: its open shift is not counted yet.
        partial: to >= today,
        changeLeft: current.totals.changeLeft,
        francs: current.totals.francs,
        byProduct: current.byProduct.map(({ product_id, ...p }) => p),
        [days > 31 ? 'byMonth' : 'byDay']: rhythm,
        byAttendant: current.byAttendant.map(({ attendant_id, ...a }) => a),
        expensesByCategory: current.expensesByCategory,
        deliveries: current.deliveries,
      },
      previous: { ...brief(previous), byProduct: previous.byProduct.map((p) => ({ product: p.product, liters: p.liters, amount: p.amount, margin_per_liter: p.margin_per_liter })) },
      trend,
      position: {
        cash: cash.cash.balance,
        mobileMoney: cash.momo.balance,
        receivables: owed.total,
        receivablesOld: owed.old,
        supplierDebt,
        stockValue: stock.length && stock.every((t) => t.value != null) ? round(stock.reduce((s, t) => s + t.value, 0)) : null,
      },
      stock,
      prices,
      alerts: alerts.map((a) => a.text),
      cashTolerance: settings.cashTolerance,
    };
  }

  const financeRow = (id) => {
    const r = db.prepare('SELECT id, date_from, date_to, figures, summary, advice, created_at FROM finance_reports WHERE id = ?').get(id);
    return r ? { ...r, figures: JSON.parse(r.figures), advice: JSON.parse(r.advice) } : null;
  };

  // Writes (or writes again) the report of a period. Null when Claude gave nothing.
  async function financeReport(from, to, userId = null) {
    const figures = financeFigures(from, to);
    const out = await financeAdvice({ figures, stationName: getSettings(db).stationName });
    if (!out) return null;
    db.prepare(
      `INSERT INTO finance_reports (date_from, date_to, figures, summary, advice, user_id) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(date_from, date_to) DO UPDATE SET figures = excluded.figures, summary = excluded.summary,
         advice = excluded.advice, user_id = excluded.user_id, created_at = datetime('now')`,
    ).run(from, to, JSON.stringify(figures), out.summary, JSON.stringify(out.advice), userId);
    return financeRow(db.prepare('SELECT id FROM finance_reports WHERE date_from = ? AND date_to = ?').get(from, to).id);
  }
  const financePdf = (r) => financeReportPdf(r, { stationName: getSettings(db).stationName });
  router.financeReport = financeReport;
  router.financePdf = financePdf;

  // The last week that is over, Monday to Sunday.
  const lastWeek = () => {
    const from = db.prepare("SELECT date('now', 'localtime', '-6 days', 'weekday 1', '-7 days') AS d").get().d;
    return { from, to: addDays(from, 6) };
  };
  const reportParam = (id) => {
    const r = /^\d+$/.test(id) ? financeRow(Number(id)) : null;
    if (!r) fail(404, 'Rapport financier introuvable.');
    return r;
  };

  router.get('/finance-reports', manager, (req, res) => {
    const reports = db.prepare('SELECT id, date_from, date_to, created_at FROM finance_reports ORDER BY date_to DESC, date_from DESC').all();
    res.json({ reports, lastWeek: lastWeek(), ai: aiEnabled() });
  });

  router.get('/finance-reports/:id', manager, (req, res) => res.json(reportParam(req.params.id)));

  router.get('/finance-reports/:id/report.pdf', manager, (req, res) => {
    const r = reportParam(req.params.id);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="rapport-financier-${r.date_from}${r.date_from === r.date_to ? '' : `_${r.date_to}`}.pdf"`);
    res.send(financePdf(r));
  });

  // Written now for the period chosen (the last week by default), or written again with the latest figures.
  router.post('/finance-reports', manager, async (req, res) => {
    if (!aiEnabled()) fail(409, 'Le rapport financier n’est pas disponible.', 'no_ai');
    const b = req.body || {};
    const { from, to } = b.from || b.to ? period({ query: b }) : lastWeek();
    if (to > db.prepare("SELECT date('now', 'localtime') AS d").get().d) fail(400, 'La période ne peut pas finir après aujourd’hui.');
    if (daysIn(from, to) > 366) fail(400, 'Choisissez une période d’un an au plus.');
    let r;
    try {
      r = await financeReport(from, to, req.user.id);
    } catch (err) {
      console.error('Rapport financier :', err.message);
      fail(422, 'Rapport impossible pour l’instant : réessayez.', 'finance_failed');
    }
    if (!r) fail(422, 'Rapport impossible pour l’instant : réessayez.', 'finance_failed');
    res.status(201).json(r);
  });

  return router;
};
