import { api } from '../api.js';
import { h, fmt, flags, edit, pageHeader, cardHeader, kpi, badge, button, busy, field, setContent, shareButton } from '../ui.js';

// Rapports → Rapport financier: Claude's summary and advice on a week (Monday to Sunday), written on
// Monday (mailed too) or on demand, with the figures they rest on. #/rapports/financier[/<lundi>].
const PRIORITY = { haute: ['Priorité haute', 'critical'], moyenne: ['Priorité moyenne', 'warning'], basse: ['Priorité basse', 'info'] };
const AREA = { finance: 'Finance', technique: 'Technique' };

const weekLabel = (from, to) => `Semaine du ${fmt.date(from)} au ${fmt.date(to)}`;
const evolution = (now, before) => {
  if (now == null || before == null || !before) return null;
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  return `${pct > 0 ? '+' : ''}${pct} % sur la semaine précédente`;
};

export async function renderFinance(page, ctx) {
  const list = await api.get('/finance-reports');
  const from = ctx.sub || list.weeks[0]?.week_from;
  const r = from && list.weeks.some((w) => w.week_from === from) ? await api.get(`/finance-reports/${from}`) : null;
  const open = (week) => ctx.navigate(`rapports/financier/${week}`);

  // Writes the report of the week shown (or of the last week over), then shows it.
  const write = (week, label) => {
    const btn = button(label, () =>
      busy(btn, async () => {
        btn.lastChild.textContent = 'Rédaction…';
        try {
          const done = await api.post('/finance-reports', { from: week }, { timeout: 300000 });
          if (ctx.sub === done.week_from) renderFinance(page, ctx);
          else open(done.week_from);
        } finally {
          btn.lastChild.textContent = label;
        }
      }),
    );
    return list.ai ? edit(btn) : null;
  };

  const missing = !list.weeks.some((w) => w.week_from === list.lastWeek);
  if (!r) {
    setContent(
      page,
      pageHeader('Rapport financier', null, h('a', { class: 'btn secondary', href: '#/rapports' }, 'Rapports')),
      h('section', { class: 'card empty' }, h('p', {}, 'Aucun rapport financier.'), write(list.lastWeek, 'Rédiger la semaine dernière')),
    );
    return;
  }

  const f = r.figures;
  const w = f.week;
  const p = f.previous;
  const s = f.position;
  const weeks = field({
    name: 'week',
    label: 'Semaine',
    type: 'select',
    value: r.week_from,
    options: list.weeks.map((x) => [x.week_from, weekLabel(x.week_from, x.week_to)]),
  });
  weeks.querySelector('select').addEventListener('change', (e) => open(e.target.value));

  setContent(
    page,
    pageHeader(
      'Rapport financier',
      weekLabel(r.week_from, r.week_to),
      shareButton(`/api/finance-reports/${r.week_from}/report.pdf`, `rapport-financier-${r.week_from}.pdf`),
      missing ? write(list.lastWeek, 'Rédiger la semaine dernière') : r.week_from === list.lastWeek ? write(r.week_from, 'Refaire') : null,
    ),
    list.weeks.length > 1 ? h('div', { class: 'row no-print', style: 'margin-bottom:24px' }, weeks) : null,
    h(
      'div',
      { class: 'grid grid-4' },
      kpi('Ventes', fmt.money(w.amount), evolution(w.amount, p.amount) || fmt.liters(w.liters)),
      kpi('Marge brute estimée', w.grossMargin == null ? '—' : fmt.money(w.grossMargin), w.grossMargin == null ? 'Prix d’achat manquant' : evolution(w.grossMargin, p.grossMargin)),
      kpi('Dépenses', fmt.money(w.expenses), evolution(w.expenses, p.expenses)),
      kpi('Résultat net estimé', w.net == null ? '—' : h('span', { class: w.net < 0 ? 'variance-neg' : '' }, fmt.money(w.net)), evolution(w.net, p.net)),
    ),
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

// The link from Rapports, shown when Claude is available (ANTHROPIC_API_KEY on the server).
export const financeLink = () => (flags.ai ? h('a', { class: 'btn secondary', href: '#/rapports/financier' }, 'Rapport financier') : null);
