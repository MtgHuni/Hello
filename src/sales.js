const { getSettings } = require('./db');
const { fail, num, str, oneOf, round, transaction, clientRef } = require('./util');
const { customerBalance } = require('./routes/customers');
const { refreshCustomer, subscriberDues, creditAllocation } = require('./loyalty');
const { ownPrice } = require('./prices');

const money = (n) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

// Records a customer sale in an open shift. Shared by the attendant's sale form
// and the confirmation of a purchase started by the customer.
//   payment: 'paid' (cash, card…), 'credit' (added to the customer's balance)
//            or 'combo' (fuel exchanged for the customer's combos)
//   price:   subscribers (abonnés) pay the subscriber price fixed at shift opening
//   quantity: litres, or an amount in dollars converted at that price
//   combos:  earned at once on a paid sale, once fully paid on a credit sale
//   credit:  beyond the limit, or for a subscriber late on last month, needs grantCredit.
function createSale(db, shift, input) {
  // The same form sent twice (answer lost on a weak network): the first sale is returned.
  const ref = clientRef(input.clientRef);
  if (ref) {
    const done = db.prepare('SELECT * FROM sales WHERE client_ref = ?').get(ref);
    if (done) return done;
  }
  const settings = getSettings(db);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND active = 1').get(Number(input.customerId));
  if (!customer) fail(400, 'Client inconnu ou désactivé.');

  let reading;
  if (input.nozzleId) {
    reading = db.prepare('SELECT * FROM shift_readings WHERE shift_id = ? AND nozzle_id = ?').get(shift.id, Number(input.nozzleId));
    if (!reading) fail(400, 'Ce produit ne fait pas partie de votre poste.');
  } else {
    reading = db.prepare('SELECT * FROM shift_readings WHERE shift_id = ? AND product_id = ? ORDER BY id LIMIT 1').get(shift.id, Number(input.productId));
    if (!reading) fail(400, "Ce produit n'est servi par aucune pompe de votre poste.");
  }

  const subscriber = customer.type === 'account';
  // A subscriber pays their own price when the station gave them one, else the shift's subscriber price.
  const unitPrice = subscriber ? ownPrice(db, customer, reading.product_id) ?? reading.subscriber_price ?? reading.unit_price : reading.unit_price;
  const payment = oneOf(input.payment ?? 'credit', 'Le mode de paiement', ['paid', 'credit', 'combo']);
  let liters;
  let amount;
  if (input.liters !== undefined && input.liters !== null && input.liters !== '') {
    liters = round(num(input.liters, 'Le nombre de litres', { min: 0.01, max: 100000 }));
    amount = round(liters * unitPrice);
  } else {
    amount = round(num(input.amount, 'Le montant', { min: 0.01, max: 1e7 }));
    liters = round(amount / unitPrice);
  }
  const plate = str(input.plate, "L'immatriculation", { required: false, max: 20 }) ?? customer.plate;
  if (payment === 'combo' && !settings.combosEnabled) fail(409, 'Les combos sont désactivés.', 'combos');
  const pointsDue = payment === 'combo' || !settings.combosEnabled ? 0 : Math.floor(liters * settings.combosPerLiter);
  const combosUsed = payment === 'combo' ? Math.ceil(amount / settings.comboValue - 1e-9) : 0;

  const id = transaction(db, () => {
    let overLimit = 0;
    if (payment === 'combo') {
      if (customer.loyalty_points < settings.comboThreshold) {
        fail(409, `Il faut au moins ${settings.comboThreshold} combos pour les échanger (le client en a ${customer.loyalty_points}).`, 'combos');
      }
      if (combosUsed > customer.loyalty_points) {
        const max = round(customer.loyalty_points * settings.comboValue);
        fail(409, `Combos insuffisants : ${customer.loyalty_points} combos valent ${money(max)}, soit ${round(max / unitPrice)} L au maximum.`, 'combos');
      }
    }
    if (payment === 'credit') {
      const balance = customerBalance(db, customer.id);
      const dues = subscriber ? subscriberDues(db, customer.id, settings.subscriberGraceDays) : null;
      let problem = null;
      if (dues?.late) problem = `Abonné en retard : ${money(dues.overdue)} du mois précédent non payés.`;
      // An individual takes a new credit only once the last one is paid: no one can grant it.
      else if (!subscriber && balance > 0.001) fail(409, `${customer.name} a déjà un crédit non payé de ${money(balance)} : pas de nouveau crédit avant son paiement.`, 'has_credit');
      // There is no credit limit: an individual has one credit at a time, a subscriber pays each month.
      if (problem) {
        // The attendant may still grant the credit to a late subscriber, but must confirm it explicitly:
        // the sale is then flagged and reported to the manager.
        if (input.grantCredit !== true) fail(409, problem, 'over_limit');
        overLimit = 1;
      }
    }
    const r = db
      .prepare(
        `INSERT INTO sales (shift_id, customer_id, nozzle_id, product_id, kind, liters, unit_price, amount, points, points_due, combos_used, plate, over_limit, source, client_ref, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(shift.id, customer.id, reading.nozzle_id, reading.product_id, payment, liters, unitPrice, amount, payment === 'paid' ? pointsDue : 0, pointsDue, combosUsed, plate, overLimit, input.source || 'attendant', ref, input.userId ?? null);
    refreshCustomer(db, customer.id);
    if (input.afterInsert) input.afterInsert(Number(r.lastInsertRowid));
    return r.lastInsertRowid;
  });
  return db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
}

// The manager corrects a credit entered wrongly (customer, product, quantity, plate): the price
// follows the shift's (subscriber price for a subscriber), and both customers' balances are
// recomputed. A correction records what happened: the credit rules are not checked again.
function updateSale(db, sale, input) {
  if (sale.kind !== 'credit') fail(409, 'Un échange de combos ne se modifie pas : annulez-le puis saisissez-le à nouveau.');
  const settings = getSettings(db);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(input.customerId ?? sale.customer_id));
  if (!customer) fail(400, 'Client inconnu.');
  const reading = db.prepare('SELECT * FROM shift_readings WHERE shift_id = ? AND product_id = ? ORDER BY id LIMIT 1').get(sale.shift_id, Number(input.productId ?? sale.product_id));
  if (!reading) fail(400, 'Ce produit ne fait pas partie du poste.');
  const unitPrice = customer.type === 'account' ? ownPrice(db, customer, reading.product_id) ?? reading.subscriber_price ?? reading.unit_price : reading.unit_price;
  let liters;
  let amount;
  if (input.amount !== undefined && input.amount !== null && input.amount !== '') {
    amount = round(num(input.amount, 'Le montant', { min: 0.01, max: 1e7 }));
    liters = round(amount / unitPrice);
  } else {
    liters = round(num(input.liters ?? sale.liters, 'Le nombre de litres', { min: 0.01, max: 100000 }));
    amount = round(liters * unitPrice);
  }
  const plate = input.plate === undefined ? sale.plate : str(input.plate, "L'immatriculation", { required: false, max: 20 });
  const pointsDue = settings.combosEnabled ? Math.floor(liters * settings.combosPerLiter) : 0;
  db.prepare('UPDATE sales SET customer_id = ?, nozzle_id = ?, product_id = ?, liters = ?, unit_price = ?, amount = ?, points_due = ?, plate = ? WHERE id = ?').run(
    customer.id,
    reading.nozzle_id,
    reading.product_id,
    liters,
    unitPrice,
    amount,
    pointsDue,
    plate,
    sale.id,
  );
  refreshCustomer(db, customer.id);
  if (customer.id !== sale.customer_id) refreshCustomer(db, sale.customer_id);
  return db.prepare('SELECT * FROM sales WHERE id = ?').get(sale.id);
}

// A credit paid back during the open shift it was taken in is neither a credit nor a payment of
// that shift: it becomes a sale paid at the pump (the indexes count it like any other), whole or
// for the part paid (the litres split in proportion). Paid by mobile money, that part is also a
// mobile money entry of the shift. Runs inside the payment's transaction; returns what it settled
// and the rest, which is an ordinary payment.
function settleInShift(db, shift, customerId, amount, { method, ref, userId }) {
  if (shift.status !== 'open') return { settled: 0, rest: amount };
  const unpaid = new Map(creditAllocation(db, customerId).filter((c) => !c.old).map((c) => [c.id, c.unpaid]));
  const credits = db
    .prepare("SELECT * FROM sales WHERE shift_id = ? AND customer_id = ? AND kind = 'credit' AND cancel_requested_at IS NULL ORDER BY created_at, id")
    .all(shift.id, customerId);
  const combos = getSettings(db).combosEnabled;
  let rest = amount;
  let settled = 0;
  for (const s of credits) {
    const due = round(Math.min(rest, unpaid.get(s.id) || 0));
    if (due < 0.01) continue;
    let liters = s.liters;
    if (due >= s.amount - 0.005) {
      db.prepare("UPDATE sales SET kind = 'paid', points = ?, over_limit = 0, settled_ref = ? WHERE id = ?").run(combos ? s.points_due : 0, ref, s.id);
    } else {
      liters = round(s.liters * (due / s.amount), 3);
      const points = Math.floor(s.points_due * (due / s.amount));
      db.prepare('UPDATE sales SET liters = ?, amount = ?, points_due = ? WHERE id = ?').run(round(s.liters - liters, 3), round(s.amount - due), s.points_due - points, s.id);
      db.prepare(
        `INSERT INTO sales (shift_id, customer_id, nozzle_id, product_id, kind, liters, unit_price, amount, points, points_due, plate, source, user_id, settled_ref)
         VALUES (?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(s.shift_id, s.customer_id, s.nozzle_id, s.product_id, liters, s.unit_price, due, combos ? points : 0, points, s.plate, s.source, userId ?? null, ref);
    }
    if (method === 'mobile money') {
      db.prepare('INSERT INTO momo_sales (shift_id, product_id, liters, unit_price, amount, user_id) VALUES (?, ?, ?, ?, ?, ?)').run(shift.id, s.product_id, liters, s.unit_price, due, userId ?? null);
    }
    rest = round(rest - due);
    settled = round(settled + due);
    if (rest < 0.01) break;
  }
  return { settled, rest };
}

module.exports = { createSale, updateSale, settleInShift };
