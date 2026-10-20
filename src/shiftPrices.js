// A price changed while a shift is open (version 33): each nozzle of that fuel is read at that moment
// (shift_price_meters: the index and the prices before), and the shift's readings take the new prices.
// The litres up to that index are sold at the prices before, the rest at the new ones; a sale is
// worth the pump price in force at its time (for the subscribers' surcharge, a correction).
const { round } = require('./util');

// The changes of a shift, per nozzle, oldest first.
function priceChanges(db, shiftId) {
  const out = new Map();
  for (const c of db.prepare('SELECT * FROM shift_price_meters WHERE shift_id = ? ORDER BY id').all(shiftId)) {
    if (!out.has(c.nozzle_id)) out.set(c.nozzle_id, []);
    out.get(c.nozzle_id).push(c);
  }
  return out;
}

// The pump prices of a reading at a time (a UTC timestamp): the prices before the first change made after it.
function priceAt(changes, reading, at) {
  const next = (changes.get(reading.nozzle_id) || []).find((c) => c.created_at > at);
  return next ? { price: next.old_price, subscriber: next.old_subscriber_price } : { price: reading.unit_price, subscriber: reading.subscriber_price };
}

// What the meter sold between two indexes, each part at its price, less the approved pump tests
// ({ liters, created_at }) at the price of their time.
function meterAmount(changes, reading, from, to, tests = []) {
  let amount = 0;
  let pos = from;
  for (const c of changes.get(reading.nozzle_id) || []) {
    if (pos >= to) break;
    const upTo = Math.min(c.meter, to);
    if (upTo > pos) {
      amount += (upTo - pos) * c.old_price;
      pos = upTo;
    }
  }
  if (to > pos) amount += (to - pos) * reading.unit_price;
  for (const t of tests) amount -= t.liters * priceAt(changes, reading, t.created_at).price;
  return round(amount);
}

// The subscribers' surcharge of some sales: what they paid above the pump price of their time.
function surchargeOf(changes, readings, sales) {
  const byNozzle = new Map(readings.map((r) => [r.nozzle_id, r]));
  return round(
    sales.reduce((t, s) => {
      const r = byNozzle.get(s.nozzle_id);
      return t + (s.amount - s.liters * (r ? priceAt(changes, r, s.created_at).price : s.unit_price));
    }, 0),
  );
}

// The same pump price in SQL, for a sale `sa` joined to its shift reading `r`.
const pumpPriceSql = (sa = 'sa', r = 'r') =>
  `COALESCE((SELECT m.old_price FROM shift_price_meters m WHERE m.shift_id = ${sa}.shift_id AND m.nozzle_id = ${sa}.nozzle_id AND m.created_at > ${sa}.created_at ORDER BY m.id LIMIT 1), ${r}.unit_price)`;

module.exports = { priceChanges, priceAt, meterAmount, surchargeOf, pumpPriceSql };
