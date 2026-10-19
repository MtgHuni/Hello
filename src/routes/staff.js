const express = require('express');
const { SALARY, getSettings } = require('../db');
const { fail, num, str, oneOf, dateParam, money, round, transaction } = require('../util');
const { requireRole, requireAdmin } = require('../auth');
const { audit } = require('../audit');
const { FUNCTIONS, monthLabel, currentMonth, salaryOf, sheetOf, payroll, addMonths, sourceOf } = require('../payroll');
const { payslipPdf } = require('../payslip');

const manager = requireRole('manager');
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const SOURCES = ['espèces', 'mobile money', 'poste'];
const SOURCE_LABEL = { espèces: 'espèces', 'mobile money': 'mobile money', poste: 'argent du poste' };

// Agents: the admin keeps the records and the salaries; the manager gives the advances and pays;
// the owner reads. An advance or a payment is an expense « Salaires » linked to the agent.
module.exports = function staffRoutes(db, { mailer }) {
  const router = express.Router();

  const monthParam = (value, label) => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !MONTH.test(value)) fail(400, `${label} doit être au format AAAA-MM.`);
    return value;
  };
  const notAfterNow = (month) => {
    if (month > currentMonth(db)) fail(400, 'Choisissez un mois passé ou le mois en cours.');
    return month;
  };

  const select = 'SELECT st.*, u.name AS user_name FROM staff st LEFT JOIN users u ON u.id = st.user_id';
  function staffRow(id) {
    const st = db.prepare(`${select} WHERE st.id = ?`).get(id);
    if (!st) fail(404, 'Agent introuvable.');
    return { ...st, salary: salaryOf(db, st, currentMonth(db)).base };
  }

  // A team login linked to one record at most.
  function userParam(value, staffId = null) {
    if (value === undefined) return undefined;
    if (value === null || value === '' || value === 0) return null;
    const user = db.prepare("SELECT id, name FROM users WHERE id = ? AND role IN ('admin', 'manager', 'attendant', 'owner')").get(Number(value));
    if (!user) fail(400, 'Compte inconnu.');
    const other = db.prepare('SELECT name FROM staff WHERE user_id = ? AND id IS NOT ?').get(user.id, staffId);
    if (other) fail(409, `Ce compte est déjà relié à la fiche de ${other.name}.`, 'duplicate');
    return user.id;
  }

  router.get('/staff', manager, (req, res) => {
    const month = notAfterNow(monthParam(req.query.month, 'Le mois') || currentMonth(db));
    const first = db.prepare('SELECT MIN(pay_from) AS m FROM staff').get().m;
    res.json({ ...payroll(db, month), firstMonth: first && first < currentMonth(db) ? first : currentMonth(db) });
  });

  router.get('/staff/:id', manager, (req, res) => {
    const staff = staffRow(req.params.id);
    const months = [];
    for (let m = currentMonth(db); m >= staff.pay_from; m = addMonths(m, -1)) months.push(sheetOf(db, staff, m));
    res.json({
      staff,
      salaries: db.prepare('SELECT from_month, amount FROM staff_salaries WHERE staff_id = ? ORDER BY from_month DESC').all(staff.id),
      months,
    });
  });

  router.get('/staff/:id/payslip.pdf', manager, (req, res) => {
    const staff = staffRow(req.params.id);
    const month = notAfterNow(monthParam(req.query.month, 'Le mois') || currentMonth(db));
    const pdf = payslipPdf({ staff, sheet: sheetOf(db, staff, month), stationName: getSettings(db).stationName });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="bulletin-${staff.id}-${month}.pdf"`);
    res.send(pdf);
  });

  router.post('/staff', manager, requireAdmin, (req, res) => {
    const b = req.body || {};
    const name = str(b.name, 'Le nom', { max: 100 });
    const phone = str(b.phone, 'Le téléphone', { required: false, max: 30 });
    const fn = oneOf(b.function, 'La fonction', FUNCTIONS);
    const hiredOn = dateParam(b.hiredOn, 'La date d’entrée');
    if (!hiredOn) fail(400, 'La date d’entrée est obligatoire.');
    const leftOn = dateParam(b.leftOn || undefined, 'La date de départ');
    if (leftOn && leftOn < hiredOn) fail(400, 'Le départ ne peut pas précéder l’entrée.');
    const payFrom = notAfterNow(monthParam(b.payFrom, 'Le mois de début de paie') || currentMonth(db));
    const salary = num(b.salary, 'Le salaire', { min: 0, max: 1e6 });
    const userId = userParam(b.userId) ?? null;
    const id = transaction(db, () => {
      const id = Number(
        db
          .prepare('INSERT INTO staff (name, phone, function, hired_on, left_on, pay_from, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(name, phone, fn, hiredOn, leftOn, payFrom, userId).lastInsertRowid,
      );
      db.prepare('INSERT INTO staff_salaries (staff_id, from_month, amount) VALUES (?, ?, ?)').run(id, payFrom, salary);
      audit(db, req, { category: 'agents', action: 'staff_added', entity: 'staff', id, summary: `Agent ajouté : ${name} (${fn}, ${money(salary)} par mois dès ${monthLabel(payFrom)})` });
      return id;
    });
    res.status(201).json(staffRow(id));
  });

  router.put('/staff/:id', manager, requireAdmin, (req, res) => {
    const before = staffRow(req.params.id);
    const b = req.body || {};
    const name = b.name === undefined ? before.name : str(b.name, 'Le nom', { max: 100 });
    const phone = b.phone === undefined ? before.phone : str(b.phone, 'Le téléphone', { required: false, max: 30 });
    const fn = b.function === undefined ? before.function : oneOf(b.function, 'La fonction', FUNCTIONS);
    const hiredOn = b.hiredOn === undefined ? before.hired_on : dateParam(b.hiredOn, 'La date d’entrée') || fail(400, 'La date d’entrée est obligatoire.');
    const leftOn = b.leftOn === undefined ? before.left_on : dateParam(b.leftOn || undefined, 'La date de départ');
    if (leftOn && leftOn < hiredOn) fail(400, 'Le départ ne peut pas précéder l’entrée.');
    const userId = b.userId === undefined ? before.user_id : userParam(b.userId, before.id);
    const salary = num(b.salary, 'Le salaire', { min: 0, max: 1e6, required: false });
    const salaryFrom = monthParam(b.salaryFrom, 'Le mois du nouveau salaire') || currentMonth(db);
    if (salary != null && salaryFrom < before.pay_from) fail(400, `Le salaire ne peut pas changer avant ${monthLabel(before.pay_from)}.`);
    transaction(db, () => {
      db.prepare('UPDATE staff SET name = ?, phone = ?, function = ?, hired_on = ?, left_on = ?, user_id = ? WHERE id = ?').run(name, phone, fn, hiredOn, leftOn, userId, before.id);
      const oldSalary = salary == null ? null : salaryOf(db, before, salaryFrom).base;
      if (salary != null) {
        db.prepare('INSERT INTO staff_salaries (staff_id, from_month, amount) VALUES (?, ?, ?) ON CONFLICT (staff_id, from_month) DO UPDATE SET amount = excluded.amount').run(before.id, salaryFrom, salary);
      }
      const changes = [
        name !== before.name ? `nom ${before.name} → ${name}` : null,
        fn !== before.function ? `${before.function} → ${fn}` : null,
        phone !== before.phone ? `téléphone ${before.phone || '—'} → ${phone || '—'}` : null,
        hiredOn !== before.hired_on ? `entrée le ${hiredOn}` : null,
        leftOn !== before.left_on ? (leftOn ? `parti le ${leftOn}` : 'départ retiré') : null,
        userId !== before.user_id ? (userId ? 'compte relié' : 'compte retiré') : null,
        salary != null && salary !== oldSalary ? `salaire ${money(oldSalary)} → ${money(salary)} dès ${monthLabel(salaryFrom)}` : null,
      ].filter(Boolean);
      if (changes.length) audit(db, req, { category: 'agents', action: 'staff_updated', entity: 'staff', id: before.id, summary: `Agent modifié : ${name} (${changes.join(', ')})`, before });
    });
    res.json(staffRow(before.id));
  });

  // An advance or a salary paid: an expense « Salaires » of the agent, counted for its month. From the
  // cash book (cash or mobile money), or from the open shift's money (an expense of that shift).
  function payOut(req, staff, { kind, month, date, amount, source }) {
    let shift = null;
    if (source === 'poste') {
      shift = db.prepare("SELECT * FROM shifts WHERE status = 'open' ORDER BY id DESC LIMIT 1").get();
      if (!shift) fail(409, 'Aucun poste ouvert.');
      if (shift.station_closed_at) fail(409, 'La station est fermée : faites l’ouverture pour continuer le poste.', 'station_closed');
    }
    const description = kind === 'avance' ? `Avance sur salaire : ${staff.name}` : `Salaire de ${monthLabel(month)} : ${staff.name}`;
    const id = transaction(db, () => {
      const id = Number(
        db
          .prepare(
            `INSERT INTO expenses (expense_date, category, amount, description, beneficiary, method, shift_id, user_id, staff_id, pay_month, pay_kind)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(date, SALARY, amount, description, staff.name, source === 'poste' ? 'espèces' : source, shift?.id ?? null, req.user.id, staff.id, month, kind).lastInsertRowid,
      );
      audit(db, req, {
        category: 'agents',
        action: kind === 'avance' ? 'staff_advance' : 'staff_payment',
        entity: 'expenses',
        id,
        summary: `${kind === 'avance' ? 'Avance' : `Salaire de ${monthLabel(month)}`} payé${kind === 'avance' ? 'e' : ''} à ${staff.name} : ${money(amount)} (${SOURCE_LABEL[source]}${shift ? ` n°${shift.id}` : ''})`,
      });
      return id;
    });
    const e = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    return { ...e, source: sourceOf(e) };
  }
  const today = () => db.prepare("SELECT date('now', 'localtime') AS d").get().d;
  const amountParam = (v) => round(num(v, 'Le montant', { min: 0.01, max: 1e6 }));

  router.post('/staff/:id/advances', manager, (req, res) => {
    const staff = staffRow(req.params.id);
    const b = req.body || {};
    const source = oneOf(b.source, 'D’où sort l’argent', SOURCES);
    // From the shift's money: today, like any expense of the shift.
    const date = source === 'poste' ? today() : dateParam(b.date, 'La date') || today();
    if (date > today()) fail(400, 'La date ne peut pas être après aujourd’hui.');
    const month = date.slice(0, 7);
    if (month < staff.pay_from) fail(400, `Rien n’est compté pour ${staff.name} avant ${monthLabel(staff.pay_from)}.`);
    res.status(201).json(payOut(req, staff, { kind: 'avance', month, date, amount: amountParam(b.amount), source }));
  });

  router.post('/staff/:id/payments', manager, (req, res) => {
    const staff = staffRow(req.params.id);
    const b = req.body || {};
    const month = notAfterNow(monthParam(b.month, 'Le mois') || fail(400, 'Le mois est obligatoire.'));
    if (month < staff.pay_from) fail(400, `Rien n’est compté pour ${staff.name} avant ${monthLabel(staff.pay_from)}.`);
    const source = oneOf(b.source, 'D’où sort l’argent', SOURCES);
    res.status(201).json(payOut(req, staff, { kind: 'salaire', month, date: today(), amount: amountParam(b.amount), source }));
  });

  // Cancelled from the agent's record: the expense goes (kept in the journal); paid with a shift's
  // money already closed, that shift is reconciled again.
  router.delete('/staff/:id/operations/:expenseId', manager, (req, res) => {
    const staff = staffRow(req.params.id);
    const e = db.prepare('SELECT e.*, s.status AS shift_status FROM expenses e LEFT JOIN shifts s ON s.id = e.shift_id WHERE e.id = ? AND e.staff_id = ?').get(req.params.expenseId, staff.id);
    if (!e) fail(404, 'Opération introuvable.');
    transaction(db, () => {
      db.prepare('DELETE FROM expenses WHERE id = ?').run(e.id);
      audit(db, req, {
        category: 'agents',
        action: 'staff_operation_deleted',
        entity: 'expenses',
        id: e.id,
        summary: `${e.pay_kind === 'avance' ? 'Avance' : 'Paiement de salaire'} annulé${e.pay_kind === 'avance' ? 'e' : ''} : ${staff.name}, ${money(e.amount)} (${monthLabel(e.pay_month)})`,
        before: e,
      });
      if (e.shift_status === 'closed') mailer.services.reconcile(e.shift_id);
    });
    res.status(204).end();
  });

  return router;
};
