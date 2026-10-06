import { flags, edit } from '../ui.js';
import { api } from '../api.js';
import { shiftLine, h, fmt, pageHeader, card, cardHeader, table, segmented, shiftBadge, varianceCell, kpi, formDialog, confirmDialog, actionSheet, toast, button, badge, setContent, reportLink, buttonRow, nameChips } from '../ui.js';
import { icon } from '../icons.js';
import { renderClosing } from './attendant.js';
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
    pageHeader('Postes', null),
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
          { label: 'Statut', render: (s) => h('span', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, shiftBadge(s.status), s.status === 'closed' && !s.counted_at ? badge('Argent à compter', 'warning') : null, s.over_limit_count ? badge('Crédit malgré le retard', 'serious') : null) },
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
    ),
    shiftLine(shift.status),
    remarkCard(shift, isManager),
    // Second step of the closing: the money, counted once the next shift has started.
    shift.status === 'closed' && !shift.counted_at
      ? h(
          'section',
          { class: 'card row between', style: 'margin-bottom:20px' },
          h('div', { style: 'flex:1;min-width:220px' }, h('h3', {}, 'Argent à compter')),
          isManager ? edit(button('Compter l’argent', closingBy('count'), { iconName: 'cash' })) : null,
        )
      : null,
    relaysCard(shift, ctx.state.settings.cashTolerance),
    isManager ? cancellationRequests(shift, () => renderShiftDetail(page, ctx)) : null,
    pumpTestsCard(shift, isManager, reload),
    shiftSummary(shift, ctx.state.settings.cashTolerance, isManager && !flags.readonly ? (kind, item) => operationMenu(ctx, shift, kind, item, reload) : null),
  );
}

// An operation the attendant entered wrongly: the manager corrects it or cancels it.
const KIND_TITLE = { sales: 'ce crédit', payments: 'ce règlement', momo: 'ce paiement mobile money', expenses: 'cette dépense' };
function operationMenu(ctx, shift, kind, item, reload) {
  if (kind === 'sales' && item.kind !== 'credit') return toast('Un échange de combos ne se modifie pas : annulez-le puis saisissez-le à nouveau.', 'error');
  actionSheet({
    title: `${fmt.time(item.created_at)} · ${fmt.money(item.amount)}`,
    actions: [
      { label: `Corriger ${KIND_TITLE[kind]}`, onClick: () => editOperation(ctx, shift, kind, item, reload) },
      {
        label: `Annuler ${KIND_TITLE[kind]}`,
        destructive: true,
        onClick: async () => {
          if (!(await confirmDialog('Annuler cette opération ?', null, { confirmLabel: 'Annuler l’opération', danger: true }))) return;
          try {
            await api.del(`/shifts/${shift.id}/${kind}/${item.id}`);
            toast('Opération annulée.');
            reload();
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      },
    ],
  });
}

async function editOperation(ctx, shift, kind, item, reload) {
  const payTo = nameChips(ctx.state.settings.supplierNames);
  const products = [...new Map(shift.readings.map((r) => [r.product_id, r.product_name])).entries()];
  const customers = kind === 'sales' || kind === 'payments' ? await api.get('/customers?form=1') : [];
  const customerField = { name: 'customerId', label: 'Client', type: 'select', options: customers.map((c) => [c.id, c.name]), value: item.customer_id, required: true };
  const forms = {
    sales: {
      title: 'Corriger le crédit',
      fields: [
        customerField,
        { name: 'productId', label: 'Produit', type: 'segment', options: products, value: item.product_id },
        { name: 'unit', label: 'Unité', type: 'segment', options: [['amount', '$'], ['liters', 'L']], value: 'amount' },
        { name: 'qty', label: 'Quantité', type: 'number', step: '0.01', min: '0.01', value: item.amount, required: true },
        { name: 'plate', label: 'Plaque', value: item.plate || undefined },
      ],
      body: (d) => ({ customerId: Number(d.customerId), productId: Number(d.productId), [d.unit === 'liters' ? 'liters' : 'amount']: Number(d.qty), plate: d.plate }),
    },
    payments: {
      title: 'Corriger le règlement',
      fields: [
        customerField,
        { name: 'amount', label: 'Montant ($)', type: 'number', step: '0.01', min: '0.01', value: item.amount, required: true },
        { name: 'method', label: 'Mode', type: 'segment', options: [['espèces', 'Espèces'], ['mobile money', 'Mobile money']], value: item.method },
        { name: 'reference', label: 'Référence', value: item.reference || undefined },
      ],
      body: (d) => ({ customerId: Number(d.customerId), amount: Number(d.amount), method: d.method, reference: d.reference }),
    },
    momo: {
      title: 'Corriger le paiement mobile money',
      fields: [
        { name: 'productId', label: 'Carburant', type: 'segment', options: products, value: item.product_id },
        { name: 'liters', label: 'Litres', type: 'number', step: '0.01', min: '0.01', value: item.liters, required: true },
      ],
      body: (d) => ({ productId: Number(d.productId), liters: Number(d.liters) }),
    },
    expenses: {
      title: 'Corriger la dépense',
      fields: [
        { name: 'amount', label: 'Montant ($)', type: 'number', step: '0.01', min: '0.01', value: item.amount, required: true },
        { name: 'category', label: 'Catégorie', type: 'select', options: ctx.state.settings.expenseCategories.map((c) => [c, c]), value: item.category },
        { name: 'description', label: 'Description', value: item.description, required: true },
        { name: 'beneficiary', label: 'Payé à', value: item.beneficiary || undefined, onInput: payTo.onInput },
        payTo.node,
      ],
      body: (d) => d,
    },
  }[kind];
  const ok = await formDialog({
    title: forms.title,
    submitLabel: 'Enregistrer la correction',
    grid: false,
    fields: forms.fields,
    onSubmit: (d) => api.put(`/shifts/${shift.id}/${kind}/${item.id}`, forms.body(d)),
  });
  if (ok) {
    toast('Opération corrigée.');
    reload();
  }
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
      pending ? `${pending > 1 ? `${pending} tests à décider` : '1 test à décider'}` : null,
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
    if (cancel && !(await confirmDialog('Annuler cette opération ?', `${i.title} · ${fmt.money(i.amount)}`, { confirmLabel: 'Annuler l’opération', danger: true }))) return;
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
    cardHeader('Annulations demandées', `${items.length} à décider`),
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
// onEdit(kind, item): the manager touches an operation to correct or cancel it.
export function shiftSummary(shift, tolerance, onEdit = null) {
  const editable = (kind) => (onEdit ? { onRowClick: (item) => onEdit(kind, item) } : {});
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
                s.kind === 'credit' ? (s.over_limit ? badge('Crédit malgré le retard', 'serious') : badge('Crédit', 'info')) : s.kind === 'combo' ? badge('Combos', 'warning') : badge('Payé', 'good'),
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
        { empty: 'Aucun crédit sur ce poste.', ...editable('sales') },
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
            editable('momo'),
          ),
        )
      : null,
    shift.payments.length
      ? h(
          'section',
          { class: 'card flush' },
          h('div', { class: 'card-header' }, h('h2', {}, 'Règlements encaissés'), h('p', {}, `${shift.payments.length} règlement${shift.payments.length > 1 ? 's' : ''} · ${fmt.money(shift.payments.reduce((t, p) => t + p.amount, 0))}`)),
          table(
            [
              { label: 'Heure', render: (p) => fmt.time(p.created_at) },
              { label: 'Client', key: 'customer_name' },
              { label: 'Mode', key: 'method' },
              { label: 'Référence', render: (p) => p.reference || '—' },
              { label: 'Montant', align: 'right', render: (p) => fmt.money(p.amount) },
            ],
            shift.payments,
            editable('payments'),
          ),
        )
      : null,
    shift.expenses.length
      ? h(
          'section',
          { class: 'card flush' },
          h('div', { class: 'card-header' }, h('h2', {}, 'Dépenses payées en caisse'), h('p', {}, `${shift.expenses.length} dépense${shift.expenses.length > 1 ? 's' : ''} · ${fmt.money(shift.expenses.reduce((t, e) => t + e.amount, 0))}`)),
          table(
            [
              { label: 'Heure', render: (e) => fmt.time(e.created_at) },
              { label: 'Catégorie', key: 'category' },
              { label: 'Description', wrap: true, render: (e) => e.description + (e.beneficiary ? ` · ${e.beneficiary}` : '') },
              { label: 'Montant', align: 'right', render: (e) => fmt.money(e.amount) },
            ],
            shift.expenses,
            editable('expenses'),
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
