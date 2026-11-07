import { flags, edit } from '../ui.js';
import { api } from '../api.js';
import { h, fmt, cardHeader, pageHeader, button, buttonRow, setContent, formDialog, toast, field, busy, productColor, openDialog, tile } from '../ui.js';
import { icon, brandMark } from '../icons.js';

const ALERT_ICON = { critical: 'alert', serious: 'alert', warning: 'info' };

export async function renderDashboard(page, { state, navigate }) {
  const [d, products, asked] = await Promise.all([api.get('/dashboard'), api.get('/products'), flags.ask ? api.get('/ask').catch(() => null) : null]);
  const hour = new Date().getHours();
  const hello = hour < 18 ? 'Bonjour' : 'Bonsoir';

  const s = d.openShifts[0];
  const bars = (values) => {
    const max = Math.max(1, ...values);
    return h('div', { class: 'tile-bars', 'aria-hidden': 'true' }, values.map((v, i) => h('i', { style: `height:${Math.round((v / max) * 100)}%;animation-delay:${i * 40}ms` })));
  };
  // The tank's level as a ring that fills on arrival (SVG needs its own namespace: built from markup).
  const ring = (pct) => {
    const box = h('span', { class: 'tile-ring-box', 'aria-hidden': 'true' });
    box.innerHTML = `<svg class="tile-ring" viewBox="0 0 54 54" style="--p:${Math.round(Math.max(0, Math.min(100, pct)))}"><circle class="ring-track" cx="27" cy="27" r="22"/><circle class="ring-fill" cx="27" cy="27" r="22"/></svg>`;
    return box;
  };
  const price = (productId) => products.find((p) => p.id === productId)?.price;
  const bare = (n) => fmt.money(n).replace(/\s?\$$/, '');
  const total7 = d.last7.reduce((t, x) => t + x.amount, 0);

  setContent(
    page,
    pageHeader(`${hello}, ${state.user.name.split(' ')[0]}`, fmt.longDay(d.today)),
    h(
      'div',
      { class: 'dash' },
      h(
        'div',
        {},
        // What the station is worth now, on blue glass; touched, every line of the addition.
        h(
          'button',
          { class: 'hero', type: 'button', onClick: () => valueDetail(d.value, flags.combos) },
          brandMark(),
          h('span', { class: 'hero-label' }, 'Valeur de la station'),
          h('span', { class: `hero-value${d.value.net < 0 ? ' lost' : ''}` }, fmt.money(d.value.net)),
          s ? h('p', { class: 'hero-sub' }, `Poste n°${s.id} · ${s.station_closed_at ? 'station fermée' : s.on_duty || 'personne en service'}`) : null,
        ),
        h(
          'nav',
          { class: 'acts', 'aria-label': 'Raccourcis' },
          s ? act('chart', 'État du poste', `#/postes/${s.id}/etat`) : null,
          edit(act('truck', 'Livraison', '#/cuves')),
          act('cash', 'Caisse', '#/caisse'),
          act('users', 'Clients', '#/clients'),
        ),
      ),
      h(
        'div',
        {},
        h('div', { class: 'sec-title' }, h('h2', {}, 'Aujourd’hui')),
        h(
          'div',
          { class: 'tiles' },
          tile({ color: 'c-blue', ic: 'chart', title: 'Ventes', side: '7 jours', value: bare(total7), unit: '$', chart: bars(d.last7.map((x) => x.amount)), href: '#/rapports' }),
          tile({ color: 'c-gold', ic: 'users', title: 'Crédits clients', value: bare(d.receivables), unit: '$', sub: d.receivablesOld ? `${fmt.money(d.receivablesOld)} à plus de 30 jours` : null, href: '#/clients/creances' }),
          d.tanks.map((t) => {
            const pct = (t.book_stock / t.capacity) * 100;
            return h(
              'a',
              { class: 'tile', href: '#/cuves', style: `--c:${productColor(t.product_id)}` },
              h('div', { class: 'tile-head' }, h('span', { class: 'tile-ic' }, icon('tank')), t.product_name, price(t.product_id) != null ? h('small', {}, fmt.price(price(t.product_id))) : null),
              h('div', { class: 'tile-body' }, h('div', {}, h('span', { class: 'tile-value' }, fmt.number(Math.round(t.book_stock)), h('small', {}, 'L')), h('p', { class: 'tile-sub' }, `${t.name} à ${Math.round(pct)} %`)), ring(pct)),
            );
          }),
          tile({ color: 'c-blue', ic: 'cash', title: 'Caisse', value: bare(d.cash.cash.balance), unit: '$', lost: d.cash.cash.balance < 0, sub: `Mobile money ${fmt.money(d.cash.momo.balance)}`, href: '#/caisse' }),
          d.supplierDebt ? tile({ color: 'c-red', ic: 'truck', title: 'Fournisseurs', value: bare(d.supplierDebt), unit: '$', lost: true, href: '#/cuves' }) : null,
          flags.combos ? tile({ color: 'c-gold', ic: 'card', title: 'Combos des clients', value: fmt.number(d.combos.total), sub: `Valeur ${fmt.money(d.combos.value)}`, href: '#/clients' }) : null,
          d.toReview ? tile({ color: 'c-red', ic: 'user', title: 'Fiches à compléter', value: String(d.toReview), href: '#/clients' }) : null,
        ),
      ),
    ),
    asked ? askCard(asked) : null,
    h(
      'section',
      { class: 'card dash-below' },
      cardHeader(
        'Alertes',
        [d.alerts.length ? `${d.alerts.length} point${d.alerts.length > 1 ? 's' : ''} à surveiller` : null, masked(d) ? `${masked(d)} masquée${masked(d) > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ') || null,
        button('Gérer', () => manageAlerts(d.alertsManage, () => renderDashboard(page, { state, navigate })), { variant: 'ghost sm', iconName: 'settings' }),
      ),
      alertList(d.alerts),
    ),
  );
}

// A shortcut in glass: the glyph in a clear squircle, its name beneath.
function act(iconName, label, href) {
  return h('a', { class: 'act', href }, h('span', { class: 'act-glass' }, icon(iconName)), label);
}

// The station's value, every line of the addition, in a sheet.
function valueDetail(v, combos) {
  openDialog((close) => h('div', { class: 'sheet dialog-body value-sheet' }, valueColumn(v, combos), buttonRow([button('Fermer', close, { variant: 'cancel' })])));
}

// « Demander à l'appli »: a question on the station's figures, answered by Claude from the database.
function askCard(data) {
  const left = h('span');
  const list = h('div', { class: 'ask-list' });
  const draw = () => {
    const n = Math.max(0, data.limit - data.used);
    left.textContent = `${n} restante${n > 1 ? 's' : ''} ce mois`;
    setContent(
      list,
      data.rows.slice(0, 5).map((r) =>
        h('div', { class: 'ask-item' }, h('p', { class: 'ask-q' }, r.question, h('span', { class: 'ask-when' }, fmt.dateTime(r.created_at))), h('p', { class: 'ask-a' }, r.answer)),
      ),
    );
  };
  const send = h('button', { class: 'btn', type: 'submit' }, 'Demander');
  const form = h(
    'form',
    {
      class: 'ask-form',
      onSubmit: (e) => {
        e.preventDefault();
        const question = form.elements.question.value.trim();
        if (question)
          busy(send, async () => {
            const r = await api.post('/ask', { question }, { timeout: 120000 });
            Object.assign(data, { used: r.used, limit: r.limit });
            data.rows.unshift(r);
            form.elements.question.value = '';
            draw();
          });
      },
    },
    field({ name: 'question', label: 'Votre question', required: true, enterkeyhint: 'send' }),
    send,
  );
  draw();
  return h('section', { class: 'card ask-card section' }, cardHeader('Question', left), form, list);
}




// What the station is worth now, as one addition: its money, credits and fuel at purchase cost,
// less what it owes, closed on a double rule.
function valueColumn(v, combos) {
  // Red means owed or a gap: what the station owes, money below zero, a missing purchase price.
  const line = (label, value, { total = false, lost = false, sub = null } = {}) =>
    h('div', { class: `summary-line${total ? ' total' : ''}` }, h('span', {}, label, sub ? h('small', { class: 'line-sub' }, sub) : null), h('span', { class: `num${lost ? ' variance-neg' : ''}` }, value));
  const own = (label, n) => line(label, fmt.money(n), { lost: n < 0 });
  const owe = (label, n) => line(label, fmt.money(-n), { lost: n > 0.005 });
  const a = v.assets;
  const d = v.debts;
  return h(
    'section',
    { class: 'card value-col' },
    cardHeader('Valeur de la station'),
    h('h3', { class: 'form-section' }, 'Ce qu’elle possède'),
    own('Espèces (caisse)', a.cash),
    own('Mobile money', a.momo),
    own('Argent du poste en cours', a.shift),
    Math.abs(a.uncounted) >= 0.005 ? own('Argent à compter', a.uncounted) : null,
    own('Crédits clients', a.receivables),
    v.tanks.map((t) =>
      line(t.name, t.value == null ? 'prix d’achat manquant' : fmt.money(t.value), { lost: t.value == null, sub: `${fmt.liters(t.liters)}${t.cost == null ? '' : ` × ${fmt.price(t.cost)}`}` }),
    ),
    h('h3', { class: 'form-section' }, 'Ce qu’elle doit'),
    owe('Fournisseurs', d.suppliers),
    owe('Salaires à payer', d.salaries),
    owe('Avances des clients', d.advances),
    combos ? owe('Combos des clients', d.combos) : null,
    line('Valeur nette', fmt.money(v.net), { total: true, lost: v.net < 0 }),
  );
}

const masked = (d) => d.alertsManage.all.filter((a) => a.off || a.hidden).length;

// Each user chooses their alerts: a whole type switched off, or one alert hidden until it changes
// (a lower stock, a bigger debt…) or is resolved.
async function manageAlerts({ all, types }, reload) {
  const shown = all.filter((a) => !a.off);
  const ok = await formDialog({
    title: 'Gérer les alertes',
    grid: false,
    fields: [
      { name: 'h-now', type: 'node', node: h('h3', { class: 'form-section' }, 'Alertes en cours') },
      ...(shown.length
        ? shown.map((a, i) => ({ name: `alert-${i}`, label: a.text, type: 'checkbox', value: !a.hidden }))
        : [{ name: 'none', type: 'node', node: h('p', { class: 'muted small' }, 'Aucune alerte en ce moment.') }]),
      { name: 'h-types', type: 'node', node: h('h3', { class: 'form-section' }, 'Types d’alertes') },
      ...types.map((t) => ({ name: `type-${t.type}`, label: t.label, type: 'checkbox', value: !t.off })),
    ],
    onSubmit: (d) =>
      api.put('/alerts', {
        off: types.filter((t) => !d[`type-${t.type}`]).map((t) => t.type),
        hidden: [...shown.filter((a, i) => !d[`alert-${i}`]), ...all.filter((a) => a.off && a.hidden)].map((a) => ({ key: a.key, text: a.text })),
      }),
  });
  if (ok) {
    toast('Alertes mises à jour.');
    reload();
  }
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

