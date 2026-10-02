import { api } from '../api.js';
import { h, fmt, pageHeader, card, cardHeader, table, segmented, kpi, badge, button, formDialog, toast, field, todayISO, isoDate } from '../ui.js';
import { icon } from '../icons.js';

let typeFilter = 'all';
let search = '';

const TYPE_LABEL = { account: 'En compte', individual: 'Particulier' };

export async function renderCustomers(page, ctx) {
  const customers = await api.get('/customers');
  const listHost = h('div');

  const draw = () => {
    const q = search.trim().toLowerCase();
    const rows = customers.filter(
      (c) =>
        (typeFilter === 'all' || (typeFilter === 'review' ? c.needs_review && c.active : c.type === typeFilter)) &&
        (!q || [c.name, c.phone, c.plate, c.email].some((v) => v?.toLowerCase().includes(q))),
    );
    listHost.replaceChildren(
      table(
        [
          { label: 'Client', render: (c) => h('div', {}, h('div', { style: 'font-weight:600' }, c.name), h('div', { class: 'muted small' }, [c.phone, c.plate].filter(Boolean).join(' · ') || '—')) },
          {
            label: 'Type',
            render: (c) => (!c.active ? badge('Désactivé') : c.needs_review ? badge('À compléter', 'warning') : TYPE_LABEL[c.type]),
          },
          { label: 'Solde dû', align: 'right', render: (c) => (c.type === 'account' ? h('span', { class: c.balance > c.credit_limit ? 'variance-neg' : '' }, fmt.money(c.balance)) : '—') },
          { label: 'Plafond', align: 'right', render: (c) => (c.type === 'account' ? fmt.money(c.credit_limit) : '—') },
          { label: 'Points', align: 'right', render: (c) => fmt.number(c.loyalty_points) },
          { label: 'Dernier achat', render: (c) => fmt.date(c.last_purchase_at) },
        ],
        rows,
        { onRowClick: (c) => ctx.navigate(`clients/${c.id}`), empty: customers.length ? 'Aucun client ne correspond.' : 'Aucun client pour le moment.' },
      ),
    );
  };

  const searchInput = h('input', { type: 'search', class: 'search', placeholder: 'Rechercher (nom, téléphone, plaque)', value: search, 'aria-label': 'Rechercher un client' });
  searchInput.addEventListener('input', () => {
    search = searchInput.value;
    draw();
  });

  const receivables = customers.filter((c) => c.type === 'account').reduce((t, c) => t + Math.max(0, c.balance), 0);
  const toReview = customers.filter((c) => c.needs_review && c.active).length;
  if (typeFilter === 'review' && !toReview) typeFilter = 'all';
  page.replaceChildren(
    pageHeader('Clients', `${customers.length} client${customers.length > 1 ? 's' : ''} · encours total ${fmt.money(receivables)}`, button('Nouveau client', () => customerDialog(null, ctx), { iconName: 'plus' })),
    h(
      'section',
      { class: 'card flush' },
      h(
        'div',
        { class: 'card-header' },
        segmented(
          [
            ['all', 'Tous'],
            ['account', 'En compte'],
            ['individual', 'Particuliers'],
            ...(toReview ? [['review', `À compléter (${toReview})`]] : []),
          ],
          typeFilter,
          (v) => {
            typeFilter = v;
            renderCustomers(page, ctx);
          },
        ),
        searchInput,
      ),
      listHost,
    ),
  );
  draw();
}

async function customerDialog(customer, ctx, onDone) {
  const ok = await formDialog({
    title: customer ? `Modifier ${customer.name}` : 'Nouveau client',
    fields: [
      { name: 'type', label: 'Type', type: 'select', value: customer?.type || 'account', options: [['account', 'En compte (société, flotte — paie à crédit)'], ['individual', 'Particulier (fidélité)']], full: true },
      { name: 'name', label: 'Nom ou raison sociale', value: customer?.name, required: true, full: true },
      { name: 'phone', label: 'Téléphone', value: customer?.phone, type: 'tel' },
      { name: 'email', label: 'E-mail', value: customer?.email, type: 'email' },
      { name: 'plate', label: 'Immatriculation principale', value: customer?.plate },
      { name: 'creditLimit', label: 'Plafond de crédit ($)', type: 'number', step: '0.01', min: '0', value: customer?.credit_limit ?? 0, hint: 'Clients en compte uniquement' },
      { name: 'address', label: 'Adresse', value: customer?.address, full: true },
      ...(customer ? [{ name: 'active', label: 'Client actif', type: 'checkbox', value: !!customer.active, full: true }] : []),
    ],
    onSubmit: (d) => (customer ? api.put(`/customers/${customer.id}`, d) : api.post('/customers', d)),
  });
  if (!ok) return;
  toast(customer ? 'Client modifié.' : 'Client créé.');
  if (onDone) onDone();
  else ctx.navigate(`clients/${ok.id}`);
}

export async function renderCustomerDetail(page, ctx) {
  const period = defaultPeriod();
  const load = async () => {
    const acc = await api.get(`/customers/${ctx.id}?from=${period.from}&to=${period.to}`);
    const c = acc.customer;
    const reload = () => load();
    page.replaceChildren(
      h('a', { class: 'back no-print', href: '#/clients' }, icon('back'), 'Clients'),
      pageHeader(
        c.name,
        [TYPE_LABEL[c.type], c.phone, c.email, c.plate].filter(Boolean).join(' · '),
        c.type === 'account' ? button('Règlement', () => paymentDialog(c, reload), { iconName: 'card' }) : null,
        button('Modifier', () => customerDialog(c, ctx, reload), { variant: 'secondary', iconName: 'edit' }),
        button(c.login ? 'Accès client' : 'Créer un accès', () => loginDialog(c, reload), { variant: 'secondary', iconName: 'user' }),
      ),
      c.needs_review
        ? h(
            'section',
            { class: 'card row between', style: 'margin-bottom:20px;box-shadow:inset 0 0 0 2px color-mix(in srgb, var(--orange) 55%, transparent)' },
            h(
              'div',
              { style: 'flex:1;min-width:220px' },
              h('h3', {}, 'Fiche à compléter'),
              h('p', { class: 'muted', style: 'font-size:15px;margin-top:2px' }, `Créé à la pompe${c.created_by_name ? ` par ${c.created_by_name}` : ''} avec le nom seulement. Ajoutez le téléphone, l’immatriculation et le plafond de crédit.`),
            ),
            button('Compléter la fiche', () => customerDialog(c, ctx, reload), { iconName: 'edit' }),
          )
        : null,
      statement(acc, period, (p) => {
        Object.assign(period, p);
        load();
      }),
    );
  };
  await load();
}

export function defaultPeriod() {
  const now = new Date();
  return { from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: todayISO() };
}

// Account statement shared with the client space: KPIs, period picker, movements, print.
export function statement(acc, period, onPeriod) {
  const c = acc.customer;
  const from = field({ name: 'from', label: 'Du', type: 'date', value: period.from });
  const to = field({ name: 'to', label: 'Au', type: 'date', value: period.to });
  const apply = () => onPeriod({ from: from.querySelector('input').value, to: to.querySelector('input').value });
  from.querySelector('input').addEventListener('change', apply);
  to.querySelector('input').addEventListener('change', apply);

  // Show the debit/credit statement as soon as the customer can owe money.
  const isAccount = c.type === 'account' || c.credit_limit > 0 || c.balance !== 0;
  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'grid grid-4' },
      isAccount
        ? [
            kpi('Solde dû', h('span', { class: c.balance > c.credit_limit ? 'variance-neg' : '' }, fmt.money(c.balance)), c.balance > c.credit_limit ? 'Plafond dépassé' : `Plafond ${fmt.money(c.credit_limit)}`),
            kpi('Crédit disponible', fmt.money(Math.max(0, c.credit_limit - c.balance))),
            kpi('Points fidélité', fmt.number(c.loyalty_points), `+${fmt.number(acc.totals.points)} sur la période`),
            kpi('Achats sur la période', fmt.money(acc.totals.purchases), fmt.liters(acc.totals.liters)),
          ]
        : [
            kpi('Points fidélité', fmt.number(c.loyalty_points), 'Cumulés'),
            kpi('Achats sur la période', fmt.money(acc.totals.purchases)),
            kpi('Litres sur la période', fmt.liters(acc.totals.liters)),
            kpi('Points sur la période', `+${fmt.number(acc.totals.points)}`),
          ],
    ),
    h(
      'section',
      { class: 'card flush' },
      h('div', { class: 'print-only', style: 'padding:0 0 12px' }, h('h2', {}, `Relevé de compte — ${c.name}`), h('p', {}, `Période du ${fmt.date(period.from)} au ${fmt.date(period.to)}`)),
      h(
        'div',
        { class: 'card-header' },
        h('div', {}, h('h2', {}, isAccount ? 'Relevé de compte' : 'Historique des achats'), isAccount ? h('p', {}, `Solde au début de la période : ${fmt.money(acc.opening)}`) : null),
        h('div', { class: 'row no-print', style: 'align-items:flex-end' }, from, to, button('Imprimer', () => window.print(), { variant: 'secondary', iconName: 'print' })),
      ),
      table(
        [
          { label: 'Date', render: (m) => fmt.dateTime(m.date) },
          { label: 'Libellé', wrap: true, key: 'label' },
          ...(isAccount
            ? [
                { label: 'Débit', align: 'right', render: (m) => (m.debit ? fmt.money(m.debit) : '') },
                { label: 'Crédit', align: 'right', render: (m) => (m.credit ? fmt.money(m.credit) : '') },
                { label: 'Solde', align: 'right', render: (m) => fmt.money(m.balance) },
              ]
            : [
                { label: 'Montant', align: 'right', render: (m) => fmt.money(m.amount) },
                { label: 'Points', align: 'right', render: (m) => (m.points ? `+${m.points}` : '') },
              ]),
        ],
        acc.movements,
        { empty: 'Aucune opération sur cette période.' },
      ),
      isAccount && acc.movements.length
        ? h('div', { class: 'summary-line total', style: 'padding:14px 22px' }, h('span', {}, 'Solde en fin de période'), h('span', {}, fmt.money(acc.closing)))
        : null,
    ),
  );
}

async function paymentDialog(c, reload) {
  const ok = await formDialog({
    title: `Règlement — ${c.name}`,
    intro: `Solde dû actuel : ${fmt.money(c.balance)}`,
    fields: [
      { name: 'amount', label: 'Montant ($)', type: 'number', step: '0.01', min: '0.01', required: true, value: c.balance > 0 ? c.balance : '' },
      { name: 'method', label: 'Mode', type: 'select', options: ['espèces', 'virement', 'chèque', 'carte', 'mobile money'].map((m) => [m, m[0].toUpperCase() + m.slice(1)]) },
      { name: 'reference', label: 'Référence', full: true, placeholder: 'N° de chèque, de virement…' },
    ],
    onSubmit: (d) => api.post(`/customers/${c.id}/payments`, d),
  });
  if (ok) {
    toast(`Règlement enregistré. Nouveau solde : ${fmt.money(ok.balance)}`);
    reload();
  }
}

async function loginDialog(c, reload) {
  const ok = await formDialog({
    title: c.login ? 'Accès à l’espace client' : 'Créer un accès client',
    intro: 'Le client pourra consulter ses achats, son solde et imprimer ses relevés. Communiquez-lui ces identifiants.',
    grid: false,
    fields: [
      { name: 'login', label: 'Identifiant', value: c.login || '', required: true },
      { name: 'password', label: c.login ? 'Nouveau mot de passe' : 'Mot de passe', type: 'text', required: true, hint: '8 caractères minimum' },
    ],
    onSubmit: (d) => api.post(`/customers/${c.id}/login`, d),
  });
  if (ok) {
    toast('Accès client enregistré.');
    reload();
  }
}
