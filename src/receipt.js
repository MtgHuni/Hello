// A customer's receipt (the « Reçu » after a credit or a payment, shared on WhatsApp as a PDF):
// what was taken or paid, and what the customer owes now.
const { Report, fmt, COLORS } = require('./pdfReport');

const METHOD = { espèces: 'Espèces', 'mobile money': 'Mobile money' };

// kind 'credit': `sale`; kind 'payment': `settled` (credits of the shift paid at the pump) and/or `payment`.
function receiptPdf({ stationName, stationPhone, customer, kind, sale, settled = [], payment, method, balance, now = new Date() }) {
  const at = sale?.created_at || payment?.created_at || settled[0]?.created_at;
  const report = new Report({
    title: kind === 'credit' ? 'Reçu de crédit' : 'Reçu de règlement',
    stationName,
    heading: kind === 'credit' ? 'Reçu de crédit' : 'Reçu de règlement',
    subtitle: [customer.name, customer.phone, at ? fmt.dateTime(at) : null].filter(Boolean).join('  ·  '),
    now,
  });

  if (kind === 'credit') {
    report.section('Crédit');
    report.line('Carburant', sale.product_name);
    report.line('Litres', fmt.liters(sale.liters));
    report.line('Prix au litre', `${fmt.price(sale.unit_price)} $`);
    if (sale.plate) report.line('Plaque', sale.plate);
    report.line('Montant', fmt.money(sale.amount), { bold: true });
  } else {
    report.section('Règlement');
    for (const s of settled) report.line(`Crédit payé · ${s.product_name} · ${fmt.liters(s.liters)}`, fmt.money(s.amount));
    if (payment && settled.length) report.line('Versé sur le compte', fmt.money(payment.amount));
    const total = settled.reduce((t, s) => t + s.amount, 0) + (payment?.amount || 0);
    report.line('Montant payé', fmt.money(total), { bold: true });
    const how = payment?.method || method;
    if (how) report.line('Mode', METHOD[how] || how);
    if (payment?.reference) report.line('Référence', payment.reference);
  }

  report.section('Compte');
  if (balance > 0.005) report.line('Reste dû', fmt.money(balance), { bold: true, color: COLORS.BAD });
  else if (balance < -0.005) report.line('Avance', fmt.money(-balance), { bold: true });
  else report.line('Solde', fmt.money(0), { bold: true });
  if (stationPhone) report.line('Station', stationPhone);
  return report.finish();
}

module.exports = { receiptPdf };
