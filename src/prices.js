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

module.exports = { applyScheduledPrices, price3 };
