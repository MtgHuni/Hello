import { api } from '../api.js';
import { h, fmt, pageHeader, card, cardHeader, table, badge, button, formDialog, openDialog, toast, productColor, setContent } from '../ui.js';

export async function renderSettings(page, ctx) {
  const [settings, products, pumps, tanks, users] = await Promise.all([
    api.get('/settings'),
    api.get('/products'),
    api.get('/pumps'),
    api.get('/tanks'),
    api.get('/users'),
  ]);
  const reload = () => renderSettings(page, ctx);
  const tankOptions = tanks.filter((t) => t.active).map((t) => [t.id, `${t.name} (${t.product_name})`]);

  setContent(page, 
    pageHeader('Réglages', 'Station, prix, équipements et équipe.'),
    h(
      'div',
      { class: 'stack' },

      // ---- Prices ----
      h(
        'section',
        { class: 'card flush' },
        h(
          'div',
          { class: 'card-header' },
          h('div', {}, h('h2', {}, 'Produits et prix'), h('p', {}, 'Un nouveau prix s’applique aux postes ouverts après le changement.')),
          button('Ajouter un produit', () => productDialog(null, reload), { variant: 'ghost', iconName: 'plus' }),
        ),
        table(
          [
            { label: 'Produit', render: (p) => h('span', {}, h('span', { class: 'swatch', style: `background:${productColor(p.id)}` }), p.name) },
            { label: 'Prix public', align: 'right', render: (p) => h('strong', {}, fmt.price(p.price)) },
            { label: 'Prix abonnés', align: 'right', render: (p) => fmt.price(p.subscriber_price) },
            { label: 'Statut', render: (p) => (p.active ? badge('Actif', 'good') : badge('Inactif')) },
            {
              label: '',
              align: 'right',
              render: (p) => h('span', { class: 'row', style: 'justify-content:flex-end' }, button('Historique', () => priceHistory(p), { variant: 'ghost sm' }), button('Changer le prix', () => productDialog(p, reload), { variant: 'secondary sm' })),
            },
          ],
          products,
        ),
      ),

      // ---- Pumps & nozzles ----
      card(
        cardHeader('Pompes et pistolets', 'Chaque pistolet est relié à une cuve, qui détermine le produit.', button('Ajouter une pompe', () => pumpDialog(null, reload), { variant: 'ghost', iconName: 'plus' })),
        pumps.length
          ? h(
              'div',
              { class: 'grid grid-2' },
              pumps.map((p) =>
                h(
                  'div',
                  { class: 'card', style: 'box-shadow:none;background:var(--surface-2);border:none' },
                  h(
                    'div',
                    { class: 'row between', style: 'margin-bottom:10px' },
                    h('h3', {}, p.name, ' ', p.active ? null : badge('Désactivée'), p.busy_with ? badge(`En service · ${p.busy_with}`, 'info') : null),
                    button('Modifier', () => pumpDialog(p, reload), { variant: 'ghost sm' }),
                  ),
                  p.nozzles.map((n) =>
                    h(
                      'div',
                      { class: 'nozzle-row' },
                      h('span', { class: 'swatch', style: `background:${productColor(n.product_id)};width:12px;height:12px` }),
                      h('div', { class: 'grow' }, h('div', { style: 'font-weight:600' }, n.name, n.active ? '' : ' (inactif)'), h('div', { class: 'muted small' }, `${n.tank_name} · index ${fmt.number(n.meter)}`)),
                      button('Modifier', () => nozzleDialog(p, n, tankOptions, reload), { variant: 'ghost sm' }),
                    ),
                  ),
                  button('+ Pistolet', () => nozzleDialog(p, null, tankOptions, reload), { variant: 'ghost sm' }),
                ),
              ),
            )
          : h('div', { class: 'empty' }, 'Aucune pompe.'),
      ),

      // ---- Team ----
      h(
        'section',
        { class: 'card flush' },
        h(
          'div',
          { class: 'card-header' },
          h('div', {}, h('h2', {}, 'Équipe'), h('p', {}, 'Gérants et pompistes. Les accès clients se créent depuis la fiche client.')),
          button('Ajouter un membre', () => userDialog(null, ctx, reload), { variant: 'ghost', iconName: 'plus' }),
        ),
        table(
          [
            { label: 'Nom', key: 'name' },
            { label: 'Identifiant', key: 'login' },
            { label: 'Rôle', render: (u) => (u.role === 'manager' ? 'Gérant' : 'Pompiste') },
            { label: 'Statut', render: (u) => (u.active ? badge('Actif', 'good') : badge('Désactivé')) },
            { label: '', align: 'right', render: (u) => button('Modifier', () => userDialog(u, ctx, reload), { variant: 'secondary sm' }) },
          ],
          users,
        ),
      ),

      // ---- Station ----
      card(
        cardHeader('Station', 'Nom et seuils de contrôle', button('Modifier', () => stationDialog(settings), { variant: 'ghost' })),
        h('div', { class: 'summary-line' }, h('span', { class: 'muted' }, 'Nom'), h('span', {}, settings.stationName)),
        h('div', { class: 'summary-line' }, h('span', { class: 'muted' }, 'Tolérance d’écart de caisse'), h('span', {}, `± ${fmt.money(settings.cashTolerance)}`)),
        h('div', { class: 'summary-line' }, h('span', { class: 'muted' }, 'Tolérance d’écart de jaugeage'), h('span', {}, `± ${fmt.liters(settings.stockTolerance)}`)),
      ),

      // ---- Customers & combos ----
      card(
        cardHeader('Clients et combos', 'Plafonds de crédit par catégorie et programme de fidélité', button('Modifier', () => customersDialog(settings, reload), { variant: 'ghost' })),
        h('h3', { style: 'margin:4px 0 2px' }, 'Particuliers'),
        line('Plafond de crédit', fmt.money(settings.individualCreditLimit)),
        h('h3', { style: 'margin:14px 0 2px' }, 'Abonnés'),
        line('Prix au litre', 'Colonne « Prix abonnés » des produits'),
        line('Plafond de crédit', fmt.money(settings.subscriberCreditLimit)),
        line('Paiement du mois', `avant le ${settings.subscriberGraceDays} du mois suivant`),
        h('h3', { style: 'margin:14px 0 2px' }, 'Combos'),
        line('Combos gagnés par litre', fmt.number(settings.combosPerLiter)),
        line('Valeur d’un combo', fmt.money(settings.comboValue)),
        line('Seuil d’échange', `${fmt.number(settings.comboThreshold)} combos (= ${fmt.money(settings.comboThreshold * settings.comboValue)})`),
        h('p', { class: 'muted small', style: 'margin-top:8px' }, 'Une vente à crédit ne rapporte ses combos qu’une fois entièrement payée.'),
      ),
    ),
  );
}

async function stationDialog(s) {
  const ok = await formDialog({
    title: 'Réglages de la station',
    fields: [
      { name: 'stationName', label: 'Nom de la station', value: s.stationName, required: true, full: true },
      { name: 'cashTolerance', label: 'Tolérance de caisse ($)', type: 'number', step: '0.01', min: '0', value: s.cashTolerance, hint: 'Écart toléré à la clôture d’un poste' },
      { name: 'stockTolerance', label: 'Tolérance de jaugeage (L)', type: 'number', step: '0.01', min: '0', value: s.stockTolerance, hint: 'Écart toléré entre stock théorique et mesuré' },
    ],
    onSubmit: (d) => api.put('/settings', d),
  });
  // The station name appears in the shell, so reload the whole app.
  if (ok) location.reload();
}

const line = (label, value) => h('div', { class: 'summary-line' }, h('span', { class: 'muted' }, label), h('span', { style: 'text-align:right' }, value));

async function customersDialog(s, reload) {
  const ok = await formDialog({
    title: 'Clients et combos',
    fields: [
      { name: 'individualCreditLimit', label: 'Plafond particuliers ($)', type: 'number', step: '0.01', min: '0', value: s.individualCreditLimit, required: true },
      { name: 'subscriberCreditLimit', label: 'Plafond abonnés ($)', type: 'number', step: '0.01', min: '0', value: s.subscriberCreditLimit, required: true },
      { name: 'subscriberGraceDays', label: 'Abonnés : payer avant le (jour du mois)', type: 'number', step: '1', min: '1', value: s.subscriberGraceDays, required: true, hint: 'Après ce jour, un abonné qui doit le mois précédent ne peut plus prendre à crédit' },
      { name: 'combosPerLiter', label: 'Combos par litre', type: 'number', step: '0.01', min: '0', value: s.combosPerLiter, required: true },
      { name: 'comboValue', label: 'Valeur d’un combo ($)', type: 'number', step: '0.0001', min: '0.0001', value: s.comboValue, required: true },
      { name: 'comboThreshold', label: 'Seuil d’échange (combos)', type: 'number', step: '1', min: '1', value: s.comboThreshold, required: true, hint: 'Minimum pour échanger des combos contre du carburant' },
    ],
    onSubmit: (d) => api.put('/settings', d),
  });
  if (ok) {
    toast('Réglages enregistrés');
    reload();
  }
}

async function productDialog(p, reload) {
  const ok = await formDialog({
    title: p ? `Prix — ${p.name}` : 'Nouveau produit',
    intro: p ? `Actuellement : ${fmt.price(p.price)} public, ${fmt.price(p.subscriber_price)} abonnés. Un changement s’applique aux postes ouverts ensuite.` : 'Ajoutez ensuite une cuve et un pistolet pour ce produit.',
    grid: false,
    fields: [
      { name: 'name', label: 'Nom', value: p?.name, required: true },
      { name: 'price', label: 'Prix public ($/L)', type: 'number', step: '0.001', min: '0.001', value: p?.price, required: true },
      { name: 'subscriberPrice', label: 'Prix abonnés ($/L)', type: 'number', step: '0.001', min: '0.001', value: p?.subscriber_price, hint: 'Un peu plus élevé, en échange du crédit au mois' },
      ...(p ? [{ name: 'active', label: 'Produit actif', type: 'checkbox', value: !!p.active }] : []),
    ],
    onSubmit: (d) => (p ? api.put(`/products/${p.id}`, d) : api.post('/products', d)),
  });
  if (ok) {
    toast(p ? 'Prix mis à jour.' : 'Produit ajouté.');
    reload();
  }
}

async function priceHistory(p) {
  const rows = await api.get(`/products/${p.id}/history`);
  openDialog((close) =>
    h(
      'div',
      { class: 'sheet dialog-body' },
      h('h2', {}, `Historique des prix — ${p.name}`),
      table(
        [
          { label: 'Date', render: (r) => fmt.dateTime(r.changed_at) },
          { label: 'Prix', align: 'right', render: (r) => fmt.price(r.price) },
          { label: 'Par', render: (r) => r.user_name || '—' },
        ],
        rows,
      ),
      h('div', { class: 'dialog-actions' }, button('Fermer', close, { variant: 'secondary' })),
    ),
  );
}

async function pumpDialog(p, reload) {
  const ok = await formDialog({
    title: p ? `Modifier ${p.name}` : 'Nouvelle pompe',
    intro: p ? null : 'Ajoutez ensuite un ou plusieurs pistolets à cette pompe.',
    grid: false,
    fields: [{ name: 'name', label: 'Nom', value: p?.name, required: true, placeholder: 'Pompe 3' }, ...(p ? [{ name: 'active', label: 'Pompe active', type: 'checkbox', value: !!p.active }] : [])],
    onSubmit: (d) => (p ? api.put(`/pumps/${p.id}`, d) : api.post('/pumps', d)),
  });
  if (ok) {
    toast('Pompe enregistrée.');
    reload();
  }
}

async function nozzleDialog(pump, n, tankOptions, reload) {
  if (!tankOptions.length) return toast('Créez d’abord une cuve.', 'error');
  const ok = await formDialog({
    title: n ? `Modifier ${n.name}` : `Nouveau pistolet — ${pump.name}`,
    intro: n ? 'Ne modifiez l’index qu’après un remplacement ou un étalonnage du compteur.' : 'Saisissez l’index actuellement affiché par le compteur.',
    grid: false,
    fields: [
      { name: 'name', label: 'Nom', value: n?.name, required: true, placeholder: 'Pistolet Gasoil' },
      { name: 'tankId', label: 'Cuve', type: 'select', options: tankOptions, value: n?.tank_id, required: true },
      { name: 'meter', label: 'Index du compteur', type: 'number', step: '0.01', min: '0', value: n?.meter ?? 0, required: true },
      ...(n ? [{ name: 'active', label: 'Pistolet actif', type: 'checkbox', value: !!n.active }] : []),
    ],
    onSubmit: (d) => {
      const body = { ...d, tankId: Number(d.tankId) };
      return n ? api.put(`/nozzles/${n.id}`, body) : api.post(`/pumps/${pump.id}/nozzles`, body);
    },
  });
  if (ok) {
    toast('Pistolet enregistré.');
    reload();
  }
}

async function userDialog(u, ctx, reload) {
  const ok = await formDialog({
    title: u ? `Modifier ${u.name}` : 'Nouveau membre',
    fields: [
      { name: 'name', label: 'Nom', value: u?.name, required: true },
      ...(u ? [] : [{ name: 'login', label: 'Identifiant', required: true }]),
      { name: 'role', label: 'Rôle', type: 'select', value: u?.role || 'attendant', options: [['attendant', 'Pompiste'], ['manager', 'Gérant']] },
      { name: 'password', label: u ? 'Nouveau mot de passe' : 'Mot de passe', type: 'text', required: !u, hint: u ? 'Laisser vide pour ne pas changer' : '8 caractères minimum' },
      ...(u ? [{ name: 'active', label: 'Compte actif', type: 'checkbox', value: !!u.active, full: true }] : []),
    ],
    onSubmit: (d) => {
      if (u && !d.password) delete d.password;
      return u ? api.put(`/users/${u.id}`, d) : api.post('/users', d);
    },
  });
  if (ok) {
    toast(u ? 'Membre modifié.' : 'Membre ajouté.');
    reload();
  }
}
