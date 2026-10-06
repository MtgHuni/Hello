import { flags } from '../ui.js';
import { api } from '../api.js';
import { priceTotem, h, fmt, pageHeader, button, formDialog, confirmDialog, toast, spinner, setContent, noticeDialog } from '../ui.js';
import { icon } from '../icons.js';
import { statement, statementShare, defaultPeriod } from './customers.js';

// Client space: start a fill-up from the phone while waiting in line,
// then follow its confirmation by the attendant; account statement below.
// The station's number at the bottom of the client space: one tap to call.
function stationPhone(phone) {
  if (!phone) return null;
  const shown = phone.replace(/^\+243(\d{3})(\d{3})(\d{3})$/, '+243 $1 $2 $3');
  return h(
    'div',
    { class: 'client-contact section' },
    h('p', {}, 'Pour toute question ou plus d’informations, contactez-nous :'),
    h('a', { href: `tel:${phone.replace(/[^\d+]/g, '')}` }, icon('phone'), shown),
  );
}

export async function renderAccount(page, ctx) {
  const period = defaultPeriod();
  const fillHost = h('div', { class: 'section', style: 'margin-top:0;margin-bottom:24px' });
  const statementHost = h('div');
  const combosHost = h('div');
  let acc = null;
  let timer = null;
  let seenConnected = false;
  let wasPending = false; // to tell the customer when a request expires

  const loadStatement = async () => {
    acc = await api.get(`/me/account?from=${period.from}&to=${period.to}`);
    setContent(combosHost, flags.combos ? combosCard(acc) : null);
    setContent(statementHost, 
      statement(
        acc,
        period,
        (p) => {
          Object.assign(period, p);
          loadStatement();
        },
        { clientSpace: true },
      ),
    );
  };

  async function refreshRequest() {
    if (fillHost.isConnected) seenConnected = true;
    else if (seenConnected) return clearInterval(timer);
    const r = await api.get('/me/requests/current').catch(() => undefined);
    if (r === undefined) return;
    if (!r && wasPending) toast('Demande expirée', 'error');
    wasPending = r?.status === 'pending';
    drawRequest(r);
    clearInterval(timer);
    timer = r?.status === 'pending' ? setInterval(refreshRequest, 4000) : null;
  }

  function drawRequest(r) {
    const startButton = button('Acheter du carburant', () => startFill(), { variant: 'large block', iconName: 'pump' });
    if (!r) return setContent(fillHost, startButton);

    if (r.status === 'pending') {
      setContent(fillHost, 
        h(
          'section',
          { class: 'card fill-card' },
          spinner(),
          h('div', { class: 'muted' }, 'En attente du pompiste'),
          h('div', { class: 'big' }, r.amount ? fmt.money(r.amount) : fmt.liters(r.liters)),
          h('div', {}, `${r.product_name} · ${{ credit: 'à crédit', combo: 'avec mes combos', paid: 'payé' }[r.payment] ?? ''}${r.plate ? ` · ${r.plate}` : ''}`),

          h(
            'div',
            { style: 'margin-top:16px' },
            button('Annuler la demande', async () => {
              if (!(await confirmDialog('Annuler la demande ?', null, { confirmLabel: 'Annuler la demande', danger: true }))) return;
              await api.del(`/me/requests/${r.id}`).catch((err) => toast(err.message, 'error'));
              refreshRequest();
            }, { variant: 'danger' }),
          ),
        ),
      );
      return;
    }

    const confirmed = r.status === 'confirmed';
    setContent(fillHost, 
      h(
        'section',
        { class: 'card fill-card' },
        h('div', { class: 'status-icon', style: `background:var(${confirmed ? '--green' : '--red'})` }, icon(confirmed ? 'check' : 'close')),
        h('h2', {}, confirmed ? 'Plein confirmé' : 'Demande refusée'),
        confirmed
          ? h('div', { class: 'big' }, `${fmt.liters(r.sale_liters)} · ${fmt.money(r.sale_amount)}`)
          : r.note ? h('p', { class: 'muted', style: 'margin-top:6px' }, r.note) : null,
        confirmed
          ? h('div', {}, `${!flags.combos ? '' : r.sale_points ? `+${r.sale_points} combos · ` : r.sale_combos ? `−${r.sale_combos} combos · ` : r.payment === 'credit' ? 'combos au paiement du crédit · ' : ''}confirmé par ${r.handled_by_name}`)
          : null,
        h('div', { style: 'margin-top:16px' }, startButton),
      ),
    );
    if (confirmed && !drawRequest.celebrated?.has(r.id)) {
      drawRequest.celebrated = drawRequest.celebrated || new Set();
      drawRequest.celebrated.add(r.id);
      navigator.vibrate?.(60);
      loadStatement();
    }
  }

  // Combos balance with progress towards the exchange threshold.
  function combosCard(a) {
    const { balance, threshold, value, pending } = a.combos;
    const pct = Math.min(100, (balance / threshold) * 100);
    return h(
      'section',
      { class: 'card', style: 'margin-bottom:20px' },
      h('div', { class: 'row between' }, h('h2', {}, 'Mes combos'), h('span', { class: 'tank-pct' }, fmt.number(balance))),
      h('div', { class: 'meter', style: 'margin:12px 0 8px', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': String(threshold), 'aria-valuenow': String(balance), 'aria-label': 'Progression vers l’échange' }, h('div', { class: 'meter-fill', style: `width:${pct}%;background:var(--orange)` })),
      h(
        'p',
        { class: 'muted', style: 'font-size:15px' },
        balance >= threshold
          ? `= ${fmt.money(value)} de carburant`
          : `Encore ${fmt.number(threshold - balance)} combos avant l’échange`,
        pending ? ` · +${fmt.number(pending)} au paiement du crédit` : '',
      ),
    );
  }

  async function startFill() {
    const products = (await api.get('/products')).filter((p) => p.active);
    const c = acc.customer;
    // A particulier who still owes a credit gets no other until it is paid.
    const canCredit = c.type === 'account' || !(c.balance > 0.001);
    const canCombo = flags.combos && acc.combos.balance >= acc.combos.threshold;
    // Paying cash needs no request: the pump's indexes count it.
    if (!canCredit && !canCombo) {
      return noticeDialog('Pas de nouveau crédit', h('p', {}, 'Vous devez encore ', h('strong', {}, fmt.money(c.balance)), '. Réglez ce crédit à la station : vous pourrez ensuite préparer un nouvel achat à crédit.'));
    }
    const priceOf = (p) => (c.type === 'account' ? p.subscriber_price : p.price);
    const estimate = h('div', { class: 'summary-line total' }, h('span', {}, 'Estimation'), h('span', {}, '—'));
    const update = (e) => {
      const form = e.target.form;
      const product = products.find((p) => p.id === Number(form.elements.productId.value));
      const price = product ? priceOf(product) : 0;
      const qty = Number(form.elements.qty.value) || 0;
      const byAmount = form.elements.unit.value === 'amount';
      estimate.lastChild.textContent = qty ? (byAmount ? `≈ ${fmt.liters(qty / price)}` : `≈ ${fmt.money(qty * price)}`) : '—';
    };
    const ok = await formDialog({
      title: 'Acheter du carburant',
      submitLabel: 'Envoyer au pompiste',
        grid: false,
      fields: [
        { name: 'productId', label: 'Carburant', type: 'segment', options: products.map((p) => [p.id, `${p.name} · ${fmt.price(priceOf(p))}`]), onInput: update },
        { name: 'unit', label: 'Je veux', type: 'segment', options: [['amount', 'Un montant ($)'], ['liters', 'Des litres']], onInput: update },
        { name: 'qty', label: 'Quantité', type: 'number', step: '0.01', min: '0.5', required: true, onInput: update, inputmode: 'decimal' },
        ...(canCredit && canCombo
          ? [
              {
                name: 'payment',
                label: 'Paiement',
                type: 'segment',
                options: [['credit', 'À crédit'], ['combo', `Mes combos (${fmt.money(acc.combos.value)})`]],
                onInput: update,
              },
            ]
          : []),
        { name: 'plate', label: 'Plaque du véhicule', value: c.plate || '', placeholder: 'Facultatif' },
      ],
      extra: () => estimate,
      onSubmit: (d) =>
        api.post('/me/requests', {
          productId: Number(d.productId),
          [d.unit === 'amount' ? 'amount' : 'liters']: d.qty,
          payment: d.payment || (canCredit ? 'credit' : 'combo'),
          plate: d.plate,
        }),
    });
    if (ok) refreshRequest();
  }

  await loadStatement();
  // Les prix du jour, au tarif du client (abonné ou particulier).
  const products = (await api.get('/products').catch(() => [])).filter((p) => p.active);
  const subscriber = acc.customer.type === 'account';
  const totem = priceTotem(products.map((p) => ({ id: p.id, name: p.name, price: subscriber ? p.subscriber_price : p.price })));
  setContent(page, pageHeader(acc.customer.name, null, statementShare('/api/me/statement.pdf', period)), totem, fillHost, combosHost, statementHost, stationPhone(ctx?.state?.settings?.stationPhone));
  await refreshRequest();
}
