import { api } from '../api.js';
import { h, fmt, pageHeader, cardHeader, table, segmented, tankGauge, button, formDialog, toast, badge } from '../ui.js';

let tab = 'deliveries';

export async function renderTanks(page, ctx) {
  const [tanks, products, deliveries, dips] = await Promise.all([api.get('/tanks'), api.get('/products'), api.get('/deliveries'), api.get('/dips')]);
  const tol = ctx.state.settings.stockTolerance;
  const active = tanks.filter((t) => t.active);
  const reload = () => renderTanks(page, ctx);

  page.replaceChildren(
    pageHeader(
      'Cuves',
      'Livraisons, jaugeages et stock théorique.',
      button('Jaugeage', () => dipDialog(active, reload), { variant: 'secondary', iconName: 'ruler' }),
      button('Livraison', () => deliveryDialog(active, reload), { iconName: 'truck' }),
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
        { class: 'card empty no-print', style: 'border:1px dashed var(--border-strong);cursor:pointer;font:inherit;color:var(--accent)', onClick: () => tankDialog(products, null, reload) },
        '+ Ajouter une cuve',
      ),
    ),
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
              { label: 'Commandé', align: 'right', render: (d) => fmt.liters(d.liters_ordered) },
              { label: 'Reçu', align: 'right', render: (d) => fmt.liters(d.liters_received) },
              {
                label: 'Manquant',
                align: 'right',
                render: (d) => {
                  const diff = d.liters_received - d.liters_ordered;
                  return diff < 0 ? h('span', { class: 'variance-neg' }, `▼ ${fmt.liters(diff)}`) : '—';
                },
              },
              { label: 'Coût', align: 'right', render: (d) => (d.unit_cost ? fmt.money(d.unit_cost * d.liters_received) : '—') },
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
                  return h('span', { class: bad ? 'variance-neg' : '' }, bad ? '⚠ ' : '', `${d.variance > 0 ? '+' : ''}${fmt.liters(d.variance)}`);
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

async function deliveryDialog(tanks, reload) {
  if (!tanks.length) return toast('Ajoutez d’abord une cuve.', 'error');
  const ok = await formDialog({
    title: 'Enregistrer une livraison',
    intro: 'Le volume reçu (mesuré au déchargement) est ajouté au stock de la cuve.',
    fields: [
      { name: 'tankId', label: 'Cuve', type: 'select', options: tankOptions(tanks), required: true, full: true },
      { name: 'litersOrdered', label: 'Litres commandés (bon)', type: 'number', step: '0.01', min: '0', required: true },
      { name: 'litersReceived', label: 'Litres reçus (mesurés)', type: 'number', step: '0.01', min: '0', required: true },
      { name: 'supplier', label: 'Fournisseur' },
      { name: 'reference', label: 'N° du bon de livraison' },
      { name: 'unitCost', label: 'Prix d’achat ($/L)', type: 'number', step: '0.001', min: '0', hint: 'Facultatif — pour suivre la marge' },
    ],
    onSubmit: (d) => api.post('/deliveries', { ...d, tankId: Number(d.tankId) }),
  });
  if (ok) {
    toast('Livraison enregistrée.');
    reload();
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
