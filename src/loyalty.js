const { round } = require('./util');
const { getSettings } = require('./db');

// What a customer owes (SQL, for a customer id column): credit sales and debts from
// before the app, minus payments.
const balanceSql = (id) => `(SELECT COALESCE(SUM(amount), 0) FROM sales WHERE customer_id = ${id} AND kind = 'credit') +
  (SELECT COALESCE(SUM(amount), 0) FROM old_debts WHERE customer_id = ${id}) -
  (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE customer_id = ${id})`;

// Payments settle a customer's debts from the oldest to the newest: debts from before the
// app first (old: true, no day), then credit sales. Returns each with what is still unpaid.
function creditAllocation(db, customerId) {
  let remaining = db.prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM payments WHERE customer_id = ?').get(customerId).v;
  const oldDebts = db
    .prepare('SELECT id, amount, 0 AS points, 0 AS points_due, NULL AS day, 1 AS old FROM old_debts WHERE customer_id = ? ORDER BY created_at, id')
    .all(customerId);
  const sales = db
    .prepare(
      `SELECT id, amount, points, points_due, date(created_at, 'localtime') AS day, 0 AS old
       FROM sales WHERE customer_id = ? AND kind = 'credit' ORDER BY created_at, id`,
    )
    .all(customerId);
  const credits = [...oldDebts, ...sales];
  return credits.map((c) => {
    const paid = Math.min(remaining, c.amount);
    remaining = round(remaining - paid);
    return { ...c, unpaid: round(c.amount - paid) };
  });
}

// Combos: a paid sale earns them at once, a credit sale only once fully paid;
// combos spent on fuel are deducted. Call after any sale or payment change.
function refreshCustomer(db, customerId) {
  const update = db.prepare('UPDATE sales SET points = ? WHERE id = ?');
  // Programme switched off: nothing new is earned (combos already earned are kept).
  for (const c of getSettings(db).combosEnabled ? creditAllocation(db, customerId) : []) {
    if (c.old) continue; // a debt from before the app earns nothing
    const points = c.unpaid <= 0.001 ? c.points_due : 0;
    if (points !== c.points) update.run(points, c.id);
  }
  db.prepare(
    `UPDATE customers SET loyalty_points =
       (SELECT COALESCE(SUM(points), 0) - COALESCE(SUM(combos_used), 0) FROM sales WHERE customer_id = ?)
     WHERE id = ?`,
  ).run(customerId, customerId);
}

// Subscribers pay the whole month at the end of the month (within a few grace days):
// what is still unpaid from previous months is overdue and blocks new credit.
function subscriberDues(db, customerId, graceDays) {
  const today = db
    .prepare(
      `SELECT date('now', 'localtime', 'start of month') AS month_start,
              CAST(strftime('%d', 'now', 'localtime') AS INTEGER) AS day,
              date('now', 'localtime', 'start of month', '+' || ? || ' days') AS overdue_deadline,
              date('now', 'localtime', 'start of month', '+1 month', '+' || ? || ' days') AS next_deadline`,
    )
    .get(Math.max(0, graceDays - 1), Math.max(0, graceDays - 1));
  let overdue = 0;
  let currentMonth = 0;
  for (const c of creditAllocation(db, customerId)) {
    // Debts from before the app do not suspend credit: the manager follows them in Créances.
    if (c.old) continue;
    if (c.day < today.month_start) overdue += c.unpaid;
    else currentMonth += c.unpaid;
  }
  overdue = round(overdue);
  return {
    overdue,
    currentMonth: round(currentMonth),
    overdueDeadline: today.overdue_deadline,
    nextDeadline: today.next_deadline,
    late: overdue > 0.001 && today.day > graceDays,
  };
}

// The credits a customer still owes (oldest first), with what is left to pay on each: what the
// attendant sees when a particulier asks for a second credit.
function unpaidCredits(db, customerId) {
  const sale = db.prepare(
    `SELECT s.created_at, s.shift_id, s.liters, p.name AS product_name, u.name AS user_name
     FROM sales s JOIN products p ON p.id = s.product_id JOIN shifts sh ON sh.id = s.shift_id
     LEFT JOIN users u ON u.id = COALESCE(s.user_id, sh.attendant_id) WHERE s.id = ?`,
  );
  const old = db.prepare('SELECT created_at, note FROM old_debts WHERE id = ?');
  return creditAllocation(db, customerId)
    .filter((c) => c.unpaid > 0.001)
    .map((c) => ({ id: c.id, old: !!c.old, amount: c.amount, unpaid: c.unpaid, ...(c.old ? old.get(c.id) : sale.get(c.id)) }));
}

module.exports = { balanceSql, creditAllocation, refreshCustomer, subscriberDues, unpaidCredits };
