import { api } from '../api.js';
import { h, fmt, flags, edit, adminEdit, canAdmin, pageHeader, cardHeader, kpi, badge, button, table, field, formDialog, confirmDialog, actionSheet, toast, todayISO, setContent, shareButton } from '../ui.js';
import { icon } from '../icons.js';

// Agents: the pay of a month (#/agents) and each agent's record (#/agents/<id>). An advance or a
// salary paid is an expense « Salaires » of the agent (src/routes/staff.js, src/payroll.js).
const FUNCTIONS = ['Pompiste', 'Gérant', 'Caissier', 'Gardien', 'Autre'];
const SOURCES = [
  ['espèces', 'Espèces'],
  ['mobile money', 'Mobile money'],
  ['poste', 'Argent du poste'],
];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const addMonths = (m, n) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const thisMonth = () => todayISO().slice(0, 7);
// From this month back to the first one, the most recent first.
const monthsFrom = (first) => {
  const list = [];
  for (let m = thisMonth(); m >= first; m = addMonths(m, -1)) list.push(m);
  return list;
};
const sourceLabel = (e) => (e.source === 'poste' ? `Argent du poste n°${e.shift_id}` : SOURCES.find(([v]) => v === e.source)?.[1] || e.source);
const isZero = (n) => Math.abs(n) < 0.005;
// A deduction movement: « Retenue : crédit de Marie du 12 sept. 2026 », « Rendu : … », « Pardonné : … ».
const deductionLabel = (d) => {
  const what = d.sale_id
    ? `crédit de ${d.customer_name || 'un client'}${d.sale_day ? ` du ${fmt.date(d.sale_day)}` : ' (annulé)'}`
    : `dépense ${d.expense_description ? `« ${d.expense_description} »` : '(annulée)'}`;
  if (d.reason === 'pardon') return `Pardonné : ${what}`;
  if (d.reason === 'rendu') return `Rendu : ${what}`;
  return `Retenue : ${what}`;
};

// What the month leaves: to pay, paid, or advanced too much; nothing yet before the first day.
function netCell(sheet) {
  if (sheet.net < -0.005) return h('span', { class: 'variance-neg' }, `Avancé ${fmt.money(-sheet.net)}`);
  if (sheet.due > 0.005) return h('strong', {}, fmt.money(sheet.due));
  return sheet.salary.amount || sheet.advances.length || sheet.payments.length ? badge('Payé', 'good') : '—';
}

let shownMonth = null;

export async function renderStaff(page, ctx) {
  const data = await api.get(`/staff${shownMonth ? `?month=${shownMonth}` : ''}`);
  const month = data.month;
  const reload = () => renderStaff(page, ctx);

  const pick = field({ name: 'month', label: 'Mois', type: 'select', value: month, options: monthsFrom(data.firstMonth).map((m) => [m, capital(monthLabel(m))]) });
  pick.querySelector('select').addEventListener('change', (e) => {
    shownMonth = e.target.value;
    reload();
  });

  setContent(
    page,
    pageHeader('Agents', capital(monthLabel(month)), adminEdit(button('Nouvel agent', () => staffDialog(null, ctx), { iconName: 'userPlus' }))),
    h('div', { class: 'row no-print', style: 'margin-bottom:24px' }, pick),
    h(
      'div',
      { class: 'grid grid-4' },
      kpi('Salaires du mois', fmt.money(data.totals.salaries)),
      kpi('Avances', fmt.money(data.totals.advanced)),
      kpi('Payé', fmt.money(data.totals.paid)),
      kpi('Reste à payer', fmt.money(data.totals.net)),
    ),
    h(
      'section',
      { class: 'card section' },
      cardHeader('Paie du mois', `${data.agents.length} agent${data.agents.length > 1 ? 's' : ''}`),
      table(
        [
          { label: 'Agent', render: (a) => h('div', {}, h('strong', {}, a.name), h('div', { class: 'muted' }, a.left_on ? `${a.function} · parti le ${fmt.date(a.left_on)}` : a.function)) },
          { label: 'Net à payer', align: 'right', render: (a) => netCell(a.sheet) },
          { label: 'Salaire', align: 'right', render: (a) => (a.sheet.salary.days < a.sheet.salary.daysInMonth && a.sheet.salary.days ? `${fmt.money(a.sheet.salary.amount)} (${a.sheet.salary.days} j)` : fmt.money(a.sheet.salary.amount)) },
          { label: 'Reste d’avant', align: 'right', render: (a) => (isZero(a.sheet.carried) ? '—' : fmt.signedMoney(a.sheet.carried)) },
          { label: 'Avances', align: 'right', render: (a) => (a.sheet.advanced ? fmt.money(a.sheet.advanced) : '—') },
          { label: 'Payé', align: 'right', render: (a) => (a.sheet.paid ? fmt.money(a.sheet.paid) : '—') },
          { label: 'Retenues', align: 'right', render: (a) => (isZero(a.sheet.deducted) ? '—' : a.sheet.deducted > 0 ? fmt.money(a.sheet.deducted) : `+${fmt.money(-a.sheet.deducted)}`) },
          {
            label: '',
            align: 'right',
            render: (a) =>
              a.sheet.due > 0.005
                ? edit(button('Payer', (e) => (e.stopPropagation(), payDialog(a, [{ month, due: a.sheet.due }], reload)), { variant: 'secondary' }))
                : null,
          },
        ],
        data.agents,
        { onRowClick: (a) => ctx.navigate(`agents/${a.id}`), empty: 'Aucun agent.' },
      ),
    ),
  );
}

export async function renderStaffDetail(page, ctx) {
  const data = await api.get(`/staff/${ctx.id}`);
  const s = data.staff;
  const reload = () => renderStaffDetail(page, ctx);
  // « Payer » goes to the oldest month still owed, else this month.
  const owed = [...data.months].reverse().filter((m) => m.due > 0.005);

  setContent(
    page,
    h('a', { class: 'back no-print', href: '#/agents' }, icon('back'), 'Agents'),
    pageHeader(
      s.name,
      [s.function, s.phone, s.user_name ? (s.user_name === s.name ? 'a un compte' : `compte ${s.user_name}`) : null].filter(Boolean).join(' · '),
      s.left_on ? badge(`Parti le ${fmt.date(s.left_on)}`, 'warning') : null,
      edit(button('Avance', () => advanceDialog(s, reload), { iconName: 'cash' })),
      edit(button('Payer', () => payDialog(s, (owed.length ? owed : data.months.slice(0, 1)).map((m) => ({ month: m.month, due: m.due })), reload), { variant: 'secondary', iconName: 'wallet' })),
      adminEdit(button('Modifier', () => staffDialog(data, ctx, reload), { variant: 'secondary', iconName: 'edit' })),
    ),
    h(
      'section',
      { class: 'card' },
      cardHeader('Salaire', `${fmt.money(s.salary)} par mois`),
      line('Entré le', fmt.date(s.hired_on)),
      line('Paie depuis', capital(monthLabel(s.pay_from))),
      data.salaries.length > 1 ? data.salaries.map((x) => line(`Dès ${monthLabel(x.from_month)}`, fmt.money(x.amount))) : null,
    ),
    data.months.map((m, i) => monthCard(s, m, i === 0, reload)),
  );
}

const line = (label, value, { total = false, lost = false } = {}) =>
  h('div', { class: `summary-line${total ? ' total' : ''}` }, h('span', {}, label), h('span', { class: `num${lost ? ' variance-neg' : ''}` }, value));

// One month of the agent: salary, what the month before left, each advance and payment, the net.
function monthCard(s, m, current, reload) {
  const operations = [...m.advances, ...m.payments].sort((a, b) => a.expense_date.localeCompare(b.expense_date) || a.id - b.id);
  return h(
    'section',
    { class: 'card section' },
    cardHeader(capital(monthLabel(m.month)), null, shareButton(`/api/staff/${s.id}/payslip.pdf?month=${m.month}`, `bulletin-${s.id}-${m.month}.pdf`)),
    line(m.salary.days < m.salary.daysInMonth ? `Salaire du mois (${m.salary.days} j sur ${m.salary.daysInMonth})` : 'Salaire du mois', fmt.money(m.salary.amount)),
    isZero(m.carried) ? null : line(m.carried > 0 ? 'Reste dû du mois d’avant' : 'Avancé en trop le mois d’avant', fmt.signedMoney(m.carried), { lost: m.carried < 0 }),
    // Each advance and payment; touched, it can be cancelled.
    operations.map((e) => {
      const row = line(`${e.pay_kind === 'avance' ? 'Avance' : 'Salaire'} du ${fmt.date(e.expense_date)} · ${sourceLabel(e)}`, fmt.money(-e.amount));
      if (flags.readonly) return row;
      row.classList.add('clickable');
      Object.assign(row, { tabIndex: 0, role: 'button', onclick: () => operationMenu(s, e, reload), onkeydown: (k) => k.key === 'Enter' && operationMenu(s, e, reload) });
      return row;
    }),
    // What is kept from the pay (−) or given back (+); touched, a deduction can be forgiven.
    m.deductions.map((d) => {
      const row = line(deductionLabel(d), fmt.signedMoney(-d.amount));
      if (flags.readonly || d.reason !== 'retenue' || d.forgiven) return row;
      row.classList.add('clickable');
      Object.assign(row, { tabIndex: 0, role: 'button', onclick: () => deductionMenu(s, d, reload), onkeydown: (k) => k.key === 'Enter' && deductionMenu(s, d, reload) });
      return row;
    }),
    m.net < -0.005
      ? line('Avancé en trop', fmt.money(-m.net), { total: true, lost: true })
      : !current && m.due < 0.005 && m.net > 0.005
        ? line('Reporté au mois suivant', fmt.money(m.net), { total: true })
        : line('Net à payer', fmt.money(current ? m.net : m.due), { total: true }),
  );
}

function deductionMenu(s, d, reload) {
  actionSheet({
    title: `${deductionLabel(d)} · ${fmt.money(d.amount)}`,
    actions: [
      {
        label: 'Pardonner',
        onClick: async () => {
          if (!(await confirmDialog('Pardonner la retenue ?', `${deductionLabel(d)} · ${fmt.money(d.amount)}`, { confirmLabel: 'Pardonner' }))) return;
          try {
            await api.post(`/staff/${s.id}/deductions/forgive`, d.sale_id ? { saleId: d.sale_id } : { expenseId: d.expense_id });
            toast('Retenue pardonnée.');
            reload();
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      },
      d.sale_id && canAdmin() ? { label: 'Changer d’agent', onClick: () => creditAgentDialog({ id: d.sale_id, staff_id: s.id }, reload) } : null,
    ].filter(Boolean),
  });
}

// The agents to choose from: those of this month's pay still there.
const agentsList = async () => (await api.get('/staff')).agents.filter((a) => !a.left_on || a.left_on >= todayISO());

// An expense kept from an agent's pay (the agent who entered it, by default).
export async function keepExpenseDialog(expense, reload) {
  const agents = await agentsList();
  if (!agents.length) return toast('Aucun agent.', 'error');
  const ok = await formDialog({
    title: 'Retenir sur un salaire',
    fields: [{ name: 'staffId', label: 'Agent', type: 'select', value: agents.find((a) => a.user_id === expense.user_id)?.id ?? agents[0].id, options: agents.map((a) => [a.id, a.name]) }],
    submitLabel: 'Retenir',
    onSubmit: (d) => api.post(`/staff/${d.staffId}/deductions`, { expenseId: expense.id }),
  });
  if (ok) {
    toast('Dépense retenue.');
    reload?.();
  }
}

// Who granted a credit (admin): an agent, or the record of the login that entered it.
export async function creditAgentDialog(sale, reload) {
  const agents = await agentsList();
  const ok = await formDialog({
    title: 'Accordé par',
    fields: [
      {
        name: 'staffId',
        label: 'Agent',
        type: 'select',
        value: sale.staff_id ?? '',
        options: [['', 'L’agent de son compte'], ...agents.map((a) => [a.id, a.name])],
      },
    ],
    onSubmit: (d) => api.put(`/staff/credits/${sale.id}`, { staffId: d.staffId ? Number(d.staffId) : null }),
  });
  if (ok) {
    toast('Agent du crédit enregistré.');
    reload?.();
  }
}

// Touched: its amount corrected, or cancelled.
function operationMenu(s, e, reload) {
  const what = e.pay_kind === 'avance' ? 'l’avance' : 'le paiement';
  actionSheet({
    title: `${e.pay_kind === 'avance' ? 'Avance' : 'Salaire'} · ${fmt.money(e.amount)} · ${fmt.date(e.expense_date)}`,
    actions: [
      { label: 'Corriger le montant', onClick: () => correctOperation(s, e, reload) },
      { label: `Annuler ${what}`, destructive: true, onClick: () => cancelOperation(s, e, reload) },
    ],
  });
}

async function correctOperation(s, e, reload) {
  const ok = await formDialog({
    title: e.pay_kind === 'avance' ? 'Corriger l’avance' : 'Corriger le paiement',
    fields: [{ name: 'amount', label: 'Montant ($)', type: 'number', step: '0.01', min: '0.01', required: true, value: e.amount }],
    onSubmit: (d) => api.put(`/staff/${s.id}/operations/${e.id}`, { amount: Number(d.amount) }),
  });
  if (ok) {
    toast('Montant corrigé.');
    reload();
  }
}

async function cancelOperation(s, e, reload) {
  const what = e.pay_kind === 'avance' ? 'l’avance' : 'le paiement';
  if (!(await confirmDialog(`Annuler ${what} ?`, `${fmt.money(e.amount)} · ${fmt.date(e.expense_date)} · ${sourceLabel(e)}`, { confirmLabel: `Annuler ${what}`, danger: true }))) return;
  try {
    await api.del(`/staff/${s.id}/operations/${e.id}`);
    toast(e.pay_kind === 'avance' ? 'Avance annulée.' : 'Paiement annulé.');
    reload();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function advanceDialog(s, reload) {
  const ok = await formDialog({
    title: `Avance — ${s.name}`,
    fields: [
      { name: 'amount', label: 'Montant ($)', type: 'number', step: '0.01', min: '0.01', required: true },
      { name: 'date', label: 'Date', type: 'date', value: todayISO(), max: todayISO() },
      { name: 'source', label: 'D’où', type: 'segment', options: SOURCES, value: 'espèces', full: true },
    ],
    submitLabel: 'Donner l’avance',
    onSubmit: (d) => api.post(`/staff/${s.id}/advances`, { ...d, amount: Number(d.amount) }),
  });
  if (ok) {
    toast('Avance enregistrée.');
    reload();
  }
}

// months: [{ month, due }], the first proposed; the amount follows the month chosen.
async function payDialog(s, months, reload) {
  const netOf = (m) => months.find((x) => x.month === m)?.due || 0;
  const ok = await formDialog({
    title: `Payer — ${s.name}`,
    fields: [
      {
        name: 'month',
        label: 'Mois',
        type: 'select',
        value: months[0].month,
        options: months.map((x) => [x.month, capital(monthLabel(x.month))]),
        onInput: (e) => {
          e.target.form.elements.amount.value = netOf(e.target.value) || '';
        },
      },
      { name: 'amount', label: 'Montant ($)', type: 'number', step: '0.01', min: '0.01', required: true, value: netOf(months[0].month) || '' },
      { name: 'source', label: 'D’où', type: 'segment', options: SOURCES, value: 'espèces', full: true },
    ],
    submitLabel: 'Payer',
    onSubmit: (d) => api.post(`/staff/${s.id}/payments`, { ...d, amount: Number(d.amount) }),
  });
  if (ok) {
    toast('Paiement enregistré.');
    reload();
  }
}

// Created by the admin (data null), or changed: the record, its login, a new salary from a month.
async function staffDialog(data, ctx, reload) {
  const s = data?.staff;
  const users = (await api.get('/users')).filter((u) => u.active || u.id === s?.user_id);
  const ok = await formDialog({
    title: s ? `Modifier — ${s.name}` : 'Nouvel agent',
    fields: [
      { name: 'name', label: 'Nom', value: s?.name, required: true },
      { name: 'phone', label: 'Téléphone', type: 'tel', value: s?.phone || '' },
      { name: 'function', label: 'Fonction', type: 'select', value: s?.function || 'Pompiste', options: FUNCTIONS.map((f) => [f, f]) },
      { name: 'hiredOn', label: 'Date d’entrée', type: 'date', value: s?.hired_on || todayISO(), required: true },
      { name: 'salary', label: s ? 'Nouveau salaire ($ par mois)' : 'Salaire ($ par mois)', type: 'number', step: '0.01', min: '0', value: s?.salary ?? '', required: !s },
      s
        ? { name: 'salaryFrom', label: 'Nouveau salaire dès', type: 'month', value: thisMonth(), min: s.pay_from }
        : { name: 'payFrom', label: 'Paie depuis', type: 'month', value: thisMonth(), max: thisMonth() },
      { name: 'userId', label: 'Compte de connexion', type: 'select', value: s?.user_id ?? '', options: [['', 'Aucun'], ...users.map((u) => [u.id, u.name])] },
      s ? { name: 'leftOn', label: 'Date de départ', type: 'date', value: s.left_on || '' } : null,
    ].filter(Boolean),
    onSubmit: (d) => {
      const body = { ...d, userId: d.userId ? Number(d.userId) : null, salary: d.salary === '' || d.salary == null ? undefined : Number(d.salary) };
      if (s) {
        if (body.salary === s.salary && body.salaryFrom === thisMonth()) delete body.salary;
        if (body.salary === undefined) delete body.salaryFrom;
        body.leftOn = d.leftOn || null;
        return api.put(`/staff/${s.id}`, body);
      }
      return api.post('/staff', body);
    },
  });
  if (!ok) return;
  toast(s ? 'Fiche enregistrée.' : 'Agent ajouté.');
  if (s) reload();
  else ctx.navigate(`agents/${ok.id}`);
}
