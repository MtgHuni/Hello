// An agent's payslip for a month (Agents → the agent → the month's « Partager »): the salary, what the
// month before left, each advance and each payment, and what remains.
const { Report, fmt, COLORS } = require('./pdfReport');
const { monthLabel } = require('./payroll');

const SOURCE = { espèces: 'Espèces', 'mobile money': 'Mobile money' };
const sourceLabel = (e) => (e.source === 'poste' ? `Argent du poste n°${e.shift_id}` : SOURCE[e.source] || e.source);

function payslipPdf({ staff, sheet, stationName, now }) {
  const month = monthLabel(sheet.month);
  const report = new Report({
    title: `Bulletin de paie ${month}`,
    stationName,
    heading: 'Bulletin de paie',
    subtitle: `${staff.name}  ·  ${staff.function}  ·  ${month.charAt(0).toUpperCase()}${month.slice(1)}`,
    now,
  });
  const s = sheet.salary;

  report.section('Salaire');
  report.line('Salaire mensuel', fmt.money(s.base));
  if (s.days < s.daysInMonth) report.line('Jours comptés', `${s.days} sur ${s.daysInMonth}`);
  report.line('Salaire du mois', fmt.money(s.amount), { bold: true });
  if (sheet.carried > 0.005) report.line('Reste dû du mois d’avant', fmt.money(sheet.carried));
  if (sheet.carried < -0.005) report.line('Avancé en trop le mois d’avant', fmt.money(-sheet.carried), { color: COLORS.BAD });

  const columns = [{ label: 'Date', width: 1 }, { label: 'D’où', width: 2 }, { label: 'Montant', align: 'right', width: 1 }];
  for (const [title, list, total, empty] of [
    ['Avances', sheet.advances, sheet.advanced, 'Aucune avance ce mois.'],
    ['Paiements', sheet.payments, sheet.paid, 'Aucun paiement ce mois.'],
  ]) {
    report.section(title);
    report.table(
      columns,
      list.map((e) => [fmt.date(e.expense_date), sourceLabel(e), fmt.money(e.amount)]),
      { totals: list.length > 1 ? [['Total', '', fmt.money(total)]] : [], empty },
    );
  }

  report.section('Reste');
  report.line('Payé pour ce mois', fmt.money(sheet.advanced + sheet.paid));
  if (sheet.net < -0.005) report.line('Avancé en trop', fmt.money(-sheet.net), { bold: true, color: COLORS.BAD });
  // A rest paid with the next month is not owed any more.
  else if (sheet.due < 0.005 && sheet.net > 0.005) report.line('Reporté au mois suivant', fmt.money(sheet.net), { bold: true });
  else report.line('Reste à payer', fmt.money(sheet.due), { bold: true, color: sheet.due > 0.005 ? COLORS.BAD : COLORS.INK });
  return report.finish();
}

module.exports = { payslipPdf };
