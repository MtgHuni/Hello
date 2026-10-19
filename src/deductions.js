// What is kept from an agent's pay (staff_deductions, version 32), kept up to date every minute and
// whenever the pay is read:
// - a credit of an individual whose oldest unpaid credit is over a month old: its unpaid part, kept from
//   the agent who granted it (sales.staff_id given by the admin, else the record of its login). Once
//   kept, it stays kept on its unpaid part; what the customer pays afterwards is given back.
// - an expense the manager marked (POST /staff/:id/deductions): its amount while it exists.
// Only movements are written (the difference with what is already kept), in the current month: a month
// already paid never changes. A source forgiven for an agent (reason 'pardon') is left alone.
const { round, transaction } = require('./util');
const { creditAllocation } = require('./loyalty');

const thisMonth = (db) => db.prepare("SELECT strftime('%Y-%m', 'now', 'localtime') AS m").get().m;
const keyOf = (r) => `${r.staff_id}:${r.sale_id ?? ''}:${r.expense_id ?? ''}`;

// The agent who granted a credit: the admin's choice, else the record linked to the login that entered it.
function creditAgentId(db, sale) {
  if (sale.staff_id) return sale.staff_id;
  return sale.user_id ? db.prepare('SELECT id FROM staff WHERE user_id = ?').get(sale.user_id)?.id ?? null : null;
}

function syncDeductions(db) {
  const month = thisMonth(db);
  // What is kept now, per agent and source.
  const kept = new Map(
    db
      .prepare(
        `SELECT staff_id, sale_id, expense_id, ROUND(SUM(amount), 2) AS net, MAX(reason = 'pardon') AS forgiven
         FROM staff_deductions GROUP BY staff_id, sale_id, expense_id`,
      )
      .all()
      .map((r) => [keyOf(r), r]),
  );
  const keptSales = new Set([...kept.values()].filter((r) => r.sale_id && !r.forgiven && r.net > 0.001).map((r) => r.sale_id));
  const targets = new Map();
  const staff = new Map(db.prepare('SELECT id, pay_from FROM staff').all().map((s) => [s.id, s]));
  const isLate = db.prepare("SELECT date(?, '+1 month') < date('now', 'localtime') AS late");
  const saleOf = db.prepare("SELECT id, staff_id, user_id, date(created_at, 'localtime') AS day FROM sales WHERE id = ?");

  const individuals = db
    .prepare("SELECT DISTINCT s.customer_id AS id FROM sales s JOIN customers c ON c.id = s.customer_id WHERE s.kind = 'credit' AND c.type = 'individual'")
    .all();
  for (const { id } of individuals) {
    const credits = creditAllocation(db, id).filter((c) => !c.old);
    const oldest = credits.find((c) => c.unpaid > 0.001);
    const late = !!oldest && !!isLate.get(oldest.day).late;
    for (const c of credits) {
      if (!late && !keptSales.has(c.id)) continue;
      const sale = saleOf.get(c.id);
      const agent = staff.get(creditAgentId(db, sale));
      // Only credits from the agent's first month counted by the app.
      if (!agent || sale.day.slice(0, 7) < agent.pay_from) continue;
      targets.set(keyOf({ staff_id: agent.id, sale_id: c.id }), { staff_id: agent.id, sale_id: c.id, expense_id: null, amount: c.unpaid });
    }
  }
  const expenseOf = db.prepare('SELECT amount FROM expenses WHERE id = ?');
  for (const r of kept.values()) {
    if (r.expense_id) targets.set(keyOf(r), { ...r, amount: expenseOf.get(r.expense_id)?.amount ?? 0 });
  }

  const insert = db.prepare('INSERT INTO staff_deductions (staff_id, sale_id, expense_id, amount, reason, pay_month) VALUES (?, ?, ?, ?, ?, ?)');
  const moves = [];
  for (const k of new Set([...kept.keys(), ...targets.keys()])) {
    const now = kept.get(k);
    if (now?.forgiven) continue;
    const target = targets.get(k);
    const source = target || now;
    const delta = round((target?.amount ?? 0) - (now?.net ?? 0));
    if (Math.abs(delta) >= 0.005) moves.push([source.staff_id, source.sale_id ?? null, source.expense_id ?? null, delta, delta > 0 ? 'retenue' : 'rendu', month]);
  }
  if (moves.length) transaction(db, () => moves.forEach((m) => insert.run(...m)));
  return moves.length;
}

// What is still kept from an agent for a source (not forgiven), and whether it was forgiven.
function keptFor(db, staffId, { saleId = null, expenseId = null }) {
  return db
    .prepare(
      `SELECT ROUND(COALESCE(SUM(amount), 0), 2) AS net, COALESCE(MAX(reason = 'pardon'), 0) AS forgiven
       FROM staff_deductions WHERE staff_id = ? AND sale_id IS ? AND expense_id IS ?`,
    )
    .get(staffId, saleId, expenseId);
}

// A month's movements of an agent, with what they are about (the customer and the credit, or the expense).
function deductionLines(db, staffId, month) {
  return db
    .prepare(
      `SELECT d.id, d.sale_id, d.expense_id, d.amount, d.reason, d.created_at,
         c.name AS customer_name, date(s.created_at, 'localtime') AS sale_day, s.amount AS sale_amount,
         e.description AS expense_description, e.expense_date AS expense_day
       FROM staff_deductions d
       LEFT JOIN sales s ON s.id = d.sale_id LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN expenses e ON e.id = d.expense_id
       WHERE d.staff_id = ? AND d.pay_month = ? ORDER BY d.id`,
    )
    .all(staffId, month);
}

// How a movement reads: « Crédit de Marie du 12/09/2026 », « Rendu : … », « Pardonné : … ».
function deductionLabel(d, date = (day) => day) {
  const what = d.sale_id
    ? `crédit de ${d.customer_name || 'un client'}${d.sale_day ? ` du ${date(d.sale_day)}` : ' (annulé)'}`
    : `dépense ${d.expense_description ? `« ${d.expense_description} »` : '(annulée)'}`;
  if (d.reason === 'pardon') return `Pardonné : ${what}`;
  if (d.reason === 'rendu') return `Rendu : ${what}`;
  return `${what.charAt(0).toUpperCase()}${what.slice(1)}`;
}

module.exports = { syncDeductions, deductionLines, deductionLabel, keptFor, creditAgentId };
