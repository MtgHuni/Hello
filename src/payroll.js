// Agents' pay (src/routes/staff.js): the salary of a month, prorated when the agent came or left
// during it, what is carried from the months before, and the advances and payments counted for it.
// Advances and payments are expenses « Salaires » linked to the agent (expenses.staff_id, pay_month).
const { round } = require('./util');
const { deductionLines } = require('./deductions');

const FUNCTIONS = ['Pompiste', 'Gérant', 'Caissier', 'Gardien', 'Autre'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const monthLabel = (month) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
// « de septembre 2026 », « d’octobre 2026 ».
const ofMonth = (month) => (/^[aeiouy]/.test(monthLabel(month).normalize('NFD')) ? `d’${monthLabel(month)}` : `de ${monthLabel(month)}`);
const addMonths = (month, n) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
const daysIn = (month) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const currentMonth = (db) => db.prepare("SELECT strftime('%Y-%m', 'now', 'localtime') AS m").get().m;

// Where the money of an advance or a payment came from.
const sourceOf = (e) => (e.shift_id ? 'poste' : e.method);

// The salary in force in a month, and the part of it due: days from the entry (or the 1st) to the
// departure (or the month's last day), out of the month's days. Nothing before « Paie depuis ».
function salaryOf(db, staff, month) {
  const daysInMonth = daysIn(month);
  const row = db.prepare('SELECT amount FROM staff_salaries WHERE staff_id = ? AND from_month <= ? ORDER BY from_month DESC LIMIT 1').get(staff.id, month);
  const base = row ? row.amount : 0;
  const first = `${month}-01`;
  const last = `${month}-${String(daysInMonth).padStart(2, '0')}`;
  const start = staff.hired_on > first ? staff.hired_on : first;
  const end = staff.left_on && staff.left_on < last ? staff.left_on : last;
  const days = month < staff.pay_from || end < start ? 0 : Number(end.slice(8)) - Number(start.slice(8)) + 1;
  return { base, days, daysInMonth, amount: round((base * days) / daysInMonth) };
}

// One month of an agent: its salary, what the months before left (owed > 0, advanced too much < 0),
// its advances and payments, and the net (what the month leaves, carried to the next one).
function monthSheet(db, staff, month, carried) {
  const salary = salaryOf(db, staff, month);
  const operations = db
    .prepare(
      `SELECT e.id, e.expense_date, e.created_at, e.amount, e.method, e.shift_id, e.pay_kind, e.description, s.status AS shift_status
       FROM expenses e LEFT JOIN shifts s ON s.id = e.shift_id
       WHERE e.staff_id = ? AND e.pay_month = ? ORDER BY e.expense_date, e.id`,
    )
    .all(staff.id, month)
    .map((e) => ({ ...e, source: sourceOf(e) }));
  const advances = operations.filter((e) => e.pay_kind === 'avance');
  const payments = operations.filter((e) => e.pay_kind === 'salaire');
  const sum = (list) => round(list.reduce((t, e) => t + e.amount, 0));
  const advanced = sum(advances);
  const paid = sum(payments);
  // Kept from the pay (> 0) or given back (< 0): src/deductions.js.
  const deductions = deductionLines(db, staff.id, month);
  const deducted = sum(deductions);
  return { month, salary, carried, advances, payments, deductions, advanced, paid, deducted, net: round(salary.amount + carried - advanced - paid - deducted) };
}

// Every month from « Paie depuis » to `until`. `due` is what is still to pay for a month once the
// months after it are counted: a month whose rest was paid with the next one is not owed any more.
function sheetsOf(db, staff, until) {
  const sheets = [];
  let carried = 0;
  for (let m = staff.pay_from; m <= until; m = addMonths(m, 1)) {
    const sheet = monthSheet(db, staff, m, carried);
    sheets.push(sheet);
    carried = sheet.net;
  }
  let lowest = Infinity;
  for (let i = sheets.length - 1; i >= 0; i--) {
    lowest = Math.min(lowest, sheets[i].net);
    sheets[i].due = round(Math.max(0, lowest));
  }
  return sheets;
}

function sheetOf(db, staff, month) {
  if (month < staff.pay_from) return { ...monthSheet(db, staff, month, 0), due: 0 };
  const now = currentMonth(db);
  return sheetsOf(db, staff, month > now ? month : now).find((s) => s.month === month);
}

// The pay of a month: every agent with a salary, something carried or an operation that month.
function payroll(db, month) {
  const agents = db
    .prepare('SELECT st.*, u.name AS user_name FROM staff st LEFT JOIN users u ON u.id = st.user_id ORDER BY st.name COLLATE NOCASE')
    .all()
    .map((st) => ({ ...st, sheet: sheetOf(db, st, month) }))
    // Everyone still there (even before their first day), and anyone gone with money still owed.
    .filter(
      ({ sheet: s, ...st }) =>
        s.salary.amount > 0 || Math.abs(s.carried) >= 0.005 || s.advances.length || s.payments.length || s.deductions.length || (month >= st.pay_from && (!st.left_on || st.left_on >= `${month}-01`)),
    );
  const total = (f) => round(agents.reduce((t, a) => t + f(a.sheet), 0));
  return {
    month,
    agents,
    totals: {
      salaries: total((s) => s.salary.amount),
      advanced: total((s) => s.advanced),
      paid: total((s) => s.paid),
      deducted: total((s) => s.deducted),
      // What is still to pay: an agent advanced too much does not lower what the others are owed.
      net: total((s) => s.due),
    },
  };
}

module.exports = { FUNCTIONS, monthLabel, ofMonth, addMonths, currentMonth, salaryOf, sheetOf, sheetsOf, payroll, sourceOf };
