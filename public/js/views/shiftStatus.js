import { api } from '../api.js';
import { h, fmt, pageHeader, card, cardHeader, table, kpi, button, field, setContent, toast, badge } from '../ui.js';
import { icon } from '../icons.js';
import { reportCard } from './relay.js';
import { renderClosing } from './attendant.js';

// The manager's view of the shift in progress: what was sold up to the last index reading,
// credits, payments, expenses, the money passed at each relief, and, if the manager reads the
// meters now, the sales and the money expected at this very moment.
export async function renderShiftStatus(page, ctx) {
  const shift = await api.get(`/shifts/${ctx.id}`);
  const tol = ctx.state.settings.cashTolerance;
  const reload = () => renderShiftStatus(page, ctx);
  const cps = shift.checkpoints;
  const last = cps.at(-1);
  const sum = (list, key) => list.reduce((t, x) => t + (x[key] || 0), 0);
  const credits = shift.sales.filter((s) => s.kind === 'credit');
  const since = (list) => (last ? list.filter((x) => x.created_at > last.at) : list);
  const lastMeter = (r) => last?.nozzles.find((n) => n.nozzle_id === r.nozzle_id)?.to ?? r.start_meter;
  const open = shift.status === 'open';

  // Reading the meters now: sales and money expected since the last reading, nothing saved.
  const live = h('div');
  let timer;
  const meters = h(
    'form',
    { class: 'stack', style: 'gap:12px' },
    shift.readings.map((r) =>
      field({
        name: `m_${r.nozzle_id}`,
        label: `${r.pump_name} · ${r.nozzle_name}`,
        hint: `Dernier relevé : ${fmt.number(lastMeter(r))}`,
        type: 'number',
        step: '0.01',
        min: String(lastMeter(r)),
        onInput: () => {
          clearTimeout(timer);
          timer = setTimeout(async () => {
            const list = shift.readings.map((x) => ({ nozzleId: x.nozzle_id, meter: meters.elements[`m_${x.nozzle_id}`].value }));
            if (list.some((x) => x.meter === '')) return setContent(live);
            try {
              const r2 = await api.post(`/shifts/${shift.id}/checkpoints/preview`, { readings: list.map((x) => ({ nozzleId: x.nozzleId, meter: Number(x.meter) })) });
              setContent(live, reportCard(r2, tol, { preview: true, title: 'En ce moment, depuis le dernier relevé' }));
            } catch (err) {
              setContent(live, h('p', { class: 'variance-neg' }, err.message));
            }
          }, 300);
        },
      }),
    ),
  );

  const person = (x) => x.user_name || '—';
  setContent(
    page,
    h('a', { class: 'back', href: `#/postes/${shift.id}` }, icon('back'), `Poste n°${shift.id}`),
    pageHeader(
      `État du poste n°${shift.id}`,
      [
        `Depuis le ${fmt.dateTime(shift.opened_at)}`,
        !open ? 'clôturé' : shift.station_closed_at ? `station fermée depuis ${fmt.time(shift.station_closed_at)}` : shift.on_duty.length ? `en service : ${shift.on_duty.join(', ')}` : 'personne en service',
      ].join(' · '),
      button('Actualiser', reload, { variant: 'secondary', iconName: 'shifts' }),
      open
        ? button('Clôturer le poste', () => renderClosing(page, ctx, shift, { mode: 'manager', onBack: reload, onDone: (closed) => (toast(`Poste clôturé · poste n°${closed.next_shift_id} ouvert`), ctx.navigate(`postes/${shift.id}`)) }), {
            variant: shift.closing_due ? '' : 'secondary',
            iconName: 'check',
          })
        : null,
    ),
    shift.closing_due ? h('p', { class: 'offline-strip', role: 'status', style: 'margin-bottom:16px' }, `L’heure de clôture (${ctx.state.settings.closingTime || '15:30'}) est passée.`) : null,
    h(
      'div',
      { class: 'grid grid-4' },
      kpi('Ventes relevées', fmt.money(sum(cps, 'sold')), last ? `${fmt.liters(sum(cps, 'liters'))} jusqu’au relevé de ${fmt.time(last.at)}` : 'Aucun relevé depuis l’ouverture'),
      kpi('Crédits', fmt.money(shift.credit_amount), `${credits.length} crédit${credits.length > 1 ? 's' : ''}${shift.combo_amount ? ` · combos ${fmt.money(shift.combo_amount)}` : ''}`),
      kpi('Règlements reçus', fmt.money(shift.payments_amount), `${shift.payments.length} règlement${shift.payments.length > 1 ? 's' : ''}`),
      kpi('Dépenses', fmt.money(shift.expenses_amount), `${shift.expenses.length} dépense${shift.expenses.length > 1 ? 's' : ''}`),
    ),
    h(
      'div',
      { class: 'grid grid-2 section' },
      card(
        cardHeader('Argent', last ? `Au dernier relevé : ${last.label.toLowerCase()} de ${last.by || '—'}, ${fmt.dateTime(last.at)}` : 'Aucun relevé : l’argent se calcule avec les index'),
        last
          ? [
              h('div', { class: 'summary-line' }, h('span', {}, 'Argent remis à ce relevé'), h('span', { class: 'num' }, fmt.money(last.handed))),
              h('div', { class: 'summary-line' }, h('span', {}, 'Écarts cumulés des relèves'), h('span', { class: 'num' }, fmt.signedMoney(Math.round(sum(cps, 'variance') * 100) / 100))),
            ]
          : null,
        h('div', { class: 'summary-line' }, h('span', {}, `Crédits ${last ? 'depuis' : 'du poste'}`), h('span', { class: 'num' }, `− ${fmt.money(sum(since(credits), 'amount'))}`)),
        h('div', { class: 'summary-line' }, h('span', {}, `Règlements ${last ? 'depuis' : 'du poste'}`), h('span', { class: 'num' }, `+ ${fmt.money(sum(since(shift.payments), 'amount'))}`)),
        h('div', { class: 'summary-line' }, h('span', {}, `Dépenses ${last ? 'depuis' : 'du poste'}`), h('span', { class: 'num' }, `− ${fmt.money(sum(since(shift.expenses), 'amount'))}`)),
        h('div', { class: 'summary-line' }, h('span', {}, 'Mobile money reçu (tout le poste)'), h('span', { class: 'num' }, fmt.money(shift.momo_total))),
        h('p', { class: 'muted small', style: 'margin-top:10px' }, 'Les ventes depuis le dernier relevé ne se connaissent qu’avec les index : relevez-les avec « Relever les index maintenant » pour voir l’argent qui devrait être en caisse.'),
      ),
      open && !shift.station_closed_at ? card(cardHeader('Relever les index maintenant', 'Rien n’est enregistré : c’est un contrôle'), meters) : null,
    ),
    live,
    cps.length
      ? h(
          'section',
          { class: 'card flush section' },
          cardHeader('Relèves, fermetures et ouvertures', `${cps.length} relevé${cps.length > 1 ? 's' : ''} d’index`),
          table(
            [
              { label: 'Heure', render: (c) => fmt.dateTime(c.at) },
              { label: 'Type', render: (c) => badge(c.label, c.kind === 'releve' ? 'info' : '') },
              { label: 'Par', render: (c) => c.by || '—' },
              { label: 'Litres', align: 'right', render: (c) => fmt.liters(c.liters) },
              { label: 'Ventes', align: 'right', render: (c) => fmt.money(c.sold) },
              { label: 'Argent remis', align: 'right', render: (c) => fmt.money(c.handed) },
              { label: 'Écart', align: 'right', render: (c) => h('span', { class: Math.abs(c.variance) > tol ? 'variance-neg' : '' }, fmt.signedMoney(c.variance)) },
            ],
            cps,
            {},
          ),
        )
      : null,
    h(
      'section',
      { class: 'card flush section' },
      cardHeader('Crédits', fmt.money(shift.credit_amount)),
      table(
        [
          { label: 'Heure', render: (s) => fmt.time(s.created_at) },
          { label: 'Client', key: 'customer_name' },
          { label: 'Produit', render: (s) => `${s.product_name} · ${fmt.liters(s.liters)}` },
          { label: 'Saisi par', render: person },
          { label: 'Montant', align: 'right', render: (s) => h('span', {}, fmt.money(s.amount), s.over_limit ? h('span', {}, ' ', badge('Hors plafond', 'serious')) : null) },
        ],
        [...credits].reverse(),
        { empty: 'Aucun crédit pour le moment.' },
      ),
    ),
    h(
      'section',
      { class: 'card flush section' },
      cardHeader('Payé en mobile money', fmt.money(sum(shift.momo, 'amount'))),
      table(
        [
          { label: 'Heure', render: (m) => fmt.time(m.created_at) },
          { label: 'Carburant', key: 'product_name' },
          { label: 'Litres', align: 'right', render: (m) => fmt.liters(m.liters) },
          { label: 'Par', render: person },
          { label: 'Montant', align: 'right', render: (m) => fmt.money(m.amount) },
        ],
        [...shift.momo].reverse(),
        { empty: 'Aucun paiement mobile money.' },
      ),
    ),
    h(
      'div',
      { class: 'grid grid-2 section' },
      h(
        'section',
        { class: 'card flush' },
        cardHeader('Règlements', fmt.money(shift.payments_amount)),
        table(
          [
            { label: 'Heure', render: (p) => fmt.time(p.created_at) },
            { label: 'Client', key: 'customer_name' },
            { label: 'Par', render: person },
            { label: 'Montant', align: 'right', render: (p) => fmt.money(p.amount) },
          ],
          [...shift.payments].reverse(),
          { empty: 'Aucun règlement.' },
        ),
      ),
      h(
        'section',
        { class: 'card flush' },
        cardHeader('Dépenses', fmt.money(shift.expenses_amount)),
        table(
          [
            { label: 'Heure', render: (e) => fmt.time(e.created_at) },
            { label: 'Dépense', wrap: true, render: (e) => `${e.category} · ${e.description}` },
            { label: 'Par', render: person },
            { label: 'Montant', align: 'right', render: (e) => fmt.money(e.amount) },
          ],
          [...shift.expenses].reverse(),
          { empty: 'Aucune dépense.' },
        ),
      ),
    ),
  );
}
