// Données de test : remplit les cuves et fixe des prix arbitraires,
// pour ne pas tout ressaisir à chaque essai. Ne crée aucun compte.
const { round, transaction } = require('./util');

const TEST_PRICES = { Gasoil: 1.35, Essence: 1.55 };
const FALLBACK_PRICE = 1.4;

// force = true : remplit toutes les cuves à `fill` de leur capacité et applique les prix de test.
// force = false : ne complète que les cuves sous 50 %, et ne touche pas aux prix déjà modifiés.
function seedTestData(db, { force = false, fill = 0.9 } = {}) {
  const manager = db.prepare("SELECT id FROM users WHERE role = 'manager' ORDER BY id LIMIT 1").get();
  if (!manager) return { skipped: 'Station non configurée : créez d’abord le compte gérant.' };

  return transaction(db, () => {
    const result = { tanks: [], prices: [] };

    for (const tank of db.prepare('SELECT * FROM tanks WHERE active = 1').all()) {
      if (!force && tank.book_stock >= tank.capacity * 0.5) continue;
      const target = round(tank.capacity * fill);
      const added = round(target - tank.book_stock);
      if (added <= 0) continue;
      db.prepare(
        `INSERT INTO deliveries (tank_id, supplier, reference, liters_ordered, liters_received, unit_cost, book_before, user_id)
         VALUES (?, 'Données de test', 'TEST', ?, ?, NULL, ?, ?)`,
      ).run(tank.id, added, added, tank.book_stock, manager.id);
      db.prepare('UPDATE tanks SET book_stock = ? WHERE id = ?').run(target, tank.id);
      result.tanks.push({ name: tank.name, liters: target });
    }

    for (const product of db.prepare('SELECT * FROM products WHERE active = 1').all()) {
      const history = db.prepare('SELECT COUNT(*) AS n FROM price_history WHERE product_id = ?').get(product.id).n;
      if (!force && history > 1) continue;
      const price = TEST_PRICES[product.name] ?? FALLBACK_PRICE;
      if (price === product.price) continue;
      db.prepare('UPDATE products SET price = ? WHERE id = ?').run(price, product.id);
      db.prepare('INSERT INTO price_history (product_id, price, user_id) VALUES (?, ?, ?)').run(product.id, price, manager.id);
      result.prices.push({ name: product.name, price });
    }
    return result;
  });
}

module.exports = { seedTestData };
