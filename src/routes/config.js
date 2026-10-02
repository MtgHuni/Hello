const express = require('express');
const { getSettings } = require('../db');
const { fail, num, str, bool, transaction } = require('../util');
const { requireRole } = require('../auth');

const manager = requireRole('manager');

module.exports = function configRoutes(db) {
  const router = express.Router();

  const nozzleInOpenShift = (nozzleId) =>
    db
      .prepare(
        `SELECT 1 FROM shift_readings r JOIN shifts s ON s.id = r.shift_id
         WHERE s.status = 'open' AND r.nozzle_id = ?`,
      )
      .get(nozzleId);

  // ---- Station settings --------------------------------------------------

  router.get('/settings', requireRole(), (req, res) => res.json(getSettings(db)));

  router.put('/settings', manager, (req, res) => {
    const b = req.body || {};
    const values = {
      station_name: str(b.stationName, 'Le nom de la station', { max: 100 }),
      cash_tolerance: num(b.cashTolerance, 'La tolérance de caisse', { max: 10000 }),
      stock_tolerance: num(b.stockTolerance, 'La tolérance de stock', { max: 100000 }),
      points_per_liter: num(b.pointsPerLiter, 'Les points par litre', { max: 1000 }),
      new_customer_credit_limit: num(b.newCustomerCreditLimit, 'Le plafond des nouveaux clients', { max: 1e8 }),
    };
    const stmt = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
    for (const [key, value] of Object.entries(values)) stmt.run(String(value), key);
    res.json(getSettings(db));
  });

  // ---- Products & prices -------------------------------------------------

  router.get('/products', requireRole(), (req, res) => {
    res.json(db.prepare('SELECT id, name, price, active FROM products ORDER BY id').all());
  });

  router.post('/products', manager, (req, res) => {
    const name = str(req.body?.name, 'Le nom du produit', { max: 50 });
    const price = num(req.body?.price, 'Le prix', { min: 0.001, max: 1000 });
    if (db.prepare('SELECT 1 FROM products WHERE name = ?').get(name)) fail(409, 'Ce produit existe déjà.');
    const id = transaction(db, () => {
      const pid = Number(db.prepare('INSERT INTO products (name, price) VALUES (?, ?)').run(name, price).lastInsertRowid);
      db.prepare('INSERT INTO price_history (product_id, price, user_id) VALUES (?, ?, ?)').run(pid, price, req.user.id);
      return pid;
    });
    res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
  });

  router.put('/products/:id', manager, (req, res) => {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!product) fail(404, 'Produit introuvable.');
    const name = str(req.body?.name, 'Le nom du produit', { required: false, max: 50 }) ?? product.name;
    const price = num(req.body?.price, 'Le prix', { min: 0.001, max: 1000, required: false }) ?? product.price;
    const active = bool(req.body?.active, !!product.active) ? 1 : 0;
    transaction(db, () => {
      db.prepare('UPDATE products SET name = ?, price = ?, active = ? WHERE id = ?').run(name, price, active, product.id);
      if (price !== product.price) {
        db.prepare('INSERT INTO price_history (product_id, price, user_id) VALUES (?, ?, ?)').run(product.id, price, req.user.id);
      }
    });
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(product.id));
  });

  router.get('/products/:id/history', manager, (req, res) => {
    res.json(
      db
        .prepare(
          `SELECT h.price, h.changed_at, u.name AS user_name
           FROM price_history h LEFT JOIN users u ON u.id = h.user_id
           WHERE h.product_id = ? ORDER BY h.id DESC LIMIT 100`,
        )
        .all(req.params.id),
    );
  });

  // ---- Tanks -------------------------------------------------------------

  const tankSelect = `
    SELECT t.*, p.name AS product_name,
      (SELECT d.variance FROM dips d WHERE d.tank_id = t.id ORDER BY d.id DESC LIMIT 1) AS last_dip_variance,
      (SELECT d.created_at FROM dips d WHERE d.tank_id = t.id ORDER BY d.id DESC LIMIT 1) AS last_dip_at
    FROM tanks t JOIN products p ON p.id = t.product_id`;

  router.get('/tanks', manager, (req, res) => {
    res.json(db.prepare(`${tankSelect} ORDER BY t.id`).all());
  });

  function tankFields(b, current = {}) {
    const productId = num(b.productId ?? current.product_id, 'Le produit', { integer: true, min: 1 });
    if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId)) fail(400, 'Produit inconnu.');
    const capacity = num(b.capacity ?? current.capacity, 'La capacité', { min: 1, max: 1e7 });
    const lowLevel = num(b.lowLevel ?? current.low_level, "Le seuil d'alerte", { max: capacity });
    return {
      name: str(b.name ?? current.name, 'Le nom de la cuve', { max: 50 }),
      productId,
      capacity,
      lowLevel,
    };
  }

  router.post('/tanks', manager, (req, res) => {
    const f = tankFields(req.body || {});
    const stock = num(req.body?.initialStock ?? 0, 'Le stock initial', { max: f.capacity });
    const id = db
      .prepare('INSERT INTO tanks (name, product_id, capacity, low_level, book_stock) VALUES (?, ?, ?, ?, ?)')
      .run(f.name, f.productId, f.capacity, f.lowLevel, stock).lastInsertRowid;
    res.status(201).json(db.prepare(`${tankSelect} WHERE t.id = ?`).get(id));
  });

  router.put('/tanks/:id', manager, (req, res) => {
    const tank = db.prepare('SELECT * FROM tanks WHERE id = ?').get(req.params.id);
    if (!tank) fail(404, 'Cuve introuvable.');
    const f = tankFields(req.body || {}, tank);
    const active = bool(req.body?.active, !!tank.active) ? 1 : 0;
    db.prepare('UPDATE tanks SET name = ?, product_id = ?, capacity = ?, low_level = ?, active = ? WHERE id = ?').run(
      f.name,
      f.productId,
      f.capacity,
      f.lowLevel,
      active,
      tank.id,
    );
    res.json(db.prepare(`${tankSelect} WHERE t.id = ?`).get(tank.id));
  });

  // ---- Pumps & nozzles ---------------------------------------------------

  function listPumps() {
    const pumps = db.prepare('SELECT * FROM pumps ORDER BY id').all();
    const nozzles = db
      .prepare(
        `SELECT n.*, t.name AS tank_name, t.product_id, p.name AS product_name, p.price,
           (SELECT u.name FROM shift_readings r JOIN shifts s ON s.id = r.shift_id JOIN users u ON u.id = s.attendant_id
            WHERE s.status = 'open' AND r.nozzle_id = n.id) AS busy_with
         FROM nozzles n JOIN tanks t ON t.id = n.tank_id JOIN products p ON p.id = t.product_id
         ORDER BY n.id`,
      )
      .all();
    return pumps.map((pump) => {
      const own = nozzles.filter((n) => n.pump_id === pump.id);
      return { ...pump, nozzles: own, busy_with: own.find((n) => n.busy_with)?.busy_with || null };
    });
  }

  router.get('/pumps', requireRole('manager', 'attendant'), (req, res) => res.json(listPumps()));

  router.post('/pumps', manager, (req, res) => {
    const name = str(req.body?.name, 'Le nom de la pompe', { max: 50 });
    db.prepare('INSERT INTO pumps (name) VALUES (?)').run(name);
    res.status(201).json(listPumps());
  });

  router.put('/pumps/:id', manager, (req, res) => {
    const pump = db.prepare('SELECT * FROM pumps WHERE id = ?').get(req.params.id);
    if (!pump) fail(404, 'Pompe introuvable.');
    const name = str(req.body?.name, 'Le nom de la pompe', { required: false, max: 50 }) ?? pump.name;
    const active = bool(req.body?.active, !!pump.active) ? 1 : 0;
    db.prepare('UPDATE pumps SET name = ?, active = ? WHERE id = ?').run(name, active, pump.id);
    res.json(listPumps());
  });

  router.post('/pumps/:id/nozzles', manager, (req, res) => {
    if (!db.prepare('SELECT 1 FROM pumps WHERE id = ?').get(req.params.id)) fail(404, 'Pompe introuvable.');
    const name = str(req.body?.name, 'Le nom du pistolet', { max: 50 });
    const tankId = num(req.body?.tankId, 'La cuve', { integer: true, min: 1 });
    if (!db.prepare('SELECT 1 FROM tanks WHERE id = ?').get(tankId)) fail(400, 'Cuve inconnue.');
    const meter = num(req.body?.meter ?? 0, "L'index du compteur");
    db.prepare('INSERT INTO nozzles (pump_id, tank_id, name, meter) VALUES (?, ?, ?, ?)').run(
      req.params.id,
      tankId,
      name,
      meter,
    );
    res.status(201).json(listPumps());
  });

  router.put('/nozzles/:id', manager, (req, res) => {
    const nozzle = db.prepare('SELECT * FROM nozzles WHERE id = ?').get(req.params.id);
    if (!nozzle) fail(404, 'Pistolet introuvable.');
    const name = str(req.body?.name, 'Le nom du pistolet', { required: false, max: 50 }) ?? nozzle.name;
    const tankId = num(req.body?.tankId, 'La cuve', { integer: true, min: 1, required: false }) ?? nozzle.tank_id;
    const meter = num(req.body?.meter, "L'index du compteur", { required: false }) ?? nozzle.meter;
    const active = bool(req.body?.active, !!nozzle.active) ? 1 : 0;
    if ((tankId !== nozzle.tank_id || meter !== nozzle.meter) && nozzleInOpenShift(nozzle.id)) {
      fail(409, 'Ce pistolet est utilisé dans un poste ouvert. Clôturez le poste avant de modifier son index ou sa cuve.');
    }
    if (!db.prepare('SELECT 1 FROM tanks WHERE id = ?').get(tankId)) fail(400, 'Cuve inconnue.');
    db.prepare('UPDATE nozzles SET name = ?, tank_id = ?, meter = ?, active = ? WHERE id = ?').run(
      name,
      tankId,
      meter,
      active,
      nozzle.id,
    );
    res.json(listPumps());
  });

  return router;
};
