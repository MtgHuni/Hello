// Cash book as a PDF: for each balance (cash, mobile money), the period's summary,
// one line per day and every movement with the running balance.
const { Report, fmt, COLORS } = require('./pdfReport');

const { money, signed, date, dateTime } = fmt;

function cashbookPdf(books, balances, { stationName, from, to, now = new Date() }) {
  const report = new Report({
    title: `Livre de caisse du ${date(from)} au ${date(to)}`,
    stationName,
    heading: 'Livre de caisse',
    subtitle: `Du ${date(from)} au ${date(to)}  ·  espèces et mobile money tenus à part`,
    now,
  });

  report.section('Soldes', 'Le mobile money n’entre dans la caisse que lorsqu’il est retiré.');
  for (const b of books) {
    report.line(`${b.accountLabel} : solde au ${date(from)}`, money(b.opening));
    report.line(`${b.accountLabel} : entrées`, money(b.in));
    report.line(`${b.accountLabel} : sorties`, money(b.out));
    report.line(`${b.accountLabel} : solde au ${date(to)}`, money(b.closing), { bold: true });
    const count = balances[b.account]?.lastCount;
    if (count) {
      report.line(`${b.accountLabel} : dernier comptage (${dateTime(count.created_at)})`, `${money(count.counted)}, écart ${signed(count.diff)}`, {
        color: Math.abs(count.diff) < 0.005 ? COLORS.INK : COLORS.BAD,
      });
    }
  }

  for (const b of books) {
    report.section(`${b.accountLabel} : par jour`);
    report.table(
      [
        { label: 'JOUR', width: 130 },
        { label: 'DÉBUT', width: 95, align: 'right' },
        { label: 'ENTRÉES', width: 95, align: 'right' },
        { label: 'SORTIES', width: 95, align: 'right' },
        { label: 'FIN', align: 'right' },
      ],
      b.days.map((d) => [date(d.day), money(d.start), money(d.in), money(d.out), money(d.end)]),
      { empty: 'Aucun mouvement sur la période.', totals: b.days.length ? [['Total', '', money(b.in), money(b.out), money(b.closing)]] : [] },
    );

    report.section(`${b.accountLabel} : détail`);
    report.table(
      [
        { label: 'DATE', width: 82 },
        { label: 'LIBELLÉ', width: 220 },
        { label: 'ENTRÉE', width: 64, align: 'right' },
        { label: 'SORTIE', width: 64, align: 'right' },
        { label: 'SOLDE', align: 'right' },
      ],
      b.movements.map((m) => [dateTime(m.at), m.label, m.in ? money(m.in) : '', m.out ? money(m.out) : '', money(m.balance)]),
      { size: 8, empty: 'Aucun mouvement sur la période.' },
    );
  }

  return report.finish();
}

module.exports = { cashbookPdf };
