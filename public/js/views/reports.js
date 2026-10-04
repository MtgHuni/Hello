import { api } from '../api.js';
import { h, fmt, pageHeader, table, segmented, kpi, field, todayISO, isoDate, varianceCell, setContent } from '../ui.js';
import { icon } from '../icons.js';
import { showShiftsOf } from './shifts.js';

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
      h('a', { class: 'btn secondary', href: `/api/reports/period.pdf?from=${range.from}&to=${range.to}`, download: '' }, icon('download'), 'Rapport PDF'),
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
      kpi(
        'Encaissé',
        fmt.money(t.cash + t.card + t.mobileMoney),
        [
          `Espèces ${fmt.money(t.cash)}`,
          t.mobileMoney ? `Mobile money ${fmt.money(t.mobileMoney)}` : null,
          t.card ? `Carte ${fmt.money(t.card)}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      ),
      kpi('Vendu à crédit', fmt.money(t.credit), `Règlements reçus : ${fmt.money(t.payments)}${t.combos ? ` · combos échangés : ${fmt.money(t.combos)}` : ''}`),
      kpi('Écarts de caisse', varianceCell(t.variance, tol), 'Cumul de la période'),
    ),
    h(
      'div',
      { class: 'grid grid-3 section' },
      kpi('Marge brute estimée', t.costKnown ? fmt.money(t.grossMargin) : '—', t.costKnown ? 'Ventes − coût d’achat du carburant' : 'Prix d’achat manquant pour un produit : saisissez-le dans les livraisons'),
      kpi('Dépenses', fmt.money(t.expenses), r.expensesByCategory[0] ? `Surtout : ${r.expensesByCategory[0].category}` : 'Aucune dépense'),
      kpi('Résultat net estimé', t.costKnown ? h('span', { class: t.net < 0 ? 'variance-neg' : '' }, fmt.money(t.net)) : '—', t.costKnown ? 'Marge brute − dépenses' : 'Calculé dès que les prix d’achat sont connus'),
    ),
    // Full width: these tables have six columns.
    h(
      'div',
      { class: 'stack section' },
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
        h('div', { class: 'card-header' }, h('div', {}, h('h2', {}, 'Écarts par pompiste'), h('p', {}, `Manques et surplus comptés à part · tolérance ± ${fmt.money(tol)}`))),
        table(
          [
            { label: 'Pompiste', key: 'attendant' },
            { label: 'Postes', align: 'right', key: 'shifts' },
            { label: 'Hors tolérance', align: 'right', render: (x) => (x.outside ? h('strong', { class: 'variance-neg' }, String(x.outside)) : '0') },
            { label: 'Manques', align: 'right', render: (x) => (x.shortages < 0 ? h('span', { class: 'variance-neg' }, fmt.money(x.shortages)) : '—') },
            { label: 'Surplus', align: 'right', render: (x) => (x.surpluses > 0 ? fmt.money(x.surpluses) : '—') },
            { label: 'Pire écart', align: 'right', render: (x) => varianceCell(x.worst, tol) },
          ],
          r.byAttendant,
          {
            empty: 'Aucun poste sur la période.',
            onRowClick: (x) => {
              showShiftsOf(x.attendant_id);
              ctx.navigate('postes');
            },
          },
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
      h('div', { class: 'card-header' }, h('div', {}, h('h2', {}, 'Cuves'), h('p', {}, 'Perte = écarts de jaugeage négatifs rapportés aux litres vendus · jours au rythme des 14 derniers jours'))),
      table(
        [
          { label: 'Cuve', key: 'name' },
          { label: 'Livré', align: 'right', render: (x) => fmt.liters(x.delivered) },
          { label: 'Vendu', align: 'right', render: (x) => fmt.liters(x.sold) },
          { label: 'Écart jaugeage', align: 'right', render: (x) => (x.dips ? h('span', { class: x.dip_variance < 0 ? 'variance-neg' : '' }, fmt.liters(x.dip_variance)) : '—') },
          { label: 'Perte', align: 'right', render: (x) => (x.dips && x.loss_pct != null ? `${fmt.number(x.loss_pct)} %` : '—') },
          { label: 'Stock', align: 'right', render: (x) => fmt.liters(x.book_stock) },
          { label: 'Jours restants', align: 'right', render: (x) => (x.days_left == null ? '—' : `≈ ${x.days_left}`) },
        ],
        r.stock,
        { empty: 'Aucune cuve.' },
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

