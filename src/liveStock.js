const { round } = require('./util');

// The tanks' book stock only loses the fuel sold at the closing. While the shift is open, the fuel
// already sold is known from the latest meter index read (a checkpoint, a delivery or a dip):
// that index minus the opening one, less the approved pump tests. Taking it off the book stock
// gives the stock now, so a delivery in the middle of a shift does not push a tank past its capacity.

// Latest known index of each nozzle of the open shift: { shiftId, nozzleId, tankId, label, start, latest }.
function openMeters(db) {
  return db
    .prepare(
      `SELECT r.shift_id AS shiftId, r.nozzle_id AS nozzleId, r.tank_id AS tankId, p.name AS label, r.start_meter AS start,
         MAX(r.start_meter,
           COALESCE((SELECT MAX(c.meter) FROM checkpoint_readings c JOIN shift_checkpoints k ON k.id = c.checkpoint_id
                     WHERE k.shift_id = r.shift_id AND c.nozzle_id = r.nozzle_id), 0),
           COALESCE((SELECT MAX(m.meter) FROM stock_readings m WHERE m.shift_id = r.shift_id AND m.nozzle_id = r.nozzle_id), 0)) AS latest
       FROM shift_readings r JOIN shifts s ON s.id = r.shift_id AND s.status = 'open'
       JOIN products p ON p.id = r.product_id
       ORDER BY r.nozzle_id`,
    )
    .all();
}

// Litres sold since the opening, per tank, with optional new indexes (Map nozzleId -> meter).
function soldByTank(db, meters = openMeters(db), fresh = new Map()) {
  const sold = new Map();
  for (const m of meters) {
    const latest = fresh.has(m.nozzleId) ? fresh.get(m.nozzleId) : m.latest;
    const tested = db.prepare("SELECT COALESCE(SUM(liters), 0) AS v FROM pump_tests WHERE shift_id = ? AND nozzle_id = ? AND status = 'approved'").get(m.shiftId, m.nozzleId).v;
    sold.set(m.tankId, round((sold.get(m.tankId) || 0) + Math.max(0, latest - m.start - tested)));
  }
  return sold;
}

// Tanks with `book_stock` as it stands now (the closing's figure stays in `closing_stock`).
function withLiveStock(db, tanks) {
  const sold = soldByTank(db);
  return tanks.map((t) => (sold.get(t.id) ? { ...t, closing_stock: t.book_stock, sold_open: sold.get(t.id), book_stock: round(t.book_stock - sold.get(t.id)) } : t));
}

module.exports = { openMeters, soldByTank, withLiveStock };
