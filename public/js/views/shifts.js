import { flags, edit } from '../ui.js';
import { api } from '../api.js';
import { shiftLine, h, fmt, pageHeader, card, cardHeader, table, segmented, shiftBadge, varianceCell, kpi, formDialog, confirmDialog, actionSheet, toast, button, badge, setContent, reportLink, buttonRow } from '../ui.js';
import { icon } from '../icons.js';
import { renderClosing, addCredit, addPayment, addMomo, addExpense, addTest } from './attendant.js';
import { reportCard } from './relay.js';
import { renderShiftStatus } from './shiftStatus.js';

// Money handed over, in dollars.
const declared = (s) => (s.cash || 0) + (s.change_left || 0) + (s.mobile_money || 0);

let filter = 'all';
let attendantFilter = '';

// From the Reports screen: every shift of one attendant.
export function showShiftsOf(attendantId) {
  attendantFilter = String(attendantId);
  filter = 'all';
}

export async function renderShifts(page, ctx) {
  const params = new URLSearchParams();
  if (filter !== 'all') params.set('status', filter);
  if (attendantFilter) params.set('attendant', attendantFilter);
  const [shifts, users] = await Promise.all([api.get(`/shifts?${params}`), api.get('/users')]);
  const who = h(
    'select',
    { class: 'header-select', 'aria-label': 'Pompiste' },
    h('option', { value: '' }, 'Tous les pompistes'),
    users.map((u) => h('option', { value: String(u.id), selected: String(u.id) === attendantFilter }, u.name)),
  );
  who.addEventListener('change', () => {
    attendantFilter = who.value;
    renderShifts(page, ctx);
  });
  const tol = ctx.state.settings.cashTolerance;
  // One column of litres per fuel (gasoil, essence), from the closed shifts' indexes.
  const fuels = [...new Map(shifts.flatMap((s) => s.liters_by_product).map((p) => [p.product_id, p.name])).entries()];
  const litersOf = (s, id) => {
    const p = s.liters_by_product.find((x) => x.product_id === id);
    return p ? fmt.liters(p.liters) : '—';
  };

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
            ['all', 'Tous'],
            ['open', 'En cours'],
            ['closed', 'Clôturés'],
          ],
          filter,
          (v) => {
            filter = v;
            renderShifts(page, ctx);
          },
        ),
        who,
      ),
      table(
        [
          { label: 'N°', render: (s) => `#${s.id}` },
          { label: 'Pompiste', key: 'attendant_name' },
          { label: 'Ouverture', render: (s) => fmt.dateTime(s.opened_at) },
          { label: 'Clôture', render: (s) => fmt.dateTime(s.closed_at) },
          ...(fuels.length
            ? fuels.map(([id, name]) => ({ label: name, align: 'right', render: (s) => litersOf(s, id) }))
            : [{ label: 'Litres', align: 'right', render: (s) => (s.total_liters == null ? '—' : fmt.liters(s.total_liters)) }]),
          { label: 'Ventes', align: 'right', render: (s) => (s.total_amount == null ? '—' : fmt.money(s.total_amount)) },
          { label: 'Écart caisse', align: 'right', render: (s) => varianceCell(s.variance, tol) },
          { label: 'Statut', render: (s) => h('span', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, shiftBadge(s.status), s.status === 'closed' && !s.counted_at ? badge('Argent à compter', 'warning') : null, s.over_limit_count ? badge('Crédit hors plafond', 'serious') : null) },
        ],
        shifts,
        {
          onRowClick: (s) => ctx.navigate(`postes/${s.id}`),
          empty: 'Aucun poste.',
        },
      ),
    ),
  );
}

export async function renderShiftDetail(page, ctx) {
  const isManager = ['manager', 'owner'].includes(ctx.state.user.role);
  if (ctx.sub === 'etat' && isManager) return renderShiftStatus(page, ctx);
  const shift = await api.get(`/shifts/${ctx.id}`);
  const backPath = isManager ? 'postes' : 'historique';
  const reload = () => renderShiftDetail(page, ctx);
  const closingBy = (mode) => () =>
    renderClosing(page, ctx, shift, { mode, onBack: reload, onDone: (closed) => (toast(mode === 'correct' ? 'Clôture corrigée.' : mode === 'count' ? 'Argent compté.' : `Poste clôturé · poste n°${closed.next_shift_id} ouvert`), reload()) });
  setContent(page, 
    h('a', { class: 'back no-print', href: `#/${backPath}` }, icon('back'), isManager ? 'Postes' : 'Historique'),
    pageHeader(
      `Poste n°${shift.id}`,
      `${shift.attendant_name} · ${fmt.dateTime(shift.opened_at)} → ${shift.closed_at ? fmt.dateTime(shift.closed_at) : 'en cours'}`,
      shiftBadge(shift.status),
      shift.status !== 'open' ? reportLink(shift.id) : null,
      isManager && shift.status === 'open' ? button('État du poste', () => ctx.navigate(`postes/${shift.id}/etat`), { variant: 'secondary', iconName: 'chart' }) : null,
      isManager && shift.status === 'open' ? edit(button('Clôturer le poste', closingBy('manager'), { variant: shift.closing_due ? '' : 'secondary', iconName: 'shifts' })) : null,
      isManager && shift.status === 'closed' ? edit(button('Corriger la clôture', closingBy('correct'), { variant: 'secondary', iconName: 'edit' })) : null,
      isManager && shift.status === 'closed' ? edit(button('Ajouter un oubli', () => forgotten(ctx, shift, reload), { variant: 'secondary', iconName: 'plus' })) : null,
      isManager && shift.status !== 'open' && !flags.readonly ? button(shift.manager_comment ? 'Modifier la remarque' : 'Remarque au pompiste', () => remarkDialog(shift, reload), { variant: 'secondary', iconName: 'message' }) : null,
    ),
    shiftLine(shift.status),
    remarkCard(shift, isManager),
    // Second step of the closing: the money, counted once the next shift has started.
    shift.status === 'closed' && !shift.counted_at
      ? h(
          'section',
          { class: 'card row between', style: 'margin-bottom:20px' },
          h('div', { style: 'flex:1;min-width:220px' }, h('h3', {}, 'Argent à compter'), h('p', { class: 'muted', style: 'font-size:15px;margin-top:2px' }, 'Le poste est clôturé et le suivant a commencé. Comptez la monnaie laissée et les espèces remises : l’écart se calcule alors.')),
          isManager ? edit(button('Compter l’argent', closingBy('count'), { iconName: 'cash' })) : null,
        )
      : null,
    relaysCard(shift, ctx.state.settings.cashTolerance),
    isManager ? cancellationRequests(shift, () => renderShiftDetail(page, ctx)) : null,
    pumpTestsCard(shift, isManager, reload),
    shiftSummary(shift, ctx.state.settings.cashTolerance),
  );
}

// A forgotten operation, added after the closing: the shift's amounts and variance are recomputed.
function forgotten(ctx, shift, reload) {
  actionSheet({
    title: `Ajouter un oubli au poste n°${shift.id} : le poste sera recalculé`,
    actions: [
      { label: 'Crédit', onClick: () => addCredit(ctx, shift, reload) },
      { label: 'Règlement client', onClick: () => addPayment(shift, reload) },
      { label: 'Payé en mobile money', onClick: () => addMomo(shift, reload) },
      { label: 'Dépense payée en caisse', onClick: () => addExpense(ctx, shift, reload) },
      { label: 'Test de pompe', onClick: () => addTest(ctx, shift, reload) },
    ],
  });
}

// Who worked on the shift, and each relief, evening closing and morning opening with its report.
function relaysCard(shift, tol) {
  if (!shift.attendants?.length && !shift.checkpoints?.length) return null;
  const times = (a) => `${fmt.dateTime(a.joined_at)} → ${a.left_at ? fmt.dateTime(a.left_at) : 'en service'}`;
  return h(
    'section',
    { class: 'card section', style: 'margin-bottom:20px' },
    cardHeader(
      'Pompistes et relèves',
      [shift.station_closed_at ? `Station fermée depuis ${fmt.time(shift.station_closed_at)}` : null, shift.on_duty?.length ? `En service : ${shift.on_duty.join(', ')}` : null].filter(Boolean).join(' · ') || null,
    ),
    shift.attendants.map((a) => h('div', { class: 'summary-line' }, h('span', {}, a.name), h('span', { class: 'muted small' }, times(a)))),
    shift.checkpoints.length
      ? h(
          'div',
          { class: 'report-list' },
          shift.checkpoints.map((c) =>
            h(
              'details',
              { class: 'report-ops' },
              h('summary', {}, `${c.label} · ${c.by || ''} · ${fmt.dateTime(c.at)} · écart ${fmt.signedMoney(c.variance)}`),
              reportCard(c, tol),
            ),
          ),
        )
      : null,
  );
}

// The manager's remark, read by the attendant; the manager sees whether it was read.
function remarkCard(shift, isManager) {
  if (!shift.manager_comment) return null;
  const read = shift.comment_seen_at ? `Lue par le pompiste le ${fmt.dateTime(shift.comment_seen_at)}` : 'Pas encore lue par le pompiste';
  return h(
    'section',
    { class: 'card remark-card' },
    cardHeader('Remarque du gérant', [shift.manager_comment_by_name, shift.manager_comment_at ? fmt.dateTime(shift.manager_comment_at) : null].filter(Boolean).join(' · ')),
    h('p', { class: 'remark-text' }, shift.manager_comment),
    isManager ? h('p', { class: 'muted small' }, read) : null,
  );
}

async function remarkDialog(shift, reload) {
  const saved = await formDialog({
    title: `Remarque · poste n°${shift.id}`,
    intro: `Le pompiste ${shift.attendant_name} la lira dans son historique. Laissez vide pour la retirer.`,
    grid: false,
    autofocus: true,
    fields: [{ name: 'comment', label: 'Remarque', type: 'textarea', value: shift.manager_comment || undefined }],
    submitLabel: 'Enregistrer',
    onSubmit: (d) => api.post(`/shifts/${shift.id}/remark`, d),
  });
  if (saved) {
    toast(saved.manager_comment ? 'Remarque enregistrée.' : 'Remarque retirée.');
    reload();
  }
}

// Pump tests: fuel drawn and poured back into the tank. Approved, it is not sold (the shift is
// recomputed even after its closing); refused, the meter counts it as sold.
function pumpTestsCard(shift, isManager, reload) {
  const tests = shift.pump_tests || [];
  if (!tests.length) return null;
  const pending = tests.filter((t) => t.status === 'pending').length;
  const decide = async (t, approve) => {
    try {
      await api.post(`/shifts/${shift.id}/tests/${t.id}/decide`, { approve });
      toast(approve ? `Test confirmé : ${fmt.liters(t.liters)} remis en cuve` : 'Test annulé : compté comme vendu');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  // Once confirmed, the test is just shown: only a cancelled or waiting one carries a sign.
  const status = (t) => (t.status === 'rejected' ? badge('Annulé', 'serious') : t.status === 'pending' ? badge('À confirmer', 'warning') : null);
  return h(
    'section',
    { class: 'card section', style: 'margin-bottom:20px' },
    cardHeader(
      'Tests de pompe',
      pending ? `${pending > 1 ? `${pending} tests attendent` : 'Un test attend'} ${flags.readonly ? 'la décision du gérant' : 'votre décision'} : confirmé, le carburant n’est pas compté comme vendu.` : 'Carburant sorti pour un test et remis dans la cuve.',
    ),
    tests.map((t) =>
      h(
        'div',
        { class: 'nozzle-row' },
        h(
          'div',
          { class: 'grow' },
          h('div', { style: 'font-weight:600' }, t.product_name),
          h('div', { class: 'muted small' }, [fmt.time(t.created_at), t.user_name, t.note, t.decided_by_name && t.status === 'rejected' ? `annulé par ${t.decided_by_name}` : null].filter(Boolean).join(' · ')),
        ),
        h('div', { class: 'num', style: 'font-weight:600' }, fmt.liters(t.liters)),
        isManager && !flags.readonly && t.status === 'pending'
          ? buttonRow([button('Confirmer', () => decide(t, true), { variant: 'sm' }), button('Annuler', () => decide(t, false), { variant: 'destructive sm' })])
          : status(t),
      ),
    ),
  );
}

// Operations the attendant asked to cancel: they stay counted until the manager decides.
function cancellationRequests(shift, reload) {
  const items = [
    ...shift.sales.map((x) => ({ x, kind: 'sales', title: `${x.kind === 'credit' ? 'Crédit' : x.kind === 'combo' ? 'Combos' : 'Vente'} · ${x.customer_name}`, detail: `${x.product_name} · ${fmt.liters(x.liters)}`, amount: x.amount })),
    ...shift.payments.map((x) => ({ x, kind: 'payments', title: `Règlement · ${x.customer_name}`, detail: x.method, amount: x.amount })),
    ...shift.momo.map((x) => ({ x, kind: 'momo', title: 'Payé en mobile money', detail: `${x.product_name} · ${fmt.liters(x.liters)}`, amount: x.amount })),
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
    cardHeader('Annulations demandées', `${items.length > 1 ? `${items.length} opérations comptent` : 'Cette opération compte'} encore dans le poste tant que vous n’avez pas décidé.`),
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
        flags.readonly ? badge('En attente du gérant', 'warning') : buttonRow([button('Garder', () => decide(i, false), { variant: 'secondary sm' }), button('Annuler', () => decide(i, true), { variant: 'destructive sm' })]),
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
          kpi('Ventes totales', fmt.money(shift.total_amount), shift.liters_by_product.length ? shift.liters_by_product.map((p) => `${p.name} ${fmt.liters(p.liters)}`).join(' · ') : fmt.liters(shift.total_liters)),
          kpi('Crédit clients', fmt.money(shift.credit_amount), shift.combo_amount ? `+ ${fmt.money(shift.combo_amount)} échangés en combos` : 'Non encaissé'),
          kpi('À remettre', fmt.money(shift.expected_amount), [shift.payments_amount ? `+ ${fmt.money(shift.payments_amount)} règlements` : null, shift.expenses_amount ? `− ${fmt.money(shift.expenses_amount)} dépenses` : null].filter(Boolean).join(' · ') || `Déclaré : ${fmt.money(declared(shift))}`),
          kpi('Écart de caisse', varianceCell(shift.variance, tolerance), !shift.counted_at ? 'Argent à compter' : Math.abs(shift.variance) <= tolerance ? 'Dans la tolérance' : `Tolérance : ± ${fmt.money(tolerance)}`),
        )
      : null,
    h(
      'section',
      { class: 'card flush' },
      h('div', { class: 'card-header' }, h('h2', {}, 'Index')),
      table(
        [
          { label: 'Produit', key: 'product_name' },
          { label: 'Index début', align: 'right', render: (r) => fmt.number(r.start_meter) },
          { label: 'Index fin', align: 'right', render: (r) => (r.end_meter == null ? '—' : fmt.number(r.end_meter)) },
          ...(shift.readings.some((r) => r.tested) ? [{ label: 'Tests (remis en cuve)', align: 'right', render: (r) => (r.tested ? `−${fmt.liters(r.tested)}` : '—') }] : []),
          { label: 'Litres vendus', align: 'right', render: (r) => (r.liters == null ? '—' : fmt.liters(r.liters)) },
          { label: 'Prix', align: 'right', render: (r) => fmt.price(r.unit_price) },
          { label: 'Montant', align: 'right', render: (r) => (r.amount == null ? '—' : fmt.money(r.amount)) },
        ],
        shift.readings,
      ),
    ),
    h(
      'section',
      { class: 'card flush' },
      h('div', { class: 'card-header' }, h('h2', {}, 'Crédits et demandes clients'), h('p', {}, `${shift.sales.length} opération${shift.sales.length > 1 ? 's' : ''}`)),
      table(
        [
          { label: 'Heure', render: (s) => fmt.time(s.created_at) },
          { label: 'Client', key: 'customer_name' },
          {
            label: 'Paiement',
            render: (s) =>
              h(
                'span',
                { class: 'row', style: 'gap:6px' },
                s.kind === 'credit' ? (s.over_limit ? badge('Crédit hors plafond', 'serious') : badge('Crédit', 'info')) : s.kind === 'combo' ? badge('Combos', 'warning') : badge('Payé', 'good'),
                s.source === 'customer' ? badge('Demande client') : null,
              ),
          },
          ...(flags.combos ? [{ label: 'Combos', align: 'right', render: (s) => (s.points ? `+${s.points}` : s.combos_used ? `−${s.combos_used}` : s.points_due ? `+${s.points_due} dû` : '—') }] : []),
          { label: 'Véhicule', render: (s) => s.plate || '—' },
          { label: 'Produit', key: 'product_name' },
          { label: 'Litres', align: 'right', render: (s) => fmt.liters(s.liters) },
          { label: 'Montant', align: 'right', render: (s) => fmt.money(s.amount) },
        ],
        shift.sales,
        { empty: 'Aucun crédit sur ce poste.' },
      ),
    ),
    shift.momo.length
      ? h(
          'section',
          { class: 'card flush' },
          h('div', { class: 'card-header' }, h('h2', {}, 'Payé en mobile money'), h('p', {}, `${shift.momo.length} paiement${shift.momo.length > 1 ? 's' : ''} · ${fmt.money(shift.momo.reduce((t, m) => t + m.amount, 0))}`)),
          table(
            [
              { label: 'Heure', render: (m) => fmt.time(m.created_at) },
              { label: 'Carburant', key: 'product_name' },
              { label: 'Litres', align: 'right', render: (m) => fmt.liters(m.liters) },
              { label: 'Par', render: (m) => m.user_name || '—' },
              { label: 'Montant', align: 'right', render: (m) => fmt.money(m.amount) },
            ],
            shift.momo,
          ),
        )
      : null,
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
    closed && shift.counted_at
      ? card(
          cardHeader('Caisse'),
          shift.change_received ? h('div', { class: 'summary-line' }, h('span', {}, 'Monnaie reçue à l’ouverture'), h('span', {}, fmt.money(shift.change_received))) : null,
          h('div', { class: 'summary-line' }, h('span', {}, 'Espèces remises'), h('span', {}, fmt.money(shift.cash))),
          shift.change_left ? h('div', { class: 'summary-line' }, h('span', {}, 'Monnaie laissée aux pompistes'), h('span', {}, fmt.money(shift.change_left))) : null,
          shift.mobile_money ? h('div', { class: 'summary-line' }, h('span', {}, 'Mobile money (saisi au fil du poste)'), h('span', {}, fmt.money(shift.mobile_money))) : null,
          h('div', { class: 'summary-line total' }, h('span', {}, 'Total déclaré'), h('span', {}, fmt.money(declared(shift)))),
          shift.notes ? h('p', { class: 'muted', style: 'margin-top:12px' }, `Remarque : ${shift.notes}`) : null,
        )
      : null,
  );
}
