const express = require('express');
const { getSettings } = require('../db');
const { fail, num, str, transaction } = require('../util');
const {
  hashPassword,
  verifyPassword,
  checkPasswordStrength,
  startSession,
  endSession,
  requireRole,
  loginLimiter,
} = require('../auth');

module.exports = function authRoutes(db) {
  const router = express.Router();
  const limiter = loginLimiter();
  const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

  router.get('/setup', (req, res) => {
    const { stationName, combosEnabled } = getSettings(db);
    res.json({ needsSetup: userCount() === 0, stationName, combosEnabled });
  });

  // First launch: creates the manager account and a default station
  // (one diesel pump and one petrol pump, each fed by its own tank).
  router.post('/setup', (req, res) => {
    const b = req.body || {};
    const stationName = str(b.stationName, 'Le nom de la station', { max: 100 });
    const name = str(b.name, 'Votre nom', { max: 100 });
    const login = str(b.login, "L'identifiant", { max: 100 });
    const password = checkPasswordStrength(b.password);
    const dieselPrice = num(b.dieselPrice, 'Le prix du gasoil', { min: 0.001, max: 1000 });
    const petrolPrice = num(b.petrolPrice, "Le prix de l'essence", { min: 0.001, max: 1000 });

    const userId = transaction(db, () => {
      if (userCount() > 0) fail(409, 'La station est déjà configurée.');
      db.prepare("UPDATE settings SET value = ? WHERE key = 'station_name'").run(stationName);
      const user = db
        .prepare("INSERT INTO users (name, login, password_hash, role) VALUES (?, ?, ?, 'manager')")
        .run(name, login, hashPassword(password));
      const id = Number(user.lastInsertRowid);

      [
        ['Gasoil', dieselPrice],
        ['Essence', petrolPrice],
      ].forEach(([product, price], i) => {
        const p = Number(db.prepare('INSERT INTO products (name, price) VALUES (?, ?)').run(product, price).lastInsertRowid);
        db.prepare('INSERT INTO price_history (product_id, price, user_id) VALUES (?, ?, ?)').run(p, price, id);
        const t = Number(
          db
            .prepare('INSERT INTO tanks (name, product_id, capacity, low_level) VALUES (?, ?, 20000, 3000)')
            .run(`Cuve ${product}`, p).lastInsertRowid,
        );
        const pump = Number(db.prepare('INSERT INTO pumps (name) VALUES (?)').run(`Pompe ${i + 1}`).lastInsertRowid);
        db.prepare('INSERT INTO nozzles (pump_id, tank_id, name) VALUES (?, ?, ?)').run(pump, t, `Pistolet ${product}`);
      });
      return id;
    });

    startSession(db, req, res, userId);
    res.status(201).json({ ok: true });
  });

  router.post('/auth/login', (req, res) => {
    const login = str(req.body?.login, "L'identifiant");
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const key = `${req.ip}|${login.toLowerCase()}`;
    limiter.check(key);

    const find = db.prepare('SELECT id, password_hash, active FROM users WHERE login = ?');
    // Customers log in with their phone number, typed with or without spaces.
    const user = find.get(login) || find.get(login.replace(/[\s.-]/g, ''));
    if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
      limiter.fail(key);
      fail(401, 'Identifiant ou mot de passe incorrect.');
    }
    limiter.reset(key);
    startSession(db, req, res, user.id);
    res.json({ ok: true });
  });

  // Self sign-up for customers: name, phone (used as login) and password.
  // The customer is a particulier (particulier credit limit), flagged for the manager.
  router.post('/register', (req, res) => {
    const key = `${req.ip}|register`;
    limiter.check(key);
    const name = str(req.body?.name, 'Votre nom', { max: 120 });
    const phone = str(req.body?.phone, 'Votre téléphone', { max: 30 }).replace(/[\s.-]/g, '');
    if (!/^\+?\d{6,15}$/.test(phone)) fail(400, 'Numéro de téléphone invalide.');
    const password = checkPasswordStrength(req.body?.password);
    if (db.prepare('SELECT 1 FROM users WHERE login = ?').get(phone)) {
      limiter.fail(key);
      fail(409, 'Un compte existe déjà avec ce numéro. Connectez-vous.');
    }
    const userId = transaction(db, () => {
      const customerId = db
        .prepare("INSERT INTO customers (type, name, phone, credit_limit, needs_review) VALUES ('individual', ?, ?, ?, 1)")
        .run(name, phone, getSettings(db).individualCreditLimit).lastInsertRowid;
      return Number(
        db.prepare("INSERT INTO users (name, login, password_hash, role, customer_id) VALUES (?, ?, ?, 'customer', ?)").run(name, phone, hashPassword(password), customerId)
          .lastInsertRowid,
      );
    });
    limiter.fail(key); // counts towards the per-IP limit, to slow down mass sign-ups
    startSession(db, req, res, userId);
    res.status(201).json({ ok: true });
  });

  router.post('/auth/logout', (req, res) => {
    endSession(db, req, res);
    res.json({ ok: true });
  });

  router.get('/auth/me', requireRole(), (req, res) => {
    res.json({ user: req.user, settings: getSettings(db) });
  });

  router.post('/auth/password', requireRole(), (req, res) => {
    const current = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(String(req.body?.current || ''), current.password_hash)) {
      fail(400, 'Mot de passe actuel incorrect.');
    }
    const password = checkPasswordStrength(req.body?.password);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), req.user.id);
    res.json({ ok: true });
  });

  return router;
};
