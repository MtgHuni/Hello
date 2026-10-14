import { api } from '../api.js';
import { flags, adminEdit, canAdmin } from '../ui.js';
import { h, fmt, pageHeader, card, cardHeader, table, segmented, kpi, field, button, formDialog, confirmDialog, actionSheet, toast, setContent, pdfLinks } from '../ui.js';
import { PRESETS, presetRange } from './reports.js';

// Cash book: cash (espèces) and mobile money are two separate balances. Mobile money only
// reaches the till when it is withdrawn. Shifts, payments, expenses, deliveries paid on the
// spot and supplier payments come in by themselves; the rest is entered here.

const ACCOUNTS = [
  ['cash', 'Espèces'],
  ['momo', 'Mobile money'],
];
// Movements entered by hand: an entry or an exit, with its reason; from mobile money, also a
// withdrawal to the till.
const KINDS = {
  cash: [
    ['autre_entree', 'Entrée'],
    ['autre_sortie', 'Sortie'],
  ],
  momo: [
    ['autre_entree', 'Entrée'],
    ['autre_sortie', 'Sortie'],
    ['retrait_momo', 'Retrait'],
  ],
};

let account = 'cash';
let view = 'days';
let preset = 'month';
let range = presetRange(preset);

// The book as a PDF: the whole book, the entries only or the exits only, over a chosen period.
async function downloadDialog() {
  const ok = await formDialog({
    title: 'Télécharger le livre de caisse',
    submitLabel: 'Télécharger le PDF',
    grid: false,
    fields: [
      { name: 'part', label: 'Contenu', type: 'segment', options: [['all', 'Tout'], ['in', 'Entrées'], ['out', 'Sorties']], value: 'all' },
      { name: 'from', label: 'Du', type: 'date', value: range.from, required: true },
      { name: 'to', label: 'Au', type: 'date', value: range.to, required: true },
    ],
    onSubmit: (d) => {
      if (d.from > d.to) throw new Error('La date de début doit précéder la date de fin.');
      return d;
    },
  });
  if (!ok) return;
  const name = { all: 'livre-de-caisse', in: 'entrees-de-caisse', out: 'sorties-de-caisse' }[ok.part];
  const link = h('a', { href: `/api/cashbook.pdf?part=${ok.part}&from=${ok.from}&to=${ok.to}`, download: `${name}-${ok.from}-au-${ok.to}.pdf`, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
}

export async function renderCashbook(page, ctx) {
  const book = await api.get(`/cashbook?account=${account}&from=${range.from}&to=${range.to}`);
  const reload = () => renderCashbook(page, ctx);
  const { cash, momo } = book.balances;
  const current = book.balances[account];

  const from = field({ name: 'from', label: 'Du', type: 'date', value: range.from });
  const to = field({ name: 'to', label: 'Au', type: 'date', value: range.to });
  const onDate = () => {
    preset = null;
    range = { from: from.querySelector('input').value, to: to.querySelector('input').value };
    if (range.from && range.to) reload();
  };
  from.querySelector('input').addEventListener('change', onDate);
  to.querySelector('input').addEventListener('change', onDate);

  const countLine = (b) =>
    b.lastCount
      ? `Compté ${fmt.money(b.lastCount.counted)} le ${fmt.dateTime(b.lastCount.created_at)} · écart ${fmt.signedMoney(b.lastCount.diff)}`
      : 'Jamais compté';

  setContent(
    page,
    pageHeader(
      'Caisse',
      null,
      button('Télécharger', () => downloadDialog(), { variant: 'secondary', iconName: 'download' }),
      adminEdit(button('Compter', () => countDialog(account, current, reload), { variant: 'secondary', iconName: 'check' })),
      adminEdit(button('Mouvement', () => movementDialog(account, reload), { iconName: 'plus' })),
    ),
    canAdmin() && (!cash.hasOpening || !momo.hasOpening)
      ? h(
          'section',
          { class: 'card row between', style: 'margin-bottom:20px' },
          h(
            'div',
            { style: 'flex:1;min-width:220px' },
            h('h3', {}, 'Solde de départ'),
          ),
          button('Saisir le solde de départ', () => openingDialog(book.balances, reload), { iconName: 'edit' }),
        )
      : null,
    h(
      'div',
      { class: 'grid grid-2' },
      kpi('Espèces en caisse', fmt.money(cash.balance), countLine(cash)),
      kpi('Mobile money', fmt.money(momo.balance), countLine(momo)),
    ),
    h(
      'div',
      { class: 'row no-print', style: 'align-items:flex-end;margin:24px 0' },
      segmented(ACCOUNTS, account, (v) => {
        account = v;
        reload();
      }),
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
      kpi('Solde au début', fmt.money(book.opening), fmt.date(range.from)),
      kpi('Entrées', fmt.money(book.in), book.accountLabel),
      kpi('Sorties', fmt.money(book.out), book.accountLabel),
      kpi('Solde à la fin', fmt.money(book.closing), fmt.date(range.to)),
    ),
    h(
      'section',
      { class: 'card flush section' },
      h(
        'div',
        { class: 'card-header' },
        segmented(
          [
            ['days', 'Par jour'],
            ['detail', 'Détail'],
          ],
          view,
          (v) => {
            view = v;
            reload();
          },
        ),
        h('p', {}, `${book.accountLabel} · du ${fmt.date(range.from)} au ${fmt.date(range.to)}`),
      ),
      view === 'days'
        ? table(
            [
              { label: 'Jour', render: (d) => fmt.date(d.day) },
              { label: 'Entrées', align: 'right', render: (d) => (d.in ? fmt.money(d.in) : '—') },
              { label: 'Sorties', align: 'right', render: (d) => (d.out ? fmt.money(d.out) : '—') },
              { label: 'Fin', align: 'right', render: (d) => h('strong', {}, fmt.money(d.end)) },
            ],
            [...book.days].reverse(),
            { empty: 'Aucun mouvement sur cette période.' },
          )
        : table(
            [
              { label: 'Date', render: (m) => fmt.dateTime(m.at) },
              { label: 'Libellé', wrap: true, key: 'label' },
              { label: 'Entrée', align: 'right', render: (m) => (m.in ? fmt.money(m.in) : '') },
              { label: 'Sortie', align: 'right', render: (m) => (m.out ? fmt.money(m.out) : '') },
              { label: 'Solde', align: 'right', render: (m) => fmt.money(m.balance) },
            ],
            [...book.movements].reverse(),
            {
              empty: 'Aucun mouvement sur cette période.',
              onRowClick: (m) => (m.source === 'movement' && !flags.readonly ? movementActions(m, reload) : m.link ? ctx.navigate(m.link.slice(2)) : null),
            },
          ),
    ),
  );
}

async function openingDialog(balances, reload) {
  const ok = await formDialog({
    title: 'Solde de départ',
    fields: [
      { name: 'cash', label: 'Espèces en caisse ($)', type: 'number', step: '0.01', min: '0', required: !balances.cash.hasOpening, hidden: balances.cash.hasOpening },
      { name: 'momo', label: 'Solde du mobile money ($)', type: 'number', step: '0.01', min: '0', required: !balances.momo.hasOpening, hidden: balances.momo.hasOpening },
      { name: 'date', label: 'Compté le', type: 'date', value: new Date().toLocaleDateString('sv-SE'), required: true, full: true },
    ],
    submitLabel: 'Enregistrer',
    onSubmit: async (d) => {
      for (const acc of ['cash', 'momo']) {
        if (!balances[acc].hasOpening && d[acc] !== '') await api.post('/cashbook/movements', { kind: 'opening', account: acc, amount: d[acc], date: d.date });
      }
      return true;
    },
  });
  if (ok) {
    toast('Solde de départ enregistré.');
    reload();
  }
}

async function movementDialog(acc, reload) {
  const label = ACCOUNTS.find(([v]) => v === acc)[1];
  // In the shift's money: any cash entry or exit; on mobile money, only a withdrawal into the cash.
  const counts = (kind) => acc === 'cash' || kind === 'retrait_momo';
  const toShift = field({ name: 'toShift', label: 'Dans l’argent du poste en cours', type: 'checkbox', value: true, full: true });
  toShift.hidden = !counts('autre_entree');
  const ok = await formDialog({
    title: `Mouvement · ${label}`,
    grid: false,
    fields: [
      { name: 'kind', label: 'Mouvement', type: 'segment', full: true, options: KINDS[acc], value: 'autre_entree', onInput: (e) => (toShift.hidden = !counts(e.target.value)) },
      { name: 'amount', label: 'Montant ($)', type: 'number', step: '0.01', min: '0.01', required: true },
      { name: 'note', label: 'Motif', required: true, placeholder: 'Ex. : apport du propriétaire, monnaie, bordereau n°…' },
      { name: 'toShiftRow', type: 'node', node: toShift },
    ],
    submitLabel: 'Enregistrer',
    onSubmit: (d, form) => api.post('/cashbook/movements', { ...d, account: acc, toShift: counts(d.kind) && form.elements.toShift.checked }),
  });
  if (ok) {
    toast('Mouvement enregistré.');
    reload();
  }
}

async function countDialog(acc, current, reload) {
  const label = ACCOUNTS.find(([v]) => v === acc)[1];
  const ok = await formDialog({
    title: `Compter · ${label}`,
    intro: `Solde du livre : ${fmt.money(current.balance)}`,
    grid: false,
    autofocus: true,
    fields: [
      { name: 'counted', label: 'Montant compté ($)', type: 'number', step: '0.01', min: '0', required: true },
      { name: 'note', label: 'Remarque', placeholder: 'Facultatif' },
    ],
    submitLabel: 'Enregistrer le comptage',
    onSubmit: (d) => api.post('/cashbook/counts', { ...d, account: acc }),
  });
  if (ok) {
    const c = ok.balances[acc].lastCount;
    toast(Math.abs(c.diff) < 0.005 ? 'Comptage juste.' : `Écart de ${fmt.signedMoney(c.diff)} noté.`, Math.abs(c.diff) < 0.005 ? undefined : 'error');
    reload();
  }
}

// A manual movement: in or out of the money of the shift open at its time, or removed.
function movementActions(m, reload) {
  const toShift = async (link) => {
    try {
      const r = await api.post(`/cashbook/movements/${m.id}/shift`, { link });
      toast(link ? `Mis dans l’argent du poste n°${r.shiftId}.` : 'Retiré de l’argent du poste.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  if (!m.shiftable) return removeMovement(m, reload);
  actionSheet({
    title: `${m.label} · ${fmt.money(m.in || m.out)}`,
    actions: [
      m.shift_id ? { label: `Retirer de l’argent du poste n°${m.shift_id}`, onClick: () => toShift(false) } : { label: 'Mettre dans l’argent du poste', onClick: () => toShift(true) },
      { label: 'Retirer ce mouvement', destructive: true, onClick: () => removeMovement(m, reload) },
    ],
  });
}

async function removeMovement(m, reload) {
  if (!(await confirmDialog('Retirer ce mouvement ?', `${m.label} · ${fmt.money(m.in || m.out)}`, { confirmLabel: 'Retirer', danger: true }))) return;
  try {
    await api.del(`/cashbook/movements/${m.id}`);
    toast('Mouvement retiré.');
    reload();
  } catch (err) {
    toast(err.message, 'error');
  }
}
