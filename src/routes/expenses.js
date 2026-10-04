const express = require('express');
const { EXPENSE_CATEGORIES } = require('../db');
const { fail, num, str, oneOf, round, dateParam, csvCell, money } = require('../util');
const { audit } = require('../audit');
const { requireRole } = require('../auth');

const manager = requireRole('manager');
const METHODS = ['espèces', 'banque', 'mobile money', 'chèque'];

module.exports = function expenseRoutes(db) {
  const router = express.Router();

  const select = `
    SELECT e.*, u.name AS user_name, s.status AS shift_status
    FROM expenses e LEFT JOIN users u ON u.id = e.user_id LEFT JOIN shifts s ON s.id = e.shift_id`;

  function fields(b, current = {}) {
    const date = dateParam(b.expenseDate ?? current.expense_date, 'La date') || db.prepare("SELECT date('now', 'localtime') AS d").get().d;
    return {
      date,
      category: oneOf(b.category ?? current.category, 'La catégorie', EXPENSE_CATEGORIES),
      amount: round(num(b.amount ?? current.amount, 'Le montant', { min: 0.01, max: 1e8 })),
      description: str(b.description ?? current.description, 'La description', { max: 300 }),
      beneficiary: str(b.beneficiary ?? current.beneficiary, 'Le bénéficiaire', { required: false, max: 120 }),
      method: oneOf(b.method ?? current.method ?? 'espèces', 'Le mode de paiement', METHODS),
      reference: str(b.reference ?? current.reference, 'La référence', { required: false, max: 100 }),
    };
  }

  router.get('/expenses', manager, (req, res) => {
    const from = dateParam(req.query.from, 'La date de début');
    const to = dateParam(req.query.to, 'La date de fin');
    const rows = db
      .prepare(
        `${select}
         WHERE (? IS NULL OR e.expense_date >= ?) AND (? IS NULL OR e.expense_date <= ?)
         ORDER BY e.expense_date DESC, e.id DESC LIMIT 1000`,
      )
      .all(from, from, to, to);

    if (req.query.format === 'csv') {
      const cell = csvCell;
      const lines = ['Date;Catégorie;Description;Bénéficiaire;Mode;Référence;Poste;Saisi par;Montant (USD)'];
      for (const e of rows) {
        lines.push(
          [e.expense_date, e.category, e.description, e.beneficiary, e.method, e.reference, e.shift_id ? `n°${e.shift_id}` : '', e.user_name]
            .map(cell)
            .concat(String(e.amount).replace('.', ','))
            .join(';'),
        );
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="depenses_${from || 'debut'}_${to || 'fin'}.csv"`);
      return res.send(`﻿${lines.join('\r\n')}\r\n`);
    }

    const byCategory = {};
    for (const e of rows) byCategory[e.category] = round((byCategory[e.category] || 0) + e.amount);
    res.json({
      expenses: rows,
      total: round(rows.reduce((t, e) => t + e.amount, 0)),
      byCategory: Object.entries(byCategory)
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount),
    });
  });

  router.post('/expenses', manager, (req, res) => {
    const f = fields(req.body || {});
    const id = db
      .prepare(
        `INSERT INTO expenses (expense_date, category, amount, description, beneficiary, method, reference, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(f.date, f.category, f.amount, f.description, f.beneficiary, f.method, f.reference, req.user.id).lastInsertRowid;
    res.status(201).json(db.prepare(`${select} WHERE e.id = ?`).get(id));
  });

  // Expenses paid from a shift's cash are part of that shift's reconciliation:
  // they can only change while the shift is still open (from the shift screen).
  function getEditable(id) {
    const expense = db.prepare(`${select} WHERE e.id = ?`).get(id);
    if (!expense) fail(404, 'Dépense introuvable.');
    if (expense.shift_id) fail(409, `Cette dépense a été payée avec la caisse du poste n°${expense.shift_id} : elle fait partie de son rapprochement.`);
    return expense;
  }

  router.put('/expenses/:id', manager, (req, res) => {
    const current = getEditable(req.params.id);
    const f = fields(req.body || {}, current);
    db.prepare(
      `UPDATE expenses SET expense_date = ?, category = ?, amount = ?, description = ?, beneficiary = ?, method = ?, reference = ?
       WHERE id = ?`,
    ).run(f.date, f.category, f.amount, f.description, f.beneficiary, f.method, f.reference, current.id);
    res.json(db.prepare(`${select} WHERE e.id = ?`).get(current.id));
  });

  router.delete('/expenses/:id', manager, (req, res) => {
    const current = getEditable(req.params.id);
    db.prepare('DELETE FROM expenses WHERE id = ?').run(current.id);
    audit(db, req, {
      category: 'annulations',
      action: 'expense_deleted',
      entity: 'expenses',
      id: current.id,
      summary: `Dépense supprimée : ${current.category}, ${money(current.amount)} (${current.description})`,
      before: current,
    });
    res.status(204).end();
  });

  return router;
};
