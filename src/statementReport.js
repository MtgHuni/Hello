// A customer's monthly statement as a PDF: balance at the start and end of the month,
// credit purchases and payments, and what a subscriber owes from earlier months.
const { Report, fmt, COLORS } = require('./pdfReport');
const { round } = require('./util');

const { money, dateTime } = fmt;

function statementPdf(acc, { stationName, month, graceDays, now = new Date() }) {
  const c = acc.customer;
  const monthLabel = new Date(`${month}-01T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const report = new Report({
    title: `Relevé de ${monthLabel} — ${c.name}`,
    stationName,
    heading: `Relevé de ${monthLabel}`,
    subtitle: [c.name, c.type === 'account' ? 'abonné' : 'particulier', c.phone, c.plate].filter(Boolean).join('  ·  '),
    now,
  });
  const debits = round(acc.movements.reduce((t, m) => t + m.debit, 0));

  report.section('Solde');
  report.line('Solde au début du mois', money(acc.opening));
  report.line('+ Achats à crédit du mois', money(debits));
  report.line('− Règlements du mois', money(acc.totals.payments));
  report.line('Solde à la fin du mois', money(acc.closing), { bold: true });
  if (acc.dues?.overdue > 0) {
    report.line(
      acc.dues.late ? 'Dû des mois précédents, en retard' : `Dû des mois précédents, à payer avant le ${graceDays} du mois`,
      money(acc.dues.overdue),
      { bold: true, color: acc.dues.late ? COLORS.BAD : COLORS.INK },
    );
  }

  report.section('Mouvements du mois', 'Les règlements soldent d’abord les achats à crédit les plus anciens.');
  report.table(
    [
      { label: 'DATE', width: 78 },
      { label: 'DÉTAIL', width: 233 },
      { label: 'ACHAT', width: 66, align: 'right' },
      { label: 'RÈGLEMENT', width: 66, align: 'right' },
      { label: 'SOLDE', align: 'right' },
    ],
    acc.movements.map((m) => [dateTime(m.date), m.label, m.debit ? money(m.debit) : '', m.credit ? money(m.credit) : '', money(m.balance)]),
    { size: 8.5, empty: 'Aucun mouvement ce mois-ci.', totals: acc.movements.length ? [['Total du mois', '', money(debits), money(acc.totals.payments), money(acc.closing)]] : [] },
  );

  report.note(`Merci de régler votre solde auprès de ${stationName}.`);
  return report.finish();
}

module.exports = { statementPdf };
