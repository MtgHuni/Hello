// What is kept from an agent's pay (staff_deductions, version 32), kept up to date every minute and
// whenever the pay is read:
// - a credit of an individual whose oldest unpaid credit is over a month old: its unpaid part, kept from
//   the agent who granted it (sales.staff_id given by the admin, else the record of its login). Once
//   kept, it stays kept on its unpaid part; what the customer pays afterwards is given back.
// - an expense the manager marked (POST /staff/:id/deductions): its amount while it exists.
// Only movements are written (the difference with what is already kept), in the current month: a month
// already paid never changes. A source forgiven for an agent (reason 'pardon') is left alone.
const { round, transaction } = require('./util');
const { balanceSql, creditAllocation } = require('./loyalty');

const thisMonth = (db) => db.prepare("SELECT strftime('%Y-%m', 'now', 'localtime') AS m").get().m;
// A source is its row and its created_at (source_at): a cancelled row's number can go to a new row.
const keyOf = (r) => `${r.staff_id}:${r.sale_id ?? ''}:${r.expense_id ?? ''}:${r.source_at ?? ''}`;

function syncDeductions(db) {
  const month = thisMonth(db);
  // What is kept now, per agent and source.
  const kept = new Map(
    db
      .prepare(
        `SELECT staff_id, sale_id, expense_id, source_at, ROUND(SUM(amount), 2) AS net, MAX(reason = 'pardon') AS forgiven
         FROM staff_deductions GROUP BY staff_id, sale_id, expense_id, source_at`,
      )
      .all()
      .map((r) => [keyOf(r), r]),
  );
  const keptSales = new Set([...kept.values()].filter((r) => r.sale_id && !r.forgiven && r.net > 0.001).map((r) => `${r.sale_id}@${r.source_at}`));
  const targets = new Map();
  const staff = new Map(db.prepare('SELECT id, user_id, pay_from FROM staff').all().map((s) => [s.id, s]));
  const staffOfUser = new Map([...staff.values()].filter((s) => s.user_id).map((s) => [s.user_id, s.id]));
  const isLate = db.prepare("SELECT date(?, '+1 month') < date('now', 'localtime') AS late");

  // Only individuals who still owe: a customer who paid everything has nothing kept (given back below).
  const owing = `SELECT c.id FROM customers c WHERE c.type = 'individual' AND ${balanceSql('c.id')} > 0.001`;
  const sales = new Map(
    db
      .prepare(`SELECT id, staff_id, user_id, created_at, date(created_at, 'localtime') AS day FROM sales WHERE kind = 'credit' AND customer_id IN (${owing})`)
      .all()
      .map((s) => [s.id, s]),
  );
  for (const { id } of db.prepare(owing).all()) {
    const credits = creditAllocation(db, id).filter((c) => !c.old);
    const oldest = credits.find((c) => c.unpaid > 0.001);
    if (!oldest) continue;
    const late = !!isLate.get(oldest.day).late;
    for (const c of credits) {
      const sale = sales.get(c.id);
      if (!late && !keptSales.has(`${c.id}@${sale.created_at}`)) continue;
      // The agent who granted it: the admin's choice, else the record linked to the login that entered it.
      const agent = staff.get(sale.staff_id || staffOfUser.get(sale.user_id));
      // Only credits from the agent's first month counted by the app.
      if (!agent || sale.day.slice(0, 7) < agent.pay_from) continue;
      const target = { staff_id: agent.id, sale_id: c.id, expense_id: null, source_at: sale.created_at, amount: c.unpaid };
      targets.set(keyOf(target), target);
    }
  }
  const expenseOf = db.prepare('SELECT amount FROM expenses WHERE id = ? AND created_at = ?');
  for (const r of kept.values()) {
    if (r.expense_id) targets.set(keyOf(r), { ...r, amount: expenseOf.get(r.expense_id, r.source_at)?.amount ?? 0 });
  }

  const insert = db.prepare('INSERT INTO staff_deductions (staff_id, sale_id, expense_id, source_at, amount, reason, pay_month) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const moves = [];
  for (const k of new Set([...kept.keys(), ...targets.keys()])) {
    const now = kept.get(k);
    if (now?.forgiven) continue;
    const target = targets.get(k);
    const source = target || now;
    const delta = round((target?.amount ?? 0) - (now?.net ?? 0));
    if (Math.abs(delta) >= 0.005) moves.push([source.staff_id, source.sale_id ?? null, source.expense_id ?? null, source.source_at, delta, delta > 0 ? 'retenue' : 'rendu', month]);
  }
  if (moves.length) transaction(db, () => moves.forEach((m) => insert.run(...m)));
  return moves.length;
}

// A sale's or an expense's row as it is now: its created_at tells it from a cancelled row of the same number.
function sourceAt(db, { saleId = null, expenseId = null }) {
  return db.prepare(`SELECT created_at FROM ${saleId ? 'sales' : 'expenses'} WHERE id = ?`).get(saleId || expenseId)?.created_at ?? null;
}

// What is still kept from an agent for a source as it is now (not forgiven), and whether it was forgiven.
function keptFor(db, staffId, { saleId = null, expenseId = null }) {
  const at = sourceAt(db, { saleId, expenseId });
  const kept = db
    .prepare(
      `SELECT ROUND(COALESCE(SUM(amount), 0), 2) AS net, COALESCE(MAX(reason = 'pardon'), 0) AS forgiven
       FROM staff_deductions WHERE staff_id = ? AND sale_id IS ? AND expense_id IS ? AND source_at IS ?`,
    )
    .get(staffId, saleId, expenseId, at);
  return { ...kept, source_at: at };
}

// A month's movements of an agent, with what they are about (the customer and the credit, or the expense)
// and what is still kept for that source (kept).
function deductionLines(db, staffId, month) {
  return db
    .prepare(
      `SELECT d.id, d.sale_id, d.expense_id, d.amount, d.reason, d.created_at,
         EXISTS (SELECT 1 FROM staff_deductions p WHERE p.staff_id = d.staff_id AND p.sale_id IS d.sale_id AND p.expense_id IS d.expense_id AND p.source_at IS d.source_at AND p.reason = 'pardon') AS forgiven,
         (SELECT ROUND(SUM(k.amount), 2) FROM staff_deductions k WHERE k.staff_id = d.staff_id AND k.sale_id IS d.sale_id AND k.expense_id IS d.expense_id AND k.source_at IS d.source_at) AS kept,
         c.name AS customer_name, date(s.created_at, 'localtime') AS sale_day, s.amount AS sale_amount,
         e.description AS expense_description, e.expense_date AS expense_day
       FROM staff_deductions d
       LEFT JOIN sales s ON s.id = d.sale_id AND s.created_at = d.source_at LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN expenses e ON e.id = d.expense_id AND e.created_at = d.source_at
       WHERE d.staff_id = ? AND d.pay_month = ? ORDER BY d.id`,
    )
    .all(staffId, month);
}

// How a movement reads: « Retenue : crédit de Marie du 12/09/2026 », « Rendu : … », « Pardonné : … ».
function deductionLabel(d, date = (day) => day) {
  const what = d.sale_id
    ? `crédit de ${d.customer_name || 'un client'}${d.sale_day ? ` du ${date(d.sale_day)}` : ' (annulé)'}`
    : `dépense ${d.expense_description ? `« ${d.expense_description} »` : '(annulée)'}`;
  if (d.reason === 'pardon') return `Pardonné : ${what}`;
  if (d.reason === 'rendu') return `Rendu : ${what}`;
  return `Retenue : ${what}`;
}

module.exports = { syncDeductions, deductionLines, deductionLabel, keptFor };
