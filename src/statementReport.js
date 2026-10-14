// A customer's statement as a PDF over a period (a whole month reads « Relevé d'octobre 2026 »):
// balance at the start and end, credit purchases and payments, and what a subscriber owes from earlier months.
const { Report, fmt, COLORS } = require('./pdfReport');
const { round } = require('./util');

const { money, dateTime } = fmt;

const day = (iso) => new Date(`${iso}T12:00:00Z`);

function statementPdf(acc, { stationName, from, to, graceDays, now = new Date() }) {
  const c = acc.customer;
  const end = day(to);
  end.setUTCDate(end.getUTCDate() + 1);
  const wholeMonth = from.endsWith('-01') && from.slice(0, 7) === to.slice(0, 7) && end.getUTCDate() === 1;
  const short = (iso) => day(iso).toLocaleDateString('fr-FR', { timeZone: 'UTC' });
  const heading = wholeMonth
    ? `Relevé de ${day(from).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`
    : `Relevé du ${short(from)} au ${short(to)}`;
  const of = wholeMonth ? 'du mois' : 'de la période';
  const report = new Report({
    title: `${heading} — ${c.name}`,
    stationName,
    heading,
    subtitle: [c.name, c.type === 'account' ? 'abonné' : 'particulier', c.phone, c.plate].filter(Boolean).join('  ·  '),
    now,
  });
  const debits = round(acc.movements.reduce((t, m) => t + m.debit, 0));

  report.section('Solde');
  report.line(`Solde au début ${of}`, money(acc.opening));
  report.line(`+ Achats à crédit ${of}`, money(debits));
  report.line(`− Règlements ${of}`, money(acc.totals.payments));
  report.line(`Solde à la fin ${of}`, money(acc.closing), { bold: true });
  if (acc.dues?.overdue > 0) {
    report.line(
      acc.dues.late ? 'Dû des mois précédents, en retard' : `Dû des mois précédents, à payer avant le ${acc.dues.paymentDay || graceDays} du mois`,
      money(acc.dues.overdue),
      { bold: true, color: acc.dues.late ? COLORS.BAD : COLORS.INK },
    );
  }

  report.section(`Mouvements ${of}`, 'Les règlements soldent d’abord les achats à crédit les plus anciens.');
  report.table(
    [
      { label: 'DATE', width: 78 },
      { label: 'DÉTAIL', width: 233 },
      { label: 'ACHAT', width: 66, align: 'right' },
      { label: 'RÈGLEMENT', width: 66, align: 'right' },
      { label: 'SOLDE', align: 'right' },
    ],
    acc.movements.map((m) => [dateTime(m.date), m.label, m.debit ? money(m.debit) : '', m.credit ? money(m.credit) : '', money(m.balance)]),
    { empty: 'Aucun mouvement sur cette période.', totals: acc.movements.length ? [[`Total ${of}`, '', money(debits), money(acc.totals.payments), money(acc.closing)]] : [] },
  );

  report.note(`Merci de régler votre solde auprès de ${stationName}.`);
  return report.finish();
}

module.exports = { statementPdf };
