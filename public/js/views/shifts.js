import { api } from '../api.js';
import { h, fmt, pageHeader, card, cardHeader, table, segmented, shiftBadge, varianceCell, kpi, formDialog, toast, button } from '../ui.js';
import { icon } from '../icons.js';

let filter = 'closed';

export async function renderShifts(page, ctx) {
  const shifts = await api.get(`/shifts${filter === 'all' ? '' : `?status=${filter}`}`);
  const tol = ctx.state.settings.cashTolerance;

  page.replaceChildren(
    pageHeader('Postes', 'Rapprochement des index et de la caisse, pompiste par pompiste.'),
    h(
      'section',
      { class: 'card flush' },
      h(
        'div',
        { class: 'card-header' },
        segmented(
          [
            ['closed', 'À valider'],
            ['open', 'En cours'],
            ['validated', 'Validés'],
            ['all', 'Tous'],
          ],
          filter,
          (v) => {
            filter = v;
            renderShifts(page, ctx);
          },
        ),
      ),
      table(
        [
          { label: 'N°', render: (s) => `#${s.id}` },
          { label: 'Pompiste', key: 'attendant_name' },
          { label: 'Pompes', render: (s) => s.pumps || '—' },
          { label: 'Ouverture', render: (s) => fmt.dateTime(s.opened_at) },
          { label: 'Clôture', render: (s) => fmt.dateTime(s.closed_at) },
          { label: 'Litres', align: 'right', render: (s) => (s.total_liters == null ? '—' : fmt.liters(s.total_liters)) },
          { label: 'Ventes', align: 'right', render: (s) => (s.total_amount == null ? '—' : fmt.money(s.total_amount)) },
          { label: 'Écart caisse', align: 'right', render: (s) => varianceCell(s.variance, tol) },
          { label: 'Statut', render: (s) => shiftBadge(s.status) },
        ],
        shifts,
        {
          onRowClick: (s) => ctx.navigate(`postes/${s.id}`),
          empty: filter === 'closed' ? 'Aucun poste en attente de validation.' : 'Aucun poste.',
        },
      ),
    ),
  );
}

export async function renderShiftDetail(page, ctx) {
  const shift = await api.get(`/shifts/${ctx.id}`);
  const isManager = ctx.state.user.role === 'manager';
  const backPath = isManager ? 'postes' : 'historique';
  page.replaceChildren(
    h('a', { class: 'back no-print', href: `#/${backPath}` }, icon('back'), isManager ? 'Postes' : 'Historique'),
    pageHeader(
      `Poste n°${shift.id}`,
      `${shift.attendant_name} · ${fmt.dateTime(shift.opened_at)} → ${shift.closed_at ? fmt.dateTime(shift.closed_at) : 'en cours'}`,
      shiftBadge(shift.status),
      shift.status !== 'open' ? button('Imprimer', () => window.print(), { variant: 'secondary', iconName: 'print' }) : null,
      isManager && shift.status === 'closed'
        ? button('Valider le poste', async () => {
            const ok = await formDialog({
              title: `Valider le poste n°${shift.id}`,
              intro: `Écart de caisse : ${fmt.signedMoney(shift.variance)}. Ajoutez un commentaire si nécessaire (explication de l'écart, retenue…).`,
              grid: false,
              fields: [{ name: 'comment', label: 'Commentaire', type: 'textarea' }],
              submitLabel: 'Valider',
              onSubmit: (d) => api.post(`/shifts/${shift.id}/validate`, d),
            });
            if (ok) {
              toast('Poste validé.');
              renderShiftDetail(page, ctx);
            }
          }, { iconName: 'check' })
        : null,
    ),
    shiftSummary(shift, ctx.state.settings.cashTolerance, ctx.state.settings.loyaltyEnabled),
  );
}

// Shared by the manager detail page and the attendant's end-of-shift screen.
export function shiftSummary(shift, tolerance, loyalty) {
  const closed = shift.status !== 'open';
  return h(
    'div',
    { class: 'stack' },
    closed
      ? h(
          'div',
          { class: 'grid grid-4' },
          kpi('Ventes totales', fmt.money(shift.total_amount), fmt.liters(shift.total_liters)),
          kpi('Crédit clients', fmt.money(shift.credit_amount), 'Non encaissé'),
          kpi('À remettre', fmt.money(shift.expected_amount), `Déclaré : ${fmt.money(shift.cash + shift.card)}`),
          kpi('Écart de caisse', varianceCell(shift.variance, tolerance), Math.abs(shift.variance) <= tolerance ? 'Dans la tolérance' : `Tolérance : ± ${fmt.money(tolerance)}`),
        )
      : null,
    h(
      'section',
      { class: 'card flush' },
      h('div', { class: 'card-header' }, h('h2', {}, 'Index des pistolets')),
      table(
        [
          { label: 'Pompe', render: (r) => `${r.pump_name} · ${r.nozzle_name}` },
          { label: 'Produit', key: 'product_name' },
          { label: 'Index début', align: 'right', render: (r) => fmt.number(r.start_meter) },
          { label: 'Index fin', align: 'right', render: (r) => (r.end_meter == null ? '—' : fmt.number(r.end_meter)) },
          { label: 'Litres', align: 'right', render: (r) => (r.liters == null ? '—' : fmt.liters(r.liters)) },
          { label: 'Prix', align: 'right', render: (r) => fmt.price(r.unit_price) },
          { label: 'Montant', align: 'right', render: (r) => (r.amount == null ? '—' : fmt.money(r.amount)) },
        ],
        shift.readings,
      ),
    ),
    h(
      'section',
      { class: 'card flush' },
      h('div', { class: 'card-header' }, h('h2', {}, 'Ventes clients'), h('p', {}, `${shift.sales.length} vente${shift.sales.length > 1 ? 's' : ''}`)),
      table(
        [
          { label: 'Heure', render: (s) => fmt.time(s.created_at) },
          { label: 'Client', key: 'customer_name' },
          { label: 'Type', render: (s) => (s.kind === 'credit' ? 'Crédit' : loyalty ? `Fidélité (+${s.points} pts)` : 'Particulier') },
          { label: 'Véhicule', render: (s) => s.plate || '—' },
          { label: 'Produit', key: 'product_name' },
          { label: 'Litres', align: 'right', render: (s) => fmt.liters(s.liters) },
          { label: 'Montant', align: 'right', render: (s) => fmt.money(s.amount) },
        ],
        shift.sales,
        { empty: 'Aucune vente client sur ce poste.' },
      ),
    ),
    closed
      ? card(
          cardHeader('Caisse'),
          h('div', { class: 'summary-line' }, h('span', {}, 'Espèces'), h('span', {}, fmt.money(shift.cash))),
          h('div', { class: 'summary-line' }, h('span', {}, 'Cartes'), h('span', {}, fmt.money(shift.card))),
          h('div', { class: 'summary-line total' }, h('span', {}, 'Total déclaré'), h('span', {}, fmt.money(shift.cash + shift.card))),
          shift.notes ? h('p', { class: 'muted', style: 'margin-top:12px' }, `Remarque du pompiste : ${shift.notes}`) : null,
          shift.status === 'validated'
            ? h('p', { class: 'muted', style: 'margin-top:8px' }, `Validé par ${shift.validated_by_name} le ${fmt.dateTime(shift.validated_at)}${shift.manager_comment ? ` — ${shift.manager_comment}` : ''}`)
            : null,
        )
      : null,
  );
}
