const { getSettings } = require('./db');

// The transport paid on every shift, out of the shift's own money: one expense « Transport » added
// when the shift opens, at the amount set in Réglages (0: none). Its key makes it once per shift;
// the manager corrects or cancels it like any other expense. It is taken out of the money at the
// closing only: the reliefs (and the other checkpoints) leave it out (`isShiftTransport()`).
const transportRef = (shiftId) => `transport-${shiftId}`;
const isShiftTransport = (expense) => expense.client_ref === transportRef(expense.shift_id);

function addShiftTransport(db, shiftId) {
  const amount = getSettings(db).shiftTransport;
  if (!(amount > 0) || !shiftId) return;
  db.prepare(
    `INSERT OR IGNORE INTO expenses (expense_date, category, amount, description, method, shift_id, client_ref)
     VALUES (date('now', 'localtime'), 'Transport', ?, 'Transport du poste', 'espèces', ?, ?)`,
  ).run(amount, shiftId, transportRef(shiftId));
}

module.exports = { addShiftTransport, isShiftTransport };
