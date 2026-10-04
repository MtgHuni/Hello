import { api } from '../api.js';
import { h, fmt, pageHeader, table, segmented, kpi, field, button, todayISO, isoDate, varianceCell, setContent } from '../ui.js';

export const PRESETS = [
  ['today', "Aujourd'hui"],
  ['7d', '7 jours'],
  ['month', 'Ce mois'],
  ['lastMonth', 'Mois dernier'],
];

export function presetRange(key) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (key) {
    case 'today':
      return { from: todayISO(), to: todayISO() };
    case '7d':
      return { from: isoDate(new Date(y, m, now.getDate() - 6)), to: todayISO() };
    case 'lastMonth':
      return { from: isoDate(new Date(y, m - 1, 1)), to: isoDate(new Date(y, m, 0)) };
    default:
      return { from: isoDate(new Date(y, m, 1)), to: todayISO() };
  }
}

let preset = 'month';
let range = presetRange(preset);

export async function renderReports(page, ctx) {
  const r = await api.get(`/reports/sales?from=${range.from}&to=${range.to}`);
  const tol = ctx.state.settings.cashTolerance;
  const reload = () => renderReports(page, ctx);

  const from = field({ name: 'from', label: 'Du', type: 'date', value: range.from });
  const to = field({ name: 'to', label: 'Au', type: 'date', value: range.to });
  const onDate = () => {
    preset = null;
    range = { from: from.querySelector('input').value, to: to.querySelector('input').value };
    if (range.from && range.to) reload();
  };
  from.querySelector('input').addEventListener('change', onDate);
  to.querySelector('input').addEventListener('change', onDate);

  const t = r.totals;
  setContent(page, 
    pageHeader(
      'Rapports',
      range.from === range.to ? fmt.longDay(range.from) : `Du ${fmt.date(range.from)} au ${fmt.date(range.to)}`,
      h('a', { class: 'btn secondary', href: `/api/reports/sales?from=${range.from}&to=${range.to}&format=csv` }, 'Exporter (Excel)'),
      button('Imprimer / PDF', () => window.print(), { variant: 'secondary' }),
    ),
    h(
      'div',
      { class: 'row no-print', style: 'align-items:flex-end;margin-bottom:24px' },
      segmented(PRESETS, preset, (v) => {
        preset = v;
        range = presetRange(v);
        reload();
      }),
      h('span', { class: 'spacer' }),
      from,
      to,
    ),
    h(
      'div',
      { class: 'grid grid-4' },
      kpi("Chiffre d'affaires", fmt.money(t.amount), fmt.liters(t.liters)),
      kpi('Encaissé', fmt.money(t.cash + t.card), `Espèces ${fmt.money(t.cash)} · Cartes ${fmt.money(t.card)}`),
      kpi('Vendu à crédit', fmt.money(t.credit), `Règlements reçus : ${fmt.money(t.payments)}${t.combos ? ` · combos échangés : ${fmt.money(t.combos)}` : ''}`),
      kpi('Écarts de caisse', varianceCell(t.variance, tol), 'Cumul de la période'),
    ),
    h(
      'div',
      { class: 'grid grid-3 section' },
      kpi('Marge brute estimée', fmt.money(t.grossMargin), t.costKnown ? 'Ventes − coût d’achat du carburant' : 'Prix d’achat manquant pour un produit : saisissez-le dans les livraisons'),
      kpi('Dépenses', fmt.money(t.expenses), r.expensesByCategory[0] ? `Surtout : ${r.expensesByCategory[0].category}` : 'Aucune dépense'),
      kpi('Résultat net estimé', h('span', { class: t.net < 0 ? 'variance-neg' : '' }, fmt.money(t.net)), 'Marge brute − dépenses'),
    ),
    h(
      'div',
      { class: 'grid grid-2 section' },
      h(
        'section',
        { class: 'card flush' },
        h('div', { class: 'card-header' }, h('h2', {}, 'Par produit')),
        table(
          [
            { label: 'Produit', key: 'product' },
            { label: 'Litres', align: 'right', render: (x) => fmt.liters(x.liters) },
            { label: 'Montant', align: 'right', render: (x) => fmt.money(x.amount) },
            { label: 'Coût moyen', align: 'right', render: (x) => (x.avg_cost == null ? '—' : fmt.price(x.avg_cost)) },
            { label: 'Marge', align: 'right', render: (x) => (x.margin == null ? '—' : fmt.money(x.margin)) },
            { label: 'Marge / L', align: 'right', render: (x) => (x.margin_per_liter == null ? '—' : fmt.price(x.margin_per_liter)) },
          ],
          r.byProduct,
          { empty: 'Aucune vente sur la période.' },
        ),
      ),
      h(
        'section',
        { class: 'card flush' },
        h('div', { class: 'card-header' }, h('h2', {}, 'Par pompiste')),
        table(
          [
            { label: 'Pompiste', key: 'attendant' },
            { label: 'Postes', align: 'right', key: 'shifts' },
            { label: 'Ventes', align: 'right', render: (x) => fmt.money(x.amount) },
            { label: 'Écarts', align: 'right', render: (x) => varianceCell(x.variance, tol) },
          ],
          r.byAttendant,
          { empty: 'Aucun poste sur la période.' },
        ),
      ),
    ),
    h(
      'section',
      { class: 'card flush section' },
      h('div', { class: 'card-header' }, h('h2', {}, 'Ventes par jour')),
      table(
        [
          { label: 'Date', key: 'date', render: (x) => fmt.longDay(x.date) },
          { label: 'Produit', key: 'product' },
          { label: 'Litres', key: 'liters', align: 'right', render: (x) => fmt.liters(x.liters) },
          { label: 'Montant', key: 'amount', align: 'right', render: (x) => fmt.money(x.amount) },
        ],
        r.byDay,
        { empty: 'Aucune vente sur la période.', footer: r.byDay.length ? { date: 'Total', liters: fmt.liters(t.liters), amount: fmt.money(t.amount) } : null },
      ),
    ),
    h(
      'section',
      { class: 'card flush section' },
      h('div', { class: 'card-header' }, h('h2', {}, 'Dépenses par catégorie'), h('a', { class: 'btn ghost sm no-print', href: '#/depenses' }, 'Voir le détail')),
      table(
        [
          { label: 'Catégorie', key: 'category' },
          { label: 'Nombre', align: 'right', key: 'count' },
          { label: 'Montant', align: 'right', key: 'amount', render: (x) => fmt.money(x.amount) },
          { label: 'Part', align: 'right', render: (x) => (t.expenses ? `${Math.round((x.amount / t.expenses) * 100)} %` : '—') },
        ],
        r.expensesByCategory,
        { empty: 'Aucune dépense sur la période.', footer: r.expensesByCategory.length ? { category: 'Total', amount: fmt.money(t.expenses) } : null },
      ),
    ),
    h(
      'section',
      { class: 'card flush section' },
      h('div', { class: 'card-header' }, h('h2', {}, 'Livraisons reçues')),
      table(
        [
          { label: 'Produit', key: 'product' },
          { label: 'Litres reçus', align: 'right', render: (x) => fmt.liters(x.liters) },
          { label: 'Manquants', align: 'right', render: (x) => (x.shortfall < 0 ? h('span', { class: 'variance-neg' }, fmt.liters(x.shortfall)) : '—') },
          { label: 'Coût d’achat', align: 'right', render: (x) => (x.cost ? fmt.money(x.cost) : '—') },
        ],
        r.deliveries,
        { empty: 'Aucune livraison sur la période.' },
      ),
    ),
  );
}

