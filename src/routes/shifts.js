const express = require('express');
const { EXPENSE_CATEGORIES, getSettings } = require('../db');
const { supplierOf } = require('../cashbook');

// Money accounted for at the closing, in dollars: cash handed over, change left with the
// attendants, mobile money entered during the shift.
const declared = (s) => round((s.cash || 0) + (s.change_left || 0) + (s.mobile_money || 0));
const { fail, num, str, oneOf, round, dateParam, transaction, money, clientRef } = require('../util');
const { requireRole } = require('../auth');
const { customerBalance } = require('./customers');
const { createSale, updateSale, settleInShift } = require('../sales');
const { refreshCustomer } = require('../loyalty');
const { shiftReportPdf } = require('../shiftReport');
const { applyScheduledPrices } = require('../prices');
const { audit } = require('../audit');
const { addShiftTransport } = require('../transport');
const { momoTotal, closingCutoff, attendantNamesSql, checkpointReports, currentPeriod, lastMeters, shiftMovements, movementsTotal } = require('../checkpoints');
const { aiEnabled } = require('../claude');

const staff = requireRole('manager', 'attendant');

module.exports = function shiftRoutes(db) {
  const router = express.Router();

  function shiftDetail(id) {
    const shift = db
      .prepare(
        `SELECT s.*, COALESCE(${attendantNamesSql}, u.name) AS attendant_name, m.name AS manager_comment_by_name
         FROM shifts s JOIN users u ON u.id = s.attendant_id LEFT JOIN users m ON m.id = s.manager_comment_by
         WHERE s.id = ?`,
      )
      .get(id);
    if (!shift) return null;
    shift.readings = db
      .prepare(
        `SELECT r.*, n.name AS nozzle_name, pu.name AS pump_name, p.name AS product_name
         FROM shift_readings r JOIN nozzles n ON n.id = r.nozzle_id JOIN pumps pu ON pu.id = n.pump_id
         JOIN products p ON p.id = r.product_id
         WHERE r.shift_id = ? ORDER BY pu.id, n.id`,
      )
      .all(id);
    shift.sales = db
      .prepare(
        `SELECT sa.*, c.name AS customer_name, c.type AS customer_type, p.name AS product_name, us.name AS user_name
         FROM sales sa JOIN customers c ON c.id = sa.customer_id JOIN products p ON p.id = sa.product_id LEFT JOIN users us ON us.id = sa.user_id
         WHERE sa.shift_id = ? ORDER BY sa.id`,
      )
      .all(id);
    shift.payments = db
      .prepare(
        `SELECT pa.*, c.name AS customer_name, us.name AS user_name FROM payments pa JOIN customers c ON c.id = pa.customer_id LEFT JOIN users us ON us.id = pa.user_id
         WHERE pa.shift_id = ? ORDER BY pa.id`,
      )
      .all(id);
    shift.expenses = db.prepare('SELECT e.*, us.name AS user_name FROM expenses e LEFT JOIN users us ON us.id = e.user_id WHERE e.shift_id = ? ORDER BY e.id').all(id);
    shift.momo = db
      .prepare(
        `SELECT ms.*, p.name AS product_name, us.name AS user_name FROM momo_sales ms JOIN products p ON p.id = ms.product_id LEFT JOIN users us ON us.id = ms.user_id
         WHERE ms.shift_id = ? ORDER BY ms.id`,
      )
      .all(id);
    shift.pump_tests = db
      .prepare(
        `SELECT t.*, n.name AS nozzle_name, pu.name AS pump_name, p.name AS product_name, us.name AS user_name, dm.name AS decided_by_name
         FROM pump_tests t JOIN nozzles n ON n.id = t.nozzle_id JOIN pumps pu ON pu.id = n.pump_id JOIN tanks tk ON tk.id = n.tank_id
         JOIN products p ON p.id = tk.product_id LEFT JOIN users us ON us.id = t.user_id LEFT JOIN users dm ON dm.id = t.decided_by
         WHERE t.shift_id = ? ORDER BY t.id`,
      )
      .all(id);
    for (const r of shift.readings) r.tested = testedLiters(id, r.nozzle_id);
    shift.tanks = db
      .prepare(
        `SELECT st.*, t.name, t.capacity, t.low_level, p.name AS product_name, p.id AS product_id
         FROM shift_tank_stock st JOIN tanks t ON t.id = st.tank_id JOIN products p ON p.id = t.product_id WHERE st.shift_id = ? ORDER BY t.id`,
      )
      .all(id);
    shift.momo_total = momoTotal(db, id);
    shift.movements = shiftMovements(db, id);
    shift.movements_amount = movementsTotal(shift.movements);
    shift.liters_by_product = litersByProduct([id]).get(Number(id)) || [];
    shift.pending_cancellations = pendingCancellations(id);
    shift.attendants = db
      .prepare('SELECT a.user_id, u.name, a.joined_at, a.left_at FROM shift_attendants a JOIN users u ON u.id = a.user_id WHERE a.shift_id = ? ORDER BY a.id')
      .all(id);
    shift.on_duty = [...new Set(shift.attendants.filter((a) => !a.left_at).map((a) => a.name))];
    shift.checkpoints = checkpointReports(db, shift, shift.readings);
    shift.closing_due = shift.status === 'open' && closingDue(shift);
    if (shift.status === 'open') {
      shift.credit_amount = round(shift.sales.filter((s) => s.kind === 'credit').reduce((t, s) => t + s.amount, 0));
      shift.combo_amount = round(shift.sales.filter((s) => s.kind === 'combo').reduce((t, s) => t + s.amount, 0));
      shift.payments_amount = round(shift.payments.reduce((t, p) => t + p.amount, 0));
      shift.expenses_amount = round(shift.expenses.reduce((t, e) => t + e.amount, 0));
    }
    return shift;
  }

  // Litres sold per product (gasoil, essence) of closed shifts: Map shift id → [{ product_id, name, liters }].
  function litersByProduct(ids) {
    const out = new Map();
    if (!ids.length) return out;
    const rows = db
      .prepare(
        `SELECT r.shift_id, r.product_id, p.name, ROUND(SUM(r.liters), 2) AS liters FROM shift_readings r JOIN products p ON p.id = r.product_id
         WHERE r.shift_id IN (${ids.map(() => '?').join(',')}) AND r.liters IS NOT NULL GROUP BY r.shift_id, r.product_id ORDER BY r.product_id`,
      )
      .all(...ids);
    for (const r of rows) {
      if (!out.has(r.shift_id)) out.set(r.shift_id, []);
      out.get(r.shift_id).push({ product_id: r.product_id, name: r.name, liters: r.liters });
    }
    return out;
  }

  // Litres of a nozzle's approved pump tests in a shift: drawn, then poured back into the tank.
  const testedLiters = (shiftId, nozzleId) =>
    round(db.prepare("SELECT COALESCE(SUM(liters), 0) AS v FROM pump_tests WHERE shift_id = ? AND nozzle_id = ? AND status = 'approved'").get(shiftId, nozzleId).v);

  // A closed shift after a test is approved or refused: each nozzle's litres sold are the meter's
  // minus the approved tests, the tank gets the difference back, then the money is reconciled.
  function applyTests(shiftId) {
    const readings = db.prepare('SELECT r.*, p.name AS label FROM shift_readings r JOIN products p ON p.id = r.product_id WHERE r.shift_id = ?').all(shiftId);
    const sales = db.prepare('SELECT nozzle_id, liters FROM sales WHERE shift_id = ?').all(shiftId);
    for (const r of readings) {
      if (r.end_meter == null) continue;
      const liters = netLiters(r, sales, testedLiters(shiftId, r.nozzle_id));
      db.prepare('UPDATE shift_readings SET liters = ?, amount = ? WHERE id = ?').run(liters, round(liters * r.unit_price), r.id);
      db.prepare('UPDATE tanks SET book_stock = ROUND(book_stock + ?, 2) WHERE id = ?').run(round((r.liters || 0) - liters), r.tank_id);
      db.prepare('UPDATE shift_tank_stock SET sold = ROUND(sold - ?, 2), stock_after = ROUND(stock_after + ?, 2) WHERE shift_id = ? AND tank_id = ?').run(
        round((r.liters || 0) - liters),
        round((r.liters || 0) - liters),
        shiftId,
        r.tank_id,
      );
    }
    db.prepare('UPDATE shifts SET total_liters = (SELECT ROUND(COALESCE(SUM(liters), 0), 2) FROM shift_readings WHERE shift_id = ?) WHERE id = ?').run(shiftId, shiftId);
    reconcile(shiftId);
  }

  // Litres sold on a nozzle: the meter's, less the fuel poured back after approved tests.
  function netLiters(r, sales, tested) {
    const meter = round(r.end_meter - r.start_meter);
    if (tested > meter + 0.001) fail(400, `${r.label} : les tests de pompe approuvés (${tested} L) dépassent les litres du compteur (${meter} L).`);
    const liters = round(meter - tested);
    const customerLiters = sales.filter((s) => s.nozzle_id === r.nozzle_id).reduce((t, s) => t + s.liters, 0);
    if (customerLiters > liters + 0.001) {
      fail(400, `${r.label} : les ventes clients (${round(customerLiters)} L) dépassent les litres vendus au compteur (${liters} L, tests de pompe déduits).`);
    }
    return liters;
  }

  const onDuty = (shiftId, userId) => !!db.prepare('SELECT 1 FROM shift_attendants WHERE shift_id = ? AND user_id = ? AND left_at IS NULL').get(shiftId, userId);
  const worked = (shift, userId) => shift.attendant_id === userId || !!db.prepare('SELECT 1 FROM shift_attendants WHERE shift_id = ? AND user_id = ?').get(shift.id, userId);
  const join = (shiftId, userId) => {
    if (!onDuty(shiftId, userId)) db.prepare('INSERT INTO shift_attendants (shift_id, user_id) VALUES (?, ?)').run(shiftId, userId);
  };

  // The daily closing is due once the closing time (15:30) has passed since the shift opened.
  const closingDue = (shift) => shift.opened_at < closingCutoff(db, getSettings(db).closingTime || '15:30');

  // open: to enter something, the attendant must be on the shift and the station open.
  // Otherwise (reading), having worked on it is enough.
  // late: the manager may also add a forgotten operation to a closed shift (see lateEntry).
  function getOwnShift(req, { open = true, late = false } = {}) {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
    if (!shift) fail(404, 'Poste introuvable.');
    if (late && shift.status === 'closed' && req.user.role === 'manager') return shift;
    if (open && shift.status !== 'open') fail(409, 'Ce poste est déjà clôturé.');
    if (req.user.role !== 'manager') {
      if (open && !onDuty(shift.id, req.user.id)) fail(403, 'Prenez d’abord le poste.', 'not_on_duty');
      if (!open && !worked(shift, req.user.id)) fail(403, 'Ce poste ne vous appartient pas.');
    }
    if (open && shift.station_closed_at) fail(409, 'La station est fermée : faites l’ouverture pour continuer le poste.', 'station_closed');
    return shift;
  }

  router.get('/shifts', staff, (req, res) => {
    const from = dateParam(req.query.from, 'La date de début');
    const to = dateParam(req.query.to, 'La date de fin');
    const status = ['open', 'closed'].includes(req.query.status) ? req.query.status : null;
    const attendant = req.user.role === 'manager' ? (Number(req.query.attendant) || null) : req.user.id;
    const shifts = db
        .prepare(
          `SELECT s.id, s.status, s.opened_at, s.closed_at, s.total_liters, s.total_amount, s.credit_amount,
             s.expected_amount, s.payments_amount, s.expenses_amount, s.cash, s.mobile_money, s.variance, s.counted_at, COALESCE(${attendantNamesSql}, u.name) AS attendant_name,
             s.manager_comment IS NOT NULL AS has_remark, (s.manager_comment IS NOT NULL AND s.comment_seen_at IS NULL) AS remark_unread,
             (SELECT COUNT(*) FROM sales sa WHERE sa.shift_id = s.id AND sa.over_limit = 1) AS over_limit_count
           FROM shifts s JOIN users u ON u.id = s.attendant_id
           WHERE (? IS NULL OR s.status = ?)
             AND (? IS NULL OR s.attendant_id = ? OR EXISTS (SELECT 1 FROM shift_attendants a WHERE a.shift_id = s.id AND a.user_id = ?))
             AND (? IS NULL OR date(s.opened_at, 'localtime') >= ?)
             AND (? IS NULL OR date(s.opened_at, 'localtime') <= ?)
           ORDER BY s.id DESC LIMIT 300`,
        )
        .all(status, status, attendant, attendant, attendant, from, from, to, to);
    const liters = litersByProduct(shifts.map((s) => s.id));
    res.json(shifts.map((s) => ({ ...s, liters_by_product: liters.get(s.id) || [] })));
  });

  const openShiftId = () => db.prepare("SELECT id FROM shifts WHERE status = 'open' ORDER BY id LIMIT 1").get()?.id;

  router.get('/shifts/open', staff, (req, res) => {
    const id = openShiftId();
    if (!id) return res.json(null);
    const s = shiftDetail(id);
    res.json({ id: s.id, opened_at: s.opened_at, attendant_name: s.attendant_name, on_duty: s.on_duty, station_closed_at: s.station_closed_at, closing_due: s.closing_due });
  });

  // The attendant's screen: the station's shift, whether they are on it, the last mini report.
  router.get('/shifts/state', staff, (req, res) => {
    const id = openShiftId();
    if (!id) return res.json({ shift: null });
    const shift = shiftDetail(id);
    // The manager may work the pump too: they never need to take the shift.
    res.json({ shift, onDuty: req.user.role === 'manager' || onDuty(id, req.user.id), lastReport: shift.checkpoints.at(-1) || null });
  });

  router.get('/shifts/current', staff, (req, res) => {
    const id = openShiftId();
    res.json(id && (req.user.role === 'manager' || onDuty(id, req.user.id)) ? shiftDetail(id) : null);
  });

  // The manager's remarks the attendant has not read yet (shown on their home screen).
  router.get('/shifts/remarks/unread', staff, (req, res) => {
    res.json(
      db
        .prepare(
          `SELECT s.id, s.closed_at, s.manager_comment, s.manager_comment_at, m.name AS manager_comment_by_name
           FROM shifts s LEFT JOIN users m ON m.id = s.manager_comment_by
           WHERE (s.attendant_id = ? OR EXISTS (SELECT 1 FROM shift_attendants a WHERE a.shift_id = s.id AND a.user_id = ?))
             AND s.manager_comment IS NOT NULL AND s.comment_seen_at IS NULL ORDER BY s.id DESC`,
        )
        .all(req.user.id, req.user.id),
    );
  });

  router.get('/shifts/:id', staff, (req, res) => {
    const shift = getOwnShift(req, { open: false });
    // The attendant opening their shift reads the manager's remark.
    if (req.user.role !== 'manager' && shift.manager_comment && !shift.comment_seen_at) markRemarkRead(shift.id);
    res.json(shiftDetail(req.params.id));
  });

  const markRemarkRead = (id) => db.prepare("UPDATE shifts SET comment_seen_at = datetime('now') WHERE id = ?").run(id);

  router.post('/shifts/:id/remark/seen', staff, (req, res) => {
    const shift = getOwnShift(req, { open: false });
    if (req.user.role !== 'manager' && shift.manager_comment) markRemarkRead(shift.id);
    res.json({ ok: true });
  });

  // Manager: a remark for the attendant on a closed shift. Empty removes it.
  router.post('/shifts/:id/remark', requireRole('manager'), (req, res) => {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
    if (!shift) fail(404, 'Poste introuvable.');
    if (shift.status === 'open') fail(409, 'Le poste est encore ouvert : la remarque se fait après la clôture.');
    const comment = str(req.body?.comment, 'La remarque', { required: false, max: 1000 });
    transaction(db, () => {
      setRemark(shift.id, comment, req.user.id);
      audit(db, req, {
        category: 'postes',
        action: 'shift_remark',
        entity: 'shifts',
        id: shift.id,
        summary: comment ? `Remarque au pompiste sur le poste n°${shift.id} : ${comment}` : `Remarque retirée du poste n°${shift.id}`,
        before: shift.manager_comment ? { remark: shift.manager_comment } : null,
      });
    });
    res.json(shiftDetail(shift.id));
  });

  function setRemark(id, comment, userId) {
    db.prepare(
      `UPDATE shifts SET manager_comment = ?, manager_comment_at = CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END,
         manager_comment_by = ?, comment_seen_at = NULL WHERE id = ?`,
    ).run(comment, comment, comment ? userId : null, id);
  }

  // End-of-shift report (PDF): cash, sales from the indexes, credits, expenses, payments.
  // Also mailed to the team once the money is counted (src/mailJobs.js).
  function shiftPdf(id) {
    const settings = getSettings(db);
    const detail = shiftDetail(id);
    return {
      detail,
      pdf: shiftReportPdf(detail, { stationName: settings.stationName, combosEnabled: settings.combosEnabled, cashTolerance: settings.cashTolerance }),
    };
  }
  router.shiftPdf = shiftPdf;
  router.reconcile = reconcile;

  router.get('/shifts/:id/report.pdf', staff, (req, res) => {
    const own = getOwnShift(req, { open: false });
    if (own.status === 'open') fail(409, 'Le rapport est disponible une fois le poste clôturé.');
    const { pdf } = shiftPdf(own.id);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="rapport-poste-${own.id}.pdf"`);
    res.send(pdf);
  });

  // A shift snapshots each nozzle's meter and the current price (a price change applies to the
  // next shift). It covers every active pump; responsibleId is who it is recorded under.
  function openShift(responsibleId) {
    applyScheduledPrices(db); // a price due by now is frozen into this shift
    const nozzles = db
      .prepare(
        `SELECT n.id, n.meter, n.tank_id, t.product_id, p.price, COALESCE(p.subscriber_price, p.price) AS subscriber_price
         FROM nozzles n JOIN pumps pu ON pu.id = n.pump_id AND pu.active = 1 JOIN tanks t ON t.id = n.tank_id JOIN products p ON p.id = t.product_id
         WHERE n.active = 1 ORDER BY pu.id, n.id`,
      )
      .all();
    if (!nozzles.length) fail(400, 'Aucune pompe active : demandez au gérant de les configurer.');
    const shiftId = Number(db.prepare("INSERT INTO shifts (attendant_id, status) VALUES (?, 'open')").run(responsibleId).lastInsertRowid);
    const insert = db.prepare(
      'INSERT INTO shift_readings (shift_id, nozzle_id, product_id, tank_id, unit_price, subscriber_price, start_meter) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const n of nozzles) insert.run(shiftId, n.id, n.product_id, n.tank_id, n.price, n.subscriber_price, n.meter);
    addShiftTransport(db, shiftId);
    return shiftId;
  }

  // The very first shift (afterwards, each closing opens the next one).
  router.post('/shifts', staff, (req, res) => {
    const id = transaction(db, () => {
      const open = openShiftId();
      if (open) fail(409, onDuty(open, req.user.id) ? 'Vous êtes déjà sur le poste.' : 'Le poste est déjà ouvert : prenez-le pour continuer.', 'shift_open');
      const shiftId = openShift(req.user.id);
      if (req.user.role === 'attendant') join(shiftId, req.user.id);
      return shiftId;
    });
    res.status(201).json(shiftDetail(id));
  });

  // An attendant takes the shift (start of their day, back from a break, second attendant).
  router.post('/shifts/:id/join', staff, (req, res) => {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
    if (!shift || shift.status !== 'open') fail(409, 'Ce poste n’est plus ouvert.');
    if (shift.station_closed_at) fail(409, 'La station est fermée : faites d’abord l’ouverture.', 'station_closed');
    if (req.user.role === 'attendant') {
      join(shift.id, req.user.id);
      // Taking the shift shows its last report: the reliefs before are seen.
      db.prepare('INSERT OR IGNORE INTO checkpoint_seen (checkpoint_id, user_id) SELECT id, ? FROM shift_checkpoints WHERE shift_id = ?').run(req.user.id, shift.id);
    }
    res.json(shiftDetail(shift.id));
  });

  // A relief made by another attendant: every attendant gets its mini report on their phone, once.
  router.get('/shifts/reports/unseen', staff, (req, res) => {
    const id = openShiftId();
    if (!id || req.user.role !== 'attendant') return res.json([]);
    const ids = db
      .prepare(
        `SELECT c.id FROM shift_checkpoints c WHERE c.shift_id = ? AND c.kind = 'releve' AND COALESCE(c.user_id, 0) != ?
           AND NOT EXISTS (SELECT 1 FROM checkpoint_seen s WHERE s.checkpoint_id = c.id AND s.user_id = ?) ORDER BY c.id`,
      )
      .all(id, req.user.id, req.user.id)
      .map((r) => r.id);
    if (!ids.length) return res.json([]);
    res.json(shiftDetail(id).checkpoints.filter((c) => ids.includes(c.id)));
  });

  router.post('/shifts/reports/:checkpointId/seen', staff, (req, res) => {
    const cp = db.prepare('SELECT id FROM shift_checkpoints WHERE id = ?').get(req.params.checkpointId);
    if (!cp) fail(404, 'Rapport introuvable.');
    db.prepare('INSERT OR IGNORE INTO checkpoint_seen (checkpoint_id, user_id) VALUES (?, ?)').run(cp.id, req.user.id);
    res.json({ ok: true });
  });

  // Indexes given at a checkpoint: every nozzle, never below the last index taken.
  function checkpointMeters(shift, list) {
    const given = new Map((Array.isArray(list) ? list : []).map((r) => [Number(r.nozzleId), r.meter]));
    const last = lastMeters(db, shift.id);
    const readings = db.prepare('SELECT r.*, p.name AS label FROM shift_readings r JOIN products p ON p.id = r.product_id WHERE r.shift_id = ?').all(shift.id);
    const meters = new Map();
    for (const r of readings) {
      const floor = last?.get(r.nozzle_id) ?? r.start_meter;
      const meter = num(given.get(r.nozzle_id), `L’index (${r.label})`, { max: 1e12 });
      if (meter < floor - 0.001) fail(400, `L’index (${r.label}) ne peut pas être inférieur au dernier relevé (${floor}).`);
      meters.set(r.nozzle_id, round(meter));
    }
    return meters;
  }

  // With Claude reading the meters, an attendant's index comes from a photo of each meter (kept a week).
  function needPhotos(shift, readings) {
    const sent = new Map((Array.isArray(readings) ? readings : []).map((r) => [Number(r?.nozzleId), Number(r?.photoId)]));
    const photo = db.prepare('SELECT 1 FROM meter_photos WHERE id = ? AND nozzle_id = ? AND shift_id = ?');
    for (const r of db.prepare('SELECT nozzle_id FROM shift_readings WHERE shift_id = ?').all(shift.id)) {
      if (!photo.get(sent.get(r.nozzle_id) || 0, r.nozzle_id, shift.id)) fail(422, 'Prenez la photo de chaque compteur.', 'photo_required');
    }
  }

  // The meter photos sent with a relief or a closing (`readings[].photoId`), linked to it.
  function linkPhotos(shiftId, readings, column, value) {
    const link = db.prepare(`UPDATE meter_photos SET ${column} = ? WHERE id = ? AND nozzle_id = ? AND shift_id = ?`);
    for (const r of Array.isArray(readings) ? readings : []) if (r?.photoId) link.run(value, Number(r.photoId), Number(r.nozzleId), shiftId);
  }

  const detailReadings = (shiftId) =>
    db
      .prepare(
        `SELECT r.*, n.name AS nozzle_name, pu.name AS pump_name, p.name AS product_name,
           (SELECT MAX(m.id) FROM meter_photos m WHERE m.closing_shift_id = r.shift_id AND m.nozzle_id = r.nozzle_id) AS end_photo_id,
           (SELECT m.read_index FROM meter_photos m WHERE m.closing_shift_id = r.shift_id AND m.nozzle_id = r.nozzle_id ORDER BY m.id DESC LIMIT 1) AS end_photo_read
         FROM shift_readings r JOIN nozzles n ON n.id = r.nozzle_id JOIN pumps pu ON pu.id = n.pump_id JOIN products p ON p.id = r.product_id
         WHERE r.shift_id = ? ORDER BY pu.id, n.id`,
      )
      .all(shiftId);

  // What the period would look like with these indexes (shown before the attendant confirms).
  // Saves nothing: the owner (actionnaire) may check the meters too.
  router.post('/shifts/:id/checkpoints/preview', requireRole('manager', 'attendant', 'owner'), (req, res) => {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
    if (!shift || shift.status !== 'open') fail(409, 'Ce poste n’est plus ouvert.');
    const meters = checkpointMeters(shift, req.body?.readings);
    res.json(currentPeriod(db, shift, detailReadings(shift.id), meters, { kind: req.body?.kind, cash: Number(req.body?.cash) || 0, userName: req.user.name }));
  });

  // Relief (the attendant hands over), evening closing (19:00), morning opening (6:30).
  router.post('/shifts/:id/checkpoints', staff, (req, res) => {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
    if (!shift || shift.status !== 'open') fail(409, 'Ce poste n’est plus ouvert.');
    const kind = oneOf(req.body?.kind, 'Le type de relevé', ['releve', 'fermeture', 'ouverture']);
    if (kind === 'ouverture' && !shift.station_closed_at) fail(409, 'La station est déjà ouverte.');
    if (kind !== 'ouverture') {
      if (shift.station_closed_at) fail(409, 'La station est fermée : faites l’ouverture pour continuer le poste.', 'station_closed');
      if (req.user.role !== 'manager' && !onDuty(shift.id, req.user.id)) fail(403, 'Prenez d’abord le poste.', 'not_on_duty');
      if (req.user.role === 'attendant' && aiEnabled()) needPhotos(shift, req.body?.readings);
    }
    const cash = round(num(req.body?.cash ?? 0, 'L’argent remis', { max: 1e8 }));
    const note = str(req.body?.note, 'La remarque', { required: false, max: 300 });
    const id = transaction(db, () => {
      const meters = checkpointMeters(shift, req.body?.readings);
      const cp = Number(
        db.prepare('INSERT INTO shift_checkpoints (shift_id, kind, user_id, cash, note) VALUES (?, ?, ?, ?, ?)').run(shift.id, kind, req.user.id, cash, note).lastInsertRowid,
      );
      const insert = db.prepare('INSERT INTO checkpoint_readings (checkpoint_id, nozzle_id, meter) VALUES (?, ?, ?)');
      for (const [nozzleId, meter] of meters) insert.run(cp, nozzleId, meter);
      linkPhotos(shift.id, req.body?.readings, 'checkpoint_id', cp);
      if (kind === 'releve') db.prepare("UPDATE shift_attendants SET left_at = datetime('now') WHERE shift_id = ? AND user_id = ? AND left_at IS NULL").run(shift.id, req.user.id);
      if (kind === 'fermeture') {
        db.prepare("UPDATE shift_attendants SET left_at = datetime('now') WHERE shift_id = ? AND left_at IS NULL").run(shift.id);
        db.prepare("UPDATE shifts SET station_closed_at = datetime('now') WHERE id = ?").run(shift.id);
      }
      if (kind === 'ouverture') {
        db.prepare('UPDATE shifts SET station_closed_at = NULL WHERE id = ?').run(shift.id);
        if (req.user.role === 'attendant') join(shift.id, req.user.id);
      }
      return cp;
    });
    const detail = shiftDetail(shift.id);
    res.status(201).json({ report: detail.checkpoints.find((c) => c.id === id), shift: detail });
  });

  // Credit entered by the attendant (or fuel exchanged for combos). Paid sales are never
  // entered: the meter indexes count them at closing.
  // A forgotten operation added after the closing: the shift's amounts and variance are recomputed.
  function lateEntry(req, shift, table, item) {
    if (shift.status !== 'closed') return;
    reconcile(shift.id);
    audit(db, req, { category: 'postes', action: 'late_entry', entity: table, id: Number(item.id), summary: `Oubli ajouté au poste n°${shift.id} après la clôture : ${describe(table, item)}` });
  }

  router.post('/shifts/:id/sales', staff, (req, res) => {
    const shift = getOwnShift(req, { late: true });
    const payment = req.body?.payment ?? 'credit';
    if (payment === 'paid') fail(400, 'Les ventes payées ne se saisissent pas : les index les comptent.', 'paid');
    const sale = createSale(db, shift, { ...(req.body || {}), payment, source: 'attendant', userId: req.user.id });
    lateEntry(req, shift, 'sales', sale);
    res.status(201).json({ ...sale, balance: customerBalance(db, sale.customer_id) }); // for the receipt
  });

  // A customer settling their account at the pump: the money goes into the shift's cash.
  router.post('/shifts/:id/payments', staff, (req, res) => {
    const shift = getOwnShift(req, { late: true });
    const ref = clientRef(req.body?.clientRef);
    const done = ref && db.prepare('SELECT * FROM payments WHERE client_ref = ?').get(ref);
    if (done) return res.status(201).json({ id: done.id, balance: customerBalance(db, done.customer_id) });
    const settledBefore = ref && db.prepare('SELECT customer_id FROM sales WHERE settled_ref = ?').get(ref);
    if (settledBefore) return res.status(201).json({ id: null, balance: customerBalance(db, settledBefore.customer_id) });
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(req.body?.customerId));
    if (!customer) fail(400, 'Choisissez un client.');
    const amount = round(num(req.body?.amount, 'Le montant', { min: 0.01, max: 1e8 }));
    const method = oneOf(req.body?.method ?? 'espèces', 'Le mode de règlement', ['espèces', 'mobile money']);
    const reference = str(req.body?.reference, 'La référence', { required: false, max: 100 });
    // Debt from before the app (the notebook), declared with the payment; the manager checks the record.
    const oldDebt = req.body?.oldDebt ? round(num(req.body.oldDebt, 'L’ancienne dette', { min: 0.01, max: 1e8 })) : 0;
    let settled = 0;
    const id = transaction(db, () => {
      if (oldDebt) {
        db.prepare('INSERT INTO old_debts (customer_id, amount, shift_id, user_id) VALUES (?, ?, ?, ?)').run(customer.id, oldDebt, shift.id, req.user.id);
        db.prepare('UPDATE customers SET needs_review = 1 WHERE id = ?').run(customer.id);
        audit(db, req, { category: 'clients', action: 'old_debt_declared', entity: 'customers', id: customer.id, summary: `Ancienne dette de ${customer.name} déclarée à la pompe : ${money(oldDebt)} (poste n°${shift.id})` });
      }
      // A credit of this same shift paid back: a paid sale, not a credit plus a payment.
      const s = settleInShift(db, shift, customer.id, amount, { method, ref, userId: req.user.id });
      settled = s.settled;
      if (settled) {
        audit(db, req, { category: 'postes', action: 'credit_paid_in_shift', entity: 'customers', id: customer.id, summary: `Crédit de ${customer.name} payé pendant le poste n°${shift.id} : ${money(settled)} ${method}, devenu une vente payée` });
      }
      let paymentId = null;
      if (s.rest >= 0.01) {
        paymentId = db
          .prepare('INSERT INTO payments (customer_id, amount, method, reference, user_id, shift_id, client_ref) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(customer.id, s.rest, method, reference, req.user.id, shift.id, ref).lastInsertRowid;
        lateEntry(req, shift, 'payments', { id: paymentId, amount: s.rest });
      }
      refreshCustomer(db, customer.id); // paid-off credit sales now earn their combos
      return paymentId;
    });
    res.status(201).json({ id: id == null ? null : Number(id), settled, balance: customerBalance(db, customer.id) });
  });

  // Fuel paid by mobile money: only the product and the litres, at the shift's price. The shift's
  // mobile money is the total of these (plus payments by mobile money): nothing to type at closing.
  router.post('/shifts/:id/momo', staff, (req, res) => {
    const shift = getOwnShift(req, { late: true });
    const ref = clientRef(req.body?.clientRef);
    const done = ref && db.prepare('SELECT * FROM momo_sales WHERE client_ref = ?').get(ref);
    if (done) return res.status(201).json(done);
    const reading = db.prepare('SELECT unit_price FROM shift_readings WHERE shift_id = ? AND product_id = ? LIMIT 1').get(shift.id, Number(req.body?.productId));
    if (!reading) fail(400, 'Choisissez le carburant.');
    const liters = round(num(req.body?.liters, 'Le nombre de litres', { min: 0.01, max: 1e5 }));
    const id = db
      .prepare('INSERT INTO momo_sales (shift_id, product_id, liters, unit_price, amount, user_id, client_ref) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(shift.id, Number(req.body.productId), liters, reading.unit_price, round(liters * reading.unit_price), req.user.id, ref).lastInsertRowid;
    const momo = db.prepare('SELECT * FROM momo_sales WHERE id = ?').get(id);
    lateEntry(req, shift, 'momo_sales', momo);
    res.status(201).json(momo);
  });

  // Pump test: fuel drawn at the pump and poured back into the tank. Entered by the attendant, it
  // waits for the manager's approval; entered by the manager, it is approved at once.
  router.post('/shifts/:id/tests', staff, (req, res) => {
    const shift = getOwnShift(req, { late: true });
    const ref = clientRef(req.body?.clientRef);
    const done = ref && db.prepare('SELECT * FROM pump_tests WHERE client_ref = ?').get(ref);
    if (done) return res.status(201).json(done);
    const reading = db.prepare('SELECT nozzle_id FROM shift_readings WHERE shift_id = ? AND nozzle_id = ?').get(shift.id, Number(req.body?.nozzleId));
    if (!reading) fail(400, 'Choisissez le produit.');
    const liters = round(num(req.body?.liters, 'Le nombre de litres', { min: 0.01, max: 500 }));
    const note = str(req.body?.note, 'La remarque', { required: false, max: 200 });
    const manager = req.user.role === 'manager';
    const id = transaction(db, () => {
      const r = db
        .prepare(
          `INSERT INTO pump_tests (shift_id, nozzle_id, liters, note, status, user_id, decided_by, decided_at, client_ref)
           VALUES (?, ?, ?, ?, ?, ?, ?, ${manager ? "datetime('now')" : 'NULL'}, ?)`,
        )
        .run(shift.id, reading.nozzle_id, liters, note, manager ? 'approved' : 'pending', req.user.id, manager ? req.user.id : null, ref);
      audit(db, req, { category: 'postes', action: 'pump_test', entity: 'pump_tests', id: Number(r.lastInsertRowid), summary: `Test de pompe : ${liters} L remis en cuve, poste n°${shift.id}${manager ? ' (saisi et approuvé par le gérant)' : ''}${shift.status === 'closed' ? ', ajouté après la clôture' : ''}` });
      if (shift.status === 'closed') applyTests(shift.id);
      return r.lastInsertRowid;
    });
    res.status(201).json(db.prepare('SELECT * FROM pump_tests WHERE id = ?').get(id));
  });

  // The manager approves or refuses a test, also after the closing (the shift is then recomputed).
  router.post('/shifts/:id/tests/:testId/decide', requireRole('manager'), (req, res) => {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
    if (!shift) fail(404, 'Poste introuvable.');
    const test = db.prepare('SELECT * FROM pump_tests WHERE id = ? AND shift_id = ?').get(req.params.testId, shift.id);
    if (!test) fail(404, 'Test de pompe introuvable.');
    if (test.status !== 'pending') fail(409, test.status === 'approved' ? 'Ce test de pompe est déjà confirmé.' : 'Ce test de pompe est déjà annulé.');
    const status = req.body?.approve === true ? 'approved' : req.body?.approve === false ? 'rejected' : fail(400, 'Confirmez ou annulez le test.');
    transaction(db, () => {
      db.prepare("UPDATE pump_tests SET status = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?").run(status, req.user.id, test.id);
      if (shift.status === 'closed') applyTests(shift.id);
      audit(db, req, {
        category: 'postes',
        action: status === 'approved' ? 'pump_test_approved' : 'pump_test_rejected',
        entity: 'pump_tests',
        id: test.id,
        summary: `Test de pompe de ${test.liters} L ${status === 'approved' ? 'confirmé : remis en cuve, pas vendu' : 'annulé : compté comme vendu'}, poste n°${shift.id}`,
        before: { status: test.status },
        after: { status },
      });
    });
    res.json(shiftDetail(shift.id));
  });

  // Small expense paid from the shift's cash (deducted from the amount to hand over).
  router.post('/shifts/:id/expenses', staff, (req, res) => {
    const shift = getOwnShift(req, { late: true });
    const ref = clientRef(req.body?.clientRef);
    const done = ref && db.prepare('SELECT * FROM expenses WHERE client_ref = ?').get(ref);
    if (done) return res.status(201).json(done);
    const category = oneOf(req.body?.category, 'La catégorie', EXPENSE_CATEGORIES);
    const amount = round(num(req.body?.amount, 'Le montant', { min: 0.01, max: 1e7 }));
    const description = str(req.body?.description, 'La description', { max: 300 });
    const beneficiary = supplierOf(db, category, str(req.body?.beneficiary, 'Le bénéficiaire', { required: false, max: 120 }));
    const id = db
      .prepare(
        `INSERT INTO expenses (expense_date, category, amount, description, beneficiary, method, shift_id, user_id, client_ref)
         VALUES (date('now', 'localtime'), ?, ?, ?, ?, 'espèces', ?, ?, ?)`,
      )
      .run(category, amount, description, beneficiary, shift.id, req.user.id, ref).lastInsertRowid;
    const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    lateEntry(req, shift, 'expenses', expense);
    res.status(201).json(expense);
  });

  // ---- Cancelling an operation: the attendant asks, the manager decides ----

  const CANCELLABLE = {
    sales: { table: 'sales', missing: 'Vente introuvable.' },
    payments: { table: 'payments', missing: 'Règlement introuvable.' },
    expenses: { table: 'expenses', missing: 'Dépense introuvable.' },
    momo: { table: 'momo_sales', missing: 'Paiement mobile money introuvable.' },
  };
  // How an operation reads in the journal.
  const describe = (table, item) =>
    table === 'sales'
      ? `${item.kind === 'credit' ? 'crédit' : item.kind === 'combo' ? 'échange de combos' : 'vente'} de ${money(item.amount)}`
      : table === 'payments'
        ? `règlement de ${money(item.amount)}`
        : table === 'momo_sales'
          ? `paiement mobile money de ${money(item.amount)} (${item.liters} L)`
        : `dépense de ${money(item.amount)} (${item.category})`;

  function cancellable(req, shift) {
    if (!Object.hasOwn(CANCELLABLE, req.params.kind)) fail(404, 'Opération introuvable.');
    const k = CANCELLABLE[req.params.kind];
    const item = db.prepare(`SELECT * FROM ${k.table} WHERE id = ? AND shift_id = ?`).get(req.params.itemId, shift.id);
    if (!item) fail(404, k.missing);
    return { table: k.table, item };
  }

  // The operation stays counted until the manager accepts its cancellation.
  router.post('/shifts/:id/:kind/:itemId/cancel', staff, (req, res) => {
    const shift = getOwnShift(req);
    const { table, item } = cancellable(req, shift);
    if (item.cancel_requested_at) fail(409, 'L’annulation a déjà été demandée au gérant.');
    const reason = str(req.body?.reason, 'La raison', { required: false, max: 200 });
    db.prepare(`UPDATE ${table} SET cancel_requested_at = datetime('now'), cancel_requested_by = ?, cancel_reason = ? WHERE id = ?`).run(
      req.user.id,
      reason,
      item.id,
    );
    res.status(202).json({ pending: true });
  });

  // Manager: cancels the operation (whether or not it was asked), also after the shift is closed.
  router.delete('/shifts/:id/:kind/:itemId', requireRole('manager'), (req, res) => {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
    if (!shift) fail(404, 'Poste introuvable.');
    const { table, item } = cancellable(req, shift);
    transaction(db, () => {
      // A sale confirmed from a customer's request: the request is cancelled with it.
      if (table === 'sales') db.prepare("UPDATE purchase_requests SET sale_id = NULL, status = 'cancelled' WHERE sale_id = ?").run(item.id);
      // A delivery paid with this expense: its payment is to be given again.
      if (table === 'expenses') db.prepare('UPDATE deliveries SET expense_id = NULL, payment = NULL, pay_method = NULL WHERE expense_id = ?').run(item.id);
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(item.id);
      audit(db, req, {
        category: 'annulations',
        action: 'cancel_accepted',
        entity: table,
        id: item.id,
        summary: `Annulation acceptée : ${describe(table, item)}, poste n°${shift.id}${item.cancel_requested_at ? ' (demandée par le pompiste)' : ''}`,
        before: item,
        reason: item.cancel_reason,
      });
      if (item.customer_id) refreshCustomer(db, item.customer_id);
      if (shift.status === 'closed') reconcile(shift.id);
    });
    res.status(204).end();
  });

  // Manager: corrects an operation entered wrongly (open or closed shift). The closed shift is
  // reconciled again; the journal keeps the operation before and after.
  router.put('/shifts/:id/:kind/:itemId', requireRole('manager'), (req, res) => {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
    if (!shift) fail(404, 'Poste introuvable.');
    const { table, item } = cancellable(req, shift);
    const b = req.body || {};
    const after = transaction(db, () => {
      if (table === 'sales') updateSale(db, item, b);
      else if (table === 'payments') {
        const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(b.customerId ?? item.customer_id));
        if (!customer) fail(400, 'Client inconnu.');
        const amount = round(num(b.amount ?? item.amount, 'Le montant', { min: 0.01, max: 1e8 }));
        const method = oneOf(b.method ?? item.method, 'Le mode de règlement', ['espèces', 'mobile money']);
        const reference = b.reference === undefined ? item.reference : str(b.reference, 'La référence', { required: false, max: 100 });
        db.prepare('UPDATE payments SET customer_id = ?, amount = ?, method = ?, reference = ? WHERE id = ?').run(customer.id, amount, method, reference, item.id);
        refreshCustomer(db, customer.id);
        if (customer.id !== item.customer_id) refreshCustomer(db, item.customer_id);
      } else if (table === 'expenses') {
        const category = oneOf(b.category ?? item.category, 'La catégorie', EXPENSE_CATEGORIES);
        const amount = round(num(b.amount ?? item.amount, 'Le montant', { min: 0.01, max: 1e7 }));
        const description = str(b.description ?? item.description, 'La description', { max: 300 });
        const beneficiary = supplierOf(db, category, b.beneficiary === undefined ? item.beneficiary : str(b.beneficiary, 'Le bénéficiaire', { required: false, max: 120 }));
        db.prepare('UPDATE expenses SET category = ?, amount = ?, description = ?, beneficiary = ? WHERE id = ?').run(category, amount, description, beneficiary, item.id);
      } else {
        const reading = db.prepare('SELECT unit_price, product_id FROM shift_readings WHERE shift_id = ? AND product_id = ? LIMIT 1').get(shift.id, Number(b.productId ?? item.product_id));
        if (!reading) fail(400, 'Choisissez le carburant.');
        const liters = round(num(b.liters ?? item.liters, 'Le nombre de litres', { min: 0.01, max: 1e5 }));
        db.prepare('UPDATE momo_sales SET product_id = ?, liters = ?, unit_price = ?, amount = ? WHERE id = ?').run(reading.product_id, liters, reading.unit_price, round(liters * reading.unit_price), item.id);
      }
      if (shift.status === 'closed') reconcile(shift.id);
      const changed = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(item.id);
      audit(db, req, {
        category: 'postes',
        action: 'operation_corrected',
        entity: table,
        id: item.id,
        summary: `Opération corrigée par le gérant, poste n°${shift.id} : ${describe(table, item)} → ${describe(table, changed)}`,
        before: item,
        after: changed,
      });
      return changed;
    });
    res.json(after);
  });

  // Manager: refuses the cancellation, the operation stays.
  router.post('/shifts/:id/:kind/:itemId/keep', requireRole('manager'), (req, res) => {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
    if (!shift) fail(404, 'Poste introuvable.');
    const { table, item } = cancellable(req, shift);
    db.prepare(`UPDATE ${table} SET cancel_requested_at = NULL, cancel_requested_by = NULL, cancel_reason = NULL WHERE id = ?`).run(item.id);
    audit(db, req, {
      category: 'annulations',
      action: 'cancel_refused',
      entity: table,
      id: item.id,
      summary: `Annulation refusée : ${describe(table, item)} gardé(e), poste n°${shift.id}`,
      reason: item.cancel_reason,
    });
    res.status(204).end();
  });

  // Amounts of a closed shift, from its meter readings and its operations.
  function reconcile(shiftId) {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId);
    const readings = db.prepare('SELECT * FROM shift_readings WHERE shift_id = ?').all(shiftId);
    const sales = db.prepare('SELECT * FROM sales WHERE shift_id = ?').all(shiftId);
    // Subscribers pay a higher price than the pump price used for the meters.
    const unitPrices = new Map(readings.map((r) => [r.nozzle_id, r.unit_price]));
    const surcharge = round(sales.reduce((t, s) => t + (s.amount - s.liters * unitPrices.get(s.nozzle_id)), 0));
    const totalAmount = round(readings.reduce((t, r) => t + (r.amount || 0), 0) + surcharge);
    const creditAmount = round(sales.filter((s) => s.kind === 'credit').reduce((t, s) => t + s.amount, 0));
    const comboAmount = round(sales.filter((s) => s.kind === 'combo').reduce((t, s) => t + s.amount, 0));
    const paymentsAmount = round(db.prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM payments WHERE shift_id = ?').get(shiftId).v);
    const expensesAmount = round(db.prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE shift_id = ?').get(shiftId).v);
    // To hand over = change received at the opening + fuel sold − sold on credit − exchanged for
    //               combos + account payments received − expenses paid from the till
    //               ± cash book movements made in the till.
    const moved = movementsTotal(shiftMovements(db, shiftId));
    const expected = round((shift.change_received || 0) + totalAmount - creditAmount - comboAmount + paymentsAmount - expensesAmount + moved);
    // Mobile money is not counted: it is the total of what was entered as paid by mobile money.
    const mobileMoney = momoTotal(db, shiftId);
    db.prepare(
      `UPDATE shifts SET total_amount = ?, credit_amount = ?, combo_amount = ?, payments_amount = ?, expenses_amount = ?, expected_amount = ?, mobile_money = ?, variance = ?
       WHERE id = ?`,
    ).run(totalAmount, creditAmount, comboAmount, paymentsAmount, expensesAmount, expected, mobileMoney, shift.counted_at ? round(declared({ ...shift, mobile_money: mobileMoney }) - expected) : null, shiftId);
  }

  const pendingCancellations = (shiftId) =>
    ['sales', 'payments', 'expenses', 'momo_sales'].reduce(
      (n, table) => n + db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE shift_id = ? AND cancel_requested_at IS NOT NULL`).get(shiftId).n,
      0,
    );

  // Closing = reconciliation: litres from meters, expected money vs declared money,
  // then meters and tank book stocks move forward. Runs inside the caller's transaction;
  // a correction calls it again after undoing the first closing (closed_at is kept).
  // The money may come later (two-step closing): without cash, the shift is closed with its
  // money still to count (counted_at null, no variance).
  function applyClosing(shift, b) {
    const counted = b.cash != null && b.cash !== '';
    const { cash, changeLeft } = counted ? moneyOf(b) : { cash: 0, changeLeft: 0 };
    const notes = b.notes === undefined ? shift.notes : str(b.notes, 'La remarque', { required: false, max: 500 });
    const ends = new Map((Array.isArray(b.readings) ? b.readings : []).map((r) => [Number(r.nozzleId), r.endMeter]));
    linkPhotos(shift.id, b.readings, 'closing_shift_id', shift.id);
    const last = lastMeters(db, shift.id);
    {
      const readings = db
        .prepare(
          `SELECT r.*, p.name AS label FROM shift_readings r JOIN products p ON p.id = r.product_id
           WHERE r.shift_id = ?`,
        )
        .all(shift.id);
      const sales = db.prepare('SELECT * FROM sales WHERE shift_id = ?').all(shift.id);

      let totalLiters = 0;
      for (const r of readings) {
        const end = num(ends.get(r.nozzle_id), `L'index de fin (${r.label})`, { max: 1e12 });
        if (end < r.start_meter) {
          fail(400, `L'index de fin (${r.label}) ne peut pas être inférieur à l'index de début (${r.start_meter}).`);
        }
        const lastTaken = last?.get(r.nozzle_id);
        if (lastTaken != null && end < lastTaken - 0.001) fail(400, `L'index de fin (${r.label}) ne peut pas être inférieur au dernier relevé du poste (${lastTaken}).`);
        const liters = netLiters({ ...r, end_meter: end }, sales, testedLiters(shift.id, r.nozzle_id));
        totalLiters += liters;
        db.prepare('UPDATE shift_readings SET end_meter = ?, liters = ?, amount = ? WHERE id = ?').run(end, liters, round(liters * r.unit_price), r.id);
        db.prepare('UPDATE nozzles SET meter = ? WHERE id = ?').run(end, r.nozzle_id);
        db.prepare('UPDATE tanks SET book_stock = ROUND(book_stock - ?, 2) WHERE id = ?').run(liters, r.tank_id);
      }
      db.prepare(
        `UPDATE shifts SET status = 'closed', closed_at = COALESCE(closed_at, datetime('now')), cash = ?, change_left = ?,
           total_liters = ?, notes = ?, counted_at = CASE WHEN ? THEN COALESCE(counted_at, datetime('now')) END WHERE id = ?`,
      ).run(cash, changeLeft, round(totalLiters), notes, counted ? 1 : 0, shift.id);
      // Each tank as the shift leaves it, for the report.
      db.prepare('DELETE FROM shift_tank_stock WHERE shift_id = ?').run(shift.id);
      db.prepare(
        `INSERT INTO shift_tank_stock (shift_id, tank_id, sold, stock_after)
         SELECT ?, t.id, COALESCE((SELECT SUM(r.liters) FROM shift_readings r WHERE r.shift_id = ? AND r.tank_id = t.id), 0), t.book_stock
         FROM tanks t WHERE t.active = 1 OR t.id IN (SELECT tank_id FROM shift_readings WHERE shift_id = ?)`,
      ).run(shift.id, shift.id, shift.id);
      reconcile(shift.id);
    }
  }

  const moneyOf = (b) => ({
    cash: round(num(b.cash, 'Le montant en espèces ($)', { max: 1e8 })),
    changeLeft: round(num(b.changeLeft ?? 0, 'La monnaie laissée aux pompistes', { max: 1e7 })),
  });

  // The next shift receives the change left at this closing.
  function passChange(shift) {
    const next = db.prepare('SELECT * FROM shifts WHERE id > ? ORDER BY id LIMIT 1').get(shift.id);
    if (!next) return;
    db.prepare('UPDATE shifts SET change_received = (SELECT change_left FROM shifts WHERE id = ?) WHERE id = ?').run(shift.id, next.id);
    if (next.status !== 'open') reconcile(next.id);
  }

  // The daily closing (15:30) is the manager's: the shift is reconciled and the next one opens at
  // once, from the same indexes, with the attendants who are on duty. The money may be counted
  // in the same step or afterwards (POST /shifts/:id/count).
  router.post('/shifts/:id/close', requireRole('manager'), (req, res) => {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
    if (!shift) fail(404, 'Poste introuvable.');
    if (shift.status !== 'open') fail(409, 'Ce poste est déjà clôturé.');
    let nextId;
    transaction(db, () => {
      applyClosing(shift, req.body || {});
      const present = db.prepare('SELECT DISTINCT user_id FROM shift_attendants WHERE shift_id = ? AND left_at IS NULL ORDER BY id').all(shift.id);
      db.prepare("UPDATE shift_attendants SET left_at = datetime('now') WHERE shift_id = ? AND left_at IS NULL").run(shift.id);
      nextId = openShift(present[0]?.user_id ?? shift.attendant_id);
      db.prepare('UPDATE shifts SET change_received = (SELECT change_left FROM shifts WHERE id = ?) WHERE id = ?').run(shift.id, nextId);
      for (const p of present) join(nextId, p.user_id);
      if (shift.station_closed_at) db.prepare('UPDATE shifts SET station_closed_at = ? WHERE id = ?').run(shift.station_closed_at, nextId);
      const s = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shift.id);
      audit(db, req, {
        category: 'postes',
        action: 'shift_closed',
        entity: 'shifts',
        id: shift.id,
        summary: `Poste n°${shift.id} clôturé (à remettre ${money(s.expected_amount)}, ${s.counted_at ? `écart ${money(s.variance)}` : 'argent à compter'}) ; poste n°${nextId} ouvert`,
      });
    });
    res.json({ ...shiftDetail(shift.id), next_shift_id: nextId });
  });

  // Second step of the closing: the manager counts the money once the next shift has started.
  router.post('/shifts/:id/count', requireRole('manager'), (req, res) => {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
    if (!shift) fail(404, 'Poste introuvable.');
    if (shift.status !== 'closed') fail(409, 'Clôturez d’abord le poste.');
    if (shift.counted_at) fail(409, 'L’argent de ce poste est déjà compté : corrigez la clôture pour le changer.');
    const { cash, changeLeft } = moneyOf(req.body || {});
    const notes = str(req.body?.notes, 'La remarque', { required: false, max: 500 }) ?? shift.notes;
    transaction(db, () => {
      db.prepare("UPDATE shifts SET cash = ?, change_left = ?, notes = ?, counted_at = datetime('now') WHERE id = ?").run(cash, changeLeft, notes, shift.id);
      reconcile(shift.id);
      passChange(shift);
      const s = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shift.id);
      audit(db, req, {
        category: 'postes',
        action: 'shift_counted',
        entity: 'shifts',
        id: shift.id,
        summary: `Argent du poste n°${shift.id} compté : espèces remises ${money(cash)}${changeLeft ? `, monnaie laissée ${money(changeLeft)}` : ''}, écart ${money(s.variance)}`,
      });
    });
    res.json(shiftDetail(shift.id));
  });

  // Manager: corrects a closing (wrong index, miscounted cash). The first
  // closing is undone (nozzle meters back, tank stock back), then applied again with the new figures.
  router.post('/shifts/:id/correct', requireRole('manager'), (req, res) => {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
    if (!shift) fail(404, 'Poste introuvable.');
    if (shift.status !== 'closed') fail(409, 'Seul un poste clôturé peut être corrigé.');
    const reason = str(req.body?.reason, 'Le motif de la correction', { max: 300 });
    // Counted money stays counted: a correction gives it again.
    if (shift.counted_at) moneyOf(req.body || {});
    transaction(db, () => {
      const readings = db
        .prepare('SELECT r.*, p.name AS label FROM shift_readings r JOIN products p ON p.id = r.product_id WHERE r.shift_id = ?')
        .all(shift.id);
      // The next shift starts from these end indexes: it follows the correction while it is open.
      const next = db.prepare('SELECT * FROM shifts WHERE id > ? ORDER BY id LIMIT 1').get(shift.id);
      for (const r of readings) {
        const later = db.prepare('SELECT DISTINCT shift_id FROM shift_readings WHERE nozzle_id = ? AND shift_id > ?').all(r.nozzle_id, shift.id);
        if (later.some((l) => !next || l.shift_id !== next.id || next.status !== 'open')) {
          fail(409, `${r.label} a déjà servi dans un poste clôturé après celui-ci : la clôture ne peut plus être corrigée ici.`);
        }
      }
      for (const r of readings) {
        db.prepare('UPDATE nozzles SET meter = ? WHERE id = ?').run(r.start_meter, r.nozzle_id);
        db.prepare('UPDATE tanks SET book_stock = ROUND(book_stock + ?, 2) WHERE id = ?').run(r.liters || 0, r.tank_id);
      }
      applyClosing(shift, req.body || {});
      if (next?.status === 'open') {
        db.prepare('UPDATE shifts SET change_received = (SELECT change_left FROM shifts WHERE id = ?) WHERE id = ?').run(shift.id, next.id);
        const firstTaken = db.prepare('SELECT c.id FROM shift_checkpoints c WHERE c.shift_id = ? ORDER BY c.id LIMIT 1').get(next.id);
        for (const r of db.prepare('SELECT nozzle_id, end_meter FROM shift_readings WHERE shift_id = ?').all(shift.id)) {
          const taken = firstTaken && db.prepare('SELECT meter FROM checkpoint_readings WHERE checkpoint_id = ? AND nozzle_id = ?').get(firstTaken.id, r.nozzle_id);
          if (taken && r.end_meter > taken.meter + 0.001) fail(409, `L’index corrigé dépasse le premier relevé du poste suivant (${taken.meter}).`);
          db.prepare('UPDATE shift_readings SET start_meter = ? WHERE shift_id = ? AND nozzle_id = ?').run(r.end_meter, next.id, r.nozzle_id);
        }
      }
      const after = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shift.id);
      const pick = (s) => ({ total_liters: s.total_liters, total_amount: s.total_amount, expected_amount: s.expected_amount, declared: declared(s), variance: s.variance });
      audit(db, req, {
        category: 'postes',
        action: 'shift_corrected',
        entity: 'shifts',
        id: shift.id,
        summary: `Clôture du poste n°${shift.id} corrigée : à remettre ${money(shift.expected_amount)} → ${money(after.expected_amount)}, écart ${money(shift.variance)} → ${money(after.variance)}`,
        before: { ...pick(shift), readings: readings.map((r) => ({ product: r.label, end: r.end_meter })) },
        after: pick(after),
        reason,
      });
    });
    res.json(shiftDetail(shift.id));
  });

  return router;
};
