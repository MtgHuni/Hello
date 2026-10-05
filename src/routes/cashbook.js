const express = require('express');
const { fail, num, str, oneOf, round, dateParam, transaction, money } = require('../util');
const { requireRole, requireAdmin } = require('../auth');
const { audit } = require('../audit');
const { getSettings } = require('../db');
const { ACCOUNTS, KINDS, cashbook, balances, supplierBalances } = require('../cashbook');
const { cashbookPdf } = require('../cashbookReport');

const manager = requireRole('manager');
const SUPPLIER_METHODS = ['espèces', 'mobile money'];

module.exports = function cashbookRoutes(db) {
  const router = express.Router();
  const today = () => db.prepare("SELECT date('now', 'localtime') AS d").get().d;
  const period = (q) => {
    const to = dateParam(q.to, 'La date de fin') || today();
    const from = dateParam(q.from, 'La date de début') || `${to.slice(0, 7)}-01`;
    return { from, to };
  };

  // ---- Cash book ----
  router.get('/cashbook', manager, (req, res) => {
    const account = oneOf(req.query.account || 'cash', 'Le compte', Object.keys(ACCOUNTS));
    res.json({ ...cashbook(db, { account, ...period(req.query) }), balances: balances(db) });
  });

  router.get('/cashbook.pdf', manager, (req, res) => {
    const p = period(req.query);
    if (p.from > p.to) fail(400, 'La date de début doit précéder la date de fin.');
    // all: the whole book; in: the entries only; out: the exits only.
    const part = oneOf(req.query.part || 'all', 'Le contenu', ['all', 'in', 'out']);
    const books = Object.keys(ACCOUNTS).map((account) => cashbook(db, { account, ...p }));
    const pdf = cashbookPdf(books, balances(db), { stationName: getSettings(db).stationName, ...p, part });
    const name = { all: 'livre-de-caisse', in: 'entrees-de-caisse', out: 'sorties-de-caisse' }[part];
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${name}-${p.from}-au-${p.to}.pdf"`);
    res.send(pdf);
  });

  // A movement entered by hand: owner's contribution or withdrawal, mobile money withdrawal…
  router.post('/cashbook/movements', manager, requireAdmin, (req, res) => {
    const b = req.body || {};
    const kind = oneOf(b.kind, 'Le type de mouvement', Object.keys(KINDS).filter((k) => !KINDS[k].old));
    const account = oneOf(b.account || KINDS[kind].accounts[0], 'Le compte', KINDS[kind].accounts);
    const amount = round(num(b.amount, 'Le montant', { min: kind === 'opening' ? 0 : 0.01, max: 1e9 }));
    const note = str(b.note, 'La remarque', { required: false, max: 200 });
    const date = kind === 'opening' ? dateParam(b.date, 'La date') : null;
    if (date && date > today()) fail(400, 'Le solde de départ ne peut pas être daté dans le futur.');
    const id = transaction(db, () => {
      const r = db
        .prepare(
          `INSERT INTO cash_movements (kind, account, amount, note, user_id, created_at)
           VALUES (?, ?, ?, ?, ?, COALESCE(datetime(? || ' 00:00:00', 'utc'), datetime('now')))`,
        )
        .run(kind, account, amount, note, req.user.id, date);
      audit(db, req, {
        category: 'caisse',
        action: `cash_${kind}`,
        entity: 'cash_movements',
        id: Number(r.lastInsertRowid),
        summary: `${KINDS[kind].label} (${ACCOUNTS[account]}) : ${money(amount)}${note ? `, ${note}` : ''}`,
      });
      return Number(r.lastInsertRowid);
    });
    res.status(201).json({ id, balances: balances(db) });
  });

  router.delete('/cashbook/movements/:id', manager, requireAdmin, (req, res) => {
    const m = db.prepare('SELECT * FROM cash_movements WHERE id = ?').get(req.params.id);
    if (!m) fail(404, 'Mouvement introuvable.');
    transaction(db, () => {
      db.prepare('DELETE FROM cash_movements WHERE id = ?').run(m.id);
      audit(db, req, {
        category: 'caisse',
        action: 'cash_movement_removed',
        entity: 'cash_movements',
        id: m.id,
        summary: `Mouvement retiré : ${KINDS[m.kind]?.label || m.kind} (${ACCOUNTS[m.account]}), ${money(m.amount)}`,
        before: m,
      });
    });
    res.json({ balances: balances(db) });
  });

  // Counting the till: the money really there against the book.
  router.post('/cashbook/counts', manager, requireAdmin, (req, res) => {
    const account = oneOf(req.body?.account || 'cash', 'Le compte', Object.keys(ACCOUNTS));
    const counted = round(num(req.body?.counted, 'Le montant compté', { max: 1e9 }));
    const note = str(req.body?.note, 'La remarque', { required: false, max: 200 });
    const book = balances(db)[account].balance;
    db.prepare('INSERT INTO cash_counts (account, counted, book, note, user_id) VALUES (?, ?, ?, ?, ?)').run(account, counted, book, note, req.user.id);
    audit(db, req, { category: 'caisse', action: 'cash_count', entity: 'cash_counts', summary: `Comptage ${ACCOUNTS[account]} : ${money(counted)} pour ${money(book)} au livre (écart ${money(round(counted - book))})` });
    res.status(201).json({ balances: balances(db) });
  });

  // ---- Suppliers: deliveries taken on credit, and their payment ----
  router.get('/suppliers', manager, (req, res) => {
    res.json({
      suppliers: supplierBalances(db),
      names: db.prepare('SELECT name FROM suppliers ORDER BY name COLLATE NOCASE').all().map((r) => r.name),
      payments: db
        .prepare('SELECT p.*, u.name AS user_name FROM supplier_payments p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.id DESC LIMIT 50')
        .all(),
    });
  });

  // The admin keeps the suppliers' records: name, phone, e-mail. A new name follows on the
  // deliveries and payments that carry the old one.
  const supplierFields = (b, current = {}) => ({
    name: str(b.name ?? current.name, 'Le nom', { max: 100 }),
    phone: str(b.phone ?? current.phone, 'Le téléphone', { required: false, max: 40 }),
    email: str(b.email ?? current.email, "L'e-mail", { required: false, max: 120 }),
  });
  const sameName = (name, id = 0) => db.prepare('SELECT 1 FROM suppliers WHERE name = ? COLLATE NOCASE AND id != ?').get(name, id);

  router.post('/suppliers', manager, requireAdmin, (req, res) => {
    const f = supplierFields(req.body || {});
    if (sameName(f.name)) fail(409, `Le fournisseur « ${f.name} » existe déjà.`, 'duplicate');
    const id = transaction(db, () => {
      const r = db.prepare('INSERT INTO suppliers (name, phone, email) VALUES (?, ?, ?)').run(f.name, f.phone, f.email);
      audit(db, req, { category: 'caisse', action: 'supplier_created', entity: 'suppliers', id: Number(r.lastInsertRowid), summary: `Fournisseur ajouté : ${f.name}`, after: f });
      return Number(r.lastInsertRowid);
    });
    res.status(201).json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id));
  });

  router.put('/suppliers/:id', manager, requireAdmin, (req, res) => {
    const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
    if (!s) fail(404, 'Fournisseur introuvable.');
    const f = supplierFields(req.body || {}, s);
    if (sameName(f.name, s.id)) fail(409, `Le fournisseur « ${f.name} » existe déjà.`, 'duplicate');
    transaction(db, () => {
      db.prepare('UPDATE suppliers SET name = ?, phone = ?, email = ? WHERE id = ?').run(f.name, f.phone, f.email, s.id);
      if (f.name !== s.name) {
        db.prepare('UPDATE deliveries SET supplier = ? WHERE lower(trim(supplier)) = lower(?)').run(f.name, s.name);
        db.prepare('UPDATE supplier_payments SET supplier = ? WHERE lower(trim(supplier)) = lower(?)').run(f.name, s.name);
      }
      const before = { name: s.name, phone: s.phone, email: s.email };
      audit(db, req, { category: 'caisse', action: 'supplier_updated', entity: 'suppliers', id: s.id, summary: f.name !== s.name ? `Fournisseur ${s.name} renommé ${f.name}` : `Fournisseur ${f.name} modifié`, before, after: f });
    });
    res.json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(s.id));
  });

  router.post('/suppliers/payments', manager, (req, res) => {
    const b = req.body || {};
    const supplier = str(b.supplier, 'Le fournisseur', { max: 100 });
    const amount = round(num(b.amount, 'Le montant', { min: 0.01, max: 1e9 }));
    const method = oneOf(b.method || 'espèces', 'Le mode de paiement', SUPPLIER_METHODS);
    const reference = str(b.reference, 'La référence', { required: false, max: 100 });
    // Same spelling as on the deliveries, so the debt and its payment meet.
    const known = db.prepare('SELECT name AS supplier FROM suppliers WHERE name = ? COLLATE NOCASE').get(supplier);
    const id = transaction(db, () => {
      const r = db
        .prepare('INSERT INTO supplier_payments (supplier, amount, method, reference, user_id) VALUES (?, ?, ?, ?, ?)')
        .run(known?.supplier || supplier, amount, method, reference, req.user.id);
      audit(db, req, { category: 'caisse', action: 'supplier_payment', entity: 'supplier_payments', id: Number(r.lastInsertRowid), summary: `Paiement au fournisseur ${known?.supplier || supplier} : ${money(amount)} (${method})` });
      return Number(r.lastInsertRowid);
    });
    res.status(201).json({ id, suppliers: supplierBalances(db) });
  });

  router.delete('/suppliers/payments/:id', manager, (req, res) => {
    const p = db.prepare('SELECT * FROM supplier_payments WHERE id = ?').get(req.params.id);
    if (!p) fail(404, 'Paiement introuvable.');
    transaction(db, () => {
      db.prepare('DELETE FROM supplier_payments WHERE id = ?').run(p.id);
      audit(db, req, { category: 'caisse', action: 'supplier_payment_removed', entity: 'supplier_payments', id: p.id, summary: `Paiement au fournisseur ${p.supplier} retiré : ${money(p.amount)}`, before: p });
    });
    res.json({ suppliers: supplierBalances(db) });
  });

  return router;
};
