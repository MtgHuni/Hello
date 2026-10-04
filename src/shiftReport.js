// End-of-shift report as a PDF: cash reconciliation, sales computed from the
// meter indexes (not every sale is entered), credits, expenses and payments.
const { Report, fmt, COLORS } = require('./pdfReport');
const { round } = require('./util');

const { money, signed, number, liters, price, dateTime, time } = fmt;

function shiftReportPdf(shift, { stationName, combosEnabled, cashTolerance = 0, now = new Date() }) {
  const report = new Report({
    title: `Rapport du poste n°${shift.id}`,
    stationName,
    heading: `Rapport du poste n°${shift.id}`,
    subtitle: `${shift.attendant_name}  ·  ouvert le ${dateTime(shift.opened_at)}  ·  clôturé le ${dateTime(shift.closed_at)}`,
    status: shift.status === 'validated' ? `Validé par ${shift.validated_by_name}` : 'Clôturé, à valider',
    now,
  });

  const readings = shift.readings;
  const indexAmount = round(readings.reduce((t, r) => t + (r.amount || 0), 0));
  const surcharge = round(shift.total_amount - indexAmount);
  const credits = shift.sales.filter((s) => s.kind === 'credit');
  const combos = shift.sales.filter((s) => s.kind === 'combo');
  const pendingNote = (item) => (item.cancel_requested_at ? 'Annulation demandée' : '');
  const cdf = shift.cash_cdf && shift.cdf_rate ? round(shift.cash_cdf / shift.cdf_rate) : 0;
  const handedOver = round((shift.cash || 0) + (shift.card || 0) + (shift.mobile_money || 0) + cdf);

  // ---- Cash ----
  report.section('Caisse', 'À remettre = ventes par les index − crédits − combos + règlements reçus − dépenses.');
  report.line('Ventes calculées par les index', money(shift.total_amount));
  report.line('− Ventes à crédit', money(shift.credit_amount));
  if (combosEnabled || shift.combo_amount) report.line('− Carburant échangé contre des combos', money(shift.combo_amount));
  report.line('+ Règlements de clients reçus', money(shift.payments_amount));
  report.line('− Dépenses payées par la caisse', money(shift.expenses_amount));
  report.line('À remettre', money(shift.expected_amount), { bold: true });
  report.line('Remis : espèces en dollars', money(shift.cash));
  if (shift.cash_cdf) report.line(`Remis : espèces en francs, ${number(shift.cash_cdf)} FC à ${number(shift.cdf_rate)} FC/$`, money(cdf));
  if (shift.mobile_money) report.line('Remis : mobile money', money(shift.mobile_money));
  if (shift.card) report.line('Remis : carte', money(shift.card));
  report.line('Total remis', money(handedOver), { bold: true });
  const ok = Math.abs(shift.variance) <= cashTolerance;
  report.line(ok ? 'Écart de caisse (dans la tolérance)' : 'Écart de caisse (hors tolérance)', signed(shift.variance), { bold: true, color: ok ? COLORS.GOOD : COLORS.BAD });
  if (shift.pending_cancellations) {
    report.note(`${shift.pending_cancellations} annulation${shift.pending_cancellations > 1 ? 's' : ''} en attente de la décision du gérant.`, { bold: true, color: COLORS.BAD });
  }

  // ---- Sales from the meters ----
  report.section('Ventes calculées par les index', 'Toutes les ventes ne sont pas saisies : litres = index de fin − index de début, au prix figé à l’ouverture.');
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
  report.table(
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
  const saleColumns = [
    { label: 'HEURE', width: 44 },
    { label: 'CLIENT', width: 178 },
    { label: 'PRODUIT', width: 64 },
    { label: 'LITRES', width: 64, align: 'right' },
    { label: 'MONTANT', width: 80, align: 'right' },
    { label: 'REMARQUE', indent: 14 },
  ];
  report.section('Crédits accordés', credits.length ? `${credits.length} vente${credits.length > 1 ? 's' : ''} à crédit` : null);
  report.table(
    saleColumns,
    credits.map((s) => [time(s.created_at), s.customer_name, s.product_name, liters(s.liters), money(s.amount), [s.over_limit ? 'Hors plafond' : '', pendingNote(s)].filter(Boolean).join(' · ')]),
    { totals: [['Total', '', '', liters(round(credits.reduce((t, s) => t + s.liters, 0))), money(shift.credit_amount), '']], empty: 'Aucun crédit sur ce poste.' },
  );

  // ---- Combos (only when some were exchanged) ----
  if (combos.length) {
    report.section('Combos échangés');
    report.table(
      saleColumns,
      combos.map((s) => [time(s.created_at), s.customer_name, s.product_name, liters(s.liters), money(s.amount), pendingNote(s)]),
      { totals: [['Total', '', '', '', money(shift.combo_amount), '']] },
    );
  }

  // ---- Expenses ----
  report.section('Dépenses', shift.expenses.length ? 'Payées avec l’argent de la caisse du poste' : null);
  report.table(
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
  report.section('Règlements de clients reçus');
  report.table(
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
    report.section('Remarques');
    for (const [label, text] of remarks) report.paragraph(label, text);
  }

  return report.finish();
}

module.exports = { shiftReportPdf };
