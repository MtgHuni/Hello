// The week's financial report: Claude, as the station's technical and financial adviser, reads the
// week's figures (src/routes/reports.js financeFigures) and writes a short summary and advice.
// Kept in finance_reports, mailed on Monday with its PDF, shown in Rapports → Rapport financier.
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
    'Chaque lundi, tu remets au gérant et à l’actionnaire le rapport financier de la semaine écoulée (du lundi au dimanche). Ils le lisent sur leur téléphone : sois concret et bref, vouvoie-les.',
    '',
    'Écris :',
    '- summary : la santé financière de la semaine en 2 à 4 phrases (ventes, marge, résultat, trésorerie), comparée à la semaine précédente et aux semaines d’avant (trend).',
    '- advice : 4 à 7 conseils, les plus importants en premier. Pour chacun : un titre court qui commence par un verbe à l’infinitif ; le domaine (finance ou technique) ; la priorité ; un texte de 2 ou 3 phrases : ce que montrent les chiffres, puis ce qu’il faut faire cette semaine, précisément (qui, quoi, combien).',
    '',
    'À examiner :',
    '- finance : marge par litre et par produit, dépenses (les catégories qui montent), résultat, trésorerie face aux dettes fournisseurs, crédits accordés face aux règlements reçus, créances de plus de 30 jours, écarts de caisse par pompiste, valeur du stock ;',
    '- technique : pertes de cuve et écarts de jaugeage, livraisons reçues sous le commandé, jours de stock restants par cuve (rupture ou trop de stock), cuves sans jaugeage, écarts répétés d’un même pompiste (compteurs, procédure), alertes ouvertes.',
    '',
    'Règles : appuie chaque constat sur les chiffres fournis, au format français (1 234,50 $ ; 0,085 $/L ; 12 %). N’invente aucune donnée, aucun prix du marché ni de la concurrence. Si une donnée manque (prix d’achat non saisi, aucun jaugeage), dis ce qu’il faut saisir pour la mesurer au lieu de supposer. Priorité « haute » : de l’argent ou du carburant perdu maintenant, ou une rupture proche ; « moyenne » : à traiter dans la semaine ; « basse » : une amélioration. Pas de salutation, pas de conclusion.',
    '',
    'Repères : week = la semaine du rapport ; previous = la semaine d’avant ; trend = les 6 semaines d’avant, de la plus ancienne à la plus récente ; position = la situation au moment du rapport ; stock = les cuves (days_left : jours de stock au rythme de la semaine) ; prices = les prix de vente actuels et le coût moyen d’achat ; grossMargin et net sont null quand un prix d’achat manque ; cashTolerance = l’écart de caisse toléré par poste.',
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

// The report as a PDF: summary, advice, then the figures they rest on.
function financeReportPdf(r, { stationName, now = new Date() }) {
  const { money, signed, liters, price, number, date } = fmt;
  const f = r.figures;
  const w = f.week;
  const p = f.previous;
  const report = new Report({
    title: `Rapport financier du ${date(r.week_from)} au ${date(r.week_to)}`,
    stationName,
    heading: 'Rapport financier',
    subtitle: `Semaine du ${date(r.week_from)} au ${date(r.week_to)}  ·  situation au ${date(r.created_at)}`,
    now,
  });

  report.section('Synthèse');
  report.note(r.summary, { color: COLORS.INK, size: 10.5 });

  report.section('Conseils');
  for (const a of r.advice) {
    report.note(a.title, { bold: true, color: COLORS.INK, size: 10.5 });
    report.note(`${AREAS[a.area] || a.area}  ·  ${PRIORITIES[a.priority] || a.priority}`, { size: 9, color: a.priority === 'haute' ? COLORS.BAD : COLORS.GREY });
    report.note(a.text, { color: COLORS.INK, size: 10 });
  }

  report.section('La semaine');
  const change = (now, before) => (now == null || before == null ? '—' : signed(now - before));
  report.table(
    [{ label: '' }, { label: 'SEMAINE', align: 'right' }, { label: 'PRÉCÉDENTE', align: 'right' }, { label: 'ÉVOLUTION', align: 'right' }],
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
    { empty: 'Aucune vente sur la semaine.' },
  );

  report.section('Cuves');
  report.table(
    [{ label: 'CUVE' }, { label: 'STOCK', align: 'right' }, { label: 'VENDU', align: 'right' }, { label: 'JOURS', align: 'right' }, { label: 'PERTE', align: 'right' }],
    f.stock.map((t) => [t.tank, liters(t.stock), liters(t.sold_week), t.days_left == null ? '—' : number(t.days_left), t.dips_week && t.loss_pct != null ? `${number(t.loss_pct)} %` : '—']),
    { empty: 'Aucune cuve.' },
  );

  report.section('Dépenses');
  report.table(
    [{ label: 'CATÉGORIE' }, { label: 'NOMBRE', align: 'right' }, { label: 'MONTANT', align: 'right' }],
    w.expensesByCategory.map((e) => [e.category, String(e.count), money(e.amount)]),
    { empty: 'Aucune dépense sur la semaine.' },
  );

  report.section('Pompistes');
  report.table(
    [{ label: 'POMPISTE' }, { label: 'POSTES', align: 'right' }, { label: 'HORS TOLÉRANCE', align: 'right' }, { label: 'MANQUES', align: 'right' }, { label: 'SURPLUS', align: 'right' }],
    w.byAttendant.map((x) => [x.attendant, String(x.shifts), String(x.outside), money(x.shortages), money(x.surpluses)]),
    { empty: 'Aucun poste sur la semaine.' },
  );

  return report.finish();
}

module.exports = { financeAdvice, financeReportPdf, AREAS, PRIORITIES };
