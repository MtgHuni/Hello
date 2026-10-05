import { api } from '../api.js';
import { h, fmt, pageHeader, cardHeader, table, segmented, tankGauge, button, formDialog, confirmDialog, toast, badge, setContent } from '../ui.js';

let tab = 'deliveries';

export async function renderTanks(page, ctx) {
  const [tanks, products, deliveries, dips, sup] = await Promise.all([api.get('/tanks'), api.get('/products'), api.get('/deliveries'), api.get('/dips'), api.get('/suppliers')]);
  const tol = ctx.state.settings.stockTolerance;
  const active = tanks.filter((t) => t.active);
  const reload = () => renderTanks(page, ctx);

  setContent(page, 
    pageHeader(
      'Cuves',
      'Livraisons, jaugeages et stock théorique.',
      button('Jaugeage', () => dipDialog(active, reload), { variant: 'secondary', iconName: 'ruler' }),
      button('Livraison', () => deliveryDialog(active, sup.names, reload), { iconName: 'truck' }),
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
            h('span', { class: 'row' }, t.active ? null : badge('Désactivée'), button('Modifier', () => tankDialog(products, t, reload), { variant: 'ghost sm' })),
          ),
        ),
      ),
      h(
        'button',
        { class: 'card empty no-print', style: 'border:1px dashed var(--field-border);cursor:pointer;font:inherit;color:var(--accent)', onClick: () => tankDialog(products, null, reload) },
        '+ Ajouter une cuve',
      ),
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
              { label: 'Paiement', render: (d) => (d.payment === 'credit' ? badge('À crédit', 'warning') : d.payment === 'cash' ? h('span', { title: d.pay_method || '' }, 'Comptant') : '—') },
            ],
            deliveries,
            { empty: 'Aucune livraison enregistrée.' },
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

const tankOptions = (tanks) => tanks.map((t) => [t.id, `${t.name} (${t.product_name})`]);

async function deliveryDialog(tanks, supplierNames, reload) {
  if (!tanks.length) return toast('Ajoutez d’abord une cuve.', 'error');
  const total = h('p', { class: 'hint-line full' });
  // Paid on the spot: out of the cash book. On credit: a debt to the supplier (supplier and amount required).
  const update = (e) => {
    const form = e.target.form;
    const credit = form.elements.payment.value === 'credit';
    form.elements.supplier.required = credit;
    const received = Number(form.elements.litersReceived.value) || 0;
    const cost = Number(form.elements.unitCost.value) || 0;
    total.textContent = received && cost ? `Montant : ${fmt.money(received * cost)}${credit ? ' dû au fournisseur' : ' payé maintenant'}` : credit ? 'Indiquez le prix d’achat : c’est la dette envers le fournisseur.' : '';
  };
  const ok = await formDialog({
    title: 'Enregistrer une livraison',
    intro: 'Le volume reçu (mesuré au déchargement) est ajouté au stock de la cuve.',
    fields: [
      { name: 'tankId', label: 'Cuve', type: 'select', options: tankOptions(tanks), required: true, full: true },
      { name: 'litersOrdered', label: 'Litres commandés (bon)', type: 'number', step: '0.01', min: '0', required: true },
      { name: 'litersReceived', label: 'Litres reçus (mesurés)', type: 'number', step: '0.01', min: '0', required: true, onInput: update },
      { name: 'supplier', label: 'Fournisseur', list: 'supplier-names' },
      { name: 'reference', label: 'N° du bon de livraison' },
      { name: 'unitCost', label: 'Prix d’achat ($/L)', type: 'number', step: '0.001', min: '0', onInput: update },
      { name: 'names', type: 'node', node: h('datalist', { id: 'supplier-names' }, supplierNames.map((n) => h('option', { value: n }))) },
      { name: 'payment', label: 'Paiement', type: 'segment', full: true, options: [['cash', 'Payée comptant (espèces)'], ['credit', 'À crédit']], onInput: update },
      { name: 'total', type: 'node', node: total },
    ],
    onSubmit: (d) => {
      if (d.payment === 'credit' && !d.unitCost) throw new Error('Indiquez le prix d’achat : c’est ce que la station devra au fournisseur.');
      return api.post('/deliveries', { ...d, tankId: Number(d.tankId) });
    },
  });
  if (ok) {
    toast('Livraison enregistrée.');
    reload();
  }
}

// What the station owes its suppliers (deliveries on credit), and their payment.
function suppliersCard(sup, reload) {
  const owing = sup.suppliers.filter((s) => s.owed > 0 || s.paid > 0);
  if (!owing.length) return null;
  const total = owing.reduce((t, s) => t + Math.max(0, s.balance), 0);
  return h(
    'section',
    { class: 'card flush section' },
    cardHeader('Fournisseurs', total ? `${fmt.money(total)} à payer pour des livraisons à crédit` : 'Rien à payer', button('Payer un fournisseur', () => supplierPaymentDialog(owing, null, reload), { variant: 'secondary sm', iconName: 'cash' })),
    table(
      [
        { label: 'Fournisseur', render: (s) => h('strong', {}, s.name) },
        { label: 'Livré à crédit', align: 'right', render: (s) => fmt.money(s.owed) },
        { label: 'Payé', align: 'right', render: (s) => fmt.money(s.paid) },
        { label: 'Reste à payer', align: 'right', render: (s) => (s.balance > 0 ? h('strong', { class: 'variance-neg' }, fmt.money(s.balance)) : 'Soldé') },
        { label: '', align: 'right', render: (s) => (s.balance > 0 ? button('Payer', () => supplierPaymentDialog(owing, s, reload), { variant: 'ghost sm' }) : null) },
      ],
      owing,
      {},
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
            { onRowClick: (p) => removeSupplierPayment(p, reload) },
          ),
        )
      : null,
  );
}

async function supplierPaymentDialog(suppliers, s, reload) {
  const ok = await formDialog({
    title: s ? `Payer ${s.name}` : 'Payer un fournisseur',
    intro: 'Le paiement en espèces ou mobile money sort du livre de caisse.',
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
  if (!(await confirmDialog('Retirer ce paiement ?', `${p.supplier} · ${fmt.money(p.amount)}. La dette revient et le retrait est gardé au journal.`, { confirmLabel: 'Retirer', danger: true }))) return;
  try {
    await api.del(`/suppliers/payments/${p.id}`);
    toast('Paiement retiré.');
    reload();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function dipDialog(tanks, reload) {
  if (!tanks.length) return toast('Ajoutez d’abord une cuve.', 'error');
  const ok = await formDialog({
    title: 'Saisir un jaugeage',
    intro: 'Le volume mesuré est comparé au stock théorique, puis devient la nouvelle référence.',
    grid: false,
    fields: [
      { name: 'tankId', label: 'Cuve', type: 'select', options: tankOptions(tanks), required: true },
      { name: 'measured', label: 'Volume mesuré (litres)', type: 'number', step: '0.01', min: '0', required: true },
      { name: 'note', label: 'Note', type: 'textarea' },
    ],
    onSubmit: (d) => api.post('/dips', { ...d, tankId: Number(d.tankId) }),
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
