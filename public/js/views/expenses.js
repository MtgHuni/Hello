import { api } from '../api.js';
import { flags, edit } from '../ui.js';
import { h, fmt, pageHeader, table, segmented, kpi, field, button, formDialog, confirmDialog, actionSheet, toast, todayISO, setContent } from '../ui.js';
import { PRESETS, presetRange } from './reports.js';

const METHODS = [
  ['espèces', 'Espèces'],
  ['mobile money', 'Mobile money'],
];

let preset = 'month';
let range = presetRange(preset);

export async function renderExpenses(page, ctx) {
  const data = await api.get(`/expenses?from=${range.from}&to=${range.to}`);
  const categories = ctx.state.settings.expenseCategories;
  const reload = () => renderExpenses(page, ctx);

  const from = field({ name: 'from', label: 'Du', type: 'date', value: range.from });
  const to = field({ name: 'to', label: 'Au', type: 'date', value: range.to });
  const onDate = () => {
    preset = null;
    range = { from: from.querySelector('input').value, to: to.querySelector('input').value };
    if (range.from && range.to) reload();
  };
  from.querySelector('input').addEventListener('change', onDate);
  to.querySelector('input').addEventListener('change', onDate);

  const fromTill = data.expenses.filter((e) => e.shift_id);
  const tillTotal = fromTill.reduce((t, e) => t + e.amount, 0);
  const top = data.byCategory[0];

  setContent(page, 
    pageHeader(
      'Dépenses',
      range.from === range.to ? fmt.longDay(range.from) : `Du ${fmt.date(range.from)} au ${fmt.date(range.to)}`,
      h('a', { class: 'btn secondary', href: `/api/expenses?from=${range.from}&to=${range.to}&format=csv` }, 'Exporter (Excel)'),
      edit(button('Nouvelle dépense', () => expenseDialog(null, categories, reload), { iconName: 'plus' })),
    ),
    h(
      'div',
      { class: 'row no-print', style: 'align-items:flex-end;margin-bottom:24px' },
      segmented(PRESETS, preset, (v) => {
        preset = v;
        range = presetRange(v);
        reload();
      }),
      h('span', { class: 'spacer' }),
      from,
      to,
    ),
    h(
      'div',
      { class: 'grid grid-4' },
      kpi('Total des dépenses', fmt.money(data.total), `${data.expenses.length} dépense${data.expenses.length > 1 ? 's' : ''}`),
      kpi('Premier poste', top ? top.category : '—', top ? fmt.money(top.amount) : 'Aucune dépense', { small: true }),
      kpi('Payées avec la caisse', fmt.money(tillTotal), 'Par les pompistes, pendant leur poste'),
      kpi('Payées par le gérant', fmt.money(data.total - tillTotal), 'Espèces, mobile money'),
    ),
    data.byCategory.length
      ? h('section', { class: 'card section' }, h('div', { class: 'card-header' }, h('div', {}, h('h2', {}, 'Par catégorie'), h('p', {}, 'Montant dépensé sur la période'))), categoryBars(data.byCategory))
      : null,
    h(
      'section',
      { class: 'card flush section' },
      h('div', { class: 'card-header' }, h('h2', {}, 'Détail'), h('p', {}, 'Touchez une dépense pour la modifier')),
      table(
        [
          { label: 'Date', render: (e) => fmt.date(e.expense_date) },
          { label: 'Catégorie', key: 'category' },
          {
            label: 'Description',
            wrap: true,
            render: (e) => h('div', {}, h('div', {}, e.description), e.beneficiary ? h('div', { class: 'muted small' }, e.beneficiary) : null),
          },
          { label: 'Payée', render: (e) => (e.shift_id ? `Caisse, poste n°${e.shift_id}` : `${METHODS.find(([m]) => m === e.method)?.[1] || e.method}`) },
          { label: 'Saisie par', render: (e) => e.user_name || '—' },
          { label: 'Montant', align: 'right', render: (e) => h('strong', {}, fmt.money(e.amount)) },
        ],
        data.expenses,
        {
          empty: 'Aucune dépense sur cette période.',
          onRowClick: (e) => rowActions(e, categories, ctx, reload),
        },
      ),
    ),
  );
}

// Horizontal bars, one hue (magnitude), each value labelled directly.
function categoryBars(rows) {
  const max = Math.max(...rows.map((r) => r.amount), 1);
  return h(
    'div',
    { class: 'hbars', role: 'list' },
    rows.map((r, i) =>
      h(
        'div',
        { class: 'hbar-row', role: 'listitem' },
        h('span', { class: 'hbar-label' }, r.category),
        h('span', { class: 'hbar-track' }, h('span', { class: 'hbar-fill', style: `width:${(r.amount / max) * 100}%;--i:${i}` })),
        h('span', { class: 'hbar-value num' }, fmt.money(r.amount)),
      ),
    ),
  );
}

function rowActions(e, categories, ctx, reload) {
  if (flags.readonly) return e.shift_id ? ctx.navigate(`postes/${e.shift_id}`) : null;
  if (e.shift_id) {
    actionSheet({
      title: `Payée avec la caisse du poste n°${e.shift_id} : elle fait partie de son rapprochement et ne peut pas être modifiée ici.`,
      actions: [{ label: `Voir le poste n°${e.shift_id}`, onClick: () => ctx.navigate(`postes/${e.shift_id}`) }],
    });
    return;
  }
  actionSheet({
    title: `${e.description} · ${fmt.money(e.amount)}`,
    actions: [
      { label: 'Modifier', onClick: () => expenseDialog(e, categories, reload) },
      {
        label: 'Supprimer',
        destructive: true,
        onClick: async () => {
          if (!(await confirmDialog('Supprimer cette dépense ?', `${e.description} · ${fmt.money(e.amount)}`, { confirmLabel: 'Supprimer', danger: true }))) return;
          try {
            await api.del(`/expenses/${e.id}`);
            toast('Dépense supprimée');
            reload();
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      },
    ],
  });
}

async function expenseDialog(e, categories, reload) {
  const ok = await formDialog({
    title: e ? 'Modifier la dépense' : 'Nouvelle dépense',
    submitLabel: 'Enregistrer',
    fields: [
      { name: 'amount', label: 'Montant ($)', type: 'number', step: '0.01', min: '0.01', value: e?.amount, required: true },
      { name: 'expenseDate', label: 'Date', type: 'date', value: e?.expense_date || todayISO(), required: true },
      { name: 'category', label: 'Catégorie', type: 'select', options: categories.map((c) => [c, c]), value: e?.category, required: true },
      { name: 'method', label: 'Payée par', type: 'select', options: METHODS, value: e?.method || 'espèces' },
      { name: 'description', label: 'Description', value: e?.description, required: true, full: true, placeholder: 'Ex. : salaire de septembre, carburant du générateur…' },
      { name: 'beneficiary', label: 'Bénéficiaire', value: e?.beneficiary, placeholder: 'Facultatif' },
      { name: 'reference', label: 'Référence / n° de reçu', value: e?.reference, placeholder: 'Facultatif' },
    ],
    onSubmit: (d) => (e ? api.put(`/expenses/${e.id}`, d) : api.post('/expenses', d)),
  });
  if (ok) {
    toast(e ? 'Dépense modifiée' : 'Dépense enregistrée');
    reload();
  }
}
