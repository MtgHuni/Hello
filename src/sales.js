const { getSettings } = require('./db');
const { fail, num, str, oneOf, round, transaction, clientRef } = require('./util');
const { customerBalance } = require('./routes/customers');
const { refreshCustomer, subscriberDues } = require('./loyalty');

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
    if (!reading) fail(400, 'Ce pistolet ne fait pas partie de votre poste.');
  } else {
    reading = db.prepare('SELECT * FROM shift_readings WHERE shift_id = ? AND product_id = ? ORDER BY id LIMIT 1').get(shift.id, Number(input.productId));
    if (!reading) fail(400, "Ce produit n'est servi par aucune pompe de votre poste.");
  }

  const subscriber = customer.type === 'account';
  const unitPrice = subscriber ? reading.subscriber_price ?? reading.unit_price : reading.unit_price;
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
      else if (balance + amount > customer.credit_limit + 0.001) {
        problem = `Plafond de crédit dépassé : encours ${money(balance)}, plafond ${money(customer.credit_limit)}, disponible ${money(Math.max(0, customer.credit_limit - balance))}.`;
      }
      if (problem) {
        // The attendant may still grant the credit, but must confirm it explicitly:
        // the sale is then flagged and reported to the manager.
        if (input.grantCredit !== true) fail(409, problem, 'over_limit');
        overLimit = 1;
      }
    }
    const r = db
      .prepare(
        `INSERT INTO sales (shift_id, customer_id, nozzle_id, product_id, kind, liters, unit_price, amount, points, points_due, combos_used, plate, over_limit, source, client_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(shift.id, customer.id, reading.nozzle_id, reading.product_id, payment, liters, unitPrice, amount, payment === 'paid' ? pointsDue : 0, pointsDue, combosUsed, plate, overLimit, input.source || 'attendant', ref);
    refreshCustomer(db, customer.id);
    if (input.afterInsert) input.afterInsert(Number(r.lastInsertRowid));
    return r.lastInsertRowid;
  });
  return db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
}

module.exports = { createSale };
