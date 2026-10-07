import { flags, edit, adminEdit, canAdmin } from '../ui.js';
import { api } from '../api.js';
import { h, fmt, pageHeader, card, cardHeader, table, badge, button, formDialog, openDialog, toast, productColor, setContent, buttonRow } from '../ui.js';
import { icon } from '../icons.js';

export async function renderSettings(page, ctx) {
  const [settings, products, pumps, tanks, users, mail] = await Promise.all([
    api.get('/settings'),
    api.get('/products'),
    api.get('/pumps'),
    api.get('/tanks'),
    api.get('/users'),
    api.get('/mail/status'),
  ]);
  const reload = () => renderSettings(page, ctx);
  const tankOptions = tanks.filter((t) => t.active).map((t) => [t.id, `${t.name} (${t.product_name})`]);
  const meters = pumps.flatMap((p) => p.nozzles);

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
          adminEdit(button('Ajouter un produit', () => productDialog(null, reload), { variant: 'ghost', iconName: 'plus' })),
        ),
        table(
          [
            { label: 'Produit', render: (p) => h('span', {}, h('span', { class: 'swatch', style: `background:${productColor(p.id)}` }), p.name) },
            {
              label: 'Prix public',
              align: 'right',
              render: (p) => h('span', {}, h('strong', {}, fmt.price(p.price)), p.next_price_at ? h('div', { class: 'muted small' }, `→ ${fmt.price(p.next_price)} le ${fmt.dateTime(p.next_price_at)}`) : null),
            },
            { label: 'Prix abonnés', align: 'right', render: (p) => fmt.price(p.subscriber_price) },
            { label: 'Statut', render: (p) => (p.active ? badge('Actif', 'good') : badge('Inactif')) },
            // The manager only reads the settings: no button at all.
            ...(canAdmin()
              ? [
                  {
                    label: '',
                    align: 'right',
                    render: (p) => h('span', { class: 'btn-row inline', style: '--cols:2' }, button('Historique', () => priceHistory(p), { variant: 'secondary sm' }), button('Changer le prix', () => productDialog(p, reload), { variant: 'secondary sm' })),
                  },
                ]
              : []),
          ],
          products,
        ),
      ),

      // ---- Meters: one pump, one meter per product ----
      card(
        cardHeader('Compteurs', 'Un compteur par produit, relié à sa cuve.', pumps[0] ? adminEdit(button('Ajouter un compteur', () => meterDialog(null, tankOptions, reload, pumps[0].id), { variant: 'ghost', iconName: 'plus' })) : null),
        meters.length
          ? meters.map((n) =>
              h(
                'div',
                { class: 'nozzle-row' },
                h('span', { class: 'swatch', style: `background:${productColor(n.product_id)};width:12px;height:12px` }),
                h('div', { class: 'grow' }, h('div', { style: 'font-weight:600' }, n.product_name, n.active ? '' : ' (inactif)'), h('div', { class: 'muted small' }, `${n.tank_name} · index ${fmt.number(n.meter)}`)),
                adminEdit(button('Modifier', () => meterDialog(n, tankOptions, reload), { variant: 'ghost sm' })),
              ),
            )
          : h('div', { class: 'empty' }, 'Aucun compteur.'),
      ),

      // ---- Team ----
      h(
        'section',
        { class: 'card flush' },
        h(
          'div',
          { class: 'card-header' },
          h('div', {}, h('h2', {}, 'Équipe'), h('p', {}, 'Administrateur, gérants, pompistes et actionnaires. Les accès clients se créent depuis la fiche client.')),
          adminEdit(button('Ajouter un membre', () => userDialog(null, ctx, reload), { variant: 'ghost', iconName: 'plus' })),
        ),
        table(
          [
            { label: 'Nom', key: 'name' },
            { label: 'Identifiant', key: 'login' },
            { label: 'E-mail', render: (u) => (u.email ? h('span', {}, u.email, u.email_verified_at ? null : h('div', {}, badge('À confirmer', 'warning'))) : '—') },
            { label: 'Rôle', render: (u) => ROLES[u.role] },
            { label: 'Statut', render: (u) => (u.active ? badge('Actif', 'good') : badge('Désactivé')) },
            ...(canAdmin() ? [{ label: '', align: 'right', render: (u) => button('Modifier', () => userDialog(u, ctx, reload), { variant: 'secondary sm' }) }] : []),
          ],
          users,
        ),
      ),

      // ---- Station ----
      card(
        cardHeader('Station', 'Nom et seuils de contrôle', adminEdit(button('Modifier', () => stationDialog(settings), { variant: 'ghost' }))),
        h('div', { class: 'summary-line' }, h('span', { class: 'muted' }, 'Nom'), h('span', {}, settings.stationName)),
        h('div', { class: 'summary-line' }, h('span', { class: 'muted' }, 'Tolérance d’écart de caisse'), h('span', {}, `± ${fmt.money(settings.cashTolerance)}`)),
        h('div', { class: 'summary-line' }, h('span', { class: 'muted' }, 'Tolérance d’écart de jaugeage'), h('span', {}, `± ${fmt.liters(settings.stockTolerance)}`)),
        h('div', { class: 'summary-line' }, h('span', { class: 'muted' }, 'Heure de clôture du poste'), h('span', {}, settings.closingTime || '15:30')),
        h('div', { class: 'summary-line' }, h('span', { class: 'muted' }, 'Transport par poste'), h('span', {}, settings.shiftTransport > 0 ? fmt.money(settings.shiftTransport) : 'Aucun')),
        h('div', { class: 'summary-line' }, h('span', { class: 'muted' }, 'Téléphone (espace client)'), h('span', {}, settings.stationPhone || '—')),
      ),

      // ---- Mails (src/mail.js): what is sent today and this month, against Resend's limits ----
      card(
        cardHeader('Mails'),
        ...[['day', 'Aujourd’hui'], ['month', 'Ce mois']].map(([period, label]) => {
          const { count, limit } = mail.usage[period];
          const near = count >= limit * 0.8;
          return h(
            'div',
            { class: 'summary-line' },
            h('span', { class: 'muted' }, label),
            h('span', {}, `${count} / ${limit.toLocaleString('fr-FR')}`, near ? h('span', {}, ' ', badge(count >= limit ? 'Limite atteinte' : 'Presque à la limite', count >= limit ? 'critical' : 'warning')) : null),
          );
        }),
      ),

      // ---- Data: backup and journal (the admin's) ----
      !canAdmin() ? null : card(
        cardHeader('Données', flags.readonly ? 'Journal des changements' : 'Sauvegarde complète de la base et journal des changements'),
        edit(h(
          'p',
          { class: 'muted', style: 'margin:0 0 16px' },
          'Téléchargez une sauvegarde régulièrement et gardez-la ailleurs (ordinateur, clé USB, e-mail) : elle contient toute la station.',
        )),
        buttonRow([
          edit(h('a', { class: 'btn secondary', href: '/api/backup', download: '' }, icon('download'), 'Télécharger une sauvegarde')),
          button('Ouvrir le journal', () => ctx.navigate('reglages/journal'), { variant: 'secondary', iconName: 'shifts' }),
        ]),
      ),

      // ---- Customers & combos ----
      card(
        cardHeader('Clients et combos', 'Règles de crédit par catégorie et programme de fidélité', adminEdit(button('Modifier', () => customersDialog(settings, reload), { variant: 'ghost' }))),
        h('h3', { style: 'margin:4px 0 2px' }, 'Particuliers'),
        line('Crédit', 'Un seul à la fois : le suivant après paiement'),
        h('h3', { style: 'margin:14px 0 2px' }, 'Abonnés'),
        line('Prix au litre', 'Colonne « Prix abonnés » des produits'),
        line('Jour de paiement', `réglé sur chaque abonné (par défaut : avant le ${settings.subscriberGraceDays})`),
        h('h3', { style: 'margin:14px 0 2px' }, 'Combos'),
        line('Programme de combos', settings.combosEnabled ? 'Activé' : 'Désactivé'),
        ...(settings.combosEnabled ? [line('Combos gagnés par litre', fmt.number(settings.combosPerLiter)),
        line('Valeur d’un combo', fmt.money(settings.comboValue)),
        line('Seuil d’échange', `${fmt.number(settings.comboThreshold)} combos (= ${fmt.money(settings.comboThreshold * settings.comboValue)})`),
        h('p', { class: 'muted small', style: 'margin-top:8px' }, 'Une vente à crédit ne rapporte ses combos qu’une fois entièrement payée.')] : []),
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
      { name: 'stationPhone', label: 'Téléphone de la station', type: 'tel', value: s.stationPhone, full: true, hint: 'Affiché en bas de l’espace client' },
      { name: 'closingTime', label: 'Heure de clôture du poste', type: 'time', value: s.closingTime || '15:30', required: true, hint: 'Le gérant clôture chaque jour à cette heure ; le poste suivant s’ouvre aussitôt' },
      { name: 'shiftTransport', label: 'Transport par poste ($)', type: 'number', step: '0.01', min: '0', value: s.shiftTransport ?? 0, full: true, hint: 'Dépense « Transport » ajoutée à chaque poste à son ouverture, payée avec l’argent du poste ; 0 = aucune' },
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
      { name: 'subscriberGraceDays', label: 'Jour de paiement par défaut des nouveaux abonnés', type: 'number', step: '1', min: '1', value: s.subscriberGraceDays, required: true, hint: 'Chaque abonné a son propre jour, modifiable sur sa fiche. Après ce jour, un abonné qui doit le mois précédent ne peut plus prendre à crédit.' },
      { name: 'combosEnabled', label: 'Programme de combos', type: 'checkbox', value: s.combosEnabled, full: true },
      { name: 'combosPerLiter', label: 'Combos par litre', type: 'number', step: '0.01', min: '0', value: s.combosPerLiter, required: true },
      { name: 'comboValue', label: 'Valeur d’un combo ($)', type: 'number', step: '0.0001', min: '0.0001', value: s.comboValue, required: true },
      { name: 'comboThreshold', label: 'Seuil d’échange (combos)', type: 'number', step: '1', min: '1', value: s.comboThreshold, required: true, hint: 'Minimum pour échanger des combos contre du carburant' },
    ],
    onSubmit: (d) => api.put('/settings', d),
  });
  if (ok) {
    // Les combos s'affichent dans tout l'écran : on recharge l'application.
    location.reload();
  }
}

async function productDialog(p, reload) {
  const ok = await formDialog({
    title: p ? `Prix — ${p.name}` : 'Nouveau produit',
    intro: p ? `Actuellement : ${fmt.price(p.price)} public, ${fmt.price(p.subscriber_price)} abonnés. Un changement s’applique aux postes ouverts ensuite.` : 'Ajoutez ensuite une cuve et un compteur pour ce produit.',
    grid: false,
    fields: [
      { name: 'name', label: 'Nom', value: p?.name, required: true },
      { name: 'price', label: 'Prix public ($/L)', type: 'number', step: '0.001', min: '0.001', value: p?.price, required: true },
      { name: 'subscriberPrice', label: 'Prix abonnés ($/L)', type: 'number', step: '0.001', min: '0.001', value: p?.subscriber_price, hint: 'Un peu plus élevé, en échange du crédit au mois' },
      ...(p
        ? [
            { name: 'effectiveAt', label: 'À partir du (facultatif)', type: 'datetime-local', hint: 'Vide : le prix change tout de suite. Sinon il s’applique au premier poste ouvert après cette date.' },
            ...(p.next_price_at ? [{ name: 'cancelScheduled', label: `Annuler le prix programmé (${fmt.price(p.next_price)} le ${fmt.dateTime(p.next_price_at)})`, type: 'checkbox', value: false, full: true }] : []),
            { name: 'active', label: 'Produit actif', type: 'checkbox', value: !!p.active },
          ]
        : []),
    ],
    onSubmit: (d) => (p ? api.put(`/products/${p.id}`, { ...d, effectiveAt: d.effectiveAt || undefined, cancelScheduled: d.cancelScheduled || undefined }) : api.post('/products', d)),
  });
  if (ok) {
    toast(!p ? 'Produit ajouté.' : ok.next_price_at && ok.next_price_at !== p.next_price_at ? 'Nouveau prix programmé.' : 'Prix mis à jour.');
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
          { label: 'Prix public', align: 'right', render: (r) => fmt.price(r.price) },
          { label: 'Prix abonnés', align: 'right', render: (r) => (r.subscriber_price == null ? '—' : fmt.price(r.subscriber_price)) },
          { label: 'Par', render: (r) => r.user_name || '—' },
        ],
        rows,
      ),
      h('div', { class: 'dialog-actions' }, button('Fermer', close, { variant: 'cancel' })),
    ),
  );
}

// n is null for a new meter, on the station's pump.
async function meterDialog(n, tankOptions, reload, pumpId) {
  if (!tankOptions.length) return toast('Créez d’abord une cuve.', 'error');
  const ok = await formDialog({
    title: n ? `Compteur ${n.product_name}` : 'Nouveau compteur',
    intro: !n ? 'Saisissez l’index actuellement affiché par le compteur.' : 'Pour fixer l’index de départ, ou après un remplacement ou un étalonnage du compteur. Le poste ouvert repart de ce nouvel index.',
    grid: false,
    fields: [
      { name: 'tankId', label: 'Cuve', type: 'select', options: tankOptions, value: n?.tank_id, required: true },
      { name: 'meter', label: 'Index du compteur', type: 'number', step: '0.01', min: '0', value: n?.meter ?? 0, required: true, meterPhoto: { product: n?.product_name } },
      ...(n ? [{ name: 'active', label: 'Compteur actif', type: 'checkbox', value: !!n.active }] : []),
    ],
    onSubmit: (d) => (n ? api.put(`/nozzles/${n.id}`, { ...d, tankId: Number(d.tankId) }) : api.post(`/pumps/${pumpId}/nozzles`, { ...d, name: 'Compteur', tankId: Number(d.tankId) })),
  });
  if (ok) {
    toast('Compteur enregistré.');
    reload();
  }
}

const ROLES = { attendant: 'Pompiste', manager: 'Gérant', admin: 'Administrateur', owner: 'Actionnaire' };

async function userDialog(u, ctx, reload) {
  const ok = await formDialog({
    title: u ? `Modifier ${u.name}` : 'Nouveau membre',
    fields: [
      { name: 'name', label: 'Nom', value: u?.name, required: true },
      ...(u ? [] : [{ name: 'login', label: 'Identifiant', required: true }]),
      { name: 'role', label: 'Rôle', type: 'select', value: u?.role || 'attendant', options: Object.entries(ROLES), hint: 'L’administrateur seul modifie les réglages et la caisse ; l’actionnaire consulte sans rien modifier.' },
      { name: 'email', label: 'Adresse e-mail', type: 'email', value: u?.email || '', full: true, hint: 'Facultative : un lien lui est envoyé pour la confirmer' },
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
