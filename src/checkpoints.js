// Checkpoints inside a shift: a relief (relève: an attendant hands over to the next), the
// evening closing (fermeture, 19 h: the shift stays open overnight) and the morning opening
// (ouverture). Each records every nozzle's index and the money passed on. The period between
// two checkpoints gets a mini report: litres and sales from the indexes, the operations entered,
// and the money the attendant should have on them.
const { round } = require('./util');

const attendantNamesSql = `(SELECT group_concat(name, ', ') FROM (SELECT u2.name FROM shift_attendants a JOIN users u2 ON u2.id = a.user_id
  WHERE a.shift_id = s.id GROUP BY u2.id ORDER BY MIN(a.id)))`;

// Mobile money of a shift: fuel paid by mobile money and payments received by mobile money.
function momoTotal(db, shiftId) {
  const fuel = db.prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM momo_sales WHERE shift_id = ?').get(shiftId).v;
  const paid = db.prepare("SELECT COALESCE(SUM(amount), 0) AS v FROM payments WHERE shift_id = ? AND method = 'mobile money'").get(shiftId).v;
  return round(fuel + paid);
}

const KIND_LABEL = { releve: 'Relève', fermeture: 'Fermeture du soir', ouverture: 'Ouverture du matin' };

function listCheckpoints(db, shiftId) {
  const rows = db
    .prepare('SELECT c.*, u.name AS user_name FROM shift_checkpoints c LEFT JOIN users u ON u.id = c.user_id WHERE c.shift_id = ? ORDER BY c.id')
    .all(shiftId);
  const read = db.prepare('SELECT nozzle_id, meter FROM checkpoint_readings WHERE checkpoint_id = ?');
  return rows.map((c) => ({ ...c, at: c.created_at, meters: new Map(read.all(c.id).map((r) => [r.nozzle_id, r.meter])) }));
}

// The period that ends at `end` ({ at, meters: Map, cash, mobile_money, kind, user_name }),
// starting at the previous checkpoint, or at the shift's opening (its start indexes, no money).
function periodReport(db, shift, readings, previous, end) {
  const from = previous || { at: shift.opened_at, meters: new Map(readings.map((r) => [r.nozzle_id, r.start_meter])), cash: 0 };
  // From the shift's opening, what was entered in its first second counts too.
  const after = previous ? '>' : '>=';
  const inPeriod = (table) => db.prepare(`SELECT * FROM ${table} WHERE shift_id = ? AND created_at ${after} ? AND created_at <= ? ORDER BY id`).all(shift.id, from.at, end.at);

  const nozzles = readings.map((r) => {
    const start = from.meters.get(r.nozzle_id) ?? r.start_meter;
    const stop = end.meters.get(r.nozzle_id) ?? start;
    const liters = round(stop - start);
    return { nozzle_id: r.nozzle_id, name: `${r.pump_name} · ${r.nozzle_name}`, product_id: r.product_id, product_name: r.product_name, from: start, to: stop, liters, amount: round(liters * r.unit_price) };
  });
  const unitPrices = new Map(readings.map((r) => [r.nozzle_id, r.unit_price]));
  const customerName = new Map(db.prepare('SELECT id, name FROM customers').all().map((c) => [c.id, c.name]));
  const sales = inPeriod('sales');
  const payments = inPeriod('payments');
  const expenses = inPeriod('expenses');
  const momo = inPeriod('momo_sales');
  const productName = new Map(readings.map((r) => [r.product_id, r.product_name]));
  // Subscribers pay more than the pump price used for the indexes.
  const surcharge = round(sales.reduce((t, s) => t + (s.amount - s.liters * (unitPrices.get(s.nozzle_id) ?? s.unit_price)), 0));
  const sold = round(nozzles.reduce((t, n) => t + n.amount, 0) + surcharge);
  const credits = round(sales.filter((s) => s.kind === 'credit').reduce((t, s) => t + s.amount, 0));
  const combos = round(sales.filter((s) => s.kind === 'combo').reduce((t, s) => t + s.amount, 0));
  const paid = round(payments.reduce((t, p) => t + p.amount, 0));
  const spent = round(expenses.reduce((t, e) => t + e.amount, 0));
  // The cash is passed on; mobile money stays on the station's account.
  const received = round(from.cash || 0);
  const mobileMoney = round(momo.reduce((t, m) => t + m.amount, 0) + payments.filter((p) => p.method === 'mobile money').reduce((t, p) => t + p.amount, 0));
  // Money on the attendant = what they received + sales − credits − combos + payments − expenses.
  const expected = round(received + sold - credits - combos + paid - spent);
  const handed = round((end.cash || 0) + mobileMoney);
  return {
    kind: end.kind,
    label: KIND_LABEL[end.kind] || 'Clôture',
    by: end.user_name || null,
    from_at: from.at,
    at: end.at,
    from_kind: previous?.kind || 'opening',
    nozzles,
    liters: round(nozzles.reduce((t, n) => t + n.liters, 0)),
    sold,
    surcharge,
    credits,
    combos,
    payments: paid,
    expenses: spent,
    received,
    expected,
    expected_cash: round(expected - mobileMoney),
    cash: end.cash || 0,
    mobile_money: mobileMoney,
    handed,
    variance: round(handed - expected),
    operations: [
      ...sales.map((s) => ({ at: s.created_at, type: s.kind === 'combo' ? 'Combos' : 'Crédit', label: customerName.get(s.customer_id) || '', amount: s.amount })),
      ...payments.map((p) => ({ at: p.created_at, type: 'Règlement', label: customerName.get(p.customer_id) || '', amount: p.amount })),
      ...expenses.map((e) => ({ at: e.created_at, type: 'Dépense', label: e.description, amount: e.amount })),
      ...momo.map((m) => ({ at: m.created_at, type: 'Mobile money', label: `${productName.get(m.product_id) || ''} · ${String(m.liters).replace('.', ',')} L`, amount: m.amount })),
    ].sort((a, b) => a.at.localeCompare(b.at)),
  };
}

// Every checkpoint of a shift with the report of the period it closes.
function checkpointReports(db, shift, readings) {
  const list = listCheckpoints(db, shift.id);
  return list.map((c, i) => ({ id: c.id, ...periodReport(db, shift, readings, list[i - 1], c) }));
}

// The period still running (since the last checkpoint), with the indexes given now.
function currentPeriod(db, shift, readings, meters, money = {}) {
  const list = listCheckpoints(db, shift.id);
  const last = list.at(-1);
  const at = db.prepare("SELECT datetime('now') AS t").get().t;
  return periodReport(db, shift, readings, last || null, { kind: money.kind, at, meters, cash: money.cash, user_name: money.userName });
}

// The last daily closing time that has passed (UTC timestamp), e.g. today 15:30 after 15:30.
function closingCutoff(db, time = '15:30') {
  return db
    .prepare(
      `SELECT CASE WHEN strftime('%H:%M', 'now', 'localtime') >= ?
         THEN datetime(date('now', 'localtime') || ' ' || ? || ':00', 'utc')
         ELSE datetime(date('now', 'localtime', '-1 day') || ' ' || ? || ':00', 'utc') END AS t`,
    )
    .get(time, time, time).t;
}

const lastMeters = (db, shiftId) => {
  const last = listCheckpoints(db, shiftId).at(-1);
  return last ? last.meters : null;
};

module.exports = { momoTotal, closingCutoff, attendantNamesSql, KIND_LABEL, listCheckpoints, checkpointReports, currentPeriod, lastMeters };
