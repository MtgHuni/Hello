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
    status: 'Clôturé',
    now,
  });

  const readings = shift.readings;
  const indexAmount = round(readings.reduce((t, r) => t + (r.amount || 0), 0));
  const surcharge = round(shift.total_amount - indexAmount);
  const credits = shift.sales.filter((s) => s.kind === 'credit');
  const combos = shift.sales.filter((s) => s.kind === 'combo');
  const pendingNote = (item) => (item.cancel_requested_at ? 'Annulation demandée' : '');
  const handedOver = round((shift.cash || 0) + (shift.change_left || 0) + (shift.mobile_money || 0));

  // ---- Cash ----
  report.section('Caisse', 'À remettre = monnaie reçue + ventes par les index − crédits − combos + règlements reçus − dépenses.');
  if (shift.change_received) report.line('Monnaie reçue à l’ouverture (poste précédent)', money(shift.change_received));
  report.line('Ventes calculées par les index', money(shift.total_amount));
  report.line('− Ventes à crédit', money(shift.credit_amount));
  if (combosEnabled || shift.combo_amount) report.line('− Carburant échangé contre des combos', money(shift.combo_amount));
  report.line('+ Règlements de clients reçus', money(shift.payments_amount));
  report.line('− Dépenses payées par la caisse', money(shift.expenses_amount));
  report.line('À remettre', money(shift.expected_amount), { bold: true });
  if (shift.mobile_money) report.line('− Mobile money reçu (saisi au fil du poste)', money(shift.mobile_money));
  if (shift.change_left) report.line('− Monnaie laissée aux pompistes', money(shift.change_left));
  report.line('Espèces à remettre', money(round(shift.expected_amount - (shift.mobile_money || 0) - (shift.change_left || 0))), { bold: true });
  report.line('Espèces remises', money(shift.cash));
  report.line('Total remis (espèces + monnaie laissée + mobile money)', money(handedOver));
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
  const tests = shift.pump_tests || [];
  if (tests.length) {
    const approved = round(tests.filter((t) => t.status === 'approved').reduce((s, t) => s + t.liters, 0));
    report.section('Tests de pompe (remis en cuve)', approved ? `${liters(approved)} approuvés : déduits des litres vendus, restés dans la cuve.` : null);
    report.table(
      [
        { label: 'HEURE', width: 44 },
        { label: 'POMPE · PISTOLET', width: 150 },
        { label: 'LITRES', width: 60, align: 'right' },
        { label: 'PAR', width: 100 },
        { label: 'DÉCISION', indent: 14 },
      ],
      tests.map((t) => [time(t.created_at), `${t.pump_name} · ${t.nozzle_name}`, liters(t.liters), t.user_name || '—', t.status === 'approved' ? 'Approuvé' : t.status === 'rejected' ? 'Refusé (compté vendu)' : 'En attente du gérant']),
    );
  }

  // ---- Tanks at the closing ----
  const tanks = shift.tanks || [];
  if (tanks.length) {
    report.section('Cuves à la clôture', 'Stock théorique : dernier jaugeage + livraisons − ventes.');
    report.table(
      [
        { label: 'CUVE', width: 140 },
        { label: 'PRODUIT', width: 70 },
        { label: 'VENDU', width: 70, align: 'right' },
        { label: 'STOCK', width: 76, align: 'right' },
        { label: 'CAPACITÉ', width: 76, align: 'right' },
        { label: 'NIVEAU', align: 'right' },
      ],
      tanks.map((t) => [
        `${t.name}${t.stock_after <= t.low_level ? ' (stock bas)' : ''}`,
        t.product_name,
        liters(t.sold),
        liters(t.stock_after),
        liters(t.capacity),
        t.capacity ? `${Math.round((t.stock_after / t.capacity) * 100)} %` : '—',
      ]),
    );
    const low = tanks.filter((t) => t.stock_after <= t.low_level);
    if (low.length) report.note(`Stock bas : ${low.map((t) => `${t.name} (seuil ${liters(t.low_level)})`).join(', ')}.`, { bold: true, color: COLORS.BAD });
  }

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
    shift.manager_comment ? [`Remarque du gérant${shift.manager_comment_by_name ? ` (${shift.manager_comment_by_name})` : ''}`, shift.manager_comment] : null,
  ].filter(Boolean);
  if (remarks.length) {
    report.section('Remarques');
    for (const [label, text] of remarks) report.paragraph(label, text);
  }

  return report.finish();
}

module.exports = { shiftReportPdf };
