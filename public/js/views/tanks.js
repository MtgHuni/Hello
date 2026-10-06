import { api } from '../api.js';
import { flags, edit, adminEdit, canAdmin } from '../ui.js';
import { h, fmt, pageHeader, cardHeader, table, segmented, tankGauge, button, formDialog, confirmDialog, actionSheet, field, toast, badge, setContent, nameChips } from '../ui.js';

let tab = 'deliveries';

export async function renderTanks(page, ctx) {
  const [tanks, products, deliveries, dips, sup, meters] = await Promise.all([api.get('/tanks'), api.get('/products'), api.get('/deliveries'), api.get('/dips'), api.get('/suppliers'), api.get('/stock/meters')]);
  const tol = ctx.state.settings.stockTolerance;
  const active = tanks.filter((t) => t.active);
  const reload = () => renderTanks(page, ctx);

  setContent(page, 
    pageHeader(
      'Cuves',
      null,
      edit(button('Jaugeage', () => dipDialog(active, meters, reload), { variant: 'secondary', iconName: 'ruler' })),
      edit(button('Livraison', () => deliveryDialog(active, sup.names, meters, reload), { iconName: 'truck' })),
    ),
    h(
      'div',
      { class: 'grid grid-2' },
      tanks.map((t) =>
        h(
          'section',
          { class: 'card stack' },
          tankGauge(t),
          h(
            'div',
            { class: 'row between small' },
            h(
              'span',
              { class: 'muted' },
              t.last_dip_at ? ['Dernier jaugeage ', fmt.dateTime(t.last_dip_at), ' · écart ', h('span', { class: Math.abs(t.last_dip_variance) > tol ? 'variance-neg' : '' }, `${t.last_dip_variance > 0 ? '+' : ''}${fmt.liters(t.last_dip_variance)}`)] : 'Aucun jaugeage',
            ),
            h('span', { class: 'row' }, t.active ? null : badge('Désactivée'), edit(button('Modifier', () => tankDialog(products, t, reload), { variant: 'ghost sm' }))),
          ),
        ),
      ),
      edit(h(
        'button',
        { class: 'card empty no-print', style: 'border:1px dashed var(--field-border);cursor:pointer;font:inherit;color:var(--accent)', onClick: () => tankDialog(products, null, reload) },
        '+ Ajouter une cuve',
      )),
    ),
    suppliersCard(sup, reload),
    h(
      'section',
      { class: 'card flush section' },
      h(
        'div',
        { class: 'card-header' },
        segmented(
          [
            ['deliveries', 'Livraisons'],
            ['dips', 'Jaugeages'],
          ],
          tab,
          (v) => {
            tab = v;
            reload();
          },
        ),
      ),
      tab === 'deliveries'
        ? table(
            [
              { label: 'Date', render: (d) => fmt.dateTime(d.created_at) },
              { label: 'Cuve', key: 'tank_name' },
              { label: 'Fournisseur', render: (d) => d.supplier || '—' },
              { label: 'Bon', render: (d) => d.reference || '—' },
              { label: 'Reçu', align: 'right', render: (d) => fmt.liters(d.liters_received) },
              {
                label: 'Manquant',
                align: 'right',
                render: (d) => {
                  const diff = d.liters_received - d.liters_ordered;
                  return diff < 0 ? h('span', { class: 'variance-neg' }, fmt.liters(diff)) : '—';
                },
              },
              { label: 'Montant', align: 'right', render: (d) => (d.amount ? fmt.money(d.amount) : d.unit_cost ? fmt.money(d.unit_cost * d.liters_received) : '—') },
              { label: 'Paiement', render: (d) => (d.payment === 'credit' ? badge('À crédit', 'warning') : d.payment === 'prepaid' ? 'Déjà payée' : d.payment === 'shift' ? 'Argent du poste' : d.payment === 'cash' ? 'Caisse' : '—') },
            ],
            deliveries,
            { empty: 'Aucune livraison enregistrée.', onRowClick: flags.readonly ? undefined : (d) => deliveryPaymentDialog(d, sup.names, reload) },
          )
        : table(
            [
              { label: 'Date', render: (d) => fmt.dateTime(d.created_at) },
              { label: 'Cuve', key: 'tank_name' },
              { label: 'Stock théorique', align: 'right', render: (d) => fmt.liters(d.book_stock) },
              { label: 'Mesuré', align: 'right', render: (d) => fmt.liters(d.measured) },
              {
                label: 'Écart',
                align: 'right',
                render: (d) => {
                  const bad = Math.abs(d.variance) > tol;
                  return h('span', { class: bad ? 'variance-neg' : '', title: bad ? 'Hors tolérance' : null }, `${d.variance > 0 ? '+' : ''}${fmt.liters(d.variance)}`);
                },
              },
              { label: 'Par', render: (d) => d.user_name || '—' },
              { label: 'Note', wrap: true, render: (d) => d.note || '' },
            ],
            dips,
            { empty: 'Aucun jaugeage enregistré.' },
          ),
    ),
  );
}

const PAYMENTS = [['cash', 'Caisse'], ['shift', 'Argent du poste'], ['credit', 'À crédit'], ['prepaid', 'Déjà payée']];
const tankOptions = (tanks) => tanks.map((t) => [t.id, `${t.name} (${t.product_name})`]);

// While the shift is open, the index of each nozzle fed by the tank, read at the same moment:
// the fuel sold since the opening comes off the stock, so the tank never shows more than it holds.
function meterFields(meters) {
  const host = h('div', { class: 'stack full' });
  const show = (tankId) =>
    setContent(
      host,
      meters
        .filter((m) => m.tankId === Number(tankId))
        .map((m) =>
          field({ name: `meter-${m.nozzleId}`, label: `Index ${m.label} maintenant`, type: 'number', step: '0.01', min: String(m.latest), required: true, hint: `Dernier relevé : ${fmt.number(m.latest)}` }),
        ),
    );
  const read = (form) => meters.filter((m) => form.elements[`meter-${m.nozzleId}`]).map((m) => ({ nozzleId: m.nozzleId, meter: Number(form.elements[`meter-${m.nozzleId}`].value) }));
  return { host, show, read };
}

async function deliveryDialog(tanks, supplierNames, meters, reload) {
  if (!tanks.length) return toast('Ajoutez d’abord une cuve.', 'error');
  const named = nameChips(supplierNames);
  const index = meterFields(meters);
  index.show(tanks[0].id);
  const total = h('p', { class: 'hint-line full' });
  // Paid on the spot: out of the cash book. On credit: a debt to the supplier (supplier and amount required).
  const update = (e) => {
    const form = e.target.form;
    const credit = form.elements.payment.value === 'credit';
    form.elements.supplier.required = credit || form.elements.payment.value === 'shift';
    const received = Number(form.elements.litersReceived.value) || 0;
    const cost = Number(form.elements.unitCost.value) || 0;
    total.textContent = received && cost ? `Montant : ${fmt.money(received * cost)}${credit ? ' dû au fournisseur' : form.elements.payment.value === 'prepaid' ? ' déjà payé' : ' payé maintenant'}` : '';
  };
  const ok = await formDialog({
    title: 'Enregistrer une livraison',
    fields: [
      { name: 'tankId', label: 'Cuve', type: 'select', options: tankOptions(tanks), required: true, full: true, onInput: (e) => index.show(e.target.value) },
      { name: 'meters', type: 'node', node: index.host },
      { name: 'litersOrdered', label: 'Litres commandés (bon)', type: 'number', step: '0.01', min: '0', required: true },
      { name: 'litersReceived', label: 'Litres reçus (mesurés)', type: 'number', step: '0.01', min: '0', required: true, onInput: update },
      { name: 'supplier', label: 'Fournisseur', onInput: named.onInput },
      named.node,
      { name: 'reference', label: 'N° du bon de livraison' },
      { name: 'unitCost', label: 'Prix d’achat ($/L)', type: 'number', step: '0.001', min: '0', onInput: update },
      { name: 'payment', label: 'Paiement', type: 'segment', full: true, options: PAYMENTS, onInput: update },
      { name: 'total', type: 'node', node: total },
    ],
    onSubmit: async (d, form) => {
      if (d.payment === 'credit' && !d.unitCost) throw new Error('Indiquez le prix d’achat : c’est ce que la station devra au fournisseur.');
      if (d.payment === 'shift' && !d.supplier) throw new Error('Indiquez le fournisseur payé avec l’argent du poste.');
      if (d.payment === 'shift' && !d.unitCost) throw new Error('Indiquez le prix d’achat : c’est ce qui sort de l’argent du poste.');
      const body = { ...d, tankId: Number(d.tankId), meters: index.read(form) };
      try {
        return await api.post('/deliveries', body);
      } catch (err) {
        if (err.code !== 'over_capacity') throw err;
        if (!(await confirmDialog('Dépasser la capacité ?', err.message, { confirmLabel: 'Enregistrer quand même', danger: true }))) throw new Error('Livraison non enregistrée.');
        return api.post('/deliveries', { ...body, force: true });
      }
    },
  });
  if (ok) {
    toast('Livraison enregistrée.');
    reload();
  }
}

// The payment of a delivery, corrected afterwards: the litres stay, they made the stock.
async function deliveryPaymentDialog(d, supplierNames, reload) {
  const named = nameChips(supplierNames);
  const ok = await formDialog({
    title: `Livraison du ${fmt.date(d.created_at)}`,
    intro: `${d.tank_name} · ${fmt.liters(d.liters_received)} reçus`,
    fields: [
      { name: 'payment', label: 'Paiement', type: 'segment', full: true, options: PAYMENTS, value: d.payment || 'cash' },
      { name: 'supplier', label: 'Fournisseur', value: d.supplier || '', onInput: named.onInput },
      named.node,
      { name: 'reference', label: 'N° du bon de livraison', value: d.reference || '' },
      { name: 'amount', label: 'Montant ($)', type: 'number', step: '0.01', min: '0', value: d.amount ?? '' },
    ],
    onSubmit: (v) => api.put(`/deliveries/${d.id}`, { payment: v.payment, supplier: v.supplier, reference: v.reference, amount: v.amount }),
  });
  if (ok) {
    toast('Paiement de la livraison corrigé.');
    reload();
  }
}

// The suppliers with their contacts, what the station owes them (deliveries on credit), and their payment.
// Touching a row pays the supplier, or lets the admin change its record (name, phone, e-mail).
function suppliersCard(sup, reload) {
  const list = sup.suppliers;
  if (!list.length && !canAdmin()) return null;
  const total = list.reduce((t, s) => t + Math.max(0, s.balance), 0);
  const owing = list.filter((s) => s.balance > 0);
  const contacts = (s) => [s.phone, s.email].filter(Boolean).join(' · ');
  const touch = (s) => {
    const actions = [
      s.balance > 0 ? { label: `Payer ${s.name}`, onClick: () => supplierPaymentDialog(owing, s, reload) } : null,
      canAdmin() && s.id ? { label: 'Modifier la fiche', onClick: () => supplierDialog(s, reload) } : null,
    ].filter(Boolean);
    if (actions.length === 1) actions[0].onClick();
    else if (actions.length) actionSheet({ title: s.name, actions });
  };
  return h(
    'section',
    { class: 'card flush section' },
    cardHeader(
      'Fournisseurs',
      total ? `${fmt.money(total)} à payer pour des livraisons à crédit` : 'Rien à payer',
      owing.length ? edit(button('Payer', () => supplierPaymentDialog(owing, null, reload), { variant: 'secondary sm', iconName: 'cash' })) : null,
      adminEdit(button('Ajouter', () => supplierDialog(null, reload), { variant: 'secondary sm', iconName: 'plus' })),
    ),
    table(
      [
        { label: 'Fournisseur', wrap: true, render: (s) => [h('strong', {}, s.name), contacts(s) ? h('div', { class: 'muted small' }, contacts(s)) : null] },
        { label: 'Livré à crédit', align: 'right', render: (s) => fmt.money(s.owed) },
        { label: 'Payé', align: 'right', render: (s) => fmt.money(s.paid) },
        { label: 'Reste à payer', align: 'right', render: (s) => (s.balance > 0 ? h('strong', { class: 'variance-neg' }, fmt.money(s.balance)) : 'Soldé') },
      ],
      list,
      { empty: 'Aucun fournisseur.', onRowClick: flags.readonly ? undefined : touch },
    ),
    sup.payments.length
      ? h(
          'details',
          { class: 'card-details' },
          h('summary', {}, `Derniers paiements (${sup.payments.length})`),
          table(
            [
              { label: 'Date', render: (p) => fmt.dateTime(p.created_at) },
              { label: 'Fournisseur', key: 'supplier' },
              { label: 'Mode', key: 'method' },
              { label: 'Montant', align: 'right', render: (p) => fmt.money(p.amount) },
            ],
            sup.payments,
            { onRowClick: flags.readonly ? undefined : (p) => (p.expense_id ? (location.hash = p.shift_id ? `#/postes/${p.shift_id}` : '#/depenses') : removeSupplierPayment(p, reload)) },
          ),
        )
      : null,
  );
}

// The admin's record of a supplier: a new name follows on its deliveries and payments.
async function supplierDialog(s, reload) {
  const ok = await formDialog({
    title: s ? `Modifier ${s.name}` : 'Nouveau fournisseur',
    grid: false,
    fields: [
      { name: 'name', label: 'Nom', value: s?.name, required: true },
      { name: 'phone', label: 'Téléphone', type: 'tel', value: s?.phone, inputmode: 'tel' },
      { name: 'email', label: 'E-mail', type: 'email', value: s?.email, inputmode: 'email' },
    ],
    onSubmit: (d) => (s ? api.put(`/suppliers/${s.id}`, d) : api.post('/suppliers', d)),
  });
  if (ok) {
    toast(s ? 'Fournisseur modifié.' : 'Fournisseur ajouté.');
    reload();
  }
}

async function supplierPaymentDialog(suppliers, s, reload) {
  const ok = await formDialog({
    title: s ? `Payer ${s.name}` : 'Payer un fournisseur',
    grid: false,
    fields: [
      { name: 'supplier', label: 'Fournisseur', type: 'select', options: suppliers.filter((x) => x.balance > 0).map((x) => [x.name, `${x.name} · reste ${fmt.money(x.balance)}`]), value: s?.name, required: true },
      { name: 'amount', label: 'Montant ($)', type: 'number', step: '0.01', min: '0.01', required: true, value: s ? s.balance.toFixed(2) : '' },
      { name: 'method', label: 'Payé avec', type: 'segment', options: [['espèces', 'Espèces'], ['mobile money', 'Mobile money']] },
      { name: 'reference', label: 'Référence', placeholder: 'Facultatif (reçu, n° de transaction…)' },
    ],
    submitLabel: 'Enregistrer le paiement',
    onSubmit: (d) => api.post('/suppliers/payments', d),
  });
  if (ok) {
    toast('Paiement au fournisseur enregistré.');
    reload();
  }
}

async function removeSupplierPayment(p, reload) {
  if (!(await confirmDialog('Retirer ce paiement ?', `${p.supplier} · ${fmt.money(p.amount)}`, { confirmLabel: 'Retirer', danger: true }))) return;
  try {
    await api.del(`/suppliers/payments/${p.id}`);
    toast('Paiement retiré.');
    reload();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function dipDialog(tanks, meters, reload) {
  if (!tanks.length) return toast('Ajoutez d’abord une cuve.', 'error');
  const index = meterFields(meters);
  index.show(tanks[0].id);
  const ok = await formDialog({
    title: 'Saisir un jaugeage',
    grid: false,
    fields: [
      { name: 'tankId', label: 'Cuve', type: 'select', options: tankOptions(tanks), required: true, onInput: (e) => index.show(e.target.value) },
      { name: 'meters', type: 'node', node: index.host },
      { name: 'measured', label: 'Volume mesuré (litres)', type: 'number', step: '0.01', min: '0', required: true },
      { name: 'note', label: 'Note', type: 'textarea' },
    ],
    onSubmit: (d, form) => api.post('/dips', { ...d, tankId: Number(d.tankId), meters: index.read(form) }),
  });
  if (ok) {
    toast('Jaugeage enregistré.');
    reload();
  }
}

async function tankDialog(products, tank, reload) {
  const fields = [
    { name: 'name', label: 'Nom', value: tank?.name, required: true },
    { name: 'productId', label: 'Produit', type: 'select', options: products.map((p) => [p.id, p.name]), value: tank?.product_id, required: true },
    { name: 'capacity', label: 'Capacité (L)', type: 'number', step: '1', min: '1', value: tank?.capacity, required: true },
    { name: 'lowLevel', label: "Seuil d'alerte (L)", type: 'number', step: '1', min: '0', value: tank?.low_level ?? 0, required: true },
  ];
  if (tank) fields.push({ name: 'active', label: 'Cuve active', type: 'checkbox', value: !!tank.active, full: true });
  else fields.push({ name: 'initialStock', label: 'Stock actuel (L)', type: 'number', step: '0.01', min: '0', value: 0, full: true });

  const ok = await formDialog({
    title: tank ? `Modifier ${tank.name}` : 'Nouvelle cuve',
    fields,
    onSubmit: (d) => {
      const body = { ...d, productId: Number(d.productId) };
      return tank ? api.put(`/tanks/${tank.id}`, body) : api.post('/tanks', body);
    },
  });
  if (ok) {
    toast(tank ? 'Cuve modifiée.' : 'Cuve ajoutée.');
    reload();
  }
}
