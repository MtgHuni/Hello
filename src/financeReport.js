// The financial report of a period: Claude, as the station's technical and financial adviser, reads
// the period's figures (src/routes/reports.js financeFigures) and writes a short summary and advice.
// Kept in finance_reports; the week before is written and mailed with its PDF every Monday, any other
// period from Rapports → Rapport financier.
const claude = require('./claude');
const { Report, fmt, COLORS } = require('./pdfReport');

const MODEL = process.env.REPORT_MODEL || 'claude-opus-5-5';

const AREAS = { finance: 'Finance', technique: 'Technique' };
const PRIORITIES = { haute: 'Priorité haute', moyenne: 'Priorité moyenne', basse: 'Priorité basse' };

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    advice: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          area: { type: 'string', enum: Object.keys(AREAS) },
          priority: { type: 'string', enum: Object.keys(PRIORITIES) },
          text: { type: 'string' },
        },
        required: ['title', 'area', 'priority', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'advice'],
  additionalProperties: false,
};

const ORDER = { haute: 0, moyenne: 1, basse: 2 };

// { summary, advice } from Claude, the most urgent advice first; null when it gave nothing.
async function financeAdvice({ figures, stationName }) {
  const text = [
    `Tu es le conseiller technique et financier de la station-service ${stationName || ''} à Goma (RD Congo), qui vend du gasoil et de l’essence. Montants en dollars US.`,
    `Tu remets au gérant et à l’actionnaire le rapport financier de la période du ${figures.from} au ${figures.to} (${figures.period.days} jour${figures.period.days > 1 ? 's' : ''}). Ils le lisent sur leur téléphone : sois concret et bref, vouvoie-les.`,
    '',
    'Écris :',
    '- summary : la santé financière de la période en 2 à 4 phrases (ventes, marge, résultat, trésorerie), comparée à la période précédente et à celles d’avant (trend).',
    '- advice : 4 à 7 conseils, les plus importants en premier. Pour chacun : un titre court qui commence par un verbe à l’infinitif ; le domaine (finance ou technique) ; la priorité ; un texte de 2 ou 3 phrases : ce que montrent les chiffres, puis ce qu’il faut faire dans les jours qui viennent, précisément (qui, quoi, combien).',
    '',
    'À examiner :',
    '- finance : marge par litre et par produit, dépenses (les catégories qui montent), résultat, trésorerie face aux dettes fournisseurs, crédits accordés face aux règlements reçus, créances de plus de 30 jours, écarts de caisse par pompiste, valeur du stock ;',
    '- technique : pertes de cuve et écarts de jaugeage, livraisons reçues sous le commandé, jours de stock restants par cuve (rupture ou trop de stock), cuves sans jaugeage, écarts répétés d’un même pompiste (compteurs, procédure), alertes ouvertes.',
    '',
    'Vérifie le bénéfice : profit.expected est le bénéfice qu’il doit y avoir (ventes − coût du carburant vendu − dépenses, sans les paiements aux fournisseurs, déjà dans le coût du carburant) ; profit.gaps sont les écarts mesurés, profit.real le bénéfice après ces écarts. Chaque écart non nul doit apparaître dans un conseil : son montant, d’où il vient (clôtures, jaugeages, factures de livraison : litres payés non reçus ou frais, comptage de la caisse) et ce qu’il faut vérifier ; un manque est en priorité haute. Si profit.uncounted n’est pas vide, l’argent de ces postes n’est pas encore compté : dis-le, le bénéfice réel n’est pas sûr. Si le bénéfice attendu ne peut pas être calculé (prix d’achat manquant), dis-le en priorité haute.',
    '',
    'Règles : appuie chaque constat sur les chiffres fournis, au format français (1 234,50 $ ; 0,085 $/L ; 12 %). N’invente aucune donnée, aucun prix du marché ni de la concurrence. Si une donnée manque (prix d’achat non saisi, aucun jaugeage), dis ce qu’il faut saisir pour la mesurer au lieu de supposer. Priorité « haute » : de l’argent ou du carburant perdu maintenant, ou une rupture proche ; « moyenne » : à traiter dans la semaine ; « basse » : une amélioration. Si la période est courte (quelques jours), tiens compte de ce que si peu de jours peuvent montrer. Pas de salutation, pas de conclusion.',
    '',
    'Repères : period = la période du rapport (partial : son dernier jour, aujourd’hui, n’est pas fini) ; previous = la période d’avant, aussi longue (des mois entiers pour des mois entiers) ; trend = les 6 périodes d’avant, de la plus ancienne à la plus récente ; position = la situation au moment du rapport ; stock = les cuves (sold sur la période, days_left : jours de stock à ce rythme) ; prices = les prix de vente actuels et le coût moyen d’achat ; grossMargin et net sont null quand un prix d’achat manque ; cashTolerance = l’écart de caisse toléré par poste ; profit = la vérification du bénéfice (gaps : caisse, cuves, livraisons, comptages ; amount négatif = perdu, null = sans prix d’achat ; shortLiters = litres commandés mais non reçus) ; money = tous les mouvements d’argent de la période (accounts : espèces et mobile money, solde de début, entrées, sorties, solde de fin ; manual : apports, retraits du propriétaire, entrées et sorties notées à la main).',
    '',
    `Chiffres :\n${JSON.stringify(figures)}`,
  ].join('\n');
  const out = await claude.ask({ model: MODEL, effort: 'high', schema: SCHEMA, maxTokens: 16000, timeoutMs: 240000, content: [{ type: 'text', text }] });
  const summary = out?.summary?.trim();
  const advice = (out?.advice || [])
    .filter((a) => a.title?.trim() && a.text?.trim())
    .map((a) => ({ title: a.title.trim(), area: a.area, priority: a.priority, text: a.text.trim() }))
    .sort((a, b) => ORDER[a.priority] - ORDER[b.priority])
    .slice(0, 8);
  return summary && advice.length ? { summary, advice } : null;
}

const SALE_KIND = { credit: 'Crédit', paid: 'Payée', combo: 'Combos' };
const DELIVERY_PAYMENT = { cash: 'Caisse', shift: 'Argent du poste', credit: 'À crédit', prepaid: 'Déjà payée' };
const capital = (s) => (s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}` : '—');
// A gap's line: the litres for the tanks.
const gapLabel = (g, liters) => (g.key === 'cuves' && g.count ? `${g.label} (${liters(g.liters)})` : g.label);

// « du 5/10/2026 au 11/10/2026 », « du 5/10/2026 » for a single day.
const periodLabel = (from, to, date) => (from === to ? `du ${date(from)}` : `du ${date(from)} au ${date(to)}`);

// The report as a PDF: summary, advice, then the figures they rest on.
function financeReportPdf(r, { stationName, now = new Date() }) {
  const { money, signed, liters, price, number, date, dateTime } = fmt;
  const f = r.figures;
  const w = f.period;
  const p = f.previous;
  const span = periodLabel(r.date_from, r.date_to, date);
  const report = new Report({
    title: `Rapport financier ${span}`,
    stationName,
    heading: 'Rapport financier',
    subtitle: `${span.charAt(0).toUpperCase()}${span.slice(1)}  ·  situation au ${date(r.created_at)}`,
    now,
  });

  report.section('Synthèse');
  report.note(r.summary, { color: COLORS.INK, size: 10.5 });

  // ---- The profit there should be, the gaps measured, the profit left ----
  const pc = f.profit;
  if (pc) {
    const lost = (v) => (v != null && v < -0.005 ? COLORS.BAD : COLORS.INK);
    report.section('Vérification du bénéfice');
    report.line('Ventes (index des compteurs)', money(pc.sales));
    report.line('Coût du carburant vendu', pc.costOfSales == null ? 'prix d’achat manquant' : money(-pc.costOfSales));
    report.line('Marge brute', pc.grossMargin == null ? '—' : money(pc.grossMargin));
    report.line('Dépenses (sans les paiements aux fournisseurs)', money(-pc.expenses));
    report.line('Bénéfice attendu', pc.expected == null ? '—' : money(pc.expected), { bold: true });
    for (const g of pc.gaps) report.line(gapLabel(g, liters), g.amount == null ? 'sans prix d’achat' : signed(g.amount), { color: lost(g.amount) });
    report.line('Bénéfice réel', pc.real == null ? '—' : money(pc.real), { bold: true, color: lost(pc.real) });
    report.line('Écart', pc.gapTotal == null ? '—' : signed(pc.gapTotal), { bold: true, color: lost(pc.gapTotal) });
    if (pc.uncounted.length) report.note(`Argent pas encore compté : poste${pc.uncounted.length > 1 ? 's' : ''} n° ${pc.uncounted.join(', ')}.`, { bold: true, color: COLORS.BAD });
    const short = pc.gaps.find((g) => g.key === 'livraisons')?.shortLiters;
    if (short) report.note(`Litres commandés mais non reçus : ${liters(-short)}.`);
  }

  report.section('Conseils');
  for (const a of r.advice) {
    report.note(a.title, { bold: true, color: COLORS.INK, size: 10.5 });
    report.note(`${AREAS[a.area] || a.area}  ·  ${PRIORITIES[a.priority] || a.priority}`, { size: 9, color: a.priority === 'haute' ? COLORS.BAD : COLORS.GREY });
    report.note(a.text, { color: COLORS.INK, size: 10 });
  }

  report.section('La période');
  const change = (now, before) => (now == null || before == null ? '—' : signed(now - before));
  report.table(
    [{ label: '' }, { label: 'PÉRIODE', align: 'right' }, { label: 'PRÉCÉDENTE', align: 'right' }, { label: 'ÉVOLUTION', align: 'right' }],
    [
      ['Ventes', money(w.amount), money(p.amount), change(w.amount, p.amount)],
      ['Litres vendus', liters(w.liters), liters(p.liters), w.liters - p.liters > 0 ? `+${liters(w.liters - p.liters)}` : liters(w.liters - p.liters)],
      ['Marge brute estimée', w.grossMargin == null ? '—' : money(w.grossMargin), p.grossMargin == null ? '—' : money(p.grossMargin), change(w.grossMargin, p.grossMargin)],
      ['Dépenses', money(w.expenses), money(p.expenses), change(w.expenses, p.expenses)],
      ['Résultat net estimé', w.net == null ? '—' : money(w.net), p.net == null ? '—' : money(p.net), change(w.net, p.net)],
      ['Vendu à crédit', money(w.credit), money(p.credit), change(w.credit, p.credit)],
      ['Règlements reçus', money(w.payments), money(p.payments), change(w.payments, p.payments)],
      ['Écarts de caisse', signed(w.variance), signed(p.variance), change(w.variance, p.variance)],
    ],
  );

  // ---- Every money movement, in totals ----
  const m = f.money;
  if (m) {
    report.section('Mouvements d’argent');
    report.table(
      [{ label: 'COMPTE' }, { label: 'DÉBUT', align: 'right' }, { label: 'ENTRÉES', align: 'right' }, { label: 'SORTIES', align: 'right' }, { label: 'FIN', align: 'right' }],
      m.accounts.map((a) => [a.account, money(a.opening), money(a.in), money(a.out), money(a.closing)]),
    );
    report.line('Ventes (index des compteurs)', money(m.sales));
    report.line('Espèces remises aux clôtures', money(m.paidCash));
    report.line('Mobile money des postes', money(m.mobileMoney));
    report.line('Vendu à crédit', money(m.credit));
    if (m.combos) report.line('Échangé contre des combos', money(m.combos));
    report.line('Règlements de clients reçus', money(m.payments));
    report.line('Dépenses', money(m.expenses));
    report.line(`Livraisons (${m.deliveries.count}, ${liters(m.deliveries.liters)})`, money(m.deliveries.amount));
    report.line('Paiements aux fournisseurs', money(m.supplierPayments));
    for (const x of m.manual) report.line(`${x.label} (${x.account.toLowerCase()}, ${x.count})`, money(x.amount));
  }

  report.section('Situation');
  const s = f.position;
  report.line('Espèces en caisse', money(s.cash));
  report.line('Mobile money', money(s.mobileMoney));
  report.line('Dû par les clients', money(s.receivables));
  report.line('dont plus de 30 jours', money(s.receivablesOld), { color: s.receivablesOld > 0 ? COLORS.BAD : COLORS.INK });
  report.line('Dû aux fournisseurs', money(s.supplierDebt), { color: s.supplierDebt > 0 ? COLORS.BAD : COLORS.INK });
  report.line('Valeur du stock (coût d’achat)', s.stockValue == null ? '—' : money(s.stockValue));

  report.section('Par produit');
  report.table(
    [{ label: 'PRODUIT' }, { label: 'LITRES', align: 'right' }, { label: 'VENTES', align: 'right' }, { label: 'COÛT MOYEN', align: 'right' }, { label: 'MARGE / L', align: 'right' }, { label: 'MARGE', align: 'right' }],
    w.byProduct.map((x) => [x.product, liters(x.liters), money(x.amount), x.avg_cost == null ? '—' : price(x.avg_cost), x.margin_per_liter == null ? '—' : price(x.margin_per_liter), x.margin == null ? '—' : money(x.margin)]),
    { empty: 'Aucune vente sur la période.' },
  );

  report.section('Cuves');
  report.table(
    [{ label: 'CUVE' }, { label: 'STOCK', align: 'right' }, { label: 'VENDU', align: 'right' }, { label: 'JOURS', align: 'right' }, { label: 'PERTE', align: 'right' }],
    f.stock.map((t) => [t.tank, liters(t.stock), liters(t.sold), t.days_left == null ? '—' : number(t.days_left), t.dips && t.loss_pct != null ? `${number(t.loss_pct)} %` : '—']),
    { empty: 'Aucune cuve.' },
  );

  report.section('Dépenses');
  report.table(
    [{ label: 'CATÉGORIE' }, { label: 'NOMBRE', align: 'right' }, { label: 'MONTANT', align: 'right' }],
    w.expensesByCategory.map((e) => [e.category, String(e.count), money(e.amount)]),
    { empty: 'Aucune dépense sur la période.' },
  );

  report.section('Pompistes');
  report.table(
    [{ label: 'POMPISTE' }, { label: 'POSTES', align: 'right' }, { label: 'HORS TOLÉRANCE', align: 'right' }, { label: 'MANQUES', align: 'right' }, { label: 'SURPLUS', align: 'right' }],
    w.byAttendant.map((x) => [x.attendant, String(x.shifts), String(x.outside), money(x.shortages), money(x.surpluses)]),
    { empty: 'Aucun poste sur la période.' },
  );

  // ---- Every line of the period ----
  const l = r.ledger;
  if (l) {
    const total = (list, key) => money(list.reduce((a, x) => a + (x[key] || 0), 0));
    const g = l.gaps || {};
    report.section('Écarts : le détail');
    if (!['caisse', 'cuves', 'livraisons', 'comptages'].some((k) => g[k]?.length)) report.note('Aucun écart sur la période.');
    if (g.caisse?.length) {
      report.note('Clôtures', { bold: true, color: COLORS.INK });
      report.table(
        [{ label: 'N°', width: 26 }, { label: 'POMPISTE' }, { label: 'CLÔTURE' }, { label: 'ÉCART', align: 'right' }],
        g.caisse.map((x) => [String(x.shift), x.attendant, dateTime(x.at), signed(x.amount)]),
        { totals: [['', 'Total', '', signed(g.caisse.reduce((a, x) => a + x.amount, 0))]] },
      );
    }
    if (g.cuves?.length) {
      report.note('Jaugeages', { bold: true, color: COLORS.INK });
      report.table(
        [{ label: 'DATE' }, { label: 'CUVE' }, { label: 'AU LIVRE', align: 'right' }, { label: 'MESURÉ', align: 'right' }, { label: 'ÉCART', align: 'right' }, { label: 'VALEUR', align: 'right' }],
        g.cuves.map((x) => [dateTime(x.at), x.tank, liters(x.book), liters(x.measured), liters(x.liters), x.amount == null ? '—' : signed(x.amount)]),
      );
    }
    if (g.livraisons?.length) {
      report.note('Livraisons', { bold: true, color: COLORS.INK });
      report.table(
        [{ label: 'DATE' }, { label: 'CUVE' }, { label: 'FOURNISSEUR' }, { label: 'COMMANDÉ', align: 'right' }, { label: 'REÇU', align: 'right' }, { label: 'PRIX', align: 'right' }, { label: 'PAYÉ', align: 'right' }, { label: 'ÉCART', align: 'right' }],
        g.livraisons.map((x) => [date(x.at), x.tank, x.supplier || '—', liters(x.ordered), liters(x.received), price(x.unit_cost), money(x.paid), signed(x.amount)]),
      );
    }
    if (g.comptages?.length) {
      report.note('Comptages de la caisse', { bold: true, color: COLORS.INK });
      report.table(
        [{ label: 'DATE' }, { label: 'COMPTE' }, { label: 'COMPTÉ', align: 'right' }, { label: 'AU LIVRE', align: 'right' }, { label: 'ÉCART', align: 'right' }, { label: 'DÉJÀ AVANT', align: 'right' }],
        g.comptages.map((x) => [dateTime(x.at), x.account, money(x.counted), money(x.book), signed(x.diff), x.carried ? signed(x.carried) : '—']),
      );
    }

    report.section('Postes clôturés');
    report.table(
      [{ label: 'N°', width: 26 }, { label: 'POMPISTE', width: 80 }, { label: 'CLÔTURE' }, { label: 'VENTES', align: 'right' }, { label: 'CRÉDITS', align: 'right' }, { label: 'À REMETTRE', align: 'right' }, { label: 'ESPÈCES', align: 'right' }, { label: 'MOBILE M.', align: 'right' }, { label: 'ÉCART', align: 'right' }],
      l.shifts.map((x) => [String(x.id), x.attendant, dateTime(x.closed_at), money(x.total_amount), money(x.credit_amount), money(x.expected_amount), x.variance == null ? 'à compter' : money(x.cash), money(x.mobile_money), x.variance == null ? '—' : signed(x.variance)]),
      { empty: 'Aucun poste clôturé sur la période.', totals: l.shifts.length ? [['', 'Total', '', total(l.shifts, 'total_amount'), total(l.shifts, 'credit_amount'), total(l.shifts, 'expected_amount'), total(l.shifts, 'cash'), total(l.shifts, 'mobile_money'), signed(l.shifts.reduce((a, x) => a + (x.variance || 0), 0))]] : [] },
    );

    report.section('Ventes par jour', 'Calculées par les index des compteurs.');
    report.table(
      [{ label: 'DATE' }, { label: 'PRODUIT' }, { label: 'LITRES', align: 'right' }, { label: 'MONTANT', align: 'right' }],
      l.salesByDay.map((x) => [date(x.date), x.product, liters(x.liters), money(x.amount)]),
      { empty: 'Aucune vente sur la période.', totals: l.salesByDay.length ? [['Total', '', liters(l.salesByDay.reduce((a, x) => a + x.liters, 0)), total(l.salesByDay, 'amount')]] : [] },
    );

    report.section('Ventes enregistrées', 'Crédits, combos et crédits payés dans leur poste.');
    report.table(
      [{ label: 'DATE' }, { label: 'CLIENT' }, { label: 'PRODUIT' }, { label: 'TYPE' }, { label: 'LITRES', align: 'right' }, { label: 'MONTANT', align: 'right' }],
      l.sales.map((x) => [dateTime(x.at), x.customer || '—', x.product, SALE_KIND[x.kind] || x.kind, liters(x.liters), money(x.amount)]),
      { empty: 'Aucune vente enregistrée sur la période.', totals: l.sales.length ? [['Total', '', '', '', liters(l.sales.reduce((a, x) => a + x.liters, 0)), total(l.sales, 'amount')]] : [] },
    );

    report.section('Règlements reçus');
    report.table(
      [{ label: 'DATE' }, { label: 'CLIENT' }, { label: 'MODE' }, { label: 'MONTANT', align: 'right' }],
      l.payments.map((x) => [dateTime(x.at), x.customer || '—', capital(x.method), money(x.amount)]),
      { empty: 'Aucun règlement sur la période.', totals: l.payments.length ? [['Total', '', '', total(l.payments, 'amount')]] : [] },
    );

    report.section('Dépenses : chaque ligne');
    report.table(
      [{ label: 'DATE' }, { label: 'CATÉGORIE' }, { label: 'DESCRIPTION', width: 140 }, { label: 'PAYÉ À' }, { label: 'MONTANT', align: 'right' }],
      l.expenses.map((x) => [date(x.day), x.category, x.description || '—', x.beneficiary || '—', money(x.amount)]),
      { empty: 'Aucune dépense sur la période.', totals: l.expenses.length ? [['Total', '', '', '', total(l.expenses, 'amount')]] : [] },
    );

    report.section('Livraisons');
    report.table(
      [{ label: 'DATE' }, { label: 'CUVE' }, { label: 'FOURNISSEUR' }, { label: 'REÇU', align: 'right' }, { label: 'PRIX', align: 'right' }, { label: 'MONTANT', align: 'right' }, { label: 'PAIEMENT' }],
      l.deliveries.map((x) => [date(x.at), x.tank, x.supplier || '—', liters(x.received), x.unit_cost == null ? '—' : price(x.unit_cost), x.amount == null ? '—' : money(x.amount), DELIVERY_PAYMENT[x.payment] || '—']),
      { empty: 'Aucune livraison sur la période.', totals: l.deliveries.length ? [['Total', '', '', liters(l.deliveries.reduce((a, x) => a + x.received, 0)), '', total(l.deliveries, 'amount'), '']] : [] },
    );

    report.section('Paiements aux fournisseurs');
    report.table(
      [{ label: 'DATE' }, { label: 'FOURNISSEUR' }, { label: 'MODE' }, { label: 'MONTANT', align: 'right' }],
      l.supplierPayments.map((x) => [dateTime(x.at), x.supplier, capital(x.method), money(x.amount)]),
      { empty: 'Aucun paiement à un fournisseur sur la période.', totals: l.supplierPayments.length ? [['Total', '', '', total(l.supplierPayments, 'amount')]] : [] },
    );

    for (const b of l.cashbook) {
      report.section(`Livre de caisse : ${b.account.toLowerCase()}`);
      report.line('Solde au début de la période', money(b.opening), { bold: true });
      report.table(
        [{ label: 'DATE' }, { label: 'MOUVEMENT', width: 220 }, { label: 'ENTRÉE', align: 'right' }, { label: 'SORTIE', align: 'right' }, { label: 'SOLDE', align: 'right' }],
        b.movements.map((x) => [dateTime(x.at), x.label, x.in ? money(x.in) : '', x.out ? money(x.out) : '', money(x.balance)]),
        { empty: 'Aucun mouvement sur la période.', totals: b.movements.length ? [['Total', '', money(b.in), money(b.out), money(b.closing)]] : [] },
      );
      report.line('Solde à la fin de la période', money(b.closing), { bold: true });
    }
  }

  return report.finish();
}

module.exports = { financeAdvice, financeReportPdf, periodLabel, AREAS, PRIORITIES };
