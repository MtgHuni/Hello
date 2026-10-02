import { api } from '../api.js';
import { h, fmt, pageHeader, card, cardHeader, table, shiftBadge, varianceCell, button, formDialog, confirmDialog, toast, field, productColor, badge, kpi } from '../ui.js';
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

  page.replaceChildren(
    pageHeader('Ouvrir mon poste', 'Choisissez la ou les pompes dont vous êtes responsable. Les index de départ sont relevés automatiquement.'),
    card(form),
  );
}

// ---------- 2. During the shift ----------
function renderOpenShift(page, ctx, shift) {
  const pumps = [...new Set(shift.readings.map((r) => r.pump_name))].join(', ');
  const reload = () => renderAttendant(page, ctx);

  // One list of everything recorded during the shift, newest first.
  const entries = [
    ...shift.sales.map((s) => ({
      at: s.created_at,
      title: s.customer_name,
      detail: `${s.product_name} · ${fmt.liters(s.liters)}${s.plate ? ` · ${s.plate}` : ''}`,
      tag: s.kind === 'credit' ? (s.over_limit ? badge('Crédit hors plafond', 'serious') : badge('Crédit', 'info')) : badge(`+${s.points} pts`, 'good'),
      amount: fmt.money(s.amount),
      remove: { url: `/shifts/${shift.id}/sales/${s.id}`, label: 'Annuler cette vente' },
    })),
    ...shift.payments.map((p) => ({
      at: p.created_at,
      title: p.customer_name,
      detail: `Règlement ${p.method}${p.reference ? ` · ${p.reference}` : ''}`,
      tag: badge('Encaissé', 'good'),
      amount: `+${fmt.money(p.amount)}`,
      remove: { url: `/shifts/${shift.id}/payments/${p.id}`, label: 'Annuler ce règlement' },
    })),
    ...shift.expenses.map((e) => ({
      at: e.created_at,
      title: e.description,
      detail: `${e.category}${e.beneficiary ? ` · ${e.beneficiary}` : ''}`,
      tag: badge('Dépense', 'warning'),
      amount: `−${fmt.money(e.amount)}`,
      remove: { url: `/shifts/${shift.id}/expenses/${e.id}`, label: 'Annuler cette dépense' },
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const quick = (label, iconName, color, onClick, primary) =>
    h('button', { type: 'button', class: `quick-action ${primary ? 'primary' : ''}`, onClick }, h('span', { class: 'qa-icon', style: primary ? '' : `background:${color}` }, icon(iconName)), label);

  page.replaceChildren(
    pageHeader('Poste en cours', `Ouvert à ${fmt.time(shift.opened_at)} · ${pumps}`, shiftBadge('open')),
    h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'quick-actions' },
        quick('Vente client', 'plus', '', () => addSale(ctx, shift, reload), true),
        quick('Règlement', 'cash', 'var(--green)', () => addPayment(shift, reload)),
        quick('Dépense', 'wallet', 'var(--orange)', () => addExpense(ctx, shift, reload)),
      ),
      h(
        'div',
        { class: 'grid kpi-row' },
        kpi('Crédit accordé', fmt.money(shift.credit_amount)),
        kpi('Règlements reçus', fmt.money(shift.payments_amount)),
        kpi('Dépenses caisse', fmt.money(shift.expenses_amount)),
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
                h(
                  'button',
                  {
                    class: 'btn danger sm',
                    'aria-label': x.remove.label,
                    title: x.remove.label,
                    onClick: async () => {
                      if (!(await confirmDialog(`${x.remove.label} ?`, `${x.title} · ${x.amount}`, { confirmLabel: 'Annuler l’opération', danger: true }))) return;
                      try {
                        await api.del(x.remove.url);
                        reload();
                      } catch (err) {
                        toast(err.message, 'error');
                      }
                    },
                  },
                  icon('trash'),
                ),
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

// Sale to a customer. A new customer can be created on the spot with just a name;
// a credit beyond the limit can be granted after an explicit confirmation.
async function addSale(ctx, shift, reload) {
  const customers = await api.get('/customers');
  const NEW = '__new';
  const priceOf = (nozzleId) => shift.readings.find((r) => r.nozzle_id === Number(nozzleId))?.unit_price || 0;
  const amount = h('div', { class: 'summary-line total' }, h('span', {}, 'Montant'), h('span', {}, fmt.money(0)));
  const info = h('p', { class: 'muted small' });
  const update = (e) => {
    const form = e.target.form;
    const isNew = form.elements.customerId.value === NEW;
    form.elements.newName.closest('.field').hidden = !isNew;
    form.elements.newName.required = isNew;
    const c = customers.find((x) => x.id === Number(form.elements.customerId.value));
    const total = (Number(form.elements.liters.value) || 0) * priceOf(form.elements.nozzleId.value);
    amount.lastChild.textContent = fmt.money(total);
    if (isNew) info.textContent = `Nouveau client en compte, plafond de départ ${fmt.money(ctx.state.settings.newCustomerCreditLimit)}. Le gérant complétera sa fiche.`;
    else if (c?.type === 'account') info.textContent = `Crédit disponible : ${fmt.money(c.available)}`;
    else info.textContent = c ? 'Client fidélité : paiement normal, points ajoutés.' : '';
    if (e.target.name === 'customerId' && c?.plate && !form.elements.plate.value) form.elements.plate.value = c.plate;
    if (isNew && e.target.name === 'customerId') form.elements.newName.focus();
  };

  const ok = await formDialog({
    title: 'Vente client',
    submitLabel: 'Enregistrer la vente',
    grid: false,
    fields: [
      {
        name: 'customerId',
        label: 'Client',
        type: 'select',
        required: true,
        options: [
          ['', 'Choisir un client…'],
          [NEW, '＋ Nouveau client'],
          ...customers.map((c) => [c.id, `${c.name} — ${c.type === 'account' ? `dispo ${fmt.money(c.available)}` : 'fidélité'}`]),
        ],
        onInput: update,
      },
      { name: 'newName', label: 'Nom du nouveau client', placeholder: 'Nom ou société', hidden: true },
      { name: 'nozzleId', label: 'Pistolet', type: 'select', required: true, options: shift.readings.map((r) => [r.nozzle_id, `${r.pump_name} · ${r.product_name} (${fmt.price(r.unit_price)})`]), onInput: update },
      { name: 'liters', label: 'Litres servis', type: 'number', step: '0.01', min: '0.01', required: true, onInput: update },
      { name: 'plate', label: 'Immatriculation du véhicule', placeholder: 'Facultatif' },
    ],
    extra: () => h('div', {}, info, amount),
    onSubmit: async (d, form) => {
      let customerId = Number(d.customerId);
      if (d.customerId === NEW) {
        const created = await api.post('/customers/quick', { name: d.newName });
        customers.push(created);
        customerId = created.id;
        // Keep the created customer selected if the sale itself fails afterwards.
        form.elements.customerId.append(h('option', { value: String(created.id) }, created.name));
        form.elements.customerId.value = String(created.id);
        form.elements.newName.closest('.field').hidden = true;
        form.elements.newName.required = false;
      }
      const body = { customerId, nozzleId: Number(d.nozzleId), liters: d.liters, plate: d.plate };
      try {
        return await api.post(`/shifts/${shift.id}/sales`, body);
      } catch (err) {
        if (err.code !== 'over_limit') throw err;
        const grant = await confirmDialog('Accorder le crédit ?', `${err.message} Si vous accordez ce crédit, il sera signalé au gérant avec votre nom.`, { confirmLabel: 'Accorder' });
        if (!grant) throw new Error('Vente non enregistrée : plafond de crédit dépassé.');
        return api.post(`/shifts/${shift.id}/sales`, { ...body, grantCredit: true });
      }
    },
  });
  if (ok) {
    toast(ok.over_limit ? 'Crédit accordé et signalé au gérant' : 'Vente enregistrée');
    reload();
  }
}

async function addPayment(shift, reload) {
  const customers = (await api.get('/customers')).filter((c) => c.type === 'account');
  if (!customers.length) return toast('Aucun client en compte.', 'error');
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
    const expected = total - credit + payments - expenses;
    const declared = (Number(form.elements.cash.value) || 0) + (Number(form.elements.card.value) || 0);
    lines.total.textContent = complete ? fmt.money(total) : '—';
    lines.expected.textContent = complete ? fmt.money(expected) : '—';
    lines.declared.textContent = fmt.money(declared);
    lines.variance.replaceChildren(complete && form.elements.cash.value !== '' ? varianceCell(Math.round((declared - expected) * 100) / 100, tol) : '—');
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

  page.replaceChildren(pageHeader('Clôturer mon poste', `Poste ouvert à ${fmt.time(shift.opened_at)}`), form);
  recompute();
}

function renderClosed(page, ctx, shift) {
  const tol = ctx.state.settings.cashTolerance;
  const ok = Math.abs(shift.variance) <= tol;
  page.replaceChildren(
    pageHeader('Poste clôturé', `Merci ${ctx.state.user.name.split(' ')[0]} !`),
    h(
      'div',
      { class: 'stack' },
      card(
        h(
          'div',
          { class: 'big-result' },
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
  page.replaceChildren(
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
