import { flags } from '../ui.js';
import { api } from '../api.js';
import { h, fmt, pageHeader, card, cardHeader, table, segmented, shiftBadge, varianceCell, kpi, formDialog, confirmDialog, toast, button, badge, setContent } from '../ui.js';
import { icon } from '../icons.js';

let filter = 'closed';

export async function renderShifts(page, ctx) {
  const shifts = await api.get(`/shifts${filter === 'all' ? '' : `?status=${filter}`}`);
  const tol = ctx.state.settings.cashTolerance;

  setContent(page, 
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
          { label: 'Statut', render: (s) => h('span', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, shiftBadge(s.status), s.over_limit_count ? badge('Crédit hors plafond', 'serious') : null) },
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
  setContent(page, 
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
    isManager ? cancellationRequests(shift, () => renderShiftDetail(page, ctx)) : null,
    shiftSummary(shift, ctx.state.settings.cashTolerance),
  );
}

// Operations the attendant asked to cancel: they stay counted until the manager decides.
function cancellationRequests(shift, reload) {
  const items = [
    ...shift.sales.map((x) => ({ x, kind: 'sales', title: `Vente · ${x.customer_name}`, detail: `${x.product_name} · ${fmt.liters(x.liters)}`, amount: x.amount })),
    ...shift.payments.map((x) => ({ x, kind: 'payments', title: `Règlement · ${x.customer_name}`, detail: x.method, amount: x.amount })),
    ...shift.expenses.map((x) => ({ x, kind: 'expenses', title: `Dépense · ${x.category}`, detail: x.description, amount: x.amount })),
  ].filter((i) => i.x.cancel_requested_at);
  if (!items.length) return null;
  const decide = async (i, cancel) => {
    if (cancel && !(await confirmDialog('Annuler cette opération ?', `${i.title} · ${fmt.money(i.amount)}. Elle sera retirée du poste et du compte du client.`, { confirmLabel: 'Annuler l’opération', danger: true }))) return;
    try {
      const url = `/shifts/${shift.id}/${i.kind}/${i.x.id}`;
      if (cancel) await api.del(url);
      else await api.post(`${url}/keep`);
      toast(cancel ? 'Opération annulée.' : 'Opération conservée.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return card(
    cardHeader('Annulations à valider', `${items.length > 1 ? `${items.length} opérations comptent` : 'Cette opération compte'} encore dans le poste tant que vous n’avez pas décidé.`),
    items.map((i) =>
      h(
        'div',
        { class: 'nozzle-row' },
        h(
          'div',
          { class: 'grow' },
          h('div', { style: 'font-weight:600' }, i.title),
          h('div', { class: 'muted small' }, `${fmt.time(i.x.created_at)} · ${i.detail} · demandé à ${fmt.time(i.x.cancel_requested_at)}`),
          i.x.cancel_reason ? h('div', { class: 'small', style: 'margin-top:2px' }, `Raison : ${i.x.cancel_reason}`) : null,
        ),
        h('div', { class: 'num', style: 'font-weight:600' }, fmt.money(i.amount)),
        h(
          'div',
          { class: 'row no-print', style: 'gap:6px' },
          button('Garder', () => decide(i, false), { variant: 'secondary sm' }),
          button('Annuler', () => decide(i, true), { variant: 'destructive sm' }),
        ),
      ),
    ),
  );
}

// Shared by the manager detail page and the attendant's end-of-shift screen.
export function shiftSummary(shift, tolerance) {
  const closed = shift.status !== 'open';
  return h(
    'div',
    { class: 'stack' },
    closed
      ? h(
          'div',
          { class: 'grid grid-4' },
          kpi('Ventes totales', fmt.money(shift.total_amount), fmt.liters(shift.total_liters)),
          kpi('Crédit clients', fmt.money(shift.credit_amount), shift.combo_amount ? `+ ${fmt.money(shift.combo_amount)} échangés en combos` : 'Non encaissé'),
          kpi('À remettre', fmt.money(shift.expected_amount), [shift.payments_amount ? `+ ${fmt.money(shift.payments_amount)} règlements` : null, shift.expenses_amount ? `− ${fmt.money(shift.expenses_amount)} dépenses` : null].filter(Boolean).join(' · ') || `Déclaré : ${fmt.money(shift.cash + shift.card)}`),
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
          {
            label: 'Paiement',
            render: (s) =>
              h(
                'span',
                { class: 'row', style: 'gap:6px;flex-wrap:nowrap' },
                s.kind === 'credit' ? (s.over_limit ? badge('Crédit hors plafond', 'serious') : badge('Crédit', 'info')) : s.kind === 'combo' ? badge('Combos', 'warning') : badge('Payé', 'good'),
                s.source === 'customer' ? badge('Demande client') : null,
              ),
          },
          ...(flags.combos ? [{ label: 'Combos', align: 'right', render: (s) => (s.points ? `+${s.points}` : s.combos_used ? `−${s.combos_used}` : s.points_due ? `+${s.points_due} au paiement` : '—') }] : []),
          { label: 'Véhicule', render: (s) => s.plate || '—' },
          { label: 'Produit', key: 'product_name' },
          { label: 'Litres', align: 'right', render: (s) => fmt.liters(s.liters) },
          { label: 'Montant', align: 'right', render: (s) => fmt.money(s.amount) },
        ],
        shift.sales,
        { empty: 'Aucune vente client sur ce poste.' },
      ),
    ),
    shift.payments.length
      ? h(
          'section',
          { class: 'card flush' },
          h('div', { class: 'card-header' }, h('h2', {}, 'Règlements encaissés'), h('p', {}, 'Ajoutés au montant à remettre')),
          table(
            [
              { label: 'Heure', render: (p) => fmt.time(p.created_at) },
              { label: 'Client', key: 'customer_name' },
              { label: 'Mode', key: 'method' },
              { label: 'Référence', render: (p) => p.reference || '—' },
              { label: 'Montant', align: 'right', render: (p) => fmt.money(p.amount) },
            ],
            shift.payments,
          ),
        )
      : null,
    shift.expenses.length
      ? h(
          'section',
          { class: 'card flush' },
          h('div', { class: 'card-header' }, h('h2', {}, 'Dépenses payées en caisse'), h('p', {}, 'Déduites du montant à remettre')),
          table(
            [
              { label: 'Heure', render: (e) => fmt.time(e.created_at) },
              { label: 'Catégorie', key: 'category' },
              { label: 'Description', wrap: true, render: (e) => e.description + (e.beneficiary ? ` · ${e.beneficiary}` : '') },
              { label: 'Montant', align: 'right', render: (e) => fmt.money(e.amount) },
            ],
            shift.expenses,
          ),
        )
      : null,
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
