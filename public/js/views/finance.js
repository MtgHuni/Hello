import { api } from '../api.js';
import { h, fmt, edit, pageHeader, cardHeader, kpi, badge, button, busy, field, segmented, setContent, shareButton, todayISO } from '../ui.js';
import { presetRange } from './reports.js';

// Rapports → Rapport financier: Claude's summary and advice on a period, with the figures they rest
// on. The week before is written every Monday (and mailed); any other period on demand.
// #/rapports/financier: the latest; …/<du>_<au>: a period (its report, or « Rédiger »); …/<id>: one report.
const PRIORITY = { haute: ['Priorité haute', 'critical'], moyenne: ['Priorité moyenne', 'warning'], basse: ['Priorité basse', 'info'] };
const AREA = { finance: 'Finance', technique: 'Technique' };
const PRESETS = [
  ['lastWeek', 'Semaine dernière'],
  ['7d', '7 jours'],
  ['month', 'Ce mois'],
  ['lastMonth', 'Mois dernier'],
];

// A label and its amount; a loss in red.
const line = (label, value, { total = false, lost = false } = {}) =>
  h('div', { class: `summary-line${total ? ' total' : ''}` }, h('span', {}, label), h('span', { class: `num${lost ? ' variance-neg' : ''}` }, value));
const isLoss = (v) => v != null && v < -0.005;

// The profit there should be, every gap measured, the profit left.
function profitCard(pc) {
  return h(
    'section',
    { class: 'card section' },
    cardHeader('Vérification du bénéfice', pc.gapTotal == null ? null : isLoss(pc.gapTotal) ? `Écart ${fmt.signedMoney(pc.gapTotal)}` : 'Aucun manque'),
    line('Ventes', fmt.money(pc.sales)),
    line('Coût du carburant vendu', pc.costOfSales == null ? 'Prix d’achat manquant' : fmt.money(-pc.costOfSales), { lost: pc.costOfSales == null }),
    line('Dépenses', fmt.money(-pc.expenses)),
    line('Bénéfice attendu', pc.expected == null ? '—' : fmt.money(pc.expected), { total: true }),
    pc.gaps.map((g) =>
      line(g.key === 'cuves' && g.count ? `${g.label} (${fmt.liters(g.liters)})` : g.label, g.amount == null ? 'Sans prix d’achat' : fmt.signedMoney(g.amount), { lost: isLoss(g.amount) || g.amount == null }),
    ),
    line('Bénéfice réel', pc.real == null ? '—' : fmt.money(pc.real), { total: true, lost: isLoss(pc.real) }),
    pc.uncounted.length ? line(`Argent à compter : poste${pc.uncounted.length > 1 ? 's' : ''} n° ${pc.uncounted.join(', ')}`, '—', { lost: true }) : null,
  );
}

// Every money movement of the period, in totals (each line is in the PDF).
function moneyCard(m) {
  return h(
    'section',
    { class: 'card section' },
    cardHeader('Mouvements d’argent'),
    m.accounts.map((a) => [
      line(`${a.account} au début`, fmt.money(a.opening)),
      line('Entrées', `+${fmt.money(a.in)}`),
      line('Sorties', fmt.money(-a.out)),
      line(`${a.account} à la fin`, fmt.money(a.closing), { total: true }),
    ]),
    line('Ventes (index des compteurs)', fmt.money(m.sales)),
    line('Espèces remises aux clôtures', fmt.money(m.paidCash)),
    line('Mobile money des postes', fmt.money(m.mobileMoney)),
    line('Vendu à crédit', fmt.money(m.credit)),
    m.combos ? line('Échangé contre des combos', fmt.money(m.combos)) : null,
    line('Règlements reçus', fmt.money(m.payments)),
    line('Dépenses', fmt.money(m.expenses)),
    line(`Livraisons (${m.deliveries.count})`, fmt.money(m.deliveries.amount)),
    line('Paiements aux fournisseurs', fmt.money(m.supplierPayments)),
    m.manual.map((x) => line(`${x.label} (${x.account.toLowerCase()})`, fmt.money(x.amount))),
  );
}

const span = (from, to) => (from === to ? fmt.longDay(from) : `Du ${fmt.date(from)} au ${fmt.date(to)}`);
const evolution = (now, before) => {
  if (now == null || before == null || !before) return null;
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  return `${pct > 0 ? '+' : ''}${pct} % sur la période précédente`;
};

export async function renderFinance(page, ctx) {
  const list = await api.get('/finance-reports');
  const sub = ctx.sub || '';
  const asked = /^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/.test(sub) ? sub.split('_') : null;
  let range;
  let r = null;
  if (asked) {
    range = { from: asked[0], to: asked[1] };
    const found = list.reports.find((x) => x.date_from === range.from && x.date_to === range.to);
    if (found) r = await api.get(`/finance-reports/${found.id}`);
  } else {
    const id = /^\d+$/.test(sub) ? sub : list.reports[0]?.id;
    if (id) r = await api.get(`/finance-reports/${id}`);
    range = r ? { from: r.date_from, to: r.date_to } : list.lastWeek;
  }

  const go = ({ from, to }) => {
    const path = `rapports/financier/${from}_${to}`;
    if (location.hash === `#/${path}`) renderFinance(page, { ...ctx, sub: `${from}_${to}` });
    else ctx.navigate(path);
  };
  const rangeOf = (key) => (key === 'lastWeek' ? list.lastWeek : presetRange(key));
  const preset = PRESETS.find(([key]) => rangeOf(key).from === range.from && rangeOf(key).to === range.to)?.[0] ?? null;

  const from = field({ name: 'from', label: 'Du', type: 'date', value: range.from });
  const to = field({ name: 'to', label: 'Au', type: 'date', value: range.to });
  const onDate = () => {
    const chosen = { from: from.querySelector('input').value, to: to.querySelector('input').value };
    if (chosen.from && chosen.to) go(chosen);
  };
  from.querySelector('input').addEventListener('change', onDate);
  to.querySelector('input').addEventListener('change', onDate);
  to.querySelector('input').max = todayISO();
  from.querySelector('input').max = todayISO();

  const written = list.reports.length
    ? field({
        name: 'written',
        label: 'Rapports rédigés',
        type: 'select',
        value: r?.id ?? '',
        options: [...(r ? [] : [['', 'Choisir…']]), ...list.reports.map((x) => [x.id, span(x.date_from, x.date_to)])],
      })
    : null;
  written?.querySelector('select').addEventListener('change', (e) => {
    const x = list.reports.find((y) => String(y.id) === e.target.value);
    if (x) go({ from: x.date_from, to: x.date_to });
  });

  // Writes the report of the period shown (1 to 3 minutes), then shows it.
  const write = (label, variant = '') => {
    const btn = button(
      label,
      () =>
        busy(btn, async () => {
          btn.lastChild.textContent = 'Rédaction…';
          try {
            const done = await api.post('/finance-reports', range, { timeout: 300000 });
            go({ from: done.date_from, to: done.date_to });
          } finally {
            btn.lastChild.textContent = label;
          }
        }),
      { variant },
    );
    return list.ai ? edit(btn) : null;
  };

  const controls = h(
    'div',
    { class: 'row no-print', style: 'align-items:flex-end;margin-bottom:24px' },
    segmented(PRESETS, preset, (key) => go(rangeOf(key))),
    h('span', { class: 'spacer' }),
    from,
    to,
    written,
  );

  if (!r) {
    setContent(
      page,
      pageHeader('Rapport financier', span(range.from, range.to)),
      controls,
      h('section', { class: 'card empty' }, h('p', { class: 'empty-text' }, 'Aucun rapport financier sur cette période.'), write('Rédiger le rapport')),
    );
    return;
  }

  const f = r.figures;
  const w = f.period;
  const p = f.previous;
  const s = f.position;
  setContent(
    page,
    pageHeader(
      'Rapport financier',
      span(r.date_from, r.date_to),
      w.partial ? badge('Période en cours', 'info') : null,
      f.profit && (isLoss(f.profit.gapTotal) || f.profit.uncounted.length || f.profit.expected == null) ? badge('Écart à vérifier', 'critical') : null,
      shareButton(`/api/finance-reports/${r.id}/report.pdf`, `rapport-financier-${r.date_from}_${r.date_to}.pdf`),
      write('Refaire'),
    ),
    controls,
    h(
      'div',
      { class: 'grid grid-4' },
      kpi('Ventes', fmt.money(w.amount), evolution(w.amount, p.amount) || fmt.liters(w.liters)),
      kpi('Marge brute estimée', w.grossMargin == null ? '—' : fmt.money(w.grossMargin), w.grossMargin == null ? 'Prix d’achat manquant' : evolution(w.grossMargin, p.grossMargin)),
      kpi('Dépenses', fmt.money(w.expenses), evolution(w.expenses, p.expenses)),
      kpi('Résultat net estimé', w.net == null ? '—' : h('span', { class: w.net < 0 ? 'variance-neg' : '' }, fmt.money(w.net)), evolution(w.net, p.net)),
    ),
    f.profit ? profitCard(f.profit) : null,
    h('section', { class: 'card section' }, cardHeader('Synthèse', `Rédigée le ${fmt.dateTime(r.created_at)}`), h('p', { class: 'finance-summary' }, r.summary)),
    h(
      'section',
      { class: 'card section' },
      cardHeader('Conseils', `${r.advice.length} conseil${r.advice.length > 1 ? 's' : ''}`),
      h(
        'div',
        { class: 'advice-list' },
        r.advice.map((a) =>
          h(
            'article',
            { class: 'advice-item' },
            h('h3', {}, a.title),
            h('div', { class: 'advice-tags' }, badge(...(PRIORITY[a.priority] || [a.priority])), badge(AREA[a.area] || a.area)),
            h('p', {}, a.text),
          ),
        ),
      ),
    ),
    f.money ? moneyCard(f.money) : null,
    h(
      'div',
      { class: 'grid grid-4 section' },
      kpi('Trésorerie', fmt.money(s.cash + s.mobileMoney), `Espèces ${fmt.money(s.cash)} · mobile money ${fmt.money(s.mobileMoney)}`),
      kpi('Dû par les clients', fmt.money(s.receivables), s.receivablesOld ? `Dont ${fmt.money(s.receivablesOld)} depuis plus de 30 jours` : null),
      kpi('Dû aux fournisseurs', fmt.money(s.supplierDebt)),
      kpi('Valeur du stock', s.stockValue == null ? '—' : fmt.money(s.stockValue), f.stock.filter((t) => t.days_left != null).map((t) => `${t.tank} : ${fmt.number(t.days_left)} j de stock`).join(' · ') || null),
    ),
  );
}
