import { api } from '../api.js';
import { h, fmt, pageHeader, button, formDialog, confirmDialog, toast, spinner } from '../ui.js';
import { icon } from '../icons.js';
import { statement, defaultPeriod } from './customers.js';

// Client space: start a fill-up from the phone while waiting in line,
// then follow its confirmation by the attendant; account statement below.
export async function renderAccount(page) {
  const period = defaultPeriod();
  const fillHost = h('div', { class: 'section', style: 'margin-top:0;margin-bottom:24px' });
  const statementHost = h('div');
  let acc = null;
  let timer = null;
  let seenConnected = false;

  const loadStatement = async () => {
    acc = await api.get(`/me/account?from=${period.from}&to=${period.to}`);
    statementHost.replaceChildren(
      statement(acc, period, (p) => {
        Object.assign(period, p);
        loadStatement();
      }),
    );
  };

  async function refreshRequest() {
    if (fillHost.isConnected) seenConnected = true;
    else if (seenConnected) return clearInterval(timer);
    const r = await api.get('/me/requests/current').catch(() => undefined);
    if (r === undefined) return;
    drawRequest(r);
    clearInterval(timer);
    timer = r?.status === 'pending' ? setInterval(refreshRequest, 4000) : null;
  }

  function drawRequest(r) {
    const startButton = button('Faire le plein', () => startFill(), { variant: 'large block', iconName: 'pump' });
    if (!r) return fillHost.replaceChildren(startButton);

    if (r.status === 'pending') {
      fillHost.replaceChildren(
        h(
          'section',
          { class: 'card fill-card' },
          spinner(),
          h('div', { class: 'muted' }, 'En attente de confirmation par le pompiste'),
          h('div', { class: 'big' }, r.amount ? fmt.money(r.amount) : fmt.liters(r.liters)),
          h('div', {}, `${r.product_name} · ${r.payment === 'credit' ? 'à crédit' : 'payé'}${r.plate ? ` · ${r.plate}` : ''}`),
          h('p', { class: 'muted small', style: 'margin-top:10px' }, `Donnez votre nom au pompiste : ${r.customer_name}`),
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
    fillHost.replaceChildren(
      h(
        'section',
        { class: 'card fill-card' },
        h('div', { class: 'status-icon', style: `background:var(${confirmed ? '--green' : '--red'})` }, icon(confirmed ? 'check' : 'close')),
        h('h2', {}, confirmed ? 'Plein confirmé' : 'Demande refusée'),
        confirmed
          ? h('div', { class: 'big' }, `${fmt.liters(r.sale_liters)} · ${fmt.money(r.sale_amount)}`)
          : h('p', { class: 'muted', style: 'margin-top:6px' }, r.note || 'Adressez-vous au pompiste.'),
        confirmed ? h('div', {}, `${r.sale_points ? `+${r.sale_points} points · ` : ''}confirmé par ${r.handled_by_name}`) : null,
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

  async function startFill() {
    const products = (await api.get('/products')).filter((p) => p.active);
    const c = acc.customer;
    const canCredit = c.credit_limit > 0;
    const estimate = h('div', { class: 'summary-line total' }, h('span', {}, 'Estimation'), h('span', {}, '—'));
    const update = (e) => {
      const form = e.target.form;
      const price = products.find((p) => p.id === Number(form.elements.productId.value))?.price || 0;
      const qty = Number(form.elements.qty.value) || 0;
      const byAmount = form.elements.unit.value === 'amount';
      estimate.lastChild.textContent = qty ? (byAmount ? `≈ ${fmt.liters(qty / price)}` : `≈ ${fmt.money(qty * price)}`) : '—';
    };
    const ok = await formDialog({
      title: 'Faire le plein',
      submitLabel: 'Envoyer au pompiste',
      intro: 'Préparez votre achat pendant que vous attendez : le pompiste n’aura plus qu’à confirmer.',
      grid: false,
      fields: [
        { name: 'productId', label: 'Carburant', type: 'segment', options: products.map((p) => [p.id, `${p.name} · ${fmt.price(p.price)}`]), onInput: update },
        { name: 'unit', label: 'Je veux', type: 'segment', options: [['amount', 'Un montant ($)'], ['liters', 'Des litres']], onInput: update },
        { name: 'qty', label: 'Quantité', type: 'number', step: '0.01', min: '0.5', required: true, onInput: update, inputmode: 'decimal' },
        ...(canCredit ? [{ name: 'payment', label: 'Paiement', type: 'segment', options: [['paid', 'Je paie maintenant'], ['credit', 'À crédit']], onInput: update }] : []),
        { name: 'plate', label: 'Plaque du véhicule', value: c.plate || '', placeholder: 'Facultatif' },
      ],
      extra: () => estimate,
      onSubmit: (d) =>
        api.post('/me/requests', {
          productId: Number(d.productId),
          [d.unit === 'amount' ? 'amount' : 'liters']: d.qty,
          payment: d.payment || 'paid',
          plate: d.plate,
        }),
    });
    if (ok) refreshRequest();
  }

  await loadStatement();
  page.replaceChildren(pageHeader(acc.customer.name, 'Votre espace client'), fillHost, statementHost, h('p', { class: 'muted small section' }, 'Une question sur votre compte ? Adressez-vous au gérant de la station.'));
  await refreshRequest();
}
