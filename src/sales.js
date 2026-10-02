const { getSettings } = require('./db');
const { fail, num, str, oneOf, round, transaction } = require('./util');
const { customerBalance } = require('./routes/customers');

const money = (n) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

// Records a customer sale in an open shift. Shared by the attendant's sale form
// and the confirmation of a purchase started by the customer.
//   payment: 'paid' (cash, card…) or 'credit' (added to the customer's balance)
//   quantity: litres, or an amount in dollars converted at the shift price
//   every sale earns loyalty points; a credit beyond the limit needs grantCredit.
function createSale(db, shift, input) {
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

  const payment = oneOf(input.payment ?? 'paid', 'Le mode de paiement', ['paid', 'credit']);
  let liters;
  let amount;
  if (input.liters !== undefined && input.liters !== null && input.liters !== '') {
    liters = round(num(input.liters, 'Le nombre de litres', { min: 0.01, max: 100000 }));
    amount = round(liters * reading.unit_price);
  } else {
    amount = round(num(input.amount, 'Le montant', { min: 0.01, max: 1e7 }));
    liters = round(amount / reading.unit_price);
  }
  const plate = str(input.plate, "L'immatriculation", { required: false, max: 20 }) ?? customer.plate;
  const points = Math.floor(liters * getSettings(db).pointsPerLiter);

  const id = transaction(db, () => {
    let overLimit = 0;
    if (payment === 'credit') {
      const balance = customerBalance(db, customer.id);
      if (balance + amount > customer.credit_limit + 0.001) {
        // The attendant may still grant the credit, but must confirm it explicitly:
        // the sale is then flagged and reported to the manager.
        if (input.grantCredit !== true) {
          fail(
            409,
            `Plafond de crédit dépassé : encours ${money(balance)}, plafond ${money(customer.credit_limit)}, disponible ${money(Math.max(0, customer.credit_limit - balance))}.`,
            'over_limit',
          );
        }
        overLimit = 1;
      }
    }
    const r = db
      .prepare(
        `INSERT INTO sales (shift_id, customer_id, nozzle_id, product_id, kind, liters, unit_price, amount, points, plate, over_limit, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(shift.id, customer.id, reading.nozzle_id, reading.product_id, payment, liters, reading.unit_price, amount, points, plate, overLimit, input.source || 'attendant');
    if (points) db.prepare('UPDATE customers SET loyalty_points = loyalty_points + ? WHERE id = ?').run(points, customer.id);
    if (input.afterInsert) input.afterInsert(Number(r.lastInsertRowid));
    return r.lastInsertRowid;
  });
  return db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
}

module.exports = { createSale };
