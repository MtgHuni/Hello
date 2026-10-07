// A price change scheduled for a date (products.next_price*) takes effect the first time
// prices are read after that date: at a shift opening, or when a screen lists the prices.
const { audit } = require('./audit');

const price3 = (n) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function applyScheduledPrices(db) {
  const due = db.prepare("SELECT * FROM products WHERE next_price_at IS NOT NULL AND next_price_at <= datetime('now')").all();
  for (const p of due) {
    const subscriber = p.next_subscriber_price ?? p.subscriber_price ?? p.next_price;
    db.prepare(
      'UPDATE products SET price = ?, subscriber_price = ?, next_price = NULL, next_subscriber_price = NULL, next_price_at = NULL, next_price_by = NULL WHERE id = ?',
    ).run(p.next_price, subscriber, p.id);
    db.prepare('INSERT INTO price_history (product_id, price, subscriber_price, changed_at, user_id) VALUES (?, ?, ?, ?, ?)').run(
      p.id,
      p.next_price,
      subscriber,
      p.next_price_at,
      p.next_price_by,
    );
    audit(db, { user: { id: p.next_price_by } }, {
      category: 'prix',
      action: 'price_applied',
      entity: 'products',
      id: p.id,
      summary: `Prix programmé appliqué : ${p.name} ${price3(p.price)} → ${price3(p.next_price)} $/L, abonnés ${price3(subscriber)} $/L`,
      before: { price: p.price, subscriber_price: p.subscriber_price },
      after: { price: p.next_price, subscriber_price: subscriber },
    });
  }
  return due.length;
}

// A subscriber's own price for a fuel (customer_prices), or null: they pay the subscribers' price.
function ownPrice(db, customer, productId) {
  if (customer?.type !== 'account') return null;
  return db.prepare('SELECT price FROM customer_prices WHERE customer_id = ? AND product_id = ?').get(customer.id, productId)?.price ?? null;
}

// What a customer pays now for each fuel on sale: a subscriber their own price, else the
// subscribers' price; a particulier the pump price. `base`: the price without their own.
function customerPriceList(db, customer) {
  const subscriber = customer.type === 'account';
  const own = new Map(db.prepare('SELECT product_id, price FROM customer_prices WHERE customer_id = ?').all(customer.id).map((r) => [r.product_id, r.price]));
  return db
    .prepare('SELECT id, name, price, COALESCE(subscriber_price, price) AS subscriber_price FROM products WHERE active = 1 ORDER BY id')
    .all()
    .map((p) => {
      const base = subscriber ? p.subscriber_price : p.price;
      const mine = subscriber ? own.get(p.id) : undefined;
      return { product_id: p.id, name: p.name, base, price: mine ?? base, own: mine != null };
    });
}

module.exports = { applyScheduledPrices, price3, ownPrice, customerPriceList };
