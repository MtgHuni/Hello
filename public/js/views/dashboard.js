import { api } from '../api.js';
import { h, fmt, kpi, card, cardHeader, tankGauge, productColor, pageHeader, button } from '../ui.js';
import { icon } from '../icons.js';

const ALERT_ICON = { critical: 'alert', serious: 'alert', warning: 'info' };

export async function renderDashboard(page, { state, navigate }) {
  const d = await api.get('/dashboard');
  const hour = new Date().getHours();
  const hello = hour < 18 ? 'Bonjour' : 'Bonsoir';

  page.replaceChildren(
    pageHeader(
      `${hello}, ${state.user.name.split(' ')[0]}`,
      fmt.longDay(d.today),
      button('Nouvelle livraison', () => navigate('cuves'), { variant: 'secondary', iconName: 'truck' }),
    ),

    h(
      'div',
      { class: 'grid grid-4' },
      kpi("Ventes aujourd'hui", fmt.money(d.todayTotal.amount), `Dépenses : ${fmt.money(d.todayExpenses)}`),
      kpi('Litres vendus', fmt.liters(d.todayTotal.liters), d.todayByProduct.map((p) => `${p.name} ${fmt.number(p.liters)}`).join(' · ')),
      kpi('Postes ouverts', String(d.openShifts.length), d.openShifts.length ? d.openShifts.map((s) => s.attendant_name).join(', ') : 'Aucun pompiste en service'),
      kpi('Encours clients', fmt.money(d.receivables), `${d.toValidate} poste${d.toValidate > 1 ? 's' : ''} à valider`),
    ),

    h(
      'div',
      { class: 'grid grid-3 section' },
      h('section', { class: 'card span-2' }, cardHeader('Ventes des 7 derniers jours', 'Chiffre d’affaires par jour, en dollars'), barChart(d.last7)),
      card(cardHeader('Alertes', d.alerts.length ? `${d.alerts.length} point${d.alerts.length > 1 ? 's' : ''} à surveiller` : null), alertList(d.alerts)),
    ),

    h(
      'section',
      { class: 'card section' },
      cardHeader('Niveau des cuves', 'Stock théorique : dernier jaugeage + livraisons − ventes', button('Voir les cuves', () => navigate('cuves'), { variant: 'ghost' })),
      d.tanks.length ? h('div', { class: 'grid grid-2', style: 'gap:28px' }, d.tanks.map(tankGauge)) : h('div', { class: 'empty' }, 'Aucune cuve configurée.'),
    ),

    h(
      'div',
      { class: 'grid grid-2 section' },
      d.todayByProduct.map((p) =>
        kpi(
          h('span', {}, h('span', { class: 'swatch', style: `background:${productColor(p.id)}` }), p.name),
          fmt.money(p.amount),
          `${fmt.liters(p.liters)} vendus aujourd'hui`,
          { small: true },
        ),
      ),
    ),
  );
}

function alertList(alerts) {
  if (!alerts.length) {
    return h('div', { class: 'alert-item' }, h('span', { class: 'alert-icon good' }, icon('check')), h('span', {}, 'Tout est en ordre.'));
  }
  return h(
    'div',
    { class: 'alert-list' },
    alerts.map((a) =>
      h('a', { class: 'alert-item', href: a.link }, h('span', { class: `alert-icon ${a.level}` }, icon(ALERT_ICON[a.level])), h('span', { class: 'alert-text' }, a.text)),
    ),
  );
}

// Single-series bar chart: one hue, no legend, hover tooltip per bar, table fallback via aria.
function barChart(days) {
  const max = Math.max(...days.map((d) => d.amount), 1);
  const tip = h('div', { class: 'tooltip glass', hidden: true });
  const chart = h(
    'div',
    { class: 'chart' },
    h(
      'div',
      { class: 'bars', role: 'img', 'aria-label': days.map((d) => `${fmt.day(d.date)} : ${fmt.money(d.amount)}`).join(', ') },
      days.map((d, i) => {
        const col = h('div', { class: 'bar-col' }, h('div', { class: 'bar', style: `height:${(d.amount / max) * 100}%;--i:${i}` }));
        col.addEventListener('mouseenter', () => {
          tip.replaceChildren(h('div', { style: 'font-weight:600' }, fmt.money(d.amount)), h('div', { class: 'muted' }, `${fmt.day(d.date)} · ${fmt.liters(d.liters)}`));
          tip.hidden = false;
          tip.style.left = `${col.offsetLeft + col.offsetWidth / 2}px`;
          tip.style.top = `${col.offsetTop + col.offsetHeight * (1 - d.amount / max) - 6}px`;
        });
        col.addEventListener('mouseleave', () => (tip.hidden = true));
        return col;
      }),
    ),
    h('div', { class: 'bar-labels' }, days.map((d) => h('span', {}, fmt.day(d.date)))),
    tip,
  );
  return chart;
}
