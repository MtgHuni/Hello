// End-of-shift report as a PDF: cash reconciliation, sales computed from the
// meter indexes (not every sale is entered), credits, expenses and payments.
const { Pdf, fit, wrap } = require('./pdf');
const { round } = require('./util');

const TZ = 'Africa/Lubumbashi';
const INK = [10, 10, 11];
const GREY = [105, 105, 99];
const RULE = [214, 214, 208];
const GASOIL = [35, 196, 107];
const ESSENCE = [240, 49, 58];
const GOOD = [18, 128, 66];
const BAD = [196, 28, 38];

const money = (n) => `${(Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const signed = (n) => `${n > 0 ? '+' : ''}${money(n)}`;
const number = (n) => (n == null ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 }));
const liters = (n) => `${number(n || 0)} L`;
const price = (n) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
// SQLite timestamps are UTC 'YYYY-MM-DD HH:MM:SS'.
const toDate = (s) => (s instanceof Date ? s : new Date(`${String(s).replace(' ', 'T')}Z`));
const dateTime = (s) => (s ? toDate(s).toLocaleString('fr-FR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }) : '—');
const time = (s) => (s ? toDate(s).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '—');

function shiftReportPdf(shift, { stationName, combosEnabled, cashTolerance = 0, now = new Date() }) {
  const pdf = new Pdf({ title: `Rapport du poste n°${shift.id} — ${stationName}` });
  const L = 42;
  const R = pdf.width - 42;
  const TOP = 50;
  const BOTTOM = pdf.height - 60;
  let y = TOP;
  let onBreak = null; // redraws a table's column heads on a new page

  const room = (h) => {
    if (y + h <= BOTTOM) return;
    pdf.addPage();
    y = TOP;
    if (onBreak) onBreak();
  };

  // ---- Header ----
  pdf.rect(L, y, 13, 13, GASOIL).rect(L + 16, y, 13, 13, ESSENCE);
  pdf.text(L + 38, y + 11, stationName.toUpperCase(), { size: 11, bold: true });
  const status = shift.status === 'validated' ? `Validé par ${shift.validated_by_name}` : 'Clôturé, à valider';
  pdf.text(R, y + 11, status, { size: 9.5, bold: true, color: GREY, align: 'right' });
  y += 50;
  pdf.text(L, y, `Rapport du poste n°${shift.id}`, { size: 24, bold: true });
  y += 20;
  pdf.text(L, y, `${shift.attendant_name}  ·  ouvert le ${dateTime(shift.opened_at)}  ·  clôturé le ${dateTime(shift.closed_at)}`, { size: 10, color: GREY });
  y += 8;

  const section = (title, note) => {
    onBreak = null;
    room(120); // a title never sits alone at the foot of a page
    y += 30;
    pdf.text(L, y, title, { size: 13, bold: true });
    y += 8;
    pdf.line(L, y, R, y, { color: INK, width: 1 });
    if (note) {
      y += 14;
      pdf.text(L, y, note, { size: 8.5, color: GREY });
      y += 2;
    }
  };

  // Key/value line of the cash summary.
  const line = (label, value, { bold = false, color = INK } = {}) => {
    room(20);
    y += 15;
    pdf.text(L, y, label, { size: 10, bold });
    pdf.text(R, y, value, { size: 10, bold, color, align: 'right' });
    y += 6;
    pdf.line(L, y, R, y, { color: RULE });
  };

  // columns: [{ label, width, align: 'left' | 'right', indent }]; the last column takes the rest.
  const table = (columns, rows, { totals = [], empty } = {}) => {
    const widths = columns.map((c) => c.width || 0);
    widths[widths.length - 1] = R - L - widths.slice(0, -1).reduce((a, b) => a + b, 0);
    const cells = (values, style) => {
      let x = L;
      values.forEach((v, i) => {
        const c = columns[i];
        const w = widths[i];
        if (v !== '' && v != null) {
          if (c.align === 'right') pdf.text(x + w, y, fit(v, w - 8, style.size, style.bold), { ...style, align: 'right' });
          else pdf.text(x + (c.indent || 0), y, fit(v, w - 10 - (c.indent || 0), style.size, style.bold), style);
        }
        x += w;
      });
    };
    const heads = () => {
      y += 15;
      cells(columns.map((c) => c.label), { size: 7.5, bold: true, color: GREY });
      y += 6;
      pdf.line(L, y, R, y, { color: RULE });
    };
    if (!rows.length) {
      room(22);
      y += 16;
      pdf.text(L, y, empty, { size: 9.5, color: GREY });
      return;
    }
    room(40);
    heads();
    onBreak = heads;
    for (const row of rows) {
      room(20);
      y += 14;
      cells(row, { size: 9 });
      y += 6;
      pdf.line(L, y, R, y, { color: RULE });
    }
    onBreak = null;
    totals.forEach((row, i) => {
      room(20);
      if (i === 0) pdf.line(L, y, R, y, { color: INK, width: 0.8 });
      y += 15;
      cells(row, { size: 9.5, bold: true });
      y += 6;
    });
  };

  const readings = shift.readings;
  const indexAmount = round(readings.reduce((t, r) => t + (r.amount || 0), 0));
  const surcharge = round(shift.total_amount - indexAmount);
  const credits = shift.sales.filter((s) => s.kind === 'credit');
  const combos = shift.sales.filter((s) => s.kind === 'combo');
  const pendingNote = (item) => (item.cancel_requested_at ? 'Annulation demandée' : '');

  // ---- Cash ----
  section('Caisse', 'À remettre = ventes par les index − crédits − combos + règlements reçus − dépenses.');
  line('Ventes calculées par les index', money(shift.total_amount));
  line('− Ventes à crédit', money(shift.credit_amount));
  if (combosEnabled || shift.combo_amount) line('− Carburant échangé contre des combos', money(shift.combo_amount));
  line('+ Règlements de clients reçus', money(shift.payments_amount));
  line('− Dépenses payées par la caisse', money(shift.expenses_amount));
  line('À remettre', money(shift.expected_amount), { bold: true });
  line(`Remis : espèces ${money(shift.cash)} · carte ${money(shift.card)}`, money(round(shift.cash + shift.card)));
  const ok = Math.abs(shift.variance) <= cashTolerance;
  line(ok ? 'Écart de caisse (dans la tolérance)' : 'Écart de caisse (hors tolérance)', signed(shift.variance), { bold: true, color: ok ? GOOD : BAD });
  if (shift.pending_cancellations) {
    y += 16;
    pdf.text(L, y, `${shift.pending_cancellations} annulation${shift.pending_cancellations > 1 ? 's' : ''} en attente de la décision du gérant.`, { size: 9, bold: true, color: BAD });
  }

  // ---- Sales from the meters ----
  section('Ventes calculées par les index', 'Toutes les ventes ne sont pas saisies : litres = index de fin − index de début, au prix figé à l’ouverture.');
  const byProduct = new Map();
  for (const r of readings) {
    const p = byProduct.get(r.product_name) || { liters: 0, amount: 0 };
    p.liters += r.liters || 0;
    p.amount += r.amount || 0;
    byProduct.set(r.product_name, p);
  }
  const totals = byProduct.size > 1 ? [...byProduct].map(([name, p]) => [`Total ${name}`, '', '', '', liters(round(p.liters)), '', money(round(p.amount))]) : [];
  totals.push(['Total des index', '', '', '', liters(shift.total_liters), '', money(indexAmount)]);
  if (surcharge) totals.push([surcharge > 0 ? 'Supplément abonnés' : 'Remise abonnés', '', '', '', '', '', money(surcharge)], ['Total des ventes', '', '', '', '', '', money(shift.total_amount)]);
  table(
    [
      { label: 'POMPE · PISTOLET', width: 146 },
      { label: 'PRODUIT', width: 62 },
      { label: 'INDEX DÉBUT', width: 68, align: 'right' },
      { label: 'INDEX FIN', width: 68, align: 'right' },
      { label: 'LITRES', width: 58, align: 'right' },
      { label: 'PRIX $/L', width: 50, align: 'right' },
      { label: 'MONTANT', align: 'right' },
    ],
    readings.map((r) => [`${r.pump_name} · ${r.nozzle_name}`, r.product_name, number(r.start_meter), number(r.end_meter), liters(r.liters), price(r.unit_price), money(r.amount)]),
    { totals },
  );

  // ---- Credits ----
  section('Crédits accordés', credits.length ? `${credits.length} vente${credits.length > 1 ? 's' : ''} à crédit` : null);
  table(
    [
      { label: 'HEURE', width: 44 },
      { label: 'CLIENT', width: 178 },
      { label: 'PRODUIT', width: 64 },
      { label: 'LITRES', width: 64, align: 'right' },
      { label: 'MONTANT', width: 80, align: 'right' },
      { label: 'REMARQUE', indent: 14 },
    ],
    credits.map((s) => [time(s.created_at), s.customer_name, s.product_name, liters(s.liters), money(s.amount), [s.over_limit ? 'Hors plafond' : '', pendingNote(s)].filter(Boolean).join(' · ')]),
    { totals: [['Total', '', '', liters(round(credits.reduce((t, s) => t + s.liters, 0))), money(shift.credit_amount), '']], empty: 'Aucun crédit sur ce poste.' },
  );

  // ---- Combos (only when some were exchanged) ----
  if (combos.length) {
    section('Combos échangés');
    table(
      [
        { label: 'HEURE', width: 44 },
        { label: 'CLIENT', width: 178 },
        { label: 'PRODUIT', width: 64 },
        { label: 'LITRES', width: 64, align: 'right' },
        { label: 'MONTANT', width: 80, align: 'right' },
        { label: 'REMARQUE', indent: 14 },
      ],
      combos.map((s) => [time(s.created_at), s.customer_name, s.product_name, liters(s.liters), money(s.amount), pendingNote(s)]),
      { totals: [['Total', '', '', '', money(shift.combo_amount), '']] },
    );
  }

  // ---- Expenses ----
  section('Dépenses', shift.expenses.length ? 'Payées avec l’argent de la caisse du poste' : null);
  table(
    [
      { label: 'HEURE', width: 44 },
      { label: 'CATÉGORIE', width: 92 },
      { label: 'DESCRIPTION', width: 176 },
      { label: 'BÉNÉFICIAIRE', width: 118 },
      { label: 'MONTANT', align: 'right' },
    ],
    shift.expenses.map((e) => [time(e.created_at), e.category, `${e.description}${e.cancel_requested_at ? ' (annulation demandée)' : ''}`, e.beneficiary || '—', money(e.amount)]),
    { totals: [['Total', '', '', '', money(shift.expenses_amount)]], empty: 'Aucune dépense sur ce poste.' },
  );

  // ---- Payments received ----
  section('Règlements de clients reçus');
  table(
    [
      { label: 'HEURE', width: 44 },
      { label: 'CLIENT', width: 178 },
      { label: 'MODE', width: 94 },
      { label: 'RÉFÉRENCE', width: 114 },
      { label: 'MONTANT', align: 'right' },
    ],
    shift.payments.map((p) => [time(p.created_at), p.customer_name, p.method, `${p.reference || '—'}${p.cancel_requested_at ? ' (annulation demandée)' : ''}`, money(p.amount)]),
    { totals: [['Total', '', '', '', money(shift.payments_amount)]], empty: 'Aucun règlement reçu sur ce poste.' },
  );

  // ---- Remarks ----
  const remarks = [
    shift.notes ? ['Remarque du pompiste', shift.notes] : null,
    shift.status === 'validated' ? [`Validé par ${shift.validated_by_name} le ${dateTime(shift.validated_at)}`, shift.manager_comment || ''] : null,
  ].filter(Boolean);
  if (remarks.length) {
    section('Remarques');
    for (const [label, text] of remarks) {
      room(36);
      y += 15;
      pdf.text(L, y, label, { size: 9.5, bold: true });
      for (const l of wrap(text, R - L, 9.5)) {
        room(16);
        y += 13;
        pdf.text(L, y, l, { size: 9.5 });
      }
    }
  }

  // ---- Footers, once the page count is known ----
  const count = pdf.pages.length;
  for (let i = 0; i < count; i++) {
    pdf.usePage(i);
    const fy = pdf.height - 34;
    pdf.line(L, fy - 12, R, fy - 12, { color: RULE });
    pdf.text(L, fy, `${stationName} · Rapport du poste n°${shift.id}`, { size: 8, color: GREY });
    pdf.text(R, fy, `Édité le ${dateTime(now)} · page ${i + 1}/${count}`, { size: 8, color: GREY, align: 'right' });
  }
  return pdf.toBuffer();
}

module.exports = { shiftReportPdf };
