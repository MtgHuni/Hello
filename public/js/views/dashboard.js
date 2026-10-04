import { flags } from '../ui.js';
import { api } from '../api.js';
import { h, fmt, kpi, cardHeader, tankGauge, pageHeader, button, setContent, priceTotem } from '../ui.js';
import { icon } from '../icons.js';

const ALERT_ICON = { critical: 'alert', serious: 'alert', warning: 'info' };

export async function renderDashboard(page, { state, navigate }) {
  const [d, products] = await Promise.all([api.get('/dashboard'), api.get('/products')]);
  const hour = new Date().getHours();
  const hello = hour < 18 ? 'Bonjour' : 'Bonsoir';

  setContent(page, 
    pageHeader(
      `${hello}, ${state.user.name.split(' ')[0]}`,
      fmt.longDay(d.today),
      d.openShifts[0] ? button('État du poste', () => navigate(`postes/${d.openShifts[0].id}/etat`), { iconName: 'chart' }) : null,
      button('Nouvelle livraison', () => navigate('cuves'), { variant: 'secondary', iconName: 'truck' }),
    ),

    priceTotem(products.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, price: p.price, subscriberPrice: p.subscriber_price }))),

    h(
      'div',
      { class: 'grid grid-4' },
      kpi("Ventes aujourd'hui", fmt.money(d.todayTotal.amount), [d.openShifts.length ? `${d.openShifts.length} poste${d.openShifts.length > 1 ? 's' : ''} en cours, compté${d.openShifts.length > 1 ? 's' : ''} à la clôture` : 'Postes clôturés', `Dépenses : ${fmt.money(d.todayExpenses)}`].join(' · ')),
      shiftKpi(d.openShifts[0], d.toValidate),
      h(
        'a',
        { class: 'card kpi kpi-link', href: '#/caisse' },
        h('div', { class: 'label' }, 'Caisse'),
        h('div', { class: 'value' }, fmt.money(d.cash.cash.balance)),
        h('div', { class: 'sub' }, `Mobile money ${fmt.money(d.cash.momo.balance)}${d.supplierDebt ? ` · fournisseurs ${fmt.money(d.supplierDebt)}` : ''}`),
      ),
      h('a', { class: 'card kpi kpi-link', href: '#/clients/creances' }, h('div', { class: 'label' }, 'Encours clients'), h('div', { class: 'value' }, fmt.money(d.receivables)), h('div', { class: 'sub' }, d.receivablesOld ? `${fmt.money(d.receivablesOld)} à plus de 30 jours` : 'Rien à plus de 30 jours')),
    ),

    // One ruled board: sales, alerts, stock and customer facts share a single surface.
    h(
      'div',
      { class: 'board section' },
      h('section', { class: 'card board-chart' }, cardHeader('Ventes des 7 derniers jours', `Total ${fmt.money(d.last7.reduce((t, x) => t + x.amount, 0))} · chiffre d’affaires par jour, en dollars`), barChart(d.last7)),
      h('section', { class: 'card board-alerts' }, cardHeader('Alertes', d.alerts.length ? `${d.alerts.length} point${d.alerts.length > 1 ? 's' : ''} à surveiller` : null), alertList(d.alerts)),
      h(
        'section',
        { class: 'card board-wide' },
        cardHeader('Niveau des cuves', 'Stock théorique : dernier jaugeage + livraisons − ventes', h('a', { class: 'more-link', href: '#/cuves' }, 'Voir les cuves', icon('chevron'))),
        d.tanks.length ? h('div', { class: 'grid grid-2', style: 'gap:28px' }, d.tanks.map(tankGauge)) : h('div', { class: 'empty' }, 'Aucune cuve configurée.'),
      ),
      facts([
        flags.combos ? ['Combos des clients', fmt.number(d.combos.total), `Valeur ${fmt.money(d.combos.value)} en carburant · ${d.combos.redeemable} client${d.combos.redeemable > 1 ? 's peuvent' : ' peut'} échanger`, '#/clients'] : null,
        ['Fiches clients à compléter', String(d.toReview), d.toReview ? 'Créées à la pompe avec le nom seulement' : 'Toutes les fiches sont complètes', '#/clients'],
      ]),
    ),
  );
}

// Customer facts as ruled rows: label and note on the left, the figure on the right.
function facts(rows) {
  const list = rows.filter(Boolean);
  return list.map(([label, value, sub, href]) =>
    h(
      'a',
      { class: `card fact${list.length === 1 ? ' board-wide' : ''}`, href },
      h('span', { class: 'fact-text' }, h('span', { class: 'fact-label' }, label), h('span', { class: 'fact-sub' }, sub)),
      h('span', { class: 'fact-value' }, value),
    ),
  );
}

// The station runs one shift at a time: who holds it, since when, or that none is open.
function shiftKpi(s, toValidate) {
  const pending = toValidate ? ` · ${toValidate} à valider` : '';
  return h(
    'a',
    { class: 'card kpi kpi-link', href: s ? `#/postes/${s.id}/etat` : '#/postes' },
    h('div', { class: 'label' }, 'Poste en cours'),
    h('div', { class: 'value sm' }, !s ? 'Aucun' : s.station_closed_at ? 'Station fermée' : s.on_duty || 'Personne'),
    h('div', { class: 'sub' }, s ? `Poste n°${s.id} depuis le ${fmt.dateTime(s.opened_at)} · crédits ${fmt.money(s.credit_so_far)}${pending}` : `Aucun poste ouvert${pending}`),
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
  if (!days.some((d) => d.amount > 0)) return h('div', { class: 'empty' }, 'Aucune vente ces 7 derniers jours.');
  const max = Math.max(...days.map((d) => d.amount), 1);
  const tip = h('div', { class: 'tooltip', hidden: true });
  const chart = h(
    'div',
    { class: 'chart' },
    h(
      'div',
      { class: 'bars', role: 'img', 'aria-label': days.map((d) => `${fmt.day(d.date)} : ${fmt.money(d.amount)}`).join(', ') },
      days.map((d, i) => {
        const col = h(
          'div',
          { class: 'bar-col' },
          h('div', { class: 'bar', style: `height:${(d.amount / max) * 100}%;--i:${i}` }, d.amount ? h('span', { class: 'bar-value', 'aria-hidden': 'true' }, fmt.number(Math.round(d.amount))) : null),
        );
        col.addEventListener('mouseenter', () => {
          setContent(tip, h('div', { style: 'font-weight:600' }, fmt.money(d.amount)), h('div', { class: 'muted' }, `${fmt.day(d.date)} · ${fmt.liters(d.liters)}`));
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
