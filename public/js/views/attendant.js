import { flags } from '../ui.js';
import { api } from '../api.js';
import { priceTotem, shiftLine, h, fmt, receipt, pageHeader, card, cardHeader, table, shiftBadge, varianceCell, button, formDialog, confirmDialog, toast, field, productColor, badge, kpi, parseServerDate, setContent, reportLink, busy, newRef, buttonRow, noticeDialog, nameChips } from '../ui.js';
import { icon } from '../icons.js';
import { shiftSummary } from './shifts.js';
import { renderJoin, renderCheckpoint, reportCard } from './relay.js';
import { withMeterPhoto, markRead } from '../photo.js';

// One shift for the station, always open: the attendant takes it (or continues it after a relief),
// opens the station in the morning, or, the very first time, opens the first shift.
export async function renderAttendant(page, ctx) {
  const manager = ctx.state.user.role === 'manager';
  const [state, remarks] = await Promise.all([api.get('/shifts/state'), manager ? [] : api.get('/shifts/remarks/unread').catch(() => [])]);
  const reload = () => renderAttendant(page, ctx);
  const remarkCards = remarkCarousel(remarks, ctx, reload);
  if (!state.shift) return renderStart(page, ctx, remarkCards);
  if (state.shift.station_closed_at) return renderCheckpoint(page, ctx, state.shift, 'ouverture', { report: state.lastReport });
  if (!state.onDuty) return renderJoin(page, ctx, state, remarkCards);
  return renderOpenShift(page, ctx, state.shift, remarkCards);
}

// ---------- 1. Opening a shift ----------
// The very first shift (afterwards, each 15:30 closing opens the next one).
async function renderStart(page, ctx, remarkCards = []) {
  const allPumps = await api.get('/pumps');
  const nozzles = allPumps.filter((p) => p.active).flatMap((p) => p.nozzles.filter((n) => n.active).map((n) => ({ ...n, pump: p.name })));
  const submit = button('Ouvrir le poste', null, { variant: 'large block', type: 'submit', disabled: !nozzles.length });
  const form = h(
    'form',
    { class: 'stack' },
    nozzles.length
        ? h(
            'div',
            { class: 'stack', style: 'gap:10px' },
            h('p', { class: 'muted' }, 'Index de départ'),
            nozzles.map((n) =>
              h('div', { class: 'summary-line' }, h('span', {}, h('span', { class: 'swatch', style: `background:${productColor(n.product_id)}` }), n.product_name), h('span', { class: 'num' }, fmt.number(n.meter))),
            ),
          )
      : h('div', { class: 'empty' }, "Aucune pompe n'est configurée. Demandez au gérant."),
    submit,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      await api.post('/shifts', {});
      toast('Poste ouvert. Bon courage !');
      renderAttendant(page, ctx);
    } catch (err) {
      toast(err.message, 'error');
      submit.disabled = false;
    }
  });

  setContent(page, 
    pageHeader('Ouvrir le poste', null),
    remarkCards,
    card(form),
  );
}

// The manager's remarks the attendant has not read yet: one card, one remark per slide
// (swipe, or the arrows), each with « C’est noté ». Shown until they are all read.
function remarkCarousel(remarks, ctx, reload) {
  if (!remarks.length) return null;
  const many = remarks.length > 1;
  const seen = (r) => async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api.post(`/shifts/${r.id}/remark/seen`);
    } catch {
      /* stays shown: it will be marked next time */
    }
    reload();
  };
  const track = h(
    'div',
    { class: 'remark-track', tabindex: many ? '0' : null, 'aria-label': many ? 'Remarques, faites glisser pour la suivante' : null },
    remarks.map((r, i) =>
      h(
        'article',
        { class: 'remark-slide', 'aria-label': many ? `Remarque ${i + 1} sur ${remarks.length}` : null },
        h('p', { class: 'remark-meta' }, `Poste n°${r.id} du ${fmt.dateTime(r.closed_at)}${r.manager_comment_by_name ? ` · ${r.manager_comment_by_name}` : ''}`),
        h('p', { class: 'remark-text' }, r.manager_comment),
        h(
          'div',
          { class: 'grid grid-2' },
          button('Voir le poste', () => ctx.navigate(`historique/${r.id}`), { variant: 'secondary' }),
          button('C’est noté', seen(r), { iconName: 'check' }),
        ),
      ),
    ),
  );
  if (!many) return h('section', { class: 'card flush remark-card' }, cardHeader('Remarque du gérant', null), track);

  const count = h('span', { class: 'remark-count', 'aria-live': 'polite' }, `1 / ${remarks.length}`);
  const dots = h('div', { class: 'remark-dots', 'aria-hidden': 'true' }, remarks.map((_, i) => h('span', { class: i ? '' : 'on' })));
  const step = (dir) => track.scrollBy({ left: dir * track.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  const prev = h('button', { type: 'button', class: 'circle-btn', 'aria-label': 'Remarque précédente', disabled: true, onClick: () => step(-1) }, icon('back'));
  const next = h('button', { type: 'button', class: 'circle-btn', 'aria-label': 'Remarque suivante', onClick: () => step(1) }, icon('chevron'));
  track.addEventListener('scroll', () => {
    const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    count.textContent = `${i + 1} / ${remarks.length}`;
    [...dots.children].forEach((d, j) => d.classList.toggle('on', j === i));
    prev.disabled = i === 0;
    next.disabled = i === remarks.length - 1;
  }, { passive: true });
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      step(e.key === 'ArrowRight' ? 1 : -1);
    }
  });
  return h(
    'section',
    { class: 'card flush remark-card', 'aria-roledescription': 'carrousel' },
    cardHeader(`${remarks.length} remarques du gérant`, null, h('div', { class: 'remark-nav' }, prev, count, next)),
    track,
    dots,
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
        intro: `${x.title} · ${x.amount}`,
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
function renderOpenShift(page, ctx, shift, remarks = null) {
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
        s.kind === 'credit' ? (s.over_limit ? badge('Crédit malgré le retard', 'serious') : badge('Crédit', 'info')) : s.kind === 'combo' ? badge(`Combos −${s.combos_used}`, 'warning') : badge('Payé', 'good'),
        s.points && flags.combos ? badge(`+${s.points} combos`) : null,
        s.source === 'customer' ? badge('Demande client') : null,
      ),
      amount: fmt.money(s.amount),
      remove: { url: `/shifts/${shift.id}/sales/${s.id}`, label: s.kind === 'credit' ? 'Annuler ce crédit' : 'Annuler cette vente', pending: !!s.cancel_requested_at },
    })),
    ...shift.payments.map((p) => ({
      at: p.created_at,
      title: p.customer_name,
      detail: `Règlement ${p.method}${p.reference ? ` · ${p.reference}` : ''}`,
      tag: badge('Encaissé', 'good'),
      amount: `+${fmt.money(p.amount)}`,
      remove: { url: `/shifts/${shift.id}/payments/${p.id}`, label: 'Annuler ce règlement', pending: !!p.cancel_requested_at },
    })),
    ...shift.momo.map((m) => ({
      at: m.created_at,
      title: 'Payé en mobile money',
      detail: `${m.product_name} · ${fmt.liters(m.liters)}`,
      tag: badge('Mobile money', 'info'),
      amount: fmt.money(m.amount),
      remove: { url: `/shifts/${shift.id}/momo/${m.id}`, label: 'Annuler ce paiement mobile money', pending: !!m.cancel_requested_at },
    })),
    ...shift.pump_tests.map((t) => ({
      at: t.created_at,
      title: 'Test de pompe',
      detail: `${t.product_name}${t.note ? ` · ${t.note}` : ''}`,
      tag: testBadge(t),
      amount: fmt.liters(t.liters),
      remove: null,
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

  // One action at a time: a second tap while the form loads does nothing.
  const quick = (label, iconName, action, primary) =>
    h('button', { type: 'button', class: `quick-action ${primary ? 'primary' : ''}`, onClick: (e) => busy(e.currentTarget, action) }, h('span', { class: 'qa-icon' }, icon(iconName)), label);

  setContent(page, 
    pageHeader(
      'Poste en cours',
      `Poste n°${shift.id} · depuis le ${fmt.dateTime(shift.opened_at)}${shift.on_duty.length ? ` · en service : ${shift.on_duty.join(', ')}` : ''}`,
      shiftBadge('open'),
    ),
    shiftLine('open'),
    remarks,
    shift.closing_due
      ? h('p', { class: 'offline-strip', role: 'status', style: 'margin-bottom:16px' }, `L’heure de clôture (${ctx.state.settings.closingTime || '15:30'}) est passée : le gérant doit clôturer le poste.`)
      : null,
    // Les prix figés à l'ouverture du poste, un par produit.
    priceTotem([...new Map(shift.readings.map((r) => [r.product_id, { id: r.product_id, name: r.product_name, price: r.unit_price, subscriberPrice: r.subscriber_price }])).values()]),
    h(
      'div',
      { class: 'stack' },
      // The actions stay in place: a new request never pushes them away under the thumb.
      h(
        'div',
        { class: 'quick-actions' },
        quick('Crédit', 'plus', () => addCredit(ctx, shift, reload), true),
        quick('Mobile money', 'phone', () => addMomo(shift, reload)),
        quick('Règlement', 'cash', () => addPayment(ctx, shift, reload)),
        quick('Dépense', 'wallet', () => addExpense(ctx, shift, reload)),
      ),
      // Fuel drawn for a test and poured back into the tank: not sold once the manager approves.
      button('Test de pompe (remis en cuve)', (e) => busy(e.currentTarget, () => addTest(ctx, shift, reload)), { variant: 'secondary block', iconName: 'pump' }),
      requestQueue(shift, reload, ctx.state.settings.cashTolerance),
      h(
        'div',
        { class: 'grid kpi-row' },
        kpi('Crédit', fmt.money(shift.credit_amount)),
        kpi('Mobile money', fmt.money(shift.momo_total)),
        kpi('Règlements', fmt.money(shift.payments_amount)),
        kpi('Dépenses', fmt.money(shift.expenses_amount)),
      ),
      card(
        cardHeader('Opérations du poste', null),
        entries.length
          ? entries.map((x) =>
              h(
                'div',
                { class: 'nozzle-row op-row' },
                h(
                  'div',
                  { class: 'grow' },
                  h('div', { style: 'font-weight:600' }, x.title),
                  h('div', { class: 'muted small' }, `${fmt.time(x.at)} · ${x.detail}`),
                ),
                h('div', { class: 'num', style: 'font-weight:600' }, x.amount),
                !x.remove
                  ? null
                  : x.remove.pending
                  ? badge('Annulation demandée', 'warning')
                  : h('button', { class: 'btn danger sm', 'aria-label': x.remove.label, title: x.remove.label, onClick: () => cancelEntry(ctx, x, reload) }, icon('trash')),
                h('div', { class: 'op-tags' }, x.tag),
              ),
            )
          : h('p', { class: 'muted' }, 'Aucune opération pour le moment.'),
      ),
      card(
        cardHeader('Prix et index', null),
        shift.readings.map((r) =>
          h(
            'div',
            { class: 'nozzle-row' },
            h('span', { class: 'swatch', style: `background:${productColor(r.product_id)};width:12px;height:12px` }),
            h('div', { class: 'grow' }, h('div', { style: 'font-weight:600' }, r.product_name), h('div', { class: 'muted small' }, fmt.price(r.unit_price))),
            h(
              'div',
              { class: 'right' },
              h('div', { class: 'muted small' }, shift.checkpoints.length ? 'Dernier relevé' : 'Index début'),
              h('div', { class: 'num', style: 'font-weight:600' }, fmt.number(shift.checkpoints.at(-1)?.nozzles.find((n) => n.nozzle_id === r.nozzle_id)?.to ?? r.start_meter)),
            ),
          ),
        ),
      ),
      // The 15:30 closing is the manager's; the attendant hands over or closes the station for the night.
      h(
        'div',
        { class: 'grid grid-2' },
        button('Relève (pause)', () => renderCheckpoint(page, ctx, shift, 'releve'), { variant: 'large secondary' }),
        button('Fermeture du soir', () => renderCheckpoint(page, ctx, shift, 'fermeture'), { variant: 'large secondary' }),
      ),
    ),
  );
}

// ---------- Purchases started by customers on their phone ----------
// Polled every few seconds; the attendant confirms with one tap.
function requestQueue(shift, reload, tol) {
  const list = h('div', { class: 'stack', style: 'gap:10px' });
  const host = h('div', { class: 'stack', style: 'gap:10px' }, list);
  // A request's price: the shift's (subscriber price for a subscriber, with their own difference).
  const priceOf = (q) => {
    const r = shift.readings.find((x) => x.product_id === q.product_id);
    if (q.customer_type !== 'account') return r?.unit_price;
    const base = r?.subscriber_price ?? r?.unit_price;
    return q.price_delta == null || base == null ? base : Math.round((base + q.price_delta) * 1000) / 1000;
  };
  let known = null;
  let seenConnected = false;
  let drawn = null; // ids on screen
  const minutes = new Map(); // request id → its « il y a N min »
  const ago = (r) => `il y a ${Math.max(0, Math.round((Date.now() - parseServerDate(r.created_at)) / 60000))} min`;
  const act = (fn) => (e) => busy(e.currentTarget, fn);

  async function confirmRequest(r, adjust = {}) {
    try {
      const sale = await api.post(`/requests/${r.id}/confirm`, adjust);
      toast(`${r.customer_name} : ${fmt.liters(sale.liters)} · ${fmt.money(sale.amount)}${flags.combos && sale.points ? ` · +${sale.points} combos` : sale.combos_used ? ` · −${sale.combos_used} combos` : ''}`);
    } catch (err) {
      if (err.code === 'has_credit') return creditBlocked(r.customer_id, err.message);
      if (err.code !== 'over_limit') throw err;
      if (!(await confirmDialog('Accorder le crédit ?', err.message, { confirmLabel: 'Accorder' }))) return;
      await api.post(`/requests/${r.id}/confirm`, { ...adjust, grantCredit: true });
      toast('Crédit accordé et signalé au gérant');
    }
    reload();
  }

  async function adjust(r) {
    await formDialog({
      title: `Ajuster — ${r.customer_name}`,
      submitLabel: 'Confirmer la vente',
      grid: false,
      fields: [{ name: 'liters', label: 'Litres servis', type: 'number', step: '0.01', min: '0.01', required: true, value: r.liters ?? (r.amount && priceOf(r) ? Math.round((r.amount / priceOf(r)) * 100) / 100 : '') }],
      onSubmit: (d) => confirmRequest(r, { liters: d.liters }),
    });
  }

  function draw(rows) {
    const ids = rows.map((r) => r.id).join(',');
    if (ids === drawn) {
      for (const r of rows) if (minutes.has(r.id)) minutes.get(r.id).textContent = ago(r);
      return;
    }
    drawn = ids;
    minutes.clear();
    if (!rows.length) return list.replaceChildren();
    setContent(list, 
      h('h2', { class: 'queue-title' }, h('span', { class: 'pulse', 'aria-hidden': 'true' }), `Demandes des clients (${rows.length})`),
      ...rows.map((r) => {
        const price = priceOf(r) ?? r.current_price;
        const liters = r.liters ?? r.amount / price;
        const amount = r.amount ?? r.liters * price;
        // An individual with an unpaid credit: the request cannot become a credit.
        const owes = r.payment === 'credit' && r.customer_type !== 'account' && r.balance > 0.001;
        return h(
          'div',
          { class: 'queue-card' },
          h('div', { class: 'who' }, h('span', { class: 'name' }, r.customer_name), minutes.set(r.id, h('span', { class: 'muted small' }, ago(r))).get(r.id)),
          h('div', { class: 'row between' }, h('span', { class: 'what' }, r.amount ? fmt.money(r.amount) : fmt.liters(r.liters)), h('span', { class: 'muted' }, `${r.product_name} · ${r.amount ? `≈ ${fmt.liters(liters)}` : `≈ ${fmt.money(amount)}`}`)),
          h(
            'div',
            { class: 'row', style: 'gap:6px' },
            r.payment === 'credit'
              ? badge(owes ? `Refusé · doit encore ${fmt.money(r.balance)}` : 'Crédit', owes ? 'serious' : 'info')
              : r.payment === 'combo'
                ? badge(`Avec ses combos (${r.loyalty_points})`, 'warning')
                : null,
            r.customer_type === 'account' ? badge('Abonné') : null,
            r.plate ? badge(r.plate) : null,
          ),
          h(
            'div',
            { class: 'actions' },
            button('Refuser', act(async () => {
              if (!(await confirmDialog('Refuser la demande ?', `${r.customer_name} · ${r.product_name}`, { confirmLabel: 'Refuser', danger: true }))) return;
              await api.post(`/requests/${r.id}/reject`, {});
              reload();
            }), { variant: 'secondary' }),
            button('Ajuster', act(() => adjust(r)), { variant: 'secondary' }),
            button('Confirmer', act(() => confirmRequest(r)), { iconName: 'check' }),
          ),
        );
      }),
    );
  }

  // The next check starts once this one has answered; while the network is down the checks
  // slow down, and after two failures a strip says since when the list is not up to date.
  let timer = null;
  let inFlight = false;
  let failures = 0;
  async function poll() {
    clearTimeout(timer);
    if (host.isConnected) seenConnected = true;
    else if (seenConnected) return; // screen left
    if (!document.hidden && !inFlight) {
      inFlight = true;
      try {
        const [rows, reports] = await Promise.all([api.get('/requests/pending'), api.get('/shifts/reports/unseen').catch(() => [])]);
        showReports(reports);
        failures = 0;
        const ids = rows.map((r) => r.id);
        if (known && ids.some((id) => !known.includes(id))) {
          navigator.vibrate?.([80, 60, 80]);
          toast(`Nouvelle demande : ${rows.find((r) => !known.includes(r.id)).customer_name}`);
        }
        known = ids;
        draw(rows);
      } catch {
        failures += 1;
      } finally {
        inFlight = false;
      }
    }
    timer = setTimeout(poll, failures ? Math.min(30000, 4000 * 2 ** failures) : 4000);
  }
  // A relief made by another attendant: its mini report on every phone of the shift, once each.
  let showing = false;
  async function showReports(reports) {
    if (showing || !reports.length) return;
    showing = true;
    try {
      for (const r of reports) {
        navigator.vibrate?.([80, 60, 80]);
        await noticeDialog(`${r.label}${r.by ? ` de ${r.by}` : ''}`, reportCard(r, tol, { title: fmt.dateTime(r.at) }), { level: 'warning', iconName: 'shifts', wide: true });
        await api.post(`/shifts/reports/${r.id}/seen`, {}).catch(() => {});
      }
    } finally {
      showing = false;
    }
  }

  // Check right away when the phone screen comes back on.
  const onVisible = () => {
    if (!document.hidden) poll();
    if (seenConnected && !host.isConnected) document.removeEventListener('visibilitychange', onVisible);
  };
  document.addEventListener('visibilitychange', onVisible);
  poll();
  return host;
}

// Saved without network: kept on the phone until the server answers (the strip at the top counts them).
function queued(reload) {
  toast('Sans réseau : en attente d’envoi');
  reload();
}

// The customers list is kept for 30 s: opening a form a second time is instant.
let customerCache = null;
async function customersList() {
  if (customerCache && Date.now() - customerCache.at < 30000) return customerCache.list;
  const list = await api.get('/customers?form=1');
  customerCache = { at: Date.now(), list };
  return list;
}
const forgetCustomers = () => (customerCache = null);

// Customer search for the attendant's forms: the three closest customers appear as chips to tap,
// so a typo never puts a debt on someone else. A new customer comes only from its own chip.
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const customerLabel = (c) => [c.name, c.plate, c.phone].filter(Boolean).join(' · ');
function customerSearch(customers, { allowNew = false, onPick } = {}) {
  let picked = null; // a customer, or { name } for a new one
  const chips = h('div', { class: 'chips', 'aria-live': 'polite' });
  const exact = (text) => customers.find((c) => norm(c.name) === norm(text) || norm(customerLabel(c)) === norm(text));
  const choose = (form, c) => {
    picked = c;
    form.elements.customer.value = c.id ? customerLabel(c) : c.name;
    chips.replaceChildren();
    onPick?.(form, picked);
  };
  const onInput = (e) => {
    const form = e.target.form;
    const text = form.elements.customer.value;
    picked = exact(text) || null;
    chips.replaceChildren();
    if (norm(text) && !picked) {
      const q = norm(text);
      const matches = customers
        .map((c) => ({ c, at: norm(customerLabel(c)).indexOf(q) }))
        .filter((m) => m.at >= 0)
        .sort((a, b) => (b.at === 0) - (a.at === 0) || a.c.name.localeCompare(b.c.name))
        .slice(0, 3);
      for (const { c } of matches) {
        chips.append(
          h('button', { type: 'button', class: 'chip', onClick: () => choose(form, c) }, c.name, h('span', { class: 'chip-sub' }, [c.plate, c.phone].filter(Boolean).join(' · ') || (c.type === 'account' ? 'abonné' : 'particulier'))),
        );
      }
      if (allowNew) chips.append(h('button', { type: 'button', class: 'chip new', onClick: () => choose(form, { name: text.trim() }) }, `Nouveau client « ${text.trim()} »`));
    }
    onPick?.(form, picked);
  };
  return { onInput, chips, picked: () => picked, pick: choose };
}

// Credit entered by the attendant (paid sales are not entered: the indexes count them),
// built for speed: one search field for the customer (name, plate or phone; an unknown
// name creates the customer), one-tap product and unit, amount in dollars or litres.
// A particulier who still owes a credit gets no other: a card in the middle of the screen says so,
// with each credit still unpaid (when, what, how much is left, who entered it).
export async function creditBlocked(customerId, fallback) {
  const info = await api.get(`/customers/${customerId}/unpaid`).catch(() => null);
  if (!info) return noticeDialog('Pas de nouveau crédit', h('p', {}, fallback || 'Ce client doit encore un crédit : pas de nouveau crédit avant son paiement.'));
  return noticeDialog('Pas de nouveau crédit', [
    h('p', {}, `${info.name} doit encore `, h('strong', {}, fmt.money(info.balance)), '.'),
    h(
      'ul',
      { class: 'notice-list' },
      info.credits.map((c) =>
        h(
          'li',
          {},
          h('span', {}, c.old ? 'Ancienne dette (cahier)' : `${fmt.dateTime(c.created_at)} · ${c.product_name} ${fmt.liters(c.liters)}`),
          h('strong', {}, fmt.money(c.unpaid)),
          h(
            'small',
            {},
            [
              c.unpaid < c.amount - 0.001 ? `reste sur ${fmt.money(c.amount)}` : null,
              c.old ? c.note : `poste n°${c.shift_id}`,
              !c.old && c.user_name ? `saisi par ${c.user_name}` : null,
            ].filter(Boolean).join(' · '),
          ),
        ),
      ),
    ),
    info.phone ? h('p', { class: 'notice-foot' }, `Téléphone : ${info.phone}`) : null,
  ]);
}

export async function addCredit(ctx, shift, reload) {
  const customers = await customersList();
  const clientRef = newRef();
  const products = [...new Map(shift.readings.map((r) => [r.product_id, r])).values()];
  // Subscribers pay the subscriber price fixed at shift opening, with their own difference when they have one.
  const priceOf = (productId, c) => {
    const r = products.find((x) => x.product_id === Number(productId));
    if (c?.type !== 'account') return r?.unit_price || 0;
    const base = r?.subscriber_price ?? r?.unit_price ?? 0;
    const delta = c.deltas?.[productId];
    return delta == null ? base : Math.round((base + delta) * 1000) / 1000;
  };
  const { combosPerLiter, comboValue, comboThreshold } = ctx.state.settings;

  const who = h('p', { class: 'hint-line' });
  const summary = h('div', { class: 'summary-line total' }, h('span', {}, 'Total'), h('span', {}, '—'));
  let alerted = null;
  const update = (e) => {
    const form = e.target?.form ?? e;
    const text = form.elements.customer.value.trim();
    const choice = search.picked();
    const c = choice?.id ? choice : null;
    if (!text) {
      who.textContent = '';
      who.className = 'hint-line';
    } else if (choice && !choice.id) {
      who.textContent = `Nouveau client « ${choice.name} »`;
      who.className = 'hint-line new';
    } else if (c) {
      const parts = [c.type === 'account' ? 'Abonné' : 'Particulier'];
      if (flags.combos) parts.push(`${c.points ?? 0} combos${c.points >= comboThreshold ? ` (= ${fmt.money(c.points * comboValue)})` : ''}`);
      // An individual who still owes a credit: the alert card, once per customer picked.
      const owes = c.type !== 'account' && c.balance > 0.001;
      if (c.type === 'account') parts.push(c.late ? 'mois précédent impayé' : c.balance > 0 ? `doit ${fmt.money(c.balance)} ce mois` : 'à jour');
      else parts.push(owes ? `doit encore ${fmt.money(c.balance)} : pas de nouveau crédit` : c.balance < 0 ? `avance ${fmt.money(-c.balance)}` : 'solde 0,00 $');
      who.textContent = parts.join(' · ');
      who.className = c.late || owes ? 'hint-line variance-neg' : 'hint-line';
      if (owes && alerted !== c.id) {
        alerted = c.id;
        creditBlocked(c.id);
      }
      if (c.plate && !form.elements.plate.value) form.elements.plate.value = c.plate;
    } else {
      who.textContent = '';
      who.className = 'hint-line';
    }
    const price = priceOf(form.elements.productId.value, c);
    const qty = Number(form.elements.qty.value) || 0;
    const byAmount = form.elements.unit.value === 'amount';
    const liters = byAmount ? qty / price : qty;
    const amount = byAmount ? qty : qty * price;
    const combos = `+${Math.floor(liters * combosPerLiter)} combos au paiement`;
    summary.lastChild.textContent = qty ? `${fmt.liters(liters)} · ${fmt.money(amount)}${flags.combos ? ` · ${combos}` : ''}` : '—';
  };

  const search = customerSearch(customers, { allowNew: true, onPick: (form) => update(form) });
  let sold = null; // the customer, for the receipt
  const fields = [
    {
      name: 'customer',
      label: 'Client (nom, plaque ou téléphone)',
      required: true,
      placeholder: 'Tapez quelques lettres…',
      onInput: search.onInput,
      enterkeyhint: 'next',
      // The car's plate in photo: the customer it belongs to is picked.
      photo: {
        label: 'Photo de la plaque',
        onImage: async (image, input) => {
          const form = input.form;
          const read = await api.post('/customers/plate/read', { image, mediaType: 'image/jpeg' }, { timeout: 30000 });
          form.elements.plate.value = read.plate;
          const c = read.customerId && customers.find((x) => x.id === read.customerId);
          if (c) search.pick(form, c);
          else toast(`Plaque ${read.plate} : aucun client`, 'error');
        },
      },
    },
    { name: 'customerChips', type: 'node', node: search.chips },
    { name: 'productId', label: 'Produit', type: 'segment', options: products.map((r) => [r.product_id, r.product_name]), onInput: update },
    { name: 'unit', label: 'Unité', type: 'segment', options: [['amount', '$'], ['liters', 'L']], onInput: update },
    { name: 'qty', label: 'Quantité', type: 'number', step: '0.01', min: '0.01', required: true, onInput: update, inputmode: 'decimal' },
    { name: 'plate', label: 'Plaque', placeholder: 'Facultatif' },
  ];

  const ok = await formDialog({
    title: 'Crédit',
    submitLabel: 'Enregistrer le crédit',
    grid: false,
    autofocus: true,
    fields,
    extra: () => h('div', {}, who, summary),
    onSubmit: async (d, form) => {
      const choice = search.picked();
      if (!choice) throw new Error('Touchez un client proposé, ou « Nouveau client » pour le créer.');
      let customer = choice.id ? choice : null;
      if (!customer) {
        customer = await api.post('/customers/quick', { name: choice.name });
        customers.push(customer);
        forgetCustomers();
        form.elements.customer.value = customer.name;
      }
      sold = customer;
      const body = {
        customerId: customer.id,
        productId: Number(d.productId),
        payment: 'credit',
        [d.unit === 'amount' ? 'amount' : 'liters']: d.qty,
        plate: d.plate,
        clientRef,
      };
      try {
        return await api.post(`/shifts/${shift.id}/sales`, body, { queue: `Crédit · ${customer.name} · ${d.unit === 'amount' ? fmt.money(d.qty) : fmt.liters(d.qty)}` });
      } catch (err) {
        if (err.code === 'has_credit') {
          await creditBlocked(customer.id, err.message);
          throw new Error('Crédit non enregistré : le client doit encore son crédit précédent.');
        }
        if (err.code !== 'over_limit') throw err;
        const grant = await confirmDialog('Accorder le crédit ?', err.message, { confirmLabel: 'Accorder' });
        if (!grant) throw new Error('Crédit non enregistré : refusé.');
        return api.post(`/shifts/${shift.id}/sales`, { ...body, grantCredit: true });
      }
    },
  });
  if (ok?.queued) return queued(reload);
  if (ok) {
    forgetCustomers(); // balances changed
    const product = products.find((r) => r.product_id === ok.product_id)?.product_name;
    const line = `Crédit : ${[product, fmt.liters(ok.liters), fmt.money(ok.amount)].filter(Boolean).join(' · ')}`;
    toast(ok.over_limit ? 'Crédit accordé et signalé au gérant' : `Crédit enregistré · ${fmt.liters(ok.liters)} · ${fmt.money(ok.amount)}`, 'info', {
      action: receipt(sold, [line, ok.plate ? `Plaque : ${ok.plate}` : null], ok.balance),
    });
    reload();
  }
}

export async function addPayment(ctx, shift, reload) {
  const customers = await customersList();
  const clientRef = newRef();
  let paid = null; // the customer and the money, for the receipt
  const owes = h('p', { class: 'hint-line' });
  // A debt from before the app: asked when the payment is more than what the app knows.
  const oldField = h(
    'div',
    {},
    field({ name: 'oldDebt', label: 'Ancienne dette, d’avant l’application ($)', type: 'number', step: '0.01', min: '0.01', placeholder: 'Vide = le montant payé' }),
  );
  const advanceNote = h('p', { class: 'hint-line', hidden: true }, 'Le surplus devient une avance.');
  const oldBox = h(
    'div',
    { class: 'stack', style: 'gap:12px', hidden: true },
    field({
      name: 'surplus',
      label: 'Le client paie plus que sa dette connue : c’est…',
      type: 'segment',
      options: [
        ['old', 'Une ancienne dette'],
        ['advance', 'Une avance'],
      ],
      onInput: (e) => refresh(e.target.form),
    }),
    oldField,
    advanceNote,
  );
  const known = (c) => (c?.id ? Math.max(0, c.balance) : 0);
  const refresh = (form) => {
    const c = search.picked();
    const amount = Number(form.elements.amount.value) || 0;
    oldBox.hidden = !c || amount <= known(c) + 0.001;
    const advance = form.elements.surplus.value === 'advance';
    oldField.hidden = advance;
    advanceNote.hidden = !advance;
    owes.textContent = !c
      ? ''
      : !c.id
        ? 'Nouveau client'
        : c.balance > 0
          ? `Doit ${fmt.money(c.balance)}`
          : c.balance < 0
            ? `A déjà une avance de ${fmt.money(-c.balance)}`
            : 'Aucune dette';
  };
  const search = customerSearch(customers, {
    allowNew: true,
    onPick: (form, c) => {
      if (c?.id && !form.elements.amount.value && c.balance > 0) form.elements.amount.value = c.balance.toFixed(2);
      refresh(form);
    },
  });
  const ok = await formDialog({
    title: 'Règlement client',
    submitLabel: 'Encaisser',
    grid: false,
    autofocus: true,
    fields: [
      { name: 'customer', label: 'Client (nom, plaque ou téléphone)', required: true, placeholder: 'Tapez quelques lettres…', onInput: search.onInput },
      { name: 'customerChips', type: 'node', node: h('div', {}, search.chips, owes) },
      { name: 'amount', label: 'Montant reçu ($)', type: 'number', step: '0.01', min: '0.01', required: true, onInput: (e) => refresh(e.target.form) },
      { name: 'oldDebtBox', type: 'node', node: oldBox },
      { name: 'method', label: 'Mode', type: 'segment', options: [['espèces', 'Espèces'], ['mobile money', 'Mobile money']] },
      { name: 'reference', label: 'Référence', placeholder: 'Facultatif (n° de transaction…)' },
    ],
    onSubmit: async (d, form) => {
      const choice = search.picked();
      if (!choice) throw new Error('Touchez un client proposé, ou « Nouveau client » pour le créer.');
      let customer = choice.id ? choice : null;
      if (!customer) {
        customer = await api.post('/customers/quick', { name: choice.name });
        customers.push(customer);
        forgetCustomers();
        form.elements.customer.value = customer.name;
      }
      // What the app does not know is a debt from before it (never an advance by mistake).
      const excess = Math.round((Number(d.amount) - known(choice)) * 100) / 100;
      const oldDebt = excess > 0 && form.elements.surplus.value !== 'advance' ? Number(form.elements.oldDebt.value) || excess : 0;
      paid = { customer, line: `Règlement : ${fmt.money(Number(d.amount))} en ${d.method}` };
      return api.post(
        `/shifts/${shift.id}/payments`,
        { amount: d.amount, method: d.method, reference: d.reference, customerId: customer.id, oldDebt, clientRef },
        { queue: `Règlement · ${customer.name} · ${fmt.money(Number(d.amount))}` },
      );
    },
  });
  if (ok?.queued) return queued(reload);
  if (ok) {
    forgetCustomers();
    const done = ok.settled && ok.id == null ? 'Crédit payé' : 'Règlement encaissé';
    toast(ok.balance < 0 ? `${done} · avance du client ${fmt.money(-ok.balance)}` : `${done} · reste dû ${fmt.money(ok.balance)}`, 'info', {
      action: receipt(paid.customer, [paid.line], ok.balance),
    });
    reload();
  }
}

// Fuel paid by mobile money: only the litres and the fuel; the amount is at the shift's price.
// At closing, the shift's mobile money is the total of these entries.
export async function addMomo(shift, reload) {
  const clientRef = newRef();
  const products = [...new Map(shift.readings.map((r) => [r.product_id, { id: r.product_id, name: r.product_name, price: r.unit_price }])).values()];
  const amount = h('span', { class: 'num' }, '—');
  const update = (e) => {
    const form = e.target.form;
    const product = products.find((p) => String(p.id) === form.querySelector('input[name=productId]:checked')?.value);
    const liters = Number(form.elements.liters.value);
    amount.textContent = product && liters > 0 ? fmt.money(Math.round(liters * product.price * 100) / 100) : '—';
  };
  const ok = await formDialog({
    autofocus: true,
    title: 'Payé en mobile money',
    submitLabel: 'Enregistrer',
    grid: false,
    fields: [
      { name: 'liters', label: 'Litres', type: 'number', step: '0.01', min: '0.01', required: true, onInput: update },
      { name: 'productId', label: 'Carburant', type: 'segment', options: products.map((p) => [String(p.id), p.name]), value: String(products[0]?.id), onInput: update },
    ],
    extra: () => h('div', { class: 'summary-line total' }, h('span', {}, 'Montant reçu'), amount),
    onSubmit: (d) => api.post(`/shifts/${shift.id}/momo`, { productId: Number(d.productId), liters: Number(d.liters), clientRef }, { queue: `Mobile money · ${fmt.liters(Number(d.liters))}` }),
  });
  if (ok?.queued) return queued(reload);
  if (ok) {
    toast(`Mobile money : ${fmt.liters(ok.liters)} · ${fmt.money(ok.amount)}`);
    reload();
  }
}

const testBadge = (t) => (t.status === 'rejected' ? badge('Annulé', 'serious') : t.status === 'pending' ? badge('À confirmer', 'warning') : null);

// A pump test: the nozzle, the litres poured back into the tank. The manager approves it.
export async function addTest(ctx, shift, reload) {
  const clientRef = newRef();
  const manager = ctx.state.user.role === 'manager';
  const quickLiters = h(
    'div',
    { class: 'full' },
    buttonRow(
      [5, 10, 20].map((l) => button(`${l} L`, (e) => (e.currentTarget.form.elements.liters.value = l), { variant: 'secondary sm' })),
      { inline: true },
    ),
  );
  const ok = await formDialog({
    title: 'Test de pompe',
    submitLabel: manager ? 'Enregistrer' : 'Envoyer au gérant',
    grid: false,
    fields: [
      { name: 'nozzleId', label: 'Produit', type: 'segment', options: shift.readings.map((r) => [String(r.nozzle_id), r.product_name]), value: String(shift.readings[0]?.nozzle_id) },
      { name: 'liters', label: 'Litres remis en cuve', type: 'number', step: '0.01', min: '0.01', required: true },
      { name: 'quick', type: 'node', node: quickLiters },
      { name: 'note', label: 'Remarque (facultatif)', placeholder: 'Étalonnage, contrôle du compteur…' },
    ],
    onSubmit: (d) => api.post(`/shifts/${shift.id}/tests`, { nozzleId: Number(d.nozzleId), liters: Number(d.liters), note: d.note, clientRef }, { queue: `Test de pompe · ${fmt.liters(Number(d.liters))}` }),
  });
  if (ok?.queued) return queued(reload);
  if (ok) {
    toast(manager ? `Test de pompe : ${fmt.liters(ok.liters)} remis en cuve` : `Test de pompe envoyé au gérant (${fmt.liters(ok.liters)})`);
    reload();
  }
}

export async function addExpense(ctx, shift, reload) {
  const clientRef = newRef();
  const payTo = nameChips(ctx.state.settings.supplierNames);
  const ok = await formDialog({
    autofocus: true,
    title: 'Dépense payée en caisse',
    submitLabel: 'Enregistrer la dépense',
    grid: false,
    fields: [
      { name: 'amount', label: 'Montant ($)', type: 'number', step: '0.01', min: '0.01', required: true },
      { name: 'category', label: 'Catégorie', type: 'select', options: ctx.state.settings.expenseCategories.map((c) => [c, c]), value: 'Fournitures' },
      { name: 'description', label: 'Description', required: true, placeholder: 'Ex. : eau, ampoule, transport…' },
      { name: 'beneficiary', label: 'Payé à', placeholder: 'Facultatif', onInput: payTo.onInput },
      payTo.node,
    ],
    onSubmit: (d) => api.post(`/shifts/${shift.id}/expenses`, { ...d, clientRef }, { queue: `Dépense · ${d.description} · ${fmt.money(Number(d.amount))}` }),
  });
  if (ok?.queued) return queued(reload);
  if (ok) {
    toast('Dépense enregistrée');
    reload();
  }
}

// ---------- 3. Closing in two steps: end meters (the next shift opens), then the money ----------
// mode 'manager' (or 'attendant'): the end meters only. 'count': the money of a closed shift.
// 'correct': the manager fixes a closed shift, starting from the first closing.
export function renderClosing(page, ctx, shift, { mode = 'attendant', onBack, onDone } = {}) {
  const tol = ctx.state.settings.cashTolerance;
  const correcting = mode === 'correct';
  const counting = mode === 'count';
  const showMeters = !counting;
  const showMoney = counting || (correcting && !!shift.counted_at);
  // The last index taken during the shift (relief, evening closing, morning opening).
  const lastTaken = (r) => shift.checkpoints?.at(-1)?.nozzles.find((n) => n.nozzle_id === r.nozzle_id)?.to ?? r.start_meter;
  const first = (value, fallback) => (correcting ? value ?? fallback : fallback);
  const cashGiven = () => showMoney && form.elements.cash.value !== '';
  const credit = shift.credit_amount || 0;
  const payments = shift.payments_amount || 0;
  const expenses = shift.expenses_amount || 0;
  const combos = shift.combo_amount || 0;
  // Cash book movements made in the till (an entry +, an exit −).
  const moves = shift.movements || [];
  const moved = shift.movements_amount || 0;
  // Mobile money is not counted: it is the total entered as it was paid.
  const momo = shift.momo_total || 0;
  // Change left at the previous closing: it is part of what is handed over.
  const received = shift.change_received || 0;
  const lines = {
    total: h('span', { class: 'num' }),
    credit: h('span', { class: 'num' }, fmt.money(credit)),
    expected: h('span', { class: 'num' }),
    expectedCash: h('span', { class: 'num' }),
    declared: h('span', { class: 'num' }),
    changeLeft: h('span', { class: 'num nowrap' }),
    variance: h('span', { class: 'num' }),
  };
  const perNozzle = new Map();

  const form = h('form', { class: 'stack' });
  const recompute = () => {
    let total = 0;
    let complete = true;
    for (const r of shift.readings) {
      const v = form.elements[`end_${r.nozzle_id}`].value;
      // Counting: no meter field, nothing to show under it.
      const out = perNozzle.get(r.nozzle_id) || {};
      if (v === '') {
        complete = false;
        out.textContent = '';
        continue;
      }
      // Approved pump tests went back into the tank: not sold.
      const liters = Number(v) - r.start_meter - (r.tested || 0);
      total += liters * r.unit_price;
      out.textContent = Number(v) < r.start_meter ? 'Index inférieur au début !' : `${fmt.liters(liters)}${r.tested ? ` (tests −${fmt.liters(r.tested)})` : ''} · ${fmt.money(liters * r.unit_price)}`;
      out.className = liters < 0 ? 'small variance-neg' : 'small muted';
    }
    // Subscribers' higher price is cashed on top of the pump price.
    const surcharge = shift.sales.reduce((t, x) => t + (x.amount - x.liters * (shift.readings.find((r) => r.nozzle_id === x.nozzle_id)?.unit_price ?? 0)), 0);
    total += surcharge;
    const expected = received + total - credit - combos + payments - expenses + moved;
    const value = (name) => Number(form.elements[name]?.value) || 0;
    const declared = value('cash') + momo;
    lines.total.textContent = complete ? fmt.money(total) : '—';
    lines.expected.textContent = complete ? fmt.money(expected) : '—';
    // The change left stays with the attendants: it is not handed over.
    lines.changeLeft.textContent = `− ${fmt.money(value('changeLeft'))}`;
    lines.expectedCash.textContent = complete ? fmt.money(expected - momo - value('changeLeft')) : '—';
    lines.declared.textContent = fmt.money(value('cash'));
    setContent(lines.variance, complete && cashGiven() ? varianceCell(Math.round((declared + value('changeLeft') - expected) * 100) / 100, tol) : '—');
  };

  // Counting: the end meters are those of the closing.
  const meterInputs = h('div', { hidden: true }, shift.readings.map((r) => h('input', { type: 'hidden', name: `end_${r.nozzle_id}`, value: String(r.end_meter ?? '') })));
  // Cards absent in this step are left out (append would write « null »).
  form.append(...[
    showMeters ? card(
      cardHeader(correcting ? '1. Index de fin' : 'Index de fin', null),
      h(
        'div',
        { class: 'stack' },
        shift.readings.map((r) => {
          const out = h('span', { class: 'small muted' });
          perNozzle.set(r.nozzle_id, out);
          return h(
            'div',
            {},
            withMeterPhoto(
              field({ name: `end_${r.nozzle_id}`, label: `${r.product_name} (début : ${fmt.number(r.start_meter)}${lastTaken(r) !== r.start_meter ? `, dernier relevé : ${fmt.number(lastTaken(r))}` : ''})`, type: 'number', step: '0.01', min: String(lastTaken(r)), required: true, value: first(r.end_meter, undefined), onInput: recompute }),
              { product: r.product_name, last: lastTaken(r), nozzleId: r.nozzle_id, typed: correcting },
            ),
            out,
          );
        }),
      ),
    ) : meterInputs,
    card(
      cardHeader('Rapprochement'),
      received ? h('div', { class: 'summary-line' }, h('span', {}, 'Monnaie reçue à l’ouverture'), h('span', { class: 'num' }, `+ ${fmt.money(received)}`)) : null,
      h('div', { class: 'summary-line' }, h('span', {}, 'Ventes selon les index'), lines.total),
      h('div', { class: 'summary-line' }, h('span', {}, 'Vendu à crédit'), h('span', {}, '− ', lines.credit)),
      combos ? h('div', { class: 'summary-line' }, h('span', {}, 'Échangé contre des combos'), h('span', { class: 'num' }, `− ${fmt.money(combos)}`)) : null,
      payments ? h('div', { class: 'summary-line' }, h('span', {}, 'Règlements reçus'), h('span', { class: 'num' }, `+ ${fmt.money(payments)}`)) : null,
      expenses ? h('div', { class: 'summary-line' }, h('span', {}, 'Dépenses payées'), h('span', { class: 'num' }, `− ${fmt.money(expenses)}`)) : null,
      moves.map((m) => h('div', { class: 'summary-line' }, h('span', {}, m.signed > 0 ? `Entrée de la caisse · ${m.note || m.label}` : `Sortie de la caisse · ${m.note || m.label}`), h('span', { class: 'num' }, `${m.signed > 0 ? '+' : '−'} ${fmt.money(Math.abs(m.signed))}`))),
      h('div', { class: 'summary-line' }, h('span', {}, 'À remettre'), lines.expected),
      momo ? h('div', { class: 'summary-line' }, h('span', {}, 'Reçu en mobile money'), h('span', { class: 'num' }, `− ${fmt.money(momo)}`)) : null,
      showMoney
        ? [
            h('div', { class: 'summary-line' }, h('span', {}, 'Monnaie laissée aux pompistes'), lines.changeLeft),
            h('div', { class: 'summary-line' }, h('span', {}, 'Espèces à remettre'), lines.expectedCash),
            h('div', { class: 'summary-line' }, h('span', {}, 'Espèces remises'), lines.declared),
            h('div', { class: 'summary-line total' }, h('span', {}, 'Écart'), lines.variance),
          ]
        : null,
    ),
    showMoney ? card(
      cardHeader(correcting ? '2. Caisse' : 'Argent', null),
      h('div', { class: 'summary-line', style: 'margin-bottom:12px' }, h('span', {}, 'Mobile money reçu'), h('span', { class: 'num' }, fmt.money(momo))),
      h(
        'div',
        { class: 'form-grid' },
        field({ name: 'changeLeft', label: 'Monnaie laissée aux pompistes ($)', type: 'number', step: '0.01', min: '0', value: first(shift.change_left, received || undefined), onInput: recompute }),
        field({ name: 'cash', label: 'Espèces remises ($)', type: 'number', step: '0.01', min: '0', required: true, value: first(shift.cash, undefined), onInput: recompute }),
        field({ name: 'notes', label: 'Remarque (facultatif)', type: 'textarea', full: true, value: first(shift.notes, undefined) }),
      ),
    ) : null,
    correcting ? card(field({ name: 'reason', label: 'Motif de la correction', required: true, full: true, placeholder: 'Ex. : index mal lu, billets oubliés' })) : null,
    h(
      'div',
      { class: 'grid grid-2' },
      button('Retour', () => (onBack ? onBack() : renderAttendant(page, ctx)), { variant: 'large return' }),
      button(correcting ? 'Corriger la clôture' : counting ? 'Enregistrer le comptage' : 'Clôturer le poste', null, { variant: 'large', type: 'submit' }),
    ),
  ].filter(Boolean));

  // Draft kept on the phone: leaving the screen or a reload does not lose the figures typed.
  const draftKey = `closing-draft-${shift.id}`;
  form.addEventListener('input', () => {
    if (correcting) return;
    try {
      const values = {};
      for (const el of form.elements) {
        if (!el.name || el.name === 'reason') continue;
        values[el.name] = el.value;
        // An index read from its photo: the photo goes with the draft.
        if (el.dataset.read) values[`${el.name}@photo`] = el.dataset.photoId || '1';
      }
      localStorage.setItem(draftKey, JSON.stringify(values));
    } catch {
      /* no storage: nothing kept */
    }
  });
  const restoreDraft = () => {
    if (correcting) return;
    try {
      const values = JSON.parse(localStorage.getItem(draftKey) || 'null');
      if (values) {
        for (const [name, value] of Object.entries(values)) if (form.elements[name] && value !== '') form.elements[name].value = value;
        for (const [key, photo] of Object.entries(values)) {
          const el = key.endsWith('@photo') && form.elements[key.slice(0, -6)];
          if (el) markRead(el, photo === '1' ? null : photo);
        }
      }
    } catch {
      /* unreadable draft: start empty */
    }
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ask = correcting
      ? ['Corriger la clôture ?', null, 'Corriger']
      : counting
        ? ['Enregistrer le comptage ?', null, 'Enregistrer']
        : ['Clôturer le poste ?', null, 'Clôturer'];
    if (!(await confirmDialog(ask[0], ask[1], { confirmLabel: ask[2] }))) return;
    const submit = form.querySelector('button[type=submit]');
    submit.disabled = true;
    try {
      const money = showMoney ? { cash: Number(form.elements.cash.value), changeLeft: Number(form.elements.changeLeft.value) || 0, notes: form.elements.notes.value } : {};
      const closed = await api.post(`/shifts/${shift.id}/${correcting ? 'correct' : counting ? 'count' : 'close'}`, {
        ...(counting
          ? {}
          : { readings: shift.readings.map((r) => ({ nozzleId: r.nozzle_id, endMeter: Number(form.elements[`end_${r.nozzle_id}`].value), photoId: form.elements[`end_${r.nozzle_id}`].dataset.photoId })) }),
        ...money,
        reason: form.elements.reason?.value,
      });
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* nothing to remove */
      }
      if (onDone) onDone(closed);
      else renderClosed(page, ctx, closed);
    } catch (err) {
      submit.disabled = false;
      toast(err.message, 'error');
    }
  });

  const title = correcting ? `Corriger la clôture du poste n°${shift.id}` : counting ? `Compter l’argent du poste n°${shift.id}` : `Clôturer le poste n°${shift.id}`;
  setContent(page, pageHeader(title, `Poste n°${shift.id} ouvert le ${fmt.dateTime(shift.opened_at)}`), form);
  restoreDraft();
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
        ),
      ),
      shiftSummary(shift, tol),
      buttonRow(reportLink(shift.id, 'secondary large')),
      button('Terminé', () => renderAttendant(page, ctx), { variant: 'large block' }),
    ),
  );
}

// ---------- History ----------
export async function renderMyShifts(page, ctx) {
  const shifts = await api.get('/shifts');
  const tol = ctx.state.settings.cashTolerance;
  setContent(page, 
    pageHeader('Historique', null),
    h(
      'section',
      { class: 'card flush' },
      table(
        [
          // Status and remark under the date, sales in the detail: two columns fit a phone.
          {
            label: 'Poste',
            render: (s) =>
              h(
                'div',
                {},
                h('div', {}, fmt.dateTime(s.opened_at)),
                h('span', { class: 'row', style: 'gap:6px;margin-top:6px' }, shiftBadge(s.status), s.remark_unread ? badge('Nouvelle remarque', 'info') : s.has_remark ? badge('Remarque') : null),
              ),
          },
          { label: 'Écart', align: 'right', render: (s) => varianceCell(s.variance, tol) },
        ],
        shifts,
        { onRowClick: (s) => ctx.navigate(`historique/${s.id}`), empty: 'Aucun poste pour le moment.' },
      ),
    ),
  );
}
