import { flags } from '../ui.js';
import { api } from '../api.js';
import { shiftLine, h, fmt, pageHeader, card, cardHeader, table, shiftBadge, varianceCell, button, formDialog, confirmDialog, toast, field, productColor, badge, kpi, parseServerDate, setContent } from '../ui.js';
import { icon } from '../icons.js';
import { shiftSummary } from './shifts.js';

export async function renderAttendant(page, ctx) {
  const current = await api.get('/shifts/current');
  if (current) return renderOpenShift(page, ctx, current);
  return renderStart(page, ctx);
}

// ---------- 1. Opening a shift ----------
async function renderStart(page, ctx) {
  const pumps = (await api.get('/pumps')).filter((p) => p.active);
  const submit = button('Ouvrir mon poste', null, { variant: 'large block', type: 'submit', disabled: true });
  const form = h(
    'form',
    { class: 'stack' },
    pumps.length
      ? pumps.map((p) => {
          const busy = !!p.busy_with;
          const nozzles = p.nozzles.filter((n) => n.active);
          return h(
            'label',
            { class: `pump-option ${busy ? 'disabled' : ''}` },
            h('input', { type: 'checkbox', name: 'pump', value: String(p.id), disabled: busy || !nozzles.length }),
            h(
              'div',
              { class: 'grow', style: 'flex:1' },
              h('h3', {}, p.name),
              busy
                ? h('div', { class: 'muted small' }, `Occupée par ${p.busy_with}`)
                : nozzles.map((n) =>
                    h('div', { class: 'muted small' }, h('span', { class: 'swatch', style: `background:${productColor(n.product_id)}` }), `${n.name} · index ${fmt.number(n.meter)} · ${fmt.price(n.price)}`),
                  ),
            ),
          );
        })
      : h('div', { class: 'empty' }, "Aucune pompe n'est configurée. Demandez au gérant."),
    submit,
  );
  form.addEventListener('change', () => {
    submit.disabled = !form.querySelector('input[name=pump]:checked');
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pumpIds = [...form.querySelectorAll('input[name=pump]:checked')].map((i) => Number(i.value));
    submit.disabled = true;
    try {
      await api.post('/shifts', { pumpIds });
      toast('Poste ouvert. Bon courage !');
      renderAttendant(page, ctx);
    } catch (err) {
      toast(err.message, 'error');
      submit.disabled = false;
    }
  });

  setContent(page, 
    pageHeader('Ouvrir mon poste', 'Choisissez la ou les pompes dont vous êtes responsable. Les index de départ sont relevés automatiquement.'),
    card(form),
  );
}

// ---------- 2. During the shift ----------

// The attendant asks, the manager decides: the operation stays counted until then.
// The manager, on their own pump, cancels directly.
async function cancelEntry(ctx, x, reload) {
  try {
    if (ctx.state.user.role === 'manager') {
      if (!(await confirmDialog(`${x.remove.label} ?`, `${x.title} · ${x.amount}`, { confirmLabel: 'Annuler l’opération', danger: true }))) return;
      await api.del(x.remove.url);
      toast('Opération annulée.');
    } else {
      const ok = await formDialog({
        title: 'Demander l’annulation',
        intro: `${x.title} · ${x.amount}. Le gérant doit valider l’annulation : l’opération reste comptée jusque-là.`,
        grid: false,
        fields: [{ name: 'reason', label: 'Raison', placeholder: 'Erreur de saisie, client parti…' }],
        submitLabel: 'Envoyer au gérant',
        onSubmit: (d) => api.post(`${x.remove.url}/cancel`, d),
      });
      if (!ok) return;
      toast('Demande envoyée au gérant.');
    }
    reload();
  } catch (err) {
    toast(err.message, 'error');
  }
}
function renderOpenShift(page, ctx, shift) {
  const pumps = [...new Set(shift.readings.map((r) => r.pump_name))].join(', ');
  const reload = () => renderAttendant(page, ctx);

  // One list of everything recorded during the shift, newest first.
  const entries = [
    ...shift.sales.map((s) => ({
      at: s.created_at,
      title: s.customer_name,
      detail: `${s.product_name} · ${fmt.liters(s.liters)}${s.plate ? ` · ${s.plate}` : ''}`,
      tag: h(
        'span',
        { class: 'row', style: 'gap:6px' },
        s.kind === 'credit' ? (s.over_limit ? badge('Crédit hors plafond', 'serious') : badge('Crédit', 'info')) : s.kind === 'combo' ? badge(`Combos −${s.combos_used}`, 'warning') : badge('Payé', 'good'),
        s.points && flags.combos ? badge(`+${s.points} combos`) : null,
        s.source === 'customer' ? badge('Demande client') : null,
      ),
      amount: fmt.money(s.amount),
      remove: { url: `/shifts/${shift.id}/sales/${s.id}`, label: 'Annuler cette vente', pending: !!s.cancel_requested_at },
    })),
    ...shift.payments.map((p) => ({
      at: p.created_at,
      title: p.customer_name,
      detail: `Règlement ${p.method}${p.reference ? ` · ${p.reference}` : ''}`,
      tag: badge('Encaissé', 'good'),
      amount: `+${fmt.money(p.amount)}`,
      remove: { url: `/shifts/${shift.id}/payments/${p.id}`, label: 'Annuler ce règlement', pending: !!p.cancel_requested_at },
    })),
    ...shift.expenses.map((e) => ({
      at: e.created_at,
      title: e.description,
      detail: `${e.category}${e.beneficiary ? ` · ${e.beneficiary}` : ''}`,
      tag: badge('Dépense', 'warning'),
      amount: `−${fmt.money(e.amount)}`,
      remove: { url: `/shifts/${shift.id}/expenses/${e.id}`, label: 'Annuler cette dépense', pending: !!e.cancel_requested_at },
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const quick = (label, iconName, onClick, primary) =>
    h('button', { type: 'button', class: `quick-action ${primary ? 'primary' : ''}`, onClick, 'data-lnav': primary ? label : null }, h('span', { class: 'qa-icon' }, icon(iconName)), label);

  setContent(page, 
    pageHeader('Poste en cours', `Ouvert à ${fmt.time(shift.opened_at)} · ${pumps}`, shiftBadge('open')),
    shiftLine('open'),
    h(
      'div',
      { class: 'stack' },
      requestQueue(shift, reload),
      h(
        'div',
        { class: 'quick-actions' },
        quick('Vente client', 'plus', () => addSale(ctx, shift, reload), true),
        quick('Règlement', 'cash', () => addPayment(shift, reload)),
        quick('Dépense', 'wallet', () => addExpense(ctx, shift, reload)),
      ),
      h(
        'div',
        { class: 'grid kpi-row' },
        kpi('Crédit', fmt.money(shift.credit_amount)),
        kpi('Règlements', fmt.money(shift.payments_amount)),
        kpi('Dépenses', fmt.money(shift.expenses_amount)),
      ),
      card(
        cardHeader('Opérations du poste', 'Les ventes payées normalement n’ont pas besoin d’être saisies : les index s’en chargent.'),
        entries.length
          ? entries.map((x) =>
              h(
                'div',
                { class: 'nozzle-row' },
                h(
                  'div',
                  { class: 'grow' },
                  h('div', { style: 'font-weight:600' }, x.title),
                  h('div', { class: 'muted small' }, `${fmt.time(x.at)} · ${x.detail}`),
                  h('div', { style: 'margin-top:4px' }, x.tag),
                ),
                h('div', { class: 'num', style: 'font-weight:600' }, x.amount),
                x.remove.pending
                  ? badge('Annulation demandée', 'warning')
                  : h('button', { class: 'btn danger sm', 'aria-label': x.remove.label, title: x.remove.label, onClick: () => cancelEntry(ctx, x, reload) }, icon('trash')),
              ),
            )
          : h('p', { class: 'muted' }, 'Aucune opération pour le moment.'),
      ),
      card(
        cardHeader('Mes pistolets', 'Index et prix relevés à l’ouverture'),
        shift.readings.map((r) =>
          h(
            'div',
            { class: 'nozzle-row' },
            h('span', { class: 'swatch', style: `background:${productColor(r.product_id)};width:12px;height:12px` }),
            h('div', { class: 'grow' }, h('div', { style: 'font-weight:600' }, `${r.pump_name} · ${r.nozzle_name}`), h('div', { class: 'muted small' }, `${r.product_name} · ${fmt.price(r.unit_price)}`)),
            h('div', { class: 'right' }, h('div', { class: 'muted small' }, 'Index début'), h('div', { class: 'num', style: 'font-weight:600' }, fmt.number(r.start_meter))),
          ),
        ),
      ),
      button('Clôturer mon poste', () => renderClosing(page, ctx, shift), { variant: 'large block secondary' }),
    ),
  );
}

// ---------- Purchases started by customers on their phone ----------
// Polled every few seconds; the attendant confirms with one tap.
function requestQueue(shift, reload) {
  const host = h('div', { class: 'stack', style: 'gap:10px' });
  const priceOf = (productId, type) => {
    const r = shift.readings.find((x) => x.product_id === productId);
    return type === 'account' ? r?.subscriber_price ?? r?.unit_price : r?.unit_price;
  };
  let known = null;
  let seenConnected = false;

  const act = async (fn) => {
    try {
      await fn();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  async function confirmRequest(r, adjust = {}) {
    try {
      const sale = await api.post(`/requests/${r.id}/confirm`, adjust);
      toast(`${r.customer_name} : ${fmt.liters(sale.liters)} · ${fmt.money(sale.amount)}${flags.combos && sale.points ? ` · +${sale.points} combos` : sale.combos_used ? ` · −${sale.combos_used} combos` : ''}`);
    } catch (err) {
      if (err.code !== 'over_limit') throw err;
      if (!(await confirmDialog('Accorder le crédit ?', `${err.message} Si vous accordez ce crédit, il sera signalé au gérant avec votre nom.`, { confirmLabel: 'Accorder' }))) return;
      await api.post(`/requests/${r.id}/confirm`, { ...adjust, grantCredit: true });
      toast('Crédit accordé et signalé au gérant');
    }
    reload();
  }

  async function adjust(r) {
    await formDialog({
      title: `Ajuster — ${r.customer_name}`,
      submitLabel: 'Confirmer la vente',
      intro: 'Saisissez la quantité réellement servie.',
      grid: false,
      fields: [{ name: 'liters', label: 'Litres servis', type: 'number', step: '0.01', min: '0.01', required: true, value: r.liters ?? (r.amount && priceOf(r.product_id, r.customer_type) ? Math.round((r.amount / priceOf(r.product_id, r.customer_type)) * 100) / 100 : '') }],
      onSubmit: (d) => confirmRequest(r, { liters: d.liters }),
    });
  }

  function draw(rows) {
    if (!rows.length) return host.replaceChildren();
    setContent(host, 
      h('h2', { class: 'queue-title' }, h('span', { class: 'pulse', 'aria-hidden': 'true' }), `Demandes des clients (${rows.length})`),
      ...rows.map((r) => {
        const price = priceOf(r.product_id, r.customer_type) ?? r.current_price;
        const liters = r.liters ?? r.amount / price;
        const amount = r.amount ?? r.liters * price;
        const overLimit = r.payment === 'credit' && amount > r.available + 0.001;
        return h(
          'div',
          { class: 'queue-card' },
          h('div', { class: 'who' }, h('span', { class: 'name' }, r.customer_name), h('span', { class: 'muted small' }, `il y a ${Math.max(0, Math.round((Date.now() - parseServerDate(r.created_at)) / 60000))} min`)),
          h('div', { class: 'row between' }, h('span', { class: 'what' }, r.amount ? fmt.money(r.amount) : fmt.liters(r.liters)), h('span', { class: 'muted' }, `${r.product_name} · ${r.amount ? `≈ ${fmt.liters(liters)}` : `≈ ${fmt.money(amount)}`}`)),
          h(
            'div',
            { class: 'row', style: 'gap:6px' },
            r.payment === 'credit'
              ? badge(overLimit ? 'Crédit · dépasse le plafond' : 'Crédit', overLimit ? 'serious' : 'info')
              : r.payment === 'combo'
                ? badge(`Avec ses combos (${r.loyalty_points})`, 'warning')
                : badge('Payé', 'good'),
            r.customer_type === 'account' ? badge('Abonné') : null,
            r.plate ? badge(r.plate) : null,
          ),
          h(
            'div',
            { class: 'actions' },
            button('Refuser', () => act(async () => {
              if (!(await confirmDialog('Refuser la demande ?', `${r.customer_name} · ${r.product_name}`, { confirmLabel: 'Refuser', danger: true }))) return;
              await api.post(`/requests/${r.id}/reject`, {});
              reload();
            }), { variant: 'secondary' }),
            button('Ajuster', () => act(() => adjust(r)), { variant: 'secondary' }),
            button('Confirmer', () => act(() => confirmRequest(r)), { iconName: 'check' }),
          ),
        );
      }),
    );
  }

  async function poll() {
    if (host.isConnected) seenConnected = true;
    else if (seenConnected) return clearInterval(timer); // screen left
    if (document.hidden) return;
    try {
      const rows = await api.get('/requests/pending');
      const ids = rows.map((r) => r.id);
      if (known && ids.some((id) => !known.includes(id))) {
        navigator.vibrate?.([80, 60, 80]);
        toast(`Nouvelle demande : ${rows.find((r) => !known.includes(r.id)).customer_name}`);
      }
      known = ids;
      draw(rows);
    } catch (err) {
      console.warn('Demandes clients :', err); // network hiccup: next poll will retry
    }
  }
  const timer = setInterval(poll, 4000);
  // Check right away when the phone screen comes back on.
  const onVisible = () => {
    if (!document.hidden) poll();
    if (seenConnected && !host.isConnected) document.removeEventListener('visibilitychange', onVisible);
  };
  document.addEventListener('visibilitychange', onVisible);
  poll();
  return host;
}

// Sale entered by the attendant, built for speed: one search field for the customer
// (name, plate or phone; an unknown name creates the customer), one-tap product,
// payment and unit, amount in dollars or litres.
async function addSale(ctx, shift, reload) {
  const customers = await api.get('/customers');
  const label = (c) => [c.name, c.plate, c.phone].filter(Boolean).join(' · ');
  const byLabel = new Map(customers.map((c) => [label(c).toLowerCase(), c]));
  const byName = new Map(customers.map((c) => [c.name.toLowerCase(), c]));
  const find = (text) => byLabel.get(text.trim().toLowerCase()) || byName.get(text.trim().toLowerCase());
  const products = [...new Map(shift.readings.map((r) => [r.product_id, r])).values()];
  // Subscribers pay the subscriber price fixed at shift opening.
  const priceOf = (productId, c) => {
    const r = products.find((x) => x.product_id === Number(productId));
    return (c?.type === 'account' ? r?.subscriber_price ?? r?.unit_price : r?.unit_price) || 0;
  };
  const { combosPerLiter, comboValue, comboThreshold } = ctx.state.settings;

  const who = h('p', { class: 'hint-line' });
  const summary = h('div', { class: 'summary-line total' }, h('span', {}, 'Total'), h('span', {}, '—'));
  const update = (e) => {
    const form = e.target.form;
    const text = form.elements.customer.value.trim();
    const c = text ? find(text) : null;
    if (!text) {
      who.textContent = '';
      who.className = 'hint-line';
    } else if (c) {
      const parts = [c.type === 'account' ? 'Abonné' : 'Particulier'];
      if (flags.combos) parts.push(`${c.points ?? 0} combos${c.points >= comboThreshold ? ` (= ${fmt.money(c.points * comboValue)})` : ''}`);
      parts.push(c.late ? 'mois précédent impayé' : `crédit disponible ${fmt.money(Math.max(0, c.available ?? 0))}`);
      who.textContent = parts.join(' · ');
      who.className = c.late ? 'hint-line variance-neg' : 'hint-line';
      if (c.plate && !form.elements.plate.value) form.elements.plate.value = c.plate;
    } else {
      who.textContent = `Nouveau client « ${text} » : il sera créé à l’enregistrement.`;
      who.className = 'hint-line new';
    }
    const price = priceOf(form.elements.productId.value, c);
    const qty = Number(form.elements.qty.value) || 0;
    const byAmount = form.elements.unit.value === 'amount';
    const liters = byAmount ? qty / price : qty;
    const amount = byAmount ? qty : qty * price;
    const payment = form.elements.payment.value;
    const combos =
      payment === 'combo'
        ? `−${Math.ceil(amount / comboValue - 1e-9)} combos`
        : payment === 'credit'
          ? `+${Math.floor(liters * combosPerLiter)} combos au paiement`
          : `+${Math.floor(liters * combosPerLiter)} combos`;
    summary.lastChild.textContent = qty ? `${fmt.liters(liters)} · ${fmt.money(amount)}${flags.combos ? ` · ${combos}` : ''}` : '—';
  };

  const fields = [
    { name: 'customer', label: 'Client (nom, plaque ou téléphone)', required: true, list: 'customer-list', placeholder: 'Tapez quelques lettres…', onInput: update, enterkeyhint: 'next' },
    { name: 'productId', label: 'Produit', type: 'segment', options: products.map((r) => [r.product_id, r.product_name]), onInput: update },
    { name: 'payment', label: 'Paiement', type: 'segment', options: [['paid', 'Payé'], ['credit', 'Crédit'], ...(flags.combos ? [['combo', 'Combos']] : [])], onInput: update },
    { name: 'unit', label: 'Unité', type: 'segment', options: [['amount', '$'], ['liters', 'L']], onInput: update },
    { name: 'qty', label: 'Quantité', type: 'number', step: '0.01', min: '0.01', required: true, onInput: update, inputmode: 'decimal' },
    { name: 'plate', label: 'Plaque', placeholder: 'Facultatif' },
  ];

  const ok = await formDialog({
    title: 'Vente client',
    submitLabel: 'Enregistrer la vente',
    grid: false,
    fields,
    extra: () => h('div', {}, h('datalist', { id: 'customer-list' }, customers.map((c) => h('option', { value: label(c) }))), who, summary),
    onSubmit: async (d, form) => {
      let customer = find(d.customer);
      if (!customer) {
        customer = await api.post('/customers/quick', { name: d.customer.trim() });
        customers.push(customer);
        byName.set(customer.name.toLowerCase(), customer);
        form.elements.customer.value = customer.name;
      }
      const body = {
        customerId: customer.id,
        productId: Number(d.productId),
        payment: d.payment,
        [d.unit === 'amount' ? 'amount' : 'liters']: d.qty,
        plate: d.plate,
      };
      try {
        return await api.post(`/shifts/${shift.id}/sales`, body);
      } catch (err) {
        if (err.code !== 'over_limit') throw err;
        const grant = await confirmDialog('Accorder le crédit ?', `${err.message} Si vous accordez ce crédit, il sera signalé au gérant avec votre nom.`, { confirmLabel: 'Accorder' });
        if (!grant) throw new Error('Vente non enregistrée : crédit refusé.');
        return api.post(`/shifts/${shift.id}/sales`, { ...body, grantCredit: true });
      }
    },
  });
  if (ok) {
    toast(
      ok.over_limit
        ? 'Crédit accordé et signalé au gérant'
        : ok.kind === 'combo'
          ? `Échange enregistré · −${ok.combos_used} combos`
          : `Vente enregistrée${flags.combos && ok.points ? ` · +${ok.points} combos` : ''}`,
    );
    reload();
  }
}

async function addPayment(shift, reload) {
  const customers = (await api.get('/customers')).filter((c) => c.balance > 0 || c.type === 'account');
  if (!customers.length) return toast('Aucun client ne doit d’argent.', 'error');
  const ok = await formDialog({
    title: 'Règlement client',
    submitLabel: 'Encaisser',
    intro: 'Un client vient payer sa dette : l’argent est ajouté à votre caisse.',
    grid: false,
    fields: [
      { name: 'customerId', label: 'Client', type: 'select', required: true, options: [['', 'Choisir un client…'], ...customers.map((c) => [c.id, `${c.name} — doit ${fmt.money(Math.max(0, c.balance))}`])] },
      { name: 'amount', label: 'Montant reçu ($)', type: 'number', step: '0.01', min: '0.01', required: true },
      { name: 'method', label: 'Mode', type: 'select', options: [['espèces', 'Espèces'], ['mobile money', 'Mobile money'], ['carte', 'Carte']] },
      { name: 'reference', label: 'Référence', placeholder: 'Facultatif (n° de transaction…)' },
    ],
    onSubmit: (d) => api.post(`/shifts/${shift.id}/payments`, { ...d, customerId: Number(d.customerId) }),
  });
  if (ok) {
    toast(`Règlement encaissé · reste dû ${fmt.money(Math.max(0, ok.balance))}`);
    reload();
  }
}

async function addExpense(ctx, shift, reload) {
  const ok = await formDialog({
    title: 'Dépense payée en caisse',
    submitLabel: 'Enregistrer la dépense',
    intro: 'Elle sera déduite du montant à remettre à la clôture.',
    grid: false,
    fields: [
      { name: 'amount', label: 'Montant ($)', type: 'number', step: '0.01', min: '0.01', required: true },
      { name: 'category', label: 'Catégorie', type: 'select', options: ctx.state.settings.expenseCategories.map((c) => [c, c]), value: 'Fournitures' },
      { name: 'description', label: 'Description', required: true, placeholder: 'Ex. : eau, ampoule, transport…' },
      { name: 'beneficiary', label: 'Payé à', placeholder: 'Facultatif' },
    ],
    onSubmit: (d) => api.post(`/shifts/${shift.id}/expenses`, d),
  });
  if (ok) {
    toast('Dépense enregistrée');
    reload();
  }
}

// ---------- 3. Closing: end meters + cash count, live reconciliation ----------
function renderClosing(page, ctx, shift) {
  const tol = ctx.state.settings.cashTolerance;
  const credit = shift.credit_amount || 0;
  const payments = shift.payments_amount || 0;
  const expenses = shift.expenses_amount || 0;
  const combos = shift.combo_amount || 0;
  const lines = {
    total: h('span', { class: 'num' }),
    credit: h('span', { class: 'num' }, fmt.money(credit)),
    expected: h('span', { class: 'num' }),
    declared: h('span', { class: 'num' }),
    variance: h('span', { class: 'num' }),
  };
  const perNozzle = new Map();

  const form = h('form', { class: 'stack' });
  const recompute = () => {
    let total = 0;
    let complete = true;
    for (const r of shift.readings) {
      const v = form.elements[`end_${r.nozzle_id}`].value;
      const out = perNozzle.get(r.nozzle_id);
      if (v === '') {
        complete = false;
        out.textContent = '';
        continue;
      }
      const liters = Number(v) - r.start_meter;
      total += liters * r.unit_price;
      out.textContent = liters < 0 ? 'Index inférieur au début !' : `${fmt.liters(liters)} · ${fmt.money(liters * r.unit_price)}`;
      out.className = liters < 0 ? 'small variance-neg' : 'small muted';
    }
    // Subscribers' higher price is cashed on top of the pump price.
    const surcharge = shift.sales.reduce((t, x) => t + (x.amount - x.liters * (shift.readings.find((r) => r.nozzle_id === x.nozzle_id)?.unit_price ?? 0)), 0);
    total += surcharge;
    const expected = total - credit - combos + payments - expenses;
    const declared = (Number(form.elements.cash.value) || 0) + (Number(form.elements.card.value) || 0);
    lines.total.textContent = complete ? fmt.money(total) : '—';
    lines.expected.textContent = complete ? fmt.money(expected) : '—';
    lines.declared.textContent = fmt.money(declared);
    setContent(lines.variance, complete && form.elements.cash.value !== '' ? varianceCell(Math.round((declared - expected) * 100) / 100, tol) : '—');
  };

  form.append(
    card(
      cardHeader('1. Index de fin', 'Relevez le compteur de chaque pistolet'),
      h(
        'div',
        { class: 'stack' },
        shift.readings.map((r) => {
          const out = h('span', { class: 'small muted' });
          perNozzle.set(r.nozzle_id, out);
          return h(
            'div',
            {},
            field({ name: `end_${r.nozzle_id}`, label: `${r.pump_name} · ${r.nozzle_name} (début : ${fmt.number(r.start_meter)})`, type: 'number', step: '0.01', min: String(r.start_meter), required: true, onInput: recompute }),
            out,
          );
        }),
      ),
    ),
    card(
      cardHeader('2. Caisse', 'Comptez l’argent encaissé pendant le poste'),
      h(
        'div',
        { class: 'form-grid' },
        field({ name: 'cash', label: 'Espèces', type: 'number', step: '0.01', min: '0', required: true, onInput: recompute }),
        field({ name: 'card', label: 'Cartes / paiements électroniques', type: 'number', step: '0.01', min: '0', value: '0', onInput: recompute }),
        field({ name: 'notes', label: 'Remarque (facultatif)', type: 'textarea', full: true }),
      ),
    ),
    card(
      cardHeader('3. Rapprochement'),
      h('div', { class: 'summary-line' }, h('span', {}, 'Ventes selon les index'), lines.total),
      h('div', { class: 'summary-line' }, h('span', {}, 'Vendu à crédit'), h('span', {}, '− ', lines.credit)),
      combos ? h('div', { class: 'summary-line' }, h('span', {}, 'Échangé contre des combos'), h('span', { class: 'num' }, `− ${fmt.money(combos)}`)) : null,
      payments ? h('div', { class: 'summary-line' }, h('span', {}, 'Règlements reçus'), h('span', { class: 'num' }, `+ ${fmt.money(payments)}`)) : null,
      expenses ? h('div', { class: 'summary-line' }, h('span', {}, 'Dépenses payées'), h('span', { class: 'num' }, `− ${fmt.money(expenses)}`)) : null,
      h('div', { class: 'summary-line' }, h('span', {}, 'À remettre'), lines.expected),
      h('div', { class: 'summary-line' }, h('span', {}, 'Déclaré'), lines.declared),
      h('div', { class: 'summary-line total' }, h('span', {}, 'Écart'), lines.variance),
    ),
    h('div', { class: 'grid grid-2' }, button('Retour', () => renderAttendant(page, ctx), { variant: 'large secondary' }), button('Clôturer le poste', null, { variant: 'large', type: 'submit' })),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!(await confirmDialog('Clôturer le poste ?', 'Les index et montants ne pourront plus être modifiés.', { confirmLabel: 'Clôturer' }))) return;
    try {
      const closed = await api.post(`/shifts/${shift.id}/close`, {
        readings: shift.readings.map((r) => ({ nozzleId: r.nozzle_id, endMeter: Number(form.elements[`end_${r.nozzle_id}`].value) })),
        cash: Number(form.elements.cash.value),
        card: Number(form.elements.card.value) || 0,
        notes: form.elements.notes.value,
      });
      renderClosed(page, ctx, closed);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  setContent(page, pageHeader('Clôturer mon poste', `Poste ouvert à ${fmt.time(shift.opened_at)}`), form);
  recompute();
}

function renderClosed(page, ctx, shift) {
  const tol = ctx.state.settings.cashTolerance;
  const ok = Math.abs(shift.variance) <= tol;
  setContent(page, 
    pageHeader('Poste clôturé', `Merci ${ctx.state.user.name.split(' ')[0]} !`),
    shiftLine('closed'),
    h(
      'div',
      { class: 'stack' },
      card(
        h(
          'div',
          { class: 'big-result' },
          h('div', { class: 'status-icon', style: `background:var(${ok ? '--green' : '--orange'})` }, icon(ok ? 'check' : 'alert')),
          h('div', { class: 'muted' }, 'Écart de caisse'),
          h('div', { class: 'value' }, varianceCell(shift.variance, tol)),
          h('div', { class: 'muted' }, ok ? 'Votre caisse est juste.' : 'L’écart dépasse la tolérance : le gérant va vérifier.'),
        ),
      ),
      shiftSummary(shift, tol),
      button('Terminé', () => renderAttendant(page, ctx), { variant: 'large block' }),
    ),
  );
}

// ---------- History ----------
export async function renderMyShifts(page, ctx) {
  const shifts = await api.get('/shifts');
  const tol = ctx.state.settings.cashTolerance;
  setContent(page, 
    pageHeader('Historique', 'Vos derniers postes'),
    h(
      'section',
      { class: 'card flush' },
      table(
        [
          { label: 'Date', render: (s) => fmt.dateTime(s.opened_at) },
          { label: 'Ventes', align: 'right', render: (s) => (s.total_amount == null ? '—' : fmt.money(s.total_amount)) },
          { label: 'Écart', align: 'right', render: (s) => varianceCell(s.variance, tol) },
          { label: 'Statut', render: (s) => shiftBadge(s.status) },
        ],
        shifts,
        { onRowClick: (s) => ctx.navigate(`historique/${s.id}`), empty: 'Aucun poste pour le moment.' },
      ),
    ),
  );
}
