// Mails that follow what happens at the station, sent by a tick every minute (server.js):
// - after an event, read from its table past a cursor (receipts, credit fill-ups, new prices),
//   a minute later so that a mistake corrected at once is not mailed;
// - the shift report once its money is counted, and the dashboard's new alerts;
// - on a schedule, in Goma time: the week's report on Monday, the month's report and the
//   customers' statements on the 1st, subscribers' payment reminders, the admin's backup on Sunday.
// Each scheduled mail is written in mail_jobs before it goes, so it goes once. On the first tick
// the cursors and lists start from what exists: nothing from before is sent.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { getSettings } = require('./db');
const { fmt } = require('./pdfReport');
const { round } = require('./util');
const { balanceSql, subscriberDues } = require('./loyalty');
const { applyScheduledPrices } = require('./prices');
const { userAlerts } = require('./alerts');
const { firstName } = require('./mailer');
const { aiEnabled } = require('./claude');
const { periodComment } = require('./reportComment');

const TZ = 'Africa/Lubumbashi';
const BACKUP_MAX = 25 * 1024 * 1024; // Resend takes 40 MB per mail, attachments included

// The station's date and hour for a moment.
function local(now) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short', hourCycle: 'h23' })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, day: Number(p.day), hour: Number(p.hour), weekday: p.weekday, month: `${p.year}-${p.month}` };
}
const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const monthLabel = (month) => new Date(`${month}-01T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
// « de mars », « d’octobre ».
const ofMonth = (month) => (/^[aeiou]/.test(monthLabel(month)) ? `d’${monthLabel(month)}` : `de ${monthLabel(month)}`);
const previousMonth = (month) => addDays(`${month}-01`, -1).slice(0, 7);
const lastDay = (month) => addDays(`${addDays(`${month}-28`, 4).slice(0, 7)}-01`, -1);
const liters = (n) => fmt.liters(round(n));
const PAY = { espèces: 'Espèces', 'mobile money': 'Mobile money' };

function createMailJobs(db, mailer) {
  const { send, toCustomer, toStaff, customerFor, appUrl } = mailer;
  const stationName = () => getSettings(db).stationName || 'MTG Station';

  const once = (job) => db.prepare('INSERT OR IGNORE INTO mail_jobs (job) VALUES (?)').run(job).changes > 0;
  const balance = (customerId) => round(db.prepare(`SELECT ${balanceSql('c.id')} AS b FROM customers c WHERE c.id = ?`).get(customerId)?.b || 0);
  const balanceRow = (customerId) => {
    const b = balance(customerId);
    return b < -0.005 ? ['Avance', fmt.money(-b), { bold: true, level: 'good' }] : ['Solde dû', fmt.money(b), { bold: true }];
  };

  // Ids of a table past the cursor, old enough; the first time, the cursor starts at the end.
  function since(name, table, timeColumn, settle) {
    const c = db.prepare('SELECT last_id FROM mail_cursors WHERE name = ?').get(name);
    if (!c) {
      const max = db.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM ${table}`).get().m;
      db.prepare('INSERT INTO mail_cursors (name, last_id) VALUES (?, ?)').run(name, max);
      return [];
    }
    return db.prepare(`SELECT id FROM ${table} WHERE id > ? AND ${timeColumn} <= datetime('now', ?) ORDER BY id`).all(c.last_id, `-${settle} seconds`);
  }
  const advance = (name, id) => db.prepare('UPDATE mail_cursors SET last_id = MAX(last_id, ?) WHERE name = ?').run(id, name);

  // ---------- Events ----------

  function receipts(settle) {
    const rows = since('payments', 'payments', 'created_at', settle);
    for (const { id } of rows) {
      advance('payments', id);
      const p = db
        .prepare('SELECT p.*, u.name AS user_name FROM payments p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?')
        .get(id);
      const c = p && customerFor(p.customer_id, 'recu');
      if (!c) continue;
      toCustomer(c, 'recu', {
        subject: `Reçu de règlement : ${fmt.money(p.amount)}`,
        eyebrow: 'Reçu de règlement',
        title: `Merci ${firstName(c.name)}`,
        preheader: `${fmt.money(p.amount)} reçus le ${fmt.dateTime(p.created_at)}.`,
        blocks: [
          { amount: { label: 'Montant reçu', value: fmt.money(p.amount), sub: `${PAY[p.method] || p.method} · ${fmt.dateTime(p.created_at)}` } },
          {
            rows: [
              ['Reçu n°', `R-${String(p.id).padStart(6, '0')}`],
              ['Mode de paiement', PAY[p.method] || p.method],
              p.reference ? ['Référence', p.reference] : null,
              p.user_name ? ['Reçu par', p.user_name] : null,
              balanceRow(c.id),
            ],
          },
          { note: 'Gardez ce mail : il vaut reçu.' },
        ],
      });
    }
  }

  function creditSales(settle) {
    const rows = since('sales', 'sales', 'created_at', settle);
    for (const { id } of rows) {
      advance('sales', id);
      const s = db
        .prepare(
          `SELECT s.*, p.name AS product_name, u.name AS user_name FROM sales s JOIN products p ON p.id = s.product_id
           JOIN shifts sh ON sh.id = s.shift_id LEFT JOIN users u ON u.id = COALESCE(s.user_id, sh.attendant_id) WHERE s.id = ?`,
        )
        .get(id);
      if (!s || s.kind === 'paid') continue;
      const c = customerFor(s.customer_id, 'plein');
      if (!c) continue;
      const combo = s.kind === 'combo';
      toCustomer(c, 'plein', {
        subject: combo ? `Plein avec vos combos : ${liters(s.liters)} de ${s.product_name}` : `Plein à crédit : ${fmt.money(s.amount)}`,
        eyebrow: combo ? 'Plein avec vos combos' : 'Plein à crédit',
        title: `${liters(s.liters)} de ${s.product_name}`,
        preheader: `${fmt.money(s.amount)} le ${fmt.dateTime(s.created_at)}.`,
        blocks: [
          { amount: { label: combo ? 'Payé avec vos combos' : 'Montant à crédit', value: fmt.money(s.amount), sub: fmt.dateTime(s.created_at) } },
          {
            rows: [
              ['Produit', s.product_name],
              ['Litres', liters(s.liters)],
              ['Prix au litre', `${fmt.price(s.unit_price)} $`],
              s.plate ? ['Véhicule', s.plate] : null,
              s.user_name ? ['Servi par', s.user_name] : null,
              balanceRow(c.id),
            ],
          },
          c.type === 'account' && !combo ? { note: `Les pleins du mois se paient avant le ${c.payment_day || getSettings(db).subscriberGraceDays} du mois suivant.` } : null,
        ].filter(Boolean),
      });
    }
  }

  // New prices (changed by hand, or scheduled and now due): one mail per customer with the
  // prices they pay (a subscriber's own price).
  function prices(settle) {
    applyScheduledPrices(db);
    const rows = since('prices', 'price_history', 'changed_at', settle);
    if (!rows.length) return;
    advance('prices', rows.at(-1).id);
    const products = db.prepare('SELECT id, name, price, COALESCE(subscriber_price, price) AS subscriber_price FROM products WHERE active = 1 ORDER BY id').all();
    const before = db.prepare('SELECT price, subscriber_price FROM price_history WHERE product_id = ? AND id < ? ORDER BY id DESC LIMIT 1');
    const changed = new Map();
    for (const { id } of rows) {
      const h = db.prepare('SELECT * FROM price_history WHERE id = ?').get(id);
      if (!changed.has(h.product_id)) changed.set(h.product_id, before.get(h.product_id, id));
    }
    const customers = db
      .prepare("SELECT id FROM customers WHERE active = 1 AND email IS NOT NULL AND email != '' AND id NOT IN (SELECT customer_id FROM customer_mail_prefs WHERE kind = 'prix')")
      .all();
    for (const { id } of customers) {
      const c = customerFor(id, 'prix');
      if (!c) continue;
      const sub = c.type === 'account';
      toCustomer(c, 'prix', {
        subject: `Nouveaux prix à ${stationName()}`,
        eyebrow: 'Prix à la pompe',
        title: 'Nouveaux prix',
        preheader: products.map((p) => `${p.name} ${fmt.price(sub ? p.subscriber_price : p.price)} $/L`).join(' · '),
        blocks: [
          { p: `Bonjour ${firstName(c.name)}, voici ${sub ? 'vos prix d’abonné' : 'les prix'} à partir d’aujourd’hui.` },
          {
            rows: products.map((p) => {
              const old = changed.get(p.id);
              const was = old ? (sub ? old.subscriber_price ?? old.price : old.price) : null;
              const now = sub ? p.subscriber_price : p.price;
              return [p.name, `${fmt.price(now)} $/L${was != null && Math.abs(was - now) > 1e-9 ? ` (avant ${fmt.price(was)})` : ''}`, { bold: true }];
            }),
          },
        ],
      });
    }
  }

  // The shift report, once the money is counted: to the team, with the PDF.
  function shiftReports(settle) {
    if (once('baseline:postes')) {
      db.exec("INSERT OR IGNORE INTO mail_jobs (job) SELECT 'poste:' || id FROM shifts WHERE counted_at IS NOT NULL");
      return;
    }
    const due = db
      .prepare(
        `SELECT id FROM shifts WHERE status = 'closed' AND counted_at IS NOT NULL AND counted_at <= datetime('now', ?)
           AND NOT EXISTS (SELECT 1 FROM mail_jobs WHERE job = 'poste:' || shifts.id) ORDER BY id`,
      )
      .all(`-${settle} seconds`);
    const tolerance = getSettings(db).cashTolerance;
    for (const { id } of due) {
      if (!once(`poste:${id}`)) continue;
      const { detail: s, pdf } = mailer.services.shiftPdf(id);
      const variance = s.variance ?? 0;
      const level = Math.abs(variance) > tolerance ? 'bad' : 'good';
      toStaff(
        'rapport_poste',
        {
          subject: `Poste n°${id} : écart ${fmt.signed(variance)}`,
          eyebrow: `Poste n°${id} · ${fmt.date(s.closed_at)}`,
          title: `Poste n°${id} clôturé`,
          preheader: `${fmt.money(s.total_amount)} de ventes, écart ${fmt.signed(variance)}.`,
          blocks: [
            { amount: { label: 'Écart de caisse', value: fmt.signed(variance), level, sub: s.attendant_name } },
            {
              rows: [
                ['Litres vendus', liters(s.total_liters)],
                ['Ventes', fmt.money(s.total_amount)],
                ['Crédits', fmt.money(s.credit_amount)],
                ['Règlements reçus', fmt.money(s.payments_amount)],
                ['Dépenses', fmt.money(s.expenses_amount)],
                ['Attendu', fmt.money(s.expected_amount), { bold: true }],
                ['Espèces remises', fmt.money(s.cash)],
                ['Mobile money', fmt.money(s.mobile_money)],
                s.change_left ? ['Monnaie laissée', fmt.money(s.change_left)] : null,
              ],
            },
            { button: { label: 'Voir le poste', url: `${appUrl()}/#/postes/${id}` } },
          ],
        },
        [{ filename: `rapport-poste-${id}.pdf`, content: pdf }],
      );
    }
  }

  // New alerts on the dashboard, as each person filters them: one mail with the new ones.
  // An alert goes once; it goes again only if it disappears and comes back.
  function alerts() {
    const all = mailer.services.stationAlerts().alerts;
    const keys = new Set(all.map((a) => a.key));
    const sent = db.prepare('SELECT 1 FROM mail_alerts_sent WHERE user_id = ? AND key = ?');
    const mark = db.prepare('INSERT OR IGNORE INTO mail_alerts_sent (user_id, key) VALUES (?, ?)');
    for (const r of db.prepare('SELECT user_id, key FROM mail_alerts_sent').all()) {
      if (!keys.has(r.key)) db.prepare('DELETE FROM mail_alerts_sent WHERE user_id = ? AND key = ?').run(r.user_id, r.key);
    }
    const baseline = once('baseline:alertes');
    for (const u of mailer.staffRecipients('alertes')) {
      const fresh = userAlerts(db, u.id, all).visible.filter((a) => !sent.get(u.id, a.key));
      for (const a of fresh) mark.run(u.id, a.key);
      if (baseline || !fresh.length) continue;
      send(
        u.email,
        {
          subject: fresh.length > 1 ? `${fresh.length} nouvelles alertes` : fresh[0].text,
          eyebrow: 'Alertes',
          title: fresh.length > 1 ? `${fresh.length} nouvelles alertes` : 'Nouvelle alerte',
          preheader: fresh.map((a) => a.text).join(' · '),
          blocks: [{ list: fresh.map((a) => ({ text: a.text, level: a.level })) }, { button: { label: 'Ouvrir le tableau de bord', url: `${appUrl()}/#/` } }],
          manageUrl: `${appUrl()}/?mail=reglages`,
        },
        { kind: 'alertes', userId: u.id },
      );
    }
  }

  // ---------- Schedule ----------

  // With Claude (ANTHROPIC_API_KEY), a few observations come first: the mail waits for them, and
  // goes without them if they fail. Without the key it is sent at once.
  function periodReport(kind, from, to, label, previous) {
    const { report, pdf } = mailer.services.periodPdf(from, to);
    const send = (points) => sendPeriodReport(kind, from, to, label, report, pdf, points);
    if (!aiEnabled()) return send(null);
    return periodComment({
      label,
      report,
      previous: mailer.services.salesReport(...previous),
      alerts: mailer.services.stationAlerts().alerts.map((a) => a.text),
      stationName: getSettings(db).stationName,
    })
      .catch((err) => {
        console.error('Commentaire du rapport :', err.message);
        return null;
      })
      .then(send)
      .catch((err) => console.error(`Mails (${kind}) :`, err));
  }

  function sendPeriodReport(kind, from, to, label, report, pdf, points) {
    const t = report.totals;
    toStaff(
      kind,
      {
        subject: `Rapport ${label}`,
        eyebrow: kind === 'rapport_mois' ? 'Rapport du mois' : 'Rapport de la semaine',
        title: label.charAt(0).toUpperCase() + label.slice(1),
        preheader: `${fmt.money(t.amount)} de ventes, ${liters(t.liters)}.`,
        blocks: [
          { amount: { label: 'Ventes', value: fmt.money(t.amount), sub: `${liters(t.liters)} · ${report.shifts.length} poste${report.shifts.length > 1 ? 's' : ''}` } },
          ...(points ? [{ list: points }] : []),
          {
            rows: [
              ['Crédits accordés', fmt.money(t.credit)],
              ['Règlements reçus', fmt.money(t.payments)],
              ['Dépenses', fmt.money(t.expenses)],
              ['Écart de caisse cumulé', fmt.signed(t.variance), { level: Math.abs(t.variance) > 0.005 ? (t.variance < 0 ? 'bad' : 'good') : undefined }],
              t.costKnown ? ['Marge brute estimée', fmt.money(t.grossMargin), { bold: true }] : null,
            ],
          },
          { button: { label: 'Ouvrir les rapports', url: `${appUrl()}/#/rapports` } },
        ],
      },
      [{ filename: `rapport-${from}_${to}.pdf`, content: pdf }],
    );
  }

  // The 1st: every customer with an address gets last month's statement (if anything moved or is owed).
  function statements(month) {
    const from = `${month}-01`;
    const to = lastDay(month);
    const ids = db
      .prepare("SELECT id FROM customers WHERE active = 1 AND email IS NOT NULL AND email != '' AND id NOT IN (SELECT customer_id FROM customer_mail_prefs WHERE kind = 'releve')")
      .all();
    for (const { id } of ids) {
      const c = customerFor(id, 'releve');
      if (!c) continue;
      const { acc, pdf, filename } = mailer.services.customerStatement(id, from, to);
      if (!acc.movements.length && Math.abs(acc.closing) < 0.005) continue;
      const debits = round(acc.movements.reduce((t, m) => t + (m.debit || 0), 0));
      toCustomer(
        c,
        'releve',
        {
          subject: `Votre relevé ${ofMonth(month)}`,
          eyebrow: 'Relevé de compte',
          title: `Relevé ${ofMonth(month)}`,
          preheader: `Solde à la fin du mois : ${fmt.money(acc.closing)}.`,
          blocks: [
            { p: `Bonjour ${firstName(c.name)}, voici votre relevé du mois, en pièce jointe.` },
            { amount: { label: 'Solde à la fin du mois', value: fmt.money(acc.closing) } },
            {
              rows: [
                ['Solde au début du mois', fmt.money(acc.opening)],
                ['Achats à crédit', fmt.money(debits)],
                ['Règlements', fmt.money(acc.totals.payments)],
              ],
            },
            c.type === 'account' && acc.closing > 0.005 ? { note: `À régler avant le ${c.payment_day || getSettings(db).subscriberGraceDays} ${monthLabel(addDays(to, 1).slice(0, 7))}.` } : null,
          ].filter(Boolean),
        },
        [{ filename, content: pdf }],
      );
    }
  }

  // Subscribers: a reminder in the 3 days before their payment day, a notice the day after it if
  // nothing came, another a week later.
  function reminders(today) {
    const day = Number(today.slice(8, 10));
    const month = today.slice(0, 7);
    const grace = getSettings(db).subscriberGraceDays;
    for (const { id } of db.prepare("SELECT id FROM customers WHERE type = 'account' AND active = 1 AND email IS NOT NULL AND email != ''").all()) {
      const c = customerFor(id, 'rappel');
      if (!c) continue;
      const dues = subscriberDues(db, id, grace);
      if (dues.overdue <= 0.005) continue;
      const deadline = `${dues.paymentDay} ${monthLabel(month)}`;
      if (!dues.late && dues.paymentDay - day <= 3 && once(`rappel:${id}:${month}`)) {
        toCustomer(c, 'rappel', {
          subject: `Rappel : ${fmt.money(dues.overdue)} à payer avant le ${deadline}`,
          eyebrow: 'Rappel de paiement',
          title: `À payer avant le ${deadline}`,
          blocks: [
            { p: `Bonjour ${firstName(c.name)}, vos pleins du mois dernier sont à régler avant le ${deadline}.` },
            { amount: { label: 'Montant à payer', value: fmt.money(dues.overdue) } },
            { note: 'Vous pouvez payer à la station, en espèces ou par mobile money. Si c’est déjà fait, merci, ignorez ce mail.' },
          ],
        });
      }
      const notice = (job, again) => {
        if (!once(job)) return;
        toCustomer(c, 'rappel', {
          subject: `Paiement en retard : ${fmt.money(dues.overdue)}`,
          eyebrow: again ? 'Deuxième rappel' : 'Paiement en retard',
          title: 'Paiement en retard',
          blocks: [
            { p: `Bonjour ${firstName(c.name)}, le paiement attendu avant le ${deadline} n’est pas encore arrivé.` },
            { amount: { label: 'Montant en retard', value: fmt.money(dues.overdue), level: 'bad' } },
            { p: 'Les nouveaux pleins à crédit sont suspendus jusqu’au paiement.' },
            { note: 'Payez à la station, en espèces ou par mobile money. Si c’est déjà fait, merci, ignorez ce mail.' },
          ],
        });
      };
      if (dues.late) notice(`relance:${id}:${month}`, false);
      if (dues.late && day >= dues.paymentDay + 7) notice(`relance2:${id}:${month}`, true);
    }
  }

  // Sunday evening: a copy of the database for the admin (gzip, as long as it fits in a mail).
  function backup(today) {
    const admins = mailer.staffRecipients('sauvegarde');
    if (!admins.length) return;
    const file = path.join(os.tmpdir(), `station-${process.pid}-${Date.now()}.db`);
    try {
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      const gz = zlib.gzipSync(fs.readFileSync(file));
      const fits = gz.length <= BACKUP_MAX;
      toStaff(
        'sauvegarde',
        {
          subject: `Sauvegarde du ${fmt.date(today)}`,
          eyebrow: 'Sauvegarde',
          title: `Sauvegarde du ${fmt.date(today)}`,
          blocks: [
            {
              p: fits
                ? 'La base de données de la station est en pièce jointe (fichier .db compressé). Gardez-la en lieu sûr : elle contient tout.'
                : `La base fait ${round(gz.length / 1048576, 1)} Mo compressée : trop pour un mail. Téléchargez-la depuis Réglages → Données.`,
            },
            { rows: [['Taille', `${round(gz.length / 1048576, 1)} Mo`], ['Faite le', fmt.dateTime(new Date())]] },
          ],
        },
        fits ? [{ filename: `station-${today}.db.gz`, content: gz }] : [],
      );
    } finally {
      fs.rmSync(file, { force: true });
    }
  }

  // One tick: everything due now. settle: seconds an event waits before its mail.
  function tick({ now = new Date(), settle = 60 } = {}) {
    const run = (name, fn) => {
      try {
        fn();
      } catch (err) {
        console.error(`Mails (${name}) :`, err);
      }
    };
    const t = local(now);
    run('reçus', () => receipts(settle));
    run('crédits', () => creditSales(settle));
    run('prix', () => prices(settle));
    run('postes', () => shiftReports(settle));
    run('alertes', alerts);
    if (t.hour >= 7 && t.weekday === 'Mon' && once(`semaine:${t.date}`)) {
      const from = addDays(t.date, -7);
      run('semaine', () => periodReport('rapport_semaine', from, addDays(t.date, -1), `de la semaine du ${fmt.date(from)} au ${fmt.date(addDays(t.date, -1))}`, [addDays(from, -7), addDays(from, -1)]));
    }
    if (t.hour >= 7 && t.day === 1) {
      const month = previousMonth(t.month);
      const before = previousMonth(month);
      if (once(`mois:${month}`)) run('mois', () => periodReport('rapport_mois', `${month}-01`, lastDay(month), ofMonth(month), [`${before}-01`, lastDay(before)]));
      if (t.hour >= 8 && once(`releves:${month}`)) run('relevés', () => statements(month));
    }
    if (t.hour >= 8 && once(`rappels:${t.date}`)) run('rappels', () => reminders(t.date));
    if (t.hour >= 22 && t.weekday === 'Sun' && once(`sauvegarde:${t.date}`)) run('sauvegarde', () => backup(t.date));
    run('nettoyage', () => db.exec("DELETE FROM mail_tokens WHERE expires_at < datetime('now', '-2 days')"));
    run('photos', () => mailer.services.cleanPhotos?.()); // meter photos older than a week
  }

  let timer = null;
  function start() {
    if (timer) return;
    setTimeout(() => tick(), 15e3).unref();
    timer = setInterval(() => tick(), 60e3);
    timer.unref();
  }

  return { tick, start };
}

module.exports = { createMailJobs };
