// Report of a period (a day, a month…) as a PDF: summary, every closed shift,
// products and margin, attendants' variances, tanks, expenses and daily sales.
const { Report, fmt, COLORS } = require('./pdfReport');
const { round } = require('./util');

const { money, signed, number, liters, price, date, dateTime } = fmt;

function periodReportPdf(r, { stationName, cashTolerance = 0, combosEnabled, now = new Date() }) {
  const t = r.totals;
  const single = r.from === r.to;
  const report = new Report({
    title: single ? `Rapport du ${date(r.from)}` : `Rapport du ${date(r.from)} au ${date(r.to)}`,
    stationName,
    heading: single ? `Rapport du ${date(r.from)}` : `Rapport du ${date(r.from)} au ${date(r.to)}`,
    subtitle: `${r.shifts.length} poste${r.shifts.length > 1 ? 's' : ''} clôturé${r.shifts.length > 1 ? 's' : ''}  ·  ${liters(t.liters)} vendus  ·  ventes calculées par les index`,
    now,
  });
  const varianceColor = (v) => (Math.abs(v) <= cashTolerance ? COLORS.GOOD : COLORS.BAD);

  // ---- Summary ----
  report.section('Résumé');
  report.line('Ventes (index, supplément abonnés compris)', money(t.amount), { bold: true });
  report.line('Vendu à crédit', money(t.credit));
  if (combosEnabled || t.combos) report.line('Échangé contre des combos', money(t.combos));
  report.line('Règlements de clients reçus', money(t.payments));
  report.line('Versé à la caisse : espèces', money(t.cash));
  if (t.changeLeft) report.line('Monnaie laissée aux pompistes (aux clôtures)', money(t.changeLeft));
  if (t.mobileMoney) report.line('Encaissé : mobile money', money(t.mobileMoney));
  report.line('Écarts de caisse cumulés', signed(t.variance), { bold: true, color: varianceColor(t.variance) });
  report.line('Dépenses', money(t.expenses));
  if (t.costKnown) {
    report.line('Marge brute estimée', money(t.grossMargin));
    report.line('Résultat net estimé (marge − dépenses)', money(t.net), { bold: true, color: t.net < 0 ? COLORS.BAD : COLORS.INK });
  } else {
    report.line('Marge et résultat', 'prix d’achat manquant dans les livraisons');
  }

  // ---- Shifts ----
  report.section('Postes', 'Remis = espèces remises + monnaie laissée aux pompistes + mobile money, en dollars.');
  const handedOver = (s) => round((s.cash || 0) + (s.change_left || 0) + (s.mobile_money || 0));
  const sum = (key) => round(r.shifts.reduce((a, s) => a + (s[key] || 0), 0));
  report.table(
    [
      { label: 'N°', width: 26 },
      { label: 'POMPISTE', width: 92 },
      { label: 'CLÔTURE', width: 62 },
      { label: 'LITRES', width: 52, align: 'right' },
      { label: 'VENTES', width: 58, align: 'right' },
      { label: 'CRÉDITS', width: 54, align: 'right' },
      { label: 'À REMETTRE', width: 58, align: 'right' },
      { label: 'REMIS', width: 58, align: 'right' },
      { label: 'ÉCART', align: 'right' },
    ],
    r.shifts.map((s) => [
      `${s.id}`,
      s.attendant,
      dateTime(s.closed_at),
      liters(s.total_liters),
      money(s.total_amount),
      money(s.credit_amount),
      money(s.expected_amount),
      money(handedOver(s)),
      s.counted_at ? signed(s.variance) : 'À compter',
    ]),
    {
      empty: 'Aucun poste clôturé sur la période.',
      totals: r.shifts.length
        ? [['Total', '', '', liters(sum('total_liters')), money(sum('total_amount')), money(sum('credit_amount')), money(sum('expected_amount')), money(round(r.shifts.reduce((a, s) => a + handedOver(s), 0))), signed(sum('variance'))]]
        : [],
    },
  );

  // ---- Products ----
  report.section('Par produit', 'Marge estimée avec le coût moyen des livraisons saisies avec un prix d’achat.');
  report.table(
    [
      { label: 'PRODUIT', width: 120 },
      { label: 'LITRES', width: 80, align: 'right' },
      { label: 'VENTES', width: 85, align: 'right' },
      { label: 'COÛT MOYEN', width: 75, align: 'right' },
      { label: 'MARGE', width: 85, align: 'right' },
      { label: 'MARGE / L', align: 'right' },
    ],
    r.byProduct.map((p) => [p.product, liters(p.liters), money(p.amount), p.avg_cost == null ? '—' : price(p.avg_cost), p.margin == null ? '—' : money(p.margin), p.margin_per_liter == null ? '—' : price(p.margin_per_liter)]),
    { empty: 'Aucune vente sur la période.' },
  );

  // ---- Attendants ----
  report.section('Écarts par pompiste', `Tolérance : ± ${money(cashTolerance)}. Manques et surplus sont comptés à part.`);
  report.table(
    [
      { label: 'POMPISTE', width: 120 },
      { label: 'POSTES', width: 48, align: 'right' },
      { label: 'VENTES', width: 80, align: 'right' },
      { label: 'HORS TOLÉRANCE', width: 78, align: 'right' },
      { label: 'MANQUES', width: 68, align: 'right' },
      { label: 'SURPLUS', width: 60, align: 'right' },
      { label: 'PIRE ÉCART', align: 'right' },
    ],
    r.byAttendant.map((a) => [a.attendant, `${a.shifts}`, money(a.amount), `${a.outside}`, money(a.shortages), money(a.surpluses), signed(a.worst)]),
    { empty: 'Aucun poste sur la période.' },
  );

  // ---- Tanks ----
  report.section('Cuves', 'Perte = écarts de jaugeage négatifs rapportés aux litres vendus.');
  report.table(
    [
      { label: 'CUVE', width: 130 },
      { label: 'LIVRÉ', width: 80, align: 'right' },
      { label: 'VENDU', width: 80, align: 'right' },
      { label: 'ÉCART JAUGEAGE', width: 90, align: 'right' },
      { label: 'PERTE', width: 60, align: 'right' },
      { label: 'STOCK', align: 'right' },
    ],
    r.stock.map((s) => [s.name, liters(s.delivered), liters(s.sold), s.dips ? liters(s.dip_variance) : '—', s.loss_pct == null || !s.dips ? '—' : `${number(s.loss_pct)} %`, liters(s.book_stock)]),
    { empty: 'Aucune cuve.' },
  );

  // ---- Expenses ----
  report.section('Dépenses par catégorie');
  report.table(
    [
      { label: 'CATÉGORIE', width: 260 },
      { label: 'NOMBRE', width: 80, align: 'right' },
      { label: 'MONTANT', align: 'right' },
    ],
    r.expensesByCategory.map((e) => [e.category, `${e.count}`, money(e.amount)]),
    { empty: 'Aucune dépense sur la période.', totals: r.expensesByCategory.length ? [['Total', '', money(t.expenses)]] : [] },
  );

  // ---- Cash book: both accounts over the period, and every movement ----
  if (r.cashbook) {
    report.section('Caisse');
    report.table(
      [
        { label: 'COMPTE', width: 120 },
        { label: 'AU DÉBUT', width: 100, align: 'right' },
        { label: 'ENTRÉES', width: 100, align: 'right' },
        { label: 'SORTIES', width: 100, align: 'right' },
        { label: 'À LA FIN', align: 'right' },
      ],
      r.cashbook.map((b) => [b.accountLabel, money(b.opening), money(b.in), money(b.out), money(b.closing)]),
    );
    const moves = r.cashbook
      .flatMap((b) => b.movements.map((m) => ({ ...m, accountLabel: b.accountLabel })))
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
    report.section('Mouvements de caisse');
    report.table(
      [
        { label: 'DATE', width: 82 },
        { label: 'COMPTE', width: 72 },
        { label: 'LIBELLÉ', width: 220 },
        { label: 'ENTRÉE', width: 70, align: 'right' },
        { label: 'SORTIE', align: 'right' },
      ],
      moves.map((m) => [dateTime(m.at), m.accountLabel, m.label, m.in ? money(m.in) : '', m.out ? money(m.out) : '']),
      {
        empty: 'Aucun mouvement de caisse sur la période.',
        totals: moves.length ? [['Total', '', '', money(round(moves.reduce((t, m) => t + (m.in || 0), 0))), money(round(moves.reduce((t, m) => t + (m.out || 0), 0)))]] : [],
      },
    );
  }

  // ---- Daily sales (several days only) ----
  if (!single) {
    report.section('Ventes par jour');
    report.table(
      [
        { label: 'DATE', width: 140 },
        { label: 'PRODUIT', width: 140 },
        { label: 'LITRES', width: 110, align: 'right' },
        { label: 'MONTANT', align: 'right' },
      ],
      r.byDay.map((d) => [date(d.date), d.product, liters(d.liters), money(d.amount)]),
      { empty: 'Aucune vente sur la période.', totals: r.byDay.length ? [['Total', '', liters(t.liters), money(t.amount)]] : [] },
    );
  }

  return report.finish();
}

module.exports = { periodReportPdf };
