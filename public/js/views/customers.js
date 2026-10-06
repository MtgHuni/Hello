import { flags, edit } from '../ui.js';
import { api } from '../api.js';
import { h, fmt, pageHeader, card, cardHeader, table, segmented, kpi, badge, button, formDialog, confirmDialog, toast, field, todayISO, isoDate, setContent, sharePdf, whatsappNumber, noticeDialog, buttonRow, nameChips } from '../ui.js';
import { icon } from '../icons.js';

let typeFilter = 'all';
let search = '';

const TYPE_LABEL = { account: 'Abonné', individual: 'Particulier' };
// Names compared as the server does: without case, accents nor extra spaces.
const nameKey = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();

export async function renderCustomers(page, ctx) {
  const customers = await api.get('/customers');
  const listHost = h('div');
  // Namesakes left from before names had to be unique.
  const seen = new Map();
  for (const c of customers) seen.set(nameKey(c.name), (seen.get(nameKey(c.name)) || 0) + 1);
  const namesake = (c) => seen.get(nameKey(c.name)) > 1;

  const draw = () => {
    const q = search.trim().toLowerCase();
    const rows = customers.filter(
      (c) =>
        (typeFilter === 'all' || (typeFilter === 'review' ? c.needs_review && c.active : c.type === typeFilter)) &&
        (!q || [c.name, c.phone, c.plate, c.email].some((v) => v?.toLowerCase().includes(q))),
    );
    setContent(listHost, 
      table(
        [
          { label: 'Client', render: (c) => h('div', {}, h('div', { style: 'font-weight:600' }, c.name), h('div', { class: 'muted small' }, [c.phone, c.plate].filter(Boolean).join(' · ') || '—')) },
          {
            label: 'Type',
            render: (c) => (namesake(c) ? badge('Même nom', 'warning') : !c.active ? badge('Désactivé') : c.needs_review ? badge('À compléter', 'warning') : TYPE_LABEL[c.type]),
          },
          { label: 'Solde dû', align: 'right', render: (c) => (c.balance < 0 ? `Avance ${fmt.money(-c.balance)}` : c.balance ? fmt.money(c.balance) : '—') },
          ...(flags.combos ? [{ label: 'Combos', align: 'right', render: (c) => fmt.number(c.loyalty_points) }] : []),
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

  const receivables = customers.reduce((t, c) => t + Math.max(0, c.balance), 0);
  const toReview = customers.filter((c) => c.needs_review && c.active).length;
  if (typeFilter === 'review' && !toReview) typeFilter = 'all';
  setContent(page, 
    pageHeader(
      'Clients',
      `${customers.length} client${customers.length > 1 ? 's' : ''} · encours total ${fmt.money(receivables)}`,
      button('Créances', () => ctx.navigate('clients/creances'), { variant: 'secondary', iconName: 'cash' }),
      edit(button('Nouveau client', () => customerDialog(null, ctx), { iconName: 'plus' })),
    ),
    h(
      'section',
      { class: 'card flush' },
      h(
        'div',
        { class: 'card-header' },
        segmented(
          [
            ['all', 'Tous'],
            ['account', 'Abonnés'],
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
      {
        name: 'type',
        label: 'Catégorie',
        type: 'segment',
        value: customer?.type || 'individual',
        options: [
          ['individual', 'Particulier'],
          ['account', 'Abonné'],
        ],
        full: true,
        onInput: (e) => {
          const day = e.target.form.elements.paymentDay;
          const account = e.target.value === 'account';
          day.closest('.field').hidden = !account;
          day.required = account;
        },
      },
      {
        name: 'paymentDay',
        label: 'Jour de paiement du mois',
        type: 'number',
        step: '1',
        min: '1',
        max: '28',
        value: customer?.payment_day ?? ctx?.state?.settings?.subscriberGraceDays ?? 5,
        hidden: (customer?.type || 'individual') !== 'account',
        required: customer?.type === 'account',
        full: true,
      },
      { name: 'name', label: 'Nom ou raison sociale', value: customer?.name, required: true, full: true },
      { name: 'phone', label: 'Téléphone', value: customer?.phone, type: 'tel' },
      { name: 'email', label: 'E-mail', value: customer?.email, type: 'email' },
      { name: 'plate', label: 'Immatriculation principale', value: customer?.plate, full: true },
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

// Who owes what, by age: payments settle the oldest credit first, so the old column is what to chase.
async function renderReceivables(page, ctx) {
  const { rows, totals } = await api.get('/customers/receivables');
  const station = ctx.state.settings.stationName;
  const remind = (r) => {
    const number = whatsappNumber(r.phone);
    if (flags.readonly) return null;
    if (!number) return h('span', { class: 'muted small' }, 'Pas de téléphone');
    const text = `Bonjour ${r.name}, votre solde chez ${station} est de ${fmt.money(r.balance)}${r.old ? `, dont ${fmt.money(r.old)} depuis plus de 30 jours` : ''}. Merci de passer le régler. ${station}`;
    return h(
      'a',
      { class: 'btn secondary sm', href: `https://wa.me/${number}?text=${encodeURIComponent(text)}`, target: '_blank', rel: 'noopener', onClick: (e) => e.stopPropagation() },
      'Relancer',
    );
  };
  setContent(
    page,
    h('a', { class: 'back no-print', href: '#/clients' }, icon('back'), 'Clients'),
    pageHeader('Créances', null),
    h(
      'div',
      { class: 'grid grid-4' },
      kpi('Plus de 30 jours', fmt.money(totals.old), 'À relancer en priorité'),
      kpi('8 à 30 jours', fmt.money(totals.month)),
      kpi('7 derniers jours', fmt.money(totals.recent)),
      kpi('Total dû', fmt.money(totals.balance), `${rows.length} client${rows.length > 1 ? 's' : ''}`),
    ),
    // Phones: one stacked row per customer, the Relancer button full width.
    h(
      'section',
      { class: 'card flush section recv-list' },
      rows.length
        ? rows.map((r) =>
            h(
              'div',
              { class: 'recv-item' },
              h(
                'a',
                { class: 'recv-head', href: `#/clients/${r.id}` },
                h('span', {}, h('strong', {}, r.name), h('span', { class: 'muted small' }, `${TYPE_LABEL[r.type]}${r.oldest_days ? ` · plus ancien : ${r.oldest_days} j` : ''}`)),
                h('span', { class: 'recv-total' }, fmt.money(r.balance)),
              ),
              h('div', { class: 'muted small' }, [r.old ? `${fmt.money(r.old)} à + 30 j` : null, r.month ? `${fmt.money(r.month)} à 8–30 j` : null, r.recent ? `${fmt.money(r.recent)} sur 7 j` : null].filter(Boolean).join(' · ')),
              remind(r),
            ),
          )
        : h('div', { class: 'empty' }, 'Aucun client ne doit d’argent.'),
    ),
    h(
      'section',
      { class: 'card flush section recv-table' },
      table(
        [
          { label: 'Client', render: (r) => h('span', {}, h('strong', {}, r.name), h('div', { class: 'muted small' }, `${TYPE_LABEL[r.type]}${r.oldest_days ? ` · plus ancien : ${r.oldest_days} j` : ''}`)) },
          { label: '+ 30 jours', align: 'right', render: (r) => (r.old ? h('strong', { class: 'variance-neg' }, fmt.money(r.old)) : '—') },
          { label: '8 à 30 j', align: 'right', render: (r) => (r.month ? fmt.money(r.month) : '—') },
          { label: '7 jours', align: 'right', render: (r) => (r.recent ? fmt.money(r.recent) : '—') },
          { label: 'Total', align: 'right', render: (r) => h('strong', {}, fmt.money(r.balance)) },
          { label: '', align: 'right', render: remind },
        ],
        rows,
        { empty: 'Aucun client ne doit d’argent.', onRowClick: (r) => ctx.navigate(`clients/${r.id}`) },
      ),
    ),
  );
}

export async function renderCustomerDetail(page, ctx) {
  if (ctx.id === 'creances') return renderReceivables(page, ctx);
  const period = defaultPeriod();
  const load = async () => {
    const acc = await api.get(`/customers/${ctx.id}?from=${period.from}&to=${period.to}`);
    const c = acc.customer;
    const reload = () => load();
    setContent(page, 
      h('a', { class: 'back no-print', href: '#/clients' }, icon('back'), 'Clients'),
      pageHeader(
        c.name,
        [TYPE_LABEL[c.type], c.type === 'account' && c.payment_day ? `paie avant le ${c.payment_day} du mois` : null, c.phone, c.email, c.plate].filter(Boolean).join(' · '),
        edit(button('Règlement', () => paymentDialog(c, reload), { iconName: 'card' })),
        edit(button('Ancienne dette', () => oldDebtDialog(c, reload), { variant: 'secondary', iconName: 'plus' })),
        edit(button('Modifier', () => customerDialog(c, ctx, reload), { variant: 'secondary', iconName: 'edit' })),
        edit(button(c.login ? 'Accès client' : 'Créer un accès', () => loginDialog(c, ctx, reload), { variant: 'secondary', iconName: 'user' })),
        edit(button('Supprimer', () => removeCustomer(c, ctx), { variant: 'secondary', iconName: 'trash' })),
      ),
      c.needs_review
        ? h(
            'section',
            { class: 'card row between', style: 'margin-bottom:20px;box-shadow:inset 0 0 0 2px color-mix(in srgb, var(--orange) 55%, transparent)' },
            h(
              'div',
              { style: 'flex:1;min-width:220px' },
              h('h3', {}, 'Fiche à compléter'),
              h('p', { class: 'muted', style: 'font-size:15px;margin-top:2px' }, `Créé à la pompe${c.created_by_name ? ` par ${c.created_by_name}` : ''}`),
            ),
            edit(button('Compléter la fiche', () => customerDialog(c, ctx, reload), { iconName: 'edit' })),
          )
        : null,
      statement(
        acc,
        period,
        (p) => {
          Object.assign(period, p);
          load();
        },
        { shareUrl: `/api/customers/${c.id}/statement.pdf`, onOldDebt: flags.readonly ? null : (m) => removeOldDebt(c, m, reload) },
      ),
    );
  };
  await load();
}

export function defaultPeriod() {
  const now = new Date();
  return { from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: todayISO() };
}

// Account statement shared with the client space: KPIs, period picker, movements.
export function statement(acc, period, onPeriod, { onOldDebt, clientSpace = false, shareUrl } = {}) {
  const c = acc.customer;
  const subscriber = c.type === 'account';
  const from = field({ name: 'from', label: 'Du', type: 'date', value: period.from });
  const to = field({ name: 'to', label: 'Au', type: 'date', value: period.to });
  const apply = () => onPeriod({ from: from.querySelector('input').value, to: to.querySelector('input').value });
  from.querySelector('input').addEventListener('change', apply);
  to.querySelector('input').addEventListener('change', apply);

  const combos = acc.combos;
  const dues = acc.dues;
  return h(
    'div',
    { class: 'stack' },
    dues && (dues.overdue > 0 || dues.currentMonth > 0)
      ? h(
          'section',
          { class: 'card', style: dues.late ? 'box-shadow:inset 0 0 0 2px var(--red)' : '' },
          cardHeader('Paiement mensuel (abonné)', null),
          dues.overdue > 0
            ? h(
                'div',
                { class: 'summary-line' },
                h('span', {}, dues.late ? badge('En retard', 'critical') : badge('À payer', 'warning'), ' Mois précédent', h('span', { class: 'muted small' }, ` — avant le ${fmt.date(dues.overdueDeadline)}`)),
                h('strong', { class: dues.late ? 'variance-neg' : '' }, fmt.money(dues.overdue)),
              )
            : null,
          h('div', { class: 'summary-line' }, h('span', {}, 'Mois en cours', h('span', { class: 'muted small' }, ` — à payer avant le ${fmt.date(dues.nextDeadline)}`)), h('strong', {}, fmt.money(dues.currentMonth))),
        )
      : null,
    h(
      'div',
      { class: `grid ${subscriber && flags.combos && !clientSpace ? 'grid-2' : ''}` },
      kpi(
        c.balance < 0 ? 'Avance du client' : 'Solde dû',
        h('span', { class: c.type !== 'account' && c.balance > 0.001 ? 'variance-neg' : '' }, fmt.money(Math.abs(c.balance))),
        [
          c.type !== 'account' && c.balance > 0.001 ? 'Crédit en cours : pas d’autre crédit avant paiement' : null,
          c.old_debt ? `dont ancienne dette ${fmt.money(c.old_debt)} au départ` : null,
        ].filter(Boolean).join(' · ') || TYPE_LABEL[c.type],
      ),
      // The balance; a subscriber's combos too (the client space shows them in their own card).
      !flags.combos || !subscriber || clientSpace ? null : kpi(
        'Combos',
        fmt.number(combos.balance),
        combos.balance >= combos.threshold
          ? `= ${fmt.money(combos.value)} · échangeables`
          : `${fmt.number(combos.threshold - combos.balance)} avant l’échange${combos.pending ? ` · +${fmt.number(combos.pending)} au paiement du crédit` : ''}`,
      ),
    ),
    h(
      'section',
      { class: 'card flush' },
      h('div', { class: 'print-only', style: 'padding:0 0 12px' }, h('h2', {}, `Relevé de compte — ${c.name}`), h('p', {}, `Période du ${fmt.date(period.from)} au ${fmt.date(period.to)}`)),
      h(
        'div',
        { class: 'card-header' },
        h('div', {}, h('h2', {}, 'Relevé de compte'), h('p', {}, `Solde au début de la période : ${fmt.money(acc.opening)}`)),
        h(
          'div',
          { class: 'row no-print', style: 'align-items:flex-end' },
          from,
          to,
          // « Partager » the statement as a PDF over the period chosen here.
          shareUrl
            ? button('Partager', () => sharePdf(`${shareUrl}?from=${period.from}&to=${period.to}`, `releve-${period.from}-au-${period.to}.pdf`), { variant: 'secondary', iconName: 'share' })
            : null,
        ),
      ),
      table(
        [
          { label: 'Date', render: (m) => fmt.dateTime(m.date) },
          { label: 'Libellé', wrap: true, key: 'label' },
          { label: 'Montant', align: 'right', render: (m) => (m.type === 'sale' ? fmt.money(m.amount) : '') },
          { label: 'Dû', align: 'right', render: (m) => (m.debit ? fmt.money(m.debit) : '') },
          { label: 'Payé', align: 'right', render: (m) => (m.credit ? fmt.money(m.credit) : '') },
          { label: 'Solde', align: 'right', render: (m) => fmt.money(m.balance) },
          ...(flags.combos ? [{ label: 'Combos', align: 'right', render: (m) => (m.points ? `+${m.points}` : m.combosUsed ? `−${m.combosUsed}` : '') }] : []),
        ],
        acc.movements,
        { empty: 'Aucune opération sur cette période.', onRowClick: onOldDebt ? (m) => m.type === 'old_debt' && onOldDebt(m) : undefined },
      ),
      acc.movements.length
        ? h('div', { class: 'summary-line total', style: 'padding:14px 22px' }, h('span', {}, 'Solde en fin de période'), h('span', {}, fmt.money(acc.closing)))
        : null,
    ),
  );
}

async function paymentDialog(c, reload) {
  const ok = await formDialog({
    title: `Règlement — ${c.name}`,
    intro: `${c.balance < 0 ? `Avance actuelle : ${fmt.money(-c.balance)}` : `Solde dû actuel : ${fmt.money(c.balance)}`}`,
    fields: [
      { name: 'amount', label: 'Montant ($)', type: 'number', step: '0.01', min: '0.01', required: true, value: c.balance > 0 ? c.balance : '' },
      { name: 'method', label: 'Mode', type: 'select', options: ['espèces', 'mobile money'].map((m) => [m, m[0].toUpperCase() + m.slice(1)]) },
      { name: 'reference', label: 'Référence', full: true, placeholder: 'N° de transaction mobile money…' },
    ],
    onSubmit: (d) => api.post(`/customers/${c.id}/payments`, d),
  });
  if (ok) {
    toast(`Règlement enregistré. Nouveau solde : ${fmt.money(ok.balance)}`);
    reload();
  }
}

// A debt from before the app (the notebook): added to the balance, settled first by payments.
// A record entered by mistake: removed as is when it holds nothing; otherwise its operations
// and its login go to the right customer, chosen among the others.
async function removeCustomer(c, ctx) {
  if (!c.operations && !c.login) {
    if (!(await confirmDialog(`Supprimer ${c.name} ?`, null, { confirmLabel: 'Supprimer', danger: true }))) return;
    try {
      await api.del(`/customers/${c.id}`);
      toast('Client supprimé.');
      ctx.navigate('clients');
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }
  const others = (await api.get('/customers?form=1')).filter((o) => o.id !== c.id);
  const chips = nameChips(others.map((o) => o.name));
  const n = c.operations;
  const ok = await formDialog({
    title: `Supprimer ${c.name}`,
    grid: false,
    fields: [
      { name: 'into', label: !n ? 'Son accès client va à' : n > 1 ? `Ses ${n} opérations vont à` : 'Son opération va à', required: true, onInput: chips.onInput },
      chips.node,
    ],
    submitLabel: 'Transférer et supprimer',
    onSubmit: (d) => {
      const into = others.find((o) => nameKey(o.name) === nameKey(d.into));
      if (!into) throw new Error('Touchez un client proposé.');
      return api.post(`/customers/${c.id}/merge`, { into: into.id });
    },
  });
  if (!ok) return;
  toast(`${c.name} supprimé.`);
  ctx.navigate(`clients/${ok.id}`);
}

async function oldDebtDialog(c, reload) {
  const ok = await formDialog({
    title: `Ancienne dette — ${c.name}`,
    grid: false,
    fields: [
      { name: 'amount', label: 'Montant ($)', type: 'number', step: '0.01', min: '0.01', required: true },
      { name: 'note', label: 'Remarque', placeholder: 'Facultatif (ex. : cahier 2025, page 12)' },
    ],
    submitLabel: 'Ajouter',
    onSubmit: (d) => api.post(`/customers/${c.id}/old-debts`, d),
  });
  if (ok) {
    toast(`Ancienne dette ajoutée. Nouveau solde : ${fmt.money(ok.balance)}`);
    reload();
  }
}

async function removeOldDebt(c, m, reload) {
  if (!(await confirmDialog('Retirer cette ancienne dette ?', `${fmt.money(m.amount)} · ${m.label}`, { confirmLabel: 'Retirer', danger: true }))) return;
  try {
    const r = await api.del(`/customers/${c.id}/old-debts/${m.id}`);
    toast(`Ancienne dette retirée. Nouveau solde : ${fmt.money(r.balance)}`);
    reload();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// The customer's login: their phone by default, and the default password, which they change later.
const DEFAULT_PASSWORD = '12345678';

async function loginDialog(c, ctx, reload) {
  const sent = {};
  const ok = await formDialog({
    title: c.login ? 'Accès à l’espace client' : 'Créer un accès client',
    grid: false,
    fields: [
      { name: 'login', label: 'Identifiant', value: c.login || (c.phone || '').replace(/[\s.-]/g, ''), required: true },
      { name: 'password', label: c.login ? 'Nouveau mot de passe' : 'Mot de passe', type: 'text', value: DEFAULT_PASSWORD, required: true },
    ],
    submitLabel: 'Enregistrer et partager',
    onSubmit: async (d) => {
      Object.assign(sent, d);
      return api.post(`/customers/${c.id}/login`, d);
    },
  });
  if (!ok) return;
  reload();
  if (ok.mailed) toast(`Accès envoyé aussi à ${c.email}`);
  shareAccess(c, sent, ctx?.state?.settings?.stationName || 'la station');
}

// Sends the customer the link, their login and password through the phone's own share sheet
// (WhatsApp, SMS…; a copy where the browser cannot share); they change the password in their space.
function shareAccess(c, { login, password }, stationName) {
  const text = [
    `Bonjour ${c.name}, voici votre espace client ${stationName} : ${location.origin}`,
    `Identifiant : ${login}`,
    `Mot de passe : ${password}`,
    'Vous pouvez changer ce mot de passe dans votre espace : touchez vos initiales en haut à droite, puis « Changer le mot de passe ».',
  ].join('\n');
  const share = () =>
    typeof navigator.share === 'function'
      ? navigator.share({ title: `Espace client ${stationName}`, text }).catch(() => {})
      : navigator.clipboard?.writeText(text).then(() => toast('Message copié.'), () => toast('Copie impossible.', 'error'));
  return noticeDialog('Accès client enregistré', [
    h('p', {}, `Identifiant : `, h('strong', {}, login), h('br'), 'Mot de passe : ', h('strong', {}, password)),
    h('div', { class: 'notice-share' }, buttonRow([button('Partager', share, { variant: 'secondary', iconName: 'share' })])),
  ], { okLabel: 'Terminé', level: 'good', iconName: 'check' });
}
