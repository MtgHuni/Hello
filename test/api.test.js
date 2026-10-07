const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/app');

let server;
let baseUrl;
let db;
let locals;

before(async () => {
  const app = createApp({ dbFile: ':memory:' });
  db = app.locals.db;
  locals = app.locals;
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => server.close());

// Minimal client that keeps its own session cookie.
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(baseUrl + url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const raw = res.status === 204 ? null : Buffer.from(await res.arrayBuffer());
    let data = null;
    try {
      data = raw && JSON.parse(raw.toString('utf8'));
    } catch {}
    return { status: res.status, data, raw, type: res.headers.get('content-type') };
  };
}

const gerant = client();
const pompiste = client();
const ctx = {};
const today = () => new Date().toLocaleDateString('sv-SE');
const customer = async (id) => (await gerant('GET', `/api/customers/${id}`)).data;
// The manager's daily closing, with every nozzle: those given move, the others keep their start index.
const closeShift = (shift, ends, money) =>
  gerant('POST', `/api/shifts/${shift.id}/close`, { readings: shift.readings.map((r) => ({ nozzleId: r.nozzle_id, endMeter: ends[r.nozzle_id] ?? r.start_meter })), ...money });
const dieselOf = (shift) => shift.readings.find((r) => r.product_id === ctx.diesel.id);
// Timestamps are to the second: steps that must not share one are spaced.
const nextSecond = () => new Promise((r) => setTimeout(r, 1100));
const round2 = (n) => Math.round(n * 100) / 100;

test('premier lancement : configuration de la station', async () => {
  assert.strictEqual((await gerant('GET', '/api/setup')).data.needsSetup, true);
  assert.strictEqual((await gerant('GET', '/api/dashboard')).status, 401);

  const res = await gerant('POST', '/api/setup', {
    stationName: 'Station Test',
    name: 'Gérant',
    login: 'gerant',
    password: 'motdepasse1',
    dieselPrice: 1.2,
    petrolPrice: 1.5,
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual((await gerant('POST', '/api/setup', {})).status, 400);
  const again = { stationName: 'Autre', name: 'Intrus', login: 'intrus', password: 'motdepasse2', dieselPrice: 1, petrolPrice: 1 };
  assert.strictEqual((await gerant('POST', '/api/setup', again)).status, 409, 'déjà configurée');

  const me = (await gerant('GET', '/api/auth/me')).data;
  assert.strictEqual(me.user.role, 'manager');
  assert.strictEqual(me.settings.combosPerLiter, 1);
  assert.strictEqual(me.settings.combosEnabled, false, 'combos désactivés par défaut');
  assert.strictEqual(me.settings.cdfRate, undefined, 'tout en dollars');
  // The combo tests below need the programme on.
  await gerant('PUT', '/api/settings', { combosEnabled: true });
  assert.strictEqual(me.settings.individualCreditLimit, 50);
  assert.strictEqual(me.settings.subscriberCreditLimit, 500);

  ctx.pumps = (await gerant('GET', '/api/pumps')).data;
  ctx.tanks = (await gerant('GET', '/api/tanks')).data;
  ctx.products = (await gerant('GET', '/api/products')).data;
  ctx.diesel = ctx.products.find((p) => p.name === 'Gasoil');
  ctx.dieselPump = ctx.pumps.find((p) => p.nozzles[0].product_name === 'Gasoil');
});

test('livraison puis jaugeage', async () => {
  const tank = ctx.tanks.find((t) => t.product_name === 'Gasoil');
  await gerant('POST', '/api/deliveries', { tankId: tank.id, litersOrdered: 10000, litersReceived: 9950 });
  const dip = await gerant('POST', '/api/dips', { tankId: tank.id, measured: 9940 });
  assert.strictEqual(dip.data.variance, -10);
});

test('catégories de clients : prix abonnés réglés dans les paramètres, pas de plafond', async () => {
  await gerant('POST', '/api/users', { name: 'Paul', login: 'paul', password: 'pompiste1', role: 'attendant' });
  assert.strictEqual((await pompiste('POST', '/api/auth/login', { login: 'PAUL', password: 'pompiste1' })).status, 200);
  assert.strictEqual((await pompiste('GET', '/api/dashboard')).status, 403);

  ctx.fleet = (await gerant('POST', '/api/customers', { type: 'account', name: 'Transports Kivu', creditLimit: 99999 })).data;
  ctx.person = (await gerant('POST', '/api/customers', { type: 'individual', name: 'Marie' })).data;

  const product = await gerant('PUT', `/api/products/${ctx.diesel.id}`, { subscriberPrice: 1.4 });
  assert.strictEqual(product.data.subscriber_price, 1.4);
});

test('poste : prix abonné, crédit sans combos, un crédit à la fois, rapprochement', async () => {
  const opened = await pompiste('POST', '/api/shifts', {});
  assert.strictEqual(opened.status, 201);
  const shift = opened.data;
  const nozzle = dieselOf(shift);
  assert.strictEqual(shift.readings.length, ctx.pumps.flatMap((p) => p.nozzles).length, 'le poste couvre toutes les pompes');
  assert.strictEqual(nozzle.unit_price, 1.2);
  assert.strictEqual(nozzle.subscriber_price, 1.4);
  assert.strictEqual((await pompiste('POST', '/api/shifts', {})).status, 409);

  const sell = (body) => pompiste('POST', `/api/shifts/${shift.id}/sales`, { nozzleId: nozzle.nozzle_id, ...body });

  // Subscriber on credit: 50 L × 1,40 = 70 $; combos only once paid.
  const fleetCredit = await sell({ customerId: ctx.fleet.id, liters: 50, payment: 'credit' });
  assert.strictEqual(fleetCredit.data.amount, 70);
  assert.strictEqual(fleetCredit.data.points, 0);
  assert.strictEqual(fleetCredit.data.points_due, 50);

  // Paid sales are not entered: the indexes count them.
  const paid = await sell({ customerId: ctx.person.id, liters: 20.5, payment: 'paid' });
  assert.strictEqual(paid.status, 400);
  assert.strictEqual(paid.data.code, 'paid');

  // Particulier credit: 40 L = 48 $; no new credit while he owes it.
  assert.strictEqual((await sell({ customerId: ctx.person.id, liters: 40, payment: 'credit' })).status, 201);
  const over = await sell({ customerId: ctx.person.id, liters: 5, payment: 'credit' });
  assert.strictEqual(over.status, 409);
  assert.strictEqual(over.data.code, 'has_credit');

  // No combos yet (< 100): no exchange.
  const tooFew = await sell({ customerId: ctx.person.id, amount: 1, payment: 'combo' });
  assert.strictEqual(tooFew.status, 409);
  assert.strictEqual(tooFew.data.code, 'combos');

  assert.strictEqual((await customer(ctx.person.id)).customer.loyalty_points, 0, 'crédit : combos seulement une fois payé');

  // 500 L at 1,20 = 600 $ + subscriber surcharge 50 × 0,20 = 10 $ → 610 $;
  // credit 70 + 48 = 118 $ → 492 $ to hand over; 490 $ declared.
  // 50 L paid by mobile money as they are sold: 60 $ of mobile money, nothing typed at closing.
  const momoRef = 'momo-test-1';
  const momo = await pompiste('POST', `/api/shifts/${shift.id}/momo`, { productId: ctx.diesel.id, liters: 50, clientRef: momoRef });
  assert.strictEqual(momo.status, 201);
  assert.strictEqual(momo.data.amount, 60);
  assert.strictEqual((await pompiste('POST', `/api/shifts/${shift.id}/momo`, { productId: ctx.diesel.id, liters: 50, clientRef: momoRef })).data.id, momo.data.id, 'pas de doublon');
  assert.strictEqual((await pompiste('POST', `/api/shifts/${shift.id}/momo`, { productId: 999, liters: 5 })).status, 400);
  assert.strictEqual((await pompiste('GET', `/api/shifts/${shift.id}`)).data.momo_total, 60);
  assert.strictEqual((await pompiste('POST', `/api/shifts/${shift.id}/close`, {})).status, 403, 'la clôture est celle du gérant');
  const closed = await closeShift(shift, { [nozzle.nozzle_id]: 500 }, { cash: 430, mobileMoney: 999 });
  assert.strictEqual(closed.status, 200);
  assert.ok(closed.data.next_shift_id > shift.id, 'le poste suivant s’ouvre aussitôt');
  assert.strictEqual(closed.data.total_amount, 610);
  assert.strictEqual(closed.data.credit_amount, 118);
  assert.strictEqual(closed.data.expected_amount, 492);
  assert.strictEqual(closed.data.mobile_money, 60, 'le total saisi, pas un montant tapé');
  assert.strictEqual(closed.data.variance, -2);
  assert.strictEqual(closed.data.status, 'closed');
  assert.deepStrictEqual(
    (await gerant('GET', '/api/shifts?status=closed')).data.find((s) => s.id === shift.id).liters_by_product.map((p) => [p.product_id, p.liters]),
    [[ctx.diesel.id, 500], [ctx.products.find((p) => p.id !== ctx.diesel.id).id, 0]],
    'litres séparés par carburant',
  );

  // End-of-shift PDF report: sales from the indexes, credits, expenses.
  const report = await pompiste('GET', `/api/shifts/${shift.id}/report.pdf`);
  assert.strictEqual(report.status, 200);
  assert.match(report.type, /application\/pdf/);
  assert.strictEqual(report.raw.subarray(0, 5).toString(), '%PDF-');
  // Accents are written as WinAnsi octal escapes: é = \351.
  const pdfText = report.raw.toString('latin1');
  assert.ok(pdfText.includes('(Ventes calcul\\351es par les index)'));
  assert.ok(pdfText.includes('(Cr\\351dits accord\\351s)'));

  const dash = (await gerant('GET', '/api/dashboard')).data;
  assert.strictEqual(dash.todayTotal.amount, 610, 'ventes selon les index + supplément abonnés, comme le poste');
  assert.strictEqual(dash.last7.at(-1).amount, 610, 'même chiffre que le graphique');
  assert.ok(dash.alerts.some((a) => a.text.includes('écart de caisse')));
  // A remark for the attendant, read in the history. There is no validation step.
  assert.strictEqual((await pompiste('POST', `/api/shifts/${shift.id}/remark`, { comment: 'x' })).status, 403);
  assert.strictEqual((await gerant('POST', `/api/shifts/${shift.id}/remark`, { comment: 'Expliquez l’écart, svp.' })).data.manager_comment, 'Expliquez l’écart, svp.');
  assert.strictEqual((await pompiste('GET', '/api/shifts')).data.find((s) => s.id === shift.id).remark_unread, 1);
  assert.deepStrictEqual((await pompiste('GET', '/api/shifts/remarks/unread')).data.map((r) => r.id), [shift.id]);
  assert.strictEqual((await gerant('POST', `/api/shifts/${shift.id}/validate`, {})).status, 404);
  assert.strictEqual((await gerant('GET', `/api/shifts/${shift.id}`)).data.comment_seen_at, null, 'le gérant ne la marque pas lue');
  assert.strictEqual((await pompiste('GET', `/api/shifts/${shift.id}`)).data.manager_comment, 'Expliquez l’écart, svp.');
  assert.deepStrictEqual((await pompiste('GET', '/api/shifts/remarks/unread')).data, []);
  assert.ok((await gerant('GET', `/api/shifts/${shift.id}`)).data.comment_seen_at, 'lue par le pompiste');
  assert.strictEqual((await gerant('POST', `/api/shifts/${shift.id}/remark`, { comment: '' })).data.manager_comment, null, 'remarque retirée');

  const state = (await pompiste('GET', '/api/shifts/state')).data;
  assert.strictEqual(state.shift.id, closed.data.next_shift_id);
  assert.strictEqual(state.onDuty, true, 'le pompiste présent continue sur le poste suivant');
  ctx.shift = state.shift;
  assert.strictEqual(dieselOf(ctx.shift).start_meter, 500);
  assert.strictEqual((await pompiste('GET', `/api/shifts/${ctx.shift.id}/report.pdf`)).status, 409, 'pas de rapport avant la clôture');
});

test('les combos d’une vente à crédit arrivent quand elle est entièrement payée', async () => {
  await gerant('POST', `/api/customers/${ctx.fleet.id}/payments`, { amount: 70, method: 'espèces' });
  assert.strictEqual((await customer(ctx.fleet.id)).customer.loyalty_points, 50);

  await gerant('POST', `/api/customers/${ctx.person.id}/payments`, { amount: 20, method: 'espèces' });
  let marie = await customer(ctx.person.id);
  assert.strictEqual(marie.customer.loyalty_points, 0, 'paiement partiel : pas encore de combos');
  assert.strictEqual(marie.combos.pending, 40);
  assert.strictEqual(marie.balance, 28);

  // Paid at the pump, during the open shift.
  const pay = await pompiste('POST', `/api/shifts/${ctx.shift.id}/payments`, { customerId: ctx.person.id, amount: 28 });
  assert.strictEqual(pay.data.balance, 0);
  marie = await customer(ctx.person.id);
  assert.strictEqual(marie.customer.loyalty_points, 40);
  assert.strictEqual(marie.combos.pending, 0);

  // Cancelling: the attendant only asks, the manager decides.
  const url = `/api/shifts/${ctx.shift.id}/payments/${pay.data.id}`;
  assert.strictEqual((await pompiste('DELETE', url)).status, 403);
  assert.strictEqual((await pompiste('POST', `${url}/cancel`, { reason: 'Erreur de montant' })).status, 202);
  assert.strictEqual((await pompiste('POST', `${url}/cancel`)).status, 409, 'déjà demandée');
  assert.strictEqual((await customer(ctx.person.id)).customer.loyalty_points, 40, 'toujours compté en attendant le gérant');
  let detail = (await gerant('GET', `/api/shifts/${ctx.shift.id}`)).data;
  assert.strictEqual(detail.pending_cancellations, 1);
  assert.strictEqual(detail.payments.find((p) => p.id === pay.data.id).cancel_reason, 'Erreur de montant');
  assert.ok((await gerant('GET', '/api/dashboard')).data.alerts.some((a) => a.text.includes('annulation demandée')));

  // Refused: the payment stays; asked again and accepted: it goes, with the combos.
  assert.strictEqual((await gerant('POST', `${url}/keep`)).status, 204);
  assert.strictEqual((await gerant('GET', `/api/shifts/${ctx.shift.id}`)).data.pending_cancellations, 0);
  await pompiste('POST', `${url}/cancel`);
  assert.strictEqual((await gerant('DELETE', url)).status, 204);
  assert.strictEqual((await customer(ctx.person.id)).customer.loyalty_points, 0);
  await pompiste('POST', `/api/shifts/${ctx.shift.id}/payments`, { customerId: ctx.person.id, amount: 28 });
});

test('échange de combos contre du carburant, déduit de la caisse', async () => {
  await gerant('PUT', '/api/settings', { comboThreshold: 40, comboValue: 0.05 });
  const nozzle = dieselOf(ctx.shift);
  const sell = (body) => pompiste('POST', `/api/shifts/${ctx.shift.id}/sales`, { nozzleId: nozzle.nozzle_id, customerId: ctx.person.id, payment: 'combo', ...body });

  const tooMuch = await sell({ amount: 5 }); // 100 combos needed, 40 available
  assert.strictEqual(tooMuch.status, 409);

  // 2 $ = 40 combos → 1,67 L at 1,20 $/L.
  const exchange = await sell({ amount: 2 });
  assert.strictEqual(exchange.status, 201);
  assert.strictEqual(exchange.data.kind, 'combo');
  assert.strictEqual(exchange.data.combos_used, 40);
  assert.strictEqual(exchange.data.liters, 1.67);
  assert.strictEqual(exchange.data.points, 0);
  assert.strictEqual((await customer(ctx.person.id)).customer.loyalty_points, 0);

  // Combos désactivés : rien n'est gagné et l'échange est refusé ; réactivés, tout revient.
  assert.strictEqual((await gerant('PUT', '/api/settings', { combosEnabled: false })).data.combosEnabled, false);
  assert.strictEqual((await pompiste('GET', '/api/setup')).data.combosEnabled, false);
  const noEarn = await sell({ amount: 1, payment: 'credit' });
  assert.strictEqual(noEarn.status, 201);
  assert.strictEqual(noEarn.data.points, 0);
  assert.strictEqual(noEarn.data.points_due, 0);
  assert.strictEqual((await sell({ amount: 1 })).status, 409, 'échange refusé');
  assert.strictEqual((await gerant('PUT', '/api/settings', { combosEnabled: true })).data.combosEnabled, true);

  // An expense entered by mistake: its cancellation is asked, still pending at closing time.
  const expense = await pompiste('POST', `/api/shifts/${ctx.shift.id}/expenses`, { category: 'Autre', amount: 3, description: 'Erreur' });
  await pompiste('POST', `/api/shifts/${ctx.shift.id}/expenses/${expense.data.id}/cancel`);

  // 10 L at 1,20 = 12 $ + 28 $ received − 2 $ in combos − 1 $ credit − 3 $ expense = 34 $.
  const closed = await closeShift(ctx.shift, { [nozzle.nozzle_id]: 510 }, { cash: 37 });
  assert.strictEqual(closed.data.combo_amount, 2);
  assert.strictEqual(closed.data.payments_amount, 28);
  assert.strictEqual(closed.data.expected_amount, 34);
  assert.strictEqual(closed.data.variance, 3);

  // The manager decides after the closing; accepting it redoes the reconciliation.
  assert.strictEqual((await gerant('DELETE', `/api/shifts/${ctx.shift.id}/expenses/${expense.data.id}`)).status, 204);
  const after = (await gerant('GET', `/api/shifts/${ctx.shift.id}`)).data;
  assert.strictEqual(after.expected_amount, 37);
  assert.strictEqual(after.variance, 0);
  assert.strictEqual(after.total_amount, 12);
  await gerant('PUT', '/api/settings', { comboThreshold: 100 });
});

test('abonnés : le mois précédent doit être payé avant le jour de paiement de chaque abonné', async () => {
  ctx.shift = (await pompiste('GET', '/api/shifts/current')).data;
  const nozzle = dieselOf(ctx.shift);
  const sale = (await pompiste('POST', `/api/shifts/${ctx.shift.id}/sales`, { nozzleId: nozzle.nozzle_id, customerId: ctx.fleet.id, liters: 10, payment: 'credit' })).data;
  // Last month: this sale; earlier still: the subscriber's first credit (already paid).
  db.prepare("UPDATE sales SET created_at = datetime('now', 'start of month', '-40 days') WHERE customer_id = ? AND id != ?").run(ctx.fleet.id, sale.id);
  db.prepare("UPDATE sales SET created_at = datetime('now', 'start of month', '-3 days') WHERE id = ?").run(sale.id);

  // Each subscriber has their own payment day; the station's setting is only the default of new ones.
  const graceDays = 1;
  assert.strictEqual((await gerant('PUT', `/api/customers/${ctx.fleet.id}`, { paymentDay: 31 })).status, 400);
  assert.strictEqual((await gerant('PUT', `/api/customers/${ctx.fleet.id}`, { paymentDay: graceDays })).data.payment_day, graceDays);
  await gerant('PUT', '/api/settings', { subscriberGraceDays: 20 });
  const fleet = await customer(ctx.fleet.id);
  assert.strictEqual(fleet.customer.payment_day, graceDays, 'le réglage ne change pas un abonné existant');
  assert.strictEqual(fleet.dues.paymentDay, graceDays);
  assert.strictEqual((await customer(ctx.person.id)).customer.payment_day, null, 'un particulier n’a pas de jour de paiement');
  assert.strictEqual(fleet.dues.overdue, 14);
  const late = new Date().getDate() > graceDays;
  assert.strictEqual(fleet.dues.late, late);

  const next = await pompiste('POST', `/api/shifts/${ctx.shift.id}/sales`, { nozzleId: nozzle.nozzle_id, customerId: ctx.fleet.id, liters: 1, payment: 'credit' });
  if (late) {
    assert.strictEqual(next.status, 409);
    assert.match(next.data.error, /retard/);
    const dash = (await gerant('GET', '/api/dashboard')).data;
    assert.ok(dash.alerts.some((a) => a.text.includes('Transports Kivu') && a.text.includes('mois')));
  } else {
    assert.strictEqual(next.status, 201);
  }
  await gerant('POST', `/api/customers/${ctx.fleet.id}/payments`, { amount: 100, method: 'espèces' });
  assert.strictEqual((await customer(ctx.fleet.id)).dues.overdue, 0);
  await gerant('PUT', '/api/settings', { subscriberGraceDays: 5 });
  await gerant('PUT', `/api/customers/${ctx.fleet.id}`, { paymentDay: 5 });
});

test('pompiste : client rapide (particulier), crédit accordé, règlement et dépense', async () => {
  const shift = ctx.shift;
  const nozzle = dieselOf(shift);

  const quick = await pompiste('POST', '/api/customers/quick', { name: 'Garage Mwami' });
  assert.strictEqual(quick.status, 201);
  assert.strictEqual(quick.data.type, 'individual');
  assert.strictEqual((await pompiste('POST', '/api/customers/quick', { name: 'garage mwami' })).data.code, 'duplicate');

  const sale = { customerId: quick.data.id, nozzleId: nozzle.nozzle_id, liters: 100, payment: 'credit' };
  // No credit limit any more: a first credit of any amount goes through, unflagged.
  const granted = await pompiste('POST', `/api/shifts/${shift.id}/sales`, sale);
  assert.strictEqual(granted.status, 201);
  assert.strictEqual(granted.data.over_limit, 0);
  const unpaid = (await pompiste('GET', `/api/customers/${quick.data.id}/unpaid`)).data;
  assert.deepStrictEqual([unpaid.balance, unpaid.credits.length, unpaid.credits[0].user_name, unpaid.credits[0].liters], [granted.data.amount, 1, 'Paul', 100]);

  // The answer was lost and the form sent again: same key, same credit, no duplicate.
  const resend = { customerId: ctx.fleet.id, nozzleId: nozzle.nozzle_id, liters: 1, clientRef: 'pompe-0001-abcd' };
  const first = await pompiste('POST', `/api/shifts/${shift.id}/sales`, resend);
  const again = await pompiste('POST', `/api/shifts/${shift.id}/sales`, resend);
  assert.strictEqual(again.data.id, first.data.id);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM sales WHERE client_ref = 'pompe-0001-abcd'").get().n, 1);

  const exp = await pompiste('POST', `/api/shifts/${shift.id}/expenses`, { category: 'Fournitures', amount: 15, description: 'Eau et savon' });
  assert.strictEqual(exp.status, 201);

  // A customer from before the app pays part of the notebook debt: created on the spot, the old debt declared. No card.
  const payer = await pompiste('POST', '/api/customers/quick', { name: 'Kambale Transport' });
  assert.strictEqual((await pompiste('POST', `/api/shifts/${shift.id}/payments`, { customerId: payer.data.id, amount: 20, method: 'carte' })).status, 400, 'pas de carte');
  const paid = await pompiste('POST', `/api/shifts/${shift.id}/payments`, { customerId: payer.data.id, amount: 20, method: 'mobile money', oldDebt: 50 });
  assert.strictEqual(paid.status, 201);
  assert.strictEqual(paid.data.balance, 30, 'reste 30 $ de l’ancienne dette');
  const kambale = await customer(payer.data.id);
  assert.ok(kambale.movements.some((m) => m.type === 'old_debt' && m.debit === 50));
  assert.strictEqual(kambale.customer.old_debt, 50);
  assert.strictEqual((await gerant('GET', '/api/customers/receivables')).data.rows.find((r) => r.id === payer.data.id).old, 30, 'ancienne dette : plus de 30 jours');
  // The manager adds another notebook debt, then removes it.
  assert.strictEqual((await pompiste('POST', `/api/customers/${payer.data.id}/old-debts`, { amount: 10 })).status, 403);
  assert.strictEqual((await gerant('POST', `/api/customers/${payer.data.id}/old-debts`, { amount: 15, note: 'cahier 2025' })).data.balance, 45);
  const added = (await customer(payer.data.id)).movements.find((m) => m.type === 'old_debt' && m.debit === 15);
  assert.strictEqual((await gerant('DELETE', `/api/customers/${payer.data.id}/old-debts/${added.id}`)).data.balance, 30);
  assert.ok((await gerant('GET', '/api/audit?category=clients')).data.some((a) => a.action === 'old_debt_removed'));
  // Paying more without an old debt: the surplus is an advance (negative balance), used by the next credit.
  assert.strictEqual((await pompiste('POST', `/api/shifts/${shift.id}/payments`, { customerId: payer.data.id, amount: 40 })).data.balance, -10);
  assert.strictEqual((await pompiste('POST', `/api/shifts/${shift.id}/sales`, { customerId: payer.data.id, nozzleId: nozzle.nozzle_id, amount: 6 })).status, 201);
  assert.strictEqual((await customer(payer.data.id)).balance, -4, 'le crédit est pris sur l’avance');

  const dash = (await gerant('GET', '/api/dashboard')).data;
  assert.ok(dash.alerts.some((a) => a.text.includes('à compléter')));

  const done = await gerant('PUT', `/api/customers/${quick.data.id}`, { phone: '+243 970 000 000', type: 'account' });
  assert.strictEqual(done.data.needs_review, 0);
});

test('client : inscription, demande d’achat confirmée en un geste', async () => {
  const moi = client();
  const reg = await moi('POST', '/api/register', { name: 'Jean Bahati', phone: '+243 990 111 222', password: 'jeanbahati' });
  assert.strictEqual(reg.status, 201);
  assert.strictEqual((await moi('POST', '/api/auth/login', { login: '+243 990 111 222', password: 'jeanbahati' })).status, 200);
  assert.strictEqual((await moi('POST', '/api/register', { name: 'X', phone: '+243990111222', password: 'jeanbahati' })).status, 409);

  assert.strictEqual((await moi('POST', '/api/me/requests', { productId: ctx.diesel.id, amount: 5, payment: 'combo' })).status, 400, 'pas assez de combos');
  assert.strictEqual((await moi('POST', '/api/me/requests', { productId: ctx.diesel.id, amount: 5, payment: 'paid' })).status, 400, 'le comptant se paie à la pompe');

  // On credit by default.
  const created = await moi('POST', '/api/me/requests', { productId: ctx.diesel.id, amount: 24, plate: 'GM-123' });
  assert.strictEqual(created.data.status, 'pending');
  assert.strictEqual(created.data.payment, 'credit');
  const mine = (await pompiste('GET', '/api/requests/pending')).data.find((r) => r.id === created.data.id);
  assert.strictEqual(mine.customer_name, 'Jean Bahati');

  const confirmed = await pompiste('POST', `/api/requests/${mine.id}/confirm`, {});
  assert.strictEqual(confirmed.data.liters, 20);
  assert.strictEqual(confirmed.data.kind, 'credit');
  assert.strictEqual(confirmed.data.points_due, 20);
  assert.strictEqual(confirmed.data.source, 'customer');
  assert.strictEqual((await pompiste('POST', `/api/requests/${mine.id}/confirm`, {})).status, 409);
  assert.strictEqual((await moi('GET', '/api/me/requests/current')).data.status, 'confirmed');

  // The manager cancels a sale that came from a request: the request goes with it (no 500).
  assert.strictEqual((await gerant('DELETE', `/api/shifts/${ctx.shift.id}/sales/${confirmed.data.id}`)).status, 204);
  assert.strictEqual(db.prepare('SELECT status FROM purchase_requests WHERE id = ?').get(mine.id).status, 'cancelled');

  const again = (await moi('POST', '/api/me/requests', { productId: ctx.diesel.id, liters: 5 })).data;
  assert.strictEqual((await pompiste('POST', `/api/requests/${again.id}/reject`, { note: 'Client parti' })).status, 204);
  const third = (await moi('POST', '/api/me/requests', { productId: ctx.diesel.id, liters: 5 })).data;
  assert.strictEqual((await moi('DELETE', `/api/me/requests/${third.id}`)).status, 204);

  const account = (await moi('GET', '/api/me/account')).data;
  assert.strictEqual(account.customer.loyalty_points, 0);
  assert.strictEqual(account.combos.threshold, 100);
  assert.strictEqual((await moi('GET', `/api/customers/${ctx.person.id}`)).status, 403);
});

test('accès : un pompiste ne voit pas le poste d’un autre ; mot de passe changé, autres sessions fermées', async () => {
  await gerant('POST', '/api/users', { name: 'Luc', login: 'luc', password: 'pompiste2', role: 'attendant' });
  const luc = client();
  const lucPhone = client();
  await luc('POST', '/api/auth/login', { login: 'luc', password: 'pompiste2' });
  await lucPhone('POST', '/api/auth/login', { login: 'luc', password: 'pompiste2' });
  assert.strictEqual((await luc('GET', `/api/shifts/${ctx.shift.id}`)).status, 403);
  assert.strictEqual((await luc('GET', `/api/shifts/${ctx.shift.id}/report.pdf`)).status, 403);
  assert.strictEqual((await gerant('POST', `/api/shifts/${ctx.shift.id}/constructor/1/keep`)).status, 404, 'type d’opération inconnu');

  assert.strictEqual((await luc('POST', '/api/auth/password', { current: 'pompiste2', password: 'pompiste3' })).status, 200);
  assert.strictEqual((await lucPhone('GET', '/api/auth/me')).status, 401, 'l’autre téléphone est déconnecté');
  assert.strictEqual((await luc('GET', '/api/auth/me')).status, 200, 'la session en cours reste ouverte');
});

test('actionnaire : consulte tout, ne modifie rien', async () => {
  assert.strictEqual((await gerant('POST', '/api/users', { name: 'Awa', login: 'awa', password: 'actionnaire1', role: 'owner' })).status, 201);
  const awa = client();
  await awa('POST', '/api/auth/login', { login: 'awa', password: 'actionnaire1' });
  assert.strictEqual((await awa('GET', '/api/auth/me')).data.user.role, 'owner');
  for (const url of ['/api/dashboard', '/api/shifts', `/api/shifts/${ctx.shift.id}`, '/api/customers', '/api/expenses', '/api/tanks', '/api/cashbook', '/api/audit', '/api/users']) {
    assert.strictEqual((await awa('GET', url)).status, 200, url);
  }
  const refused = await awa('POST', '/api/expenses', { amount: 5, category: 'Divers', description: 'x' });
  assert.strictEqual(refused.status, 403);
  assert.strictEqual(refused.data.code, 'read_only');
  assert.strictEqual((await awa('PUT', '/api/settings', { stationName: 'Autre' })).status, 403);
  const meters = ctx.shift.readings.map((r) => ({ nozzleId: r.nozzle_id, meter: r.start_meter + 1000 }));
  assert.strictEqual((await awa('POST', `/api/shifts/${ctx.shift.id}/checkpoints/preview`, { readings: meters })).status, 200, 'vérifier les compteurs sans rien enregistrer');
  assert.strictEqual((await awa('GET', '/api/backup')).status, 403, 'la sauvegarde reste au gérant');
  assert.strictEqual((await awa('POST', '/api/auth/password', { current: 'actionnaire1', password: 'actionnaire2' })).status, 200, 'son propre mot de passe');
});

test('administrateur : seul à modifier les réglages et la caisse ; le gérant les consulte', async () => {
  assert.strictEqual((await gerant('GET', '/api/auth/me')).data.user.admin, true, 'le compte créé à l’installation est l’administrateur');
  assert.strictEqual((await gerant('POST', '/api/users', { name: 'Chef', login: 'chef', password: 'gerant123', role: 'manager' })).status, 201);
  const chef = client();
  await chef('POST', '/api/auth/login', { login: 'chef', password: 'gerant123' });
  for (const url of ['/api/settings', '/api/cashbook', '/api/users', '/api/products']) assert.strictEqual((await chef('GET', url)).status, 200, url);
  const refused = await chef('PUT', '/api/settings', { stationName: 'Autre' });
  assert.strictEqual(refused.status, 403);
  assert.strictEqual(refused.data.code, 'admin_only');
  assert.strictEqual((await chef('POST', '/api/cashbook/movements', { kind: 'apport', amount: 10 })).status, 403, 'la caisse');
  assert.strictEqual((await chef('POST', '/api/cashbook/counts', { account: 'cash', counted: 10 })).status, 403);
  assert.strictEqual((await chef('PUT', `/api/products/${ctx.diesel.id}`, { price: 9 })).status, 403, 'les prix');
  assert.strictEqual((await chef('POST', '/api/users', { name: 'X', login: 'x', password: 'motdepasse9', role: 'manager' })).status, 403, 'l’équipe');
  assert.strictEqual((await chef('GET', '/api/shifts')).status, 200, 'le reste du travail du gérant');
});

test('le gérant clôture à la place du pompiste (mobile money), puis corrige la clôture', async () => {
  const shift = (await gerant('GET', `/api/shifts/${ctx.shift.id}`)).data;
  const nozzle = dieselOf(shift);
  const start = nozzle.start_meter;
  const stock = () => db.prepare('SELECT book_stock FROM tanks WHERE id = ?').get(nozzle.tank_id).book_stock;
  const meter = () => db.prepare('SELECT meter FROM nozzles WHERE id = ?').get(nozzle.nozzle_id).meter;
  const stockBefore = stock();
  const count = { cash: 15, mobileMoney: 2 };

  const closed = await closeShift(shift, { [nozzle.nozzle_id]: start + 200 }, count);
  assert.strictEqual(closed.status, 200);
  assert.strictEqual(closed.data.variance, Math.round((15 + closed.data.mobile_money - closed.data.expected_amount) * 100) / 100);
  assert.strictEqual(stock(), stockBefore - 200);
  assert.ok((await gerant('GET', '/api/audit?category=postes')).data.some((a) => a.action === 'shift_closed'));

  // The real end index was 250 L further: tank and meter follow the correction, closing time stays.
  const correction = { readings: shift.readings.map((r) => ({ nozzleId: r.nozzle_id, endMeter: r.nozzle_id === nozzle.nozzle_id ? start + 250 : r.start_meter })), ...count };
  assert.strictEqual((await gerant('POST', `/api/shifts/${shift.id}/correct`, correction)).status, 400, 'motif obligatoire');
  assert.strictEqual((await pompiste('POST', `/api/shifts/${shift.id}/correct`, { ...correction, reason: 'x' })).status, 403);
  const fixed = await gerant('POST', `/api/shifts/${shift.id}/correct`, { ...correction, reason: 'Index mal lu' });
  assert.strictEqual(fixed.status, 200);
  assert.strictEqual(fixed.data.total_liters, 250);
  assert.strictEqual(fixed.data.closed_at, closed.data.closed_at);
  assert.strictEqual(stock(), stockBefore - 250);
  assert.strictEqual(meter(), start + 250);
  const next = (await gerant('GET', `/api/shifts/${closed.data.next_shift_id}`)).data;
  assert.strictEqual(dieselOf(next).start_meter, start + 250, 'le poste suivant repart de l’index corrigé');
  assert.ok((await gerant('GET', '/api/audit?category=postes')).data.some((a) => a.action === 'shift_corrected' && a.reason === 'Index mal lu'));
});

test('installation neuve : pas d’inscription client avant le gérant ; origine étrangère refusée', async () => {
  const fresh = createApp({ dbFile: ':memory:' });
  const srv = await new Promise((resolve) => {
    const s = fresh.listen(0, () => resolve(s));
  });
  const url = `http://localhost:${srv.address().port}`;
  const post = (path, body, headers = {}) =>
    fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.strictEqual((await post('/api/register', { name: 'Trop Tôt', phone: '+243990000001', password: 'motdepasse' })).status, 409);
    assert.strictEqual((await (await fetch(`${url}/api/setup`)).json()).needsSetup, true, 'la station reste à configurer');
    assert.strictEqual((await post('/api/auth/login', { login: 'a', password: 'b' }, { Origin: 'https://ailleurs.example' })).status, 403);
    assert.strictEqual((await fetch(`${url}/api/health`)).status, 200);
  } finally {
    srv.close();
  }
});

test('dépenses et rapport avec marge', async () => {
  assert.strictEqual((await pompiste('GET', '/api/expenses')).status, 403);
  const created = await gerant('POST', '/api/expenses', { category: 'Salaires', amount: 300, description: 'Avance Paul', method: 'mobile money' });
  assert.strictEqual(created.data.expense_date, today());
  const list = (await gerant('GET', `/api/expenses?from=${today()}&to=${today()}`)).data;
  assert.strictEqual(list.total, 315);
  const shiftExpense = list.expenses.find((e) => e.shift_id);
  assert.strictEqual((await gerant('DELETE', `/api/expenses/${shiftExpense.id}`)).status, 409);

  const tank = ctx.tanks.find((t) => t.product_name === 'Gasoil');
  await gerant('POST', '/api/deliveries', { tankId: tank.id, litersOrdered: 1000, litersReceived: 1000, unitCost: 1 });
  const rep = (await gerant('GET', `/api/reports/sales?from=${today()}&to=${today()}`)).data;
  assert.strictEqual(rep.totals.expenses, 315);
  assert.strictEqual(rep.totals.combos, 2);
  const diesel = rep.byProduct.find((p) => p.product === 'Gasoil');
  assert.strictEqual(diesel.avg_cost, 1);
  assert.strictEqual(typeof diesel.margin_per_liter, 'number');

  // Variances per attendant: shortages and surpluses apart, shifts beyond the 1 $ tolerance counted.
  const paul = rep.byAttendant.find((a) => a.attendant === 'Paul');
  const variances = rep.shifts.filter((s) => s.attendant === 'Paul').map((s) => s.variance);
  const sum = (list) => Math.round(list.reduce((a, b) => a + b, 0) * 100) / 100;
  assert.ok(variances.includes(-2), 'le premier poste : −2 $');
  assert.strictEqual(paul.shifts, variances.length);
  assert.strictEqual(paul.outside, variances.filter((v) => Math.abs(v) > 1).length);
  assert.strictEqual(paul.shortages, sum(variances.filter((v) => v < 0)));
  assert.strictEqual(paul.surpluses, sum(variances.filter((v) => v > 0)));
  assert.strictEqual(paul.worst, Math.min(...variances));
  assert.ok(rep.stock.some((s) => s.name === 'Cuve Gasoil' && s.delivered >= 1000));
  const theirs = (await gerant('GET', `/api/shifts?attendant=${paul.attendant_id}`)).data;
  assert.ok(theirs.length && theirs.every((s) => s.attendant_name === 'Paul'));

  // The period as a PDF.
  const pdf = await gerant('GET', `/api/reports/period.pdf?from=${today()}&to=${today()}`);
  assert.strictEqual(pdf.status, 200);
  assert.strictEqual(pdf.raw.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.raw.toString('latin1').includes('(\\311carts par pompiste)'));
  // The cash book of the period: both accounts and every movement.
  assert.ok(pdf.raw.toString('latin1').includes('(Mouvements de caisse)'));
  assert.ok(pdf.raw.toString('latin1').includes('(Mobile money)'));
  assert.strictEqual((await pompiste('GET', `/api/reports/period.pdf?from=${today()}&to=${today()}`)).status, 403);

  const res = await fetch(`${baseUrl}/api/reports/sales?from=${today()}&to=${today()}&format=csv`);
  assert.strictEqual(res.status, 401);
});

test('sauvegarde téléchargeable et journal des changements', async () => {
  const backup = await gerant('GET', '/api/backup');
  assert.strictEqual(backup.status, 200);
  assert.strictEqual(backup.raw.subarray(0, 15).toString(), 'SQLite format 3', 'un vrai fichier SQLite');
  assert.strictEqual((await pompiste('GET', '/api/backup')).status, 403);

  await gerant('PUT', `/api/products/${ctx.diesel.id}`, { price: 1.25 });
  const journal = (await gerant('GET', '/api/audit')).data;
  const accepted = journal.find((a) => a.action === 'cancel_accepted');
  assert.ok(accepted, 'annulation acceptée gardée au journal');
  assert.strictEqual(accepted.category, 'annulations');
  assert.ok(journal.some((a) => a.category === 'prix' && a.summary.includes('1,200 → 1,250')));
  assert.ok(journal.some((a) => a.category === 'reglages' && a.summary.includes('programme de combos')));
  assert.ok(journal.some((a) => a.category === 'equipe' && a.summary.includes('mot de passe') === false));
  assert.ok(journal.some((a) => a.category === 'donnees'));
  assert.ok((await gerant('GET', '/api/audit?category=prix')).data.every((a) => a.category === 'prix'));
  assert.strictEqual((await pompiste('GET', '/api/audit')).status, 403);
  const history = (await gerant('GET', `/api/products/${ctx.diesel.id}/history`)).data;
  assert.strictEqual(history[0].price, 1.25);
  assert.strictEqual(history[0].subscriber_price, 1.4, 'le prix abonné est gardé dans l’historique');
});

test('créances par ancienneté, relevé PDF, prix programmé', async () => {
  // Garage Mwami's credit is 40 days old: the first to chase.
  const garage = (await gerant('GET', '/api/customers')).data.find((c) => c.name === 'Garage Mwami');
  db.prepare("UPDATE sales SET created_at = datetime('now', '-40 days') WHERE customer_id = ? AND kind = 'credit'").run(garage.id);
  const receivables = (await gerant('GET', '/api/customers/receivables')).data;
  const row = receivables.rows.find((r) => r.id === garage.id);
  assert.strictEqual(row.old, row.balance, 'tout le solde a plus de 30 jours');
  assert.ok(row.oldest_days >= 40);
  assert.strictEqual(receivables.rows[0].id, garage.id, 'les plus anciennes dettes en premier');
  assert.ok(receivables.totals.balance >= row.balance);
  assert.strictEqual((await pompiste('GET', '/api/customers/receivables')).status, 403);

  const month = today().slice(0, 7);
  const statement = await gerant('GET', `/api/customers/${garage.id}/statement.pdf?month=${month}`);
  assert.strictEqual(statement.status, 200);
  assert.strictEqual(statement.raw.subarray(0, 5).toString(), '%PDF-');
  assert.match(statement.raw.toString('latin1'), /\(Solde au d\\351but du mois\)/);
  const chosen = await gerant('GET', `/api/customers/${garage.id}/statement.pdf?from=${month}-01&to=${today()}`);
  assert.strictEqual(chosen.status, 200);
  assert.match(chosen.raw.toString('latin1'), /\(Solde au d\\351but de la p\\351riode\)/);
  assert.strictEqual((await gerant('GET', `/api/customers/${garage.id}/statement.pdf?from=${today()}&to=${month}-01`)).status, today() === `${month}-01` ? 200 : 400);
  assert.strictEqual((await gerant('GET', '/api/me/statement.pdf')).status, 403);

  // A price scheduled for later does not change today's price; once due, the next read applies it.
  const essence = ctx.products.find((p) => p.name === 'Essence');
  const local = (ms) => new Date(Date.now() + ms).toLocaleString('sv-SE').replace(' ', 'T').slice(0, 16);
  assert.strictEqual((await gerant('PUT', `/api/products/${essence.id}`, { price: 1.6, effectiveAt: local(-3600e3) })).status, 400, 'date passée');
  const scheduled = await gerant('PUT', `/api/products/${essence.id}`, { price: 1.6, subscriberPrice: 1.7, effectiveAt: local(2 * 86400e3) });
  assert.strictEqual(scheduled.data.price, 1.5);
  assert.strictEqual(scheduled.data.next_price, 1.6);
  db.prepare("UPDATE products SET next_price_at = datetime('now', '-1 minute') WHERE id = ?").run(essence.id);
  const now = (await gerant('GET', '/api/products')).data.find((p) => p.id === essence.id);
  assert.strictEqual(now.price, 1.6);
  assert.strictEqual(now.subscriber_price, 1.7);
  assert.strictEqual(now.next_price, null);
  assert.ok((await gerant('GET', '/api/audit?category=prix')).data.some((a) => a.action === 'price_applied'));
});

test('un seul poste à la fois, livre de caisse (espèces et mobile money), livraisons à crédit', async () => {
  const cash = async () => (await gerant('GET', '/api/cashbook')).data.balances;
  // Timestamps are to the second: the count is taken apart from what came before and after.
  await nextSecond();
  assert.strictEqual((await gerant('POST', '/api/cashbook/movements', { kind: 'opening', account: 'cash', amount: 100 })).status, 201);
  await gerant('POST', '/api/cashbook/movements', { kind: 'opening', account: 'momo', amount: 0 });
  await nextSecond();
  assert.strictEqual((await cash()).cash.balance, 100, 'le livre part du comptage');

  // One shift for the whole station, always open: a second attendant joins it, nobody opens another.
  const open = (await gerant('GET', '/api/shifts/open')).data;
  assert.ok(open, 'toujours un poste ouvert');
  await gerant('POST', '/api/users', { name: 'Béa', login: 'bea', password: 'pompiste9', role: 'attendant' });
  const bea = client();
  await bea('POST', '/api/auth/login', { login: 'bea', password: 'pompiste9' });
  const refused = await bea('POST', '/api/shifts', {});
  assert.strictEqual(refused.status, 409);
  assert.strictEqual(refused.data.code, 'shift_open');
  assert.strictEqual((await bea('POST', `/api/shifts/${open.id}/sales`, {})).data.code, 'not_on_duty');
  await bea('POST', `/api/shifts/${open.id}/join`);
  assert.ok((await gerant('GET', '/api/shifts/open')).data.on_duty.includes('Béa'));
  ctx.bea = bea;

  // Cash handed over goes into the till, mobile money into its own balance.
  const running = (await gerant('GET', `/api/shifts/${open.id}`)).data;
  await bea('POST', `/api/shifts/${open.id}/momo`, { productId: ctx.diesel.id, liters: 25 }); // 25 L at 1,20 = 30 $
  await bea('POST', `/api/shifts/${open.id}/expenses`, { category: 'Fournitures', amount: 5, description: 'Eau' }); // paid from the till
  await closeShift(running, Object.fromEntries(running.readings.map((r) => [r.nozzle_id, r.start_meter + 100])), { cash: 50 });
  let b = await cash();
  assert.strictEqual(b.cash.balance, 150);
  assert.strictEqual(b.momo.balance, 30);
  // Mobile money only reaches the till when withdrawn.
  await gerant('POST', '/api/cashbook/movements', { kind: 'retrait_momo', amount: 15 });
  assert.strictEqual((await gerant('POST', '/api/cashbook/movements', { kind: 'versement_banque', account: 'momo', amount: 1 })).status, 400);
  b = await cash();
  assert.strictEqual(b.cash.balance, 165);
  assert.strictEqual(b.momo.balance, 15);
  // The manager's cash expense and a payment received by the manager.
  await gerant('POST', '/api/expenses', { category: 'Fournitures', amount: 10, description: 'Ampoules', method: 'espèces' });
  await gerant('POST', `/api/customers/${ctx.person.id}/payments`, { amount: 5, method: 'espèces' });
  assert.strictEqual((await cash()).cash.balance, 160);

  // A delivery paid on the spot leaves the till; one on credit is a debt to the supplier.
  const tank = ctx.tanks[0];
  await gerant('POST', '/api/deliveries', { tankId: tank.id, litersOrdered: 30, litersReceived: 30, unitCost: 1, payment: 'cash', payMethod: 'mobile money' });
  assert.strictEqual((await cash()).cash.balance, 130, 'payée comptant : toujours en espèces, jamais en mobile money');
  // The manager works the pump too: always on duty on « Mon poste ».
  assert.strictEqual((await gerant('GET', '/api/shifts/state')).data.onDuty, true);
  assert.strictEqual((await gerant('POST', '/api/deliveries', { tankId: tank.id, litersOrdered: 100, litersReceived: 100, unitCost: 1.1, payment: 'credit' })).status, 400, 'fournisseur obligatoire');
  await gerant('POST', '/api/deliveries', { tankId: tank.id, litersOrdered: 100, litersReceived: 100, unitCost: 1.1, payment: 'credit', supplier: 'Total Goma' });
  assert.strictEqual((await cash()).cash.balance, 130, 'à crédit : rien ne sort de la caisse');
  let sup = (await gerant('GET', '/api/suppliers')).data.suppliers.find((s) => s.name === 'Total Goma');
  assert.strictEqual(sup.balance, 110);
  assert.ok((await gerant('GET', '/api/dashboard')).data.alerts.some((a) => a.text.includes('fournisseurs')));
  const paid = await gerant('POST', '/api/suppliers/payments', { supplier: 'total goma', amount: 60, method: 'espèces' });
  sup = paid.data.suppliers.find((s) => s.name === 'Total Goma');
  assert.strictEqual(sup.balance, 50, 'même fournisseur, quelle que soit la casse');
  assert.strictEqual((await cash()).cash.balance, 70);

  // Counting the till keeps the gap; the book and its PDF.
  const counted = await gerant('POST', '/api/cashbook/counts', { account: 'cash', counted: 69 });
  assert.strictEqual(counted.data.balances.cash.lastCount.diff, -1);
  const book = (await gerant('GET', '/api/cashbook?account=cash')).data;
  assert.ok(book.movements.some((m) => m.source === 'shift') && book.movements.some((m) => m.source === 'supplier_payment'));
  // The attendant's expenses show in the book, the shift coming in before them.
  const spent = book.movements.find((m) => m.source === 'expense' && m.label.includes('du poste n°'));
  assert.ok(spent, 'dépense du pompiste dans la caisse');
  const its = book.movements.find((m) => m.source === 'shift' && spent.link === m.link);
  assert.ok(its && its.label.includes('dépenses du poste'));
  assert.strictEqual(book.days.at(-1).end, 70);
  const pdf = await gerant('GET', '/api/cashbook.pdf');
  assert.strictEqual(pdf.raw.subarray(0, 5).toString(), '%PDF-');
  assert.strictEqual((await pompiste('GET', '/api/cashbook')).status, 403);
  assert.ok((await gerant('GET', '/api/audit?category=caisse')).data.some((a) => a.action === 'supplier_payment'));

  // Old deliveries entered to set the stock: « déjà payée » leaves nothing in the till, and the
  // payment of one can be corrected afterwards (here 3 300 $ still owed to the supplier).
  const before = (await cash()).cash.balance;
  const old = (await gerant('POST', '/api/deliveries', { tankId: tank.id, litersOrdered: 50, litersReceived: 50, unitCost: 1, payment: 'prepaid' })).data;
  assert.strictEqual((await cash()).cash.balance, before, 'déjà payée : rien ne sort de la caisse');
  const cashOld = (await gerant('POST', '/api/deliveries', { tankId: tank.id, litersOrdered: 40, litersReceived: 40, unitCost: 1, payment: 'cash' })).data;
  assert.strictEqual((await cash()).cash.balance, before - 40);
  assert.strictEqual((await gerant('PUT', `/api/deliveries/${cashOld.id}`, { payment: 'credit', amount: 3300 })).status, 400, 'fournisseur obligatoire');
  const fixed = await gerant('PUT', `/api/deliveries/${cashOld.id}`, { payment: 'credit', supplier: 'Ancien Fournisseur', amount: 3300 });
  assert.strictEqual(fixed.status, 200);
  assert.strictEqual((await cash()).cash.balance, before, 'corrigée : la sortie de caisse disparaît');
  sup = (await gerant('GET', '/api/suppliers')).data.suppliers.find((s) => s.name === 'Ancien Fournisseur');
  assert.strictEqual(sup.balance, 3300);
  assert.strictEqual((await gerant('PUT', `/api/deliveries/${old.id}`, { payment: 'prepaid' })).data.payment, 'prepaid');
  assert.ok((await gerant('GET', '/api/audit?category=donnees')).data.some((a) => a.action === 'delivery_payment'));
  assert.strictEqual((await pompiste('PUT', `/api/deliveries/${old.id}`, { payment: 'cash' })).status, 403);
});

test('relève, fermeture du soir et ouverture du matin : le poste continue', async () => {
  const bea = ctx.bea;
  const shift = (await pompiste('GET', '/api/shifts/state')).data.shift;
  await pompiste('POST', `/api/shifts/${shift.id}/join`);
  await bea('POST', `/api/shifts/${shift.id}/join`);
  assert.deepStrictEqual((await gerant('GET', `/api/shifts/${shift.id}`)).data.on_duty.sort(), ['Béa', 'Paul'], 'deux pompistes sur le même poste');
  const diesel = dieselOf(shift);
  const at = (dieselLiters) => shift.readings.map((r) => ({ nozzleId: r.nozzle_id, meter: r.start_meter + (r.nozzle_id === diesel.nozzle_id ? dieselLiters : 0) }));
  await nextSecond();

  // Paul enters a credit, then hands over: the mini report says what he should pass on.
  const kambale = (await pompiste('POST', '/api/customers/quick', { name: 'Client Relève' })).data;
  const credit = (await pompiste('POST', `/api/shifts/${shift.id}/sales`, { customerId: kambale.id, nozzleId: diesel.nozzle_id, amount: 6 })).data;
  assert.ok(credit.user_id, 'le crédit garde le nom du pompiste');
  const preview = (await pompiste('POST', `/api/shifts/${shift.id}/checkpoints/preview`, { kind: 'releve', readings: at(20) })).data;
  assert.strictEqual(preview.liters, 20);
  assert.strictEqual(preview.credits, 6);
  assert.strictEqual(preview.expected, Math.round((20 * diesel.unit_price - 6) * 100) / 100);
  const relief = await pompiste('POST', `/api/shifts/${shift.id}/checkpoints`, { kind: 'releve', readings: at(20), cash: preview.expected });
  assert.strictEqual(relief.status, 201);
  assert.strictEqual(relief.data.report.variance, 0);
  // Béa is on duty too: she gets Paul's mini report on her phone, once; Paul does not.
  const unseen = (await bea('GET', '/api/shifts/reports/unseen')).data;
  assert.deepStrictEqual(unseen.map((r) => [r.id, r.kind, r.by]), [[relief.data.report.id, 'releve', 'Paul']]);
  assert.deepStrictEqual((await pompiste('GET', '/api/shifts/reports/unseen')).data, []);
  assert.strictEqual((await bea('POST', `/api/shifts/reports/${relief.data.report.id}/seen`)).status, 200);
  assert.deepStrictEqual((await bea('GET', '/api/shifts/reports/unseen')).data, []);
  assert.strictEqual((await pompiste('POST', `/api/shifts/${shift.id}/sales`, { customerId: kambale.id, nozzleId: diesel.nozzle_id, amount: 1 })).data.code, 'not_on_duty', 'parti en pause');
  assert.strictEqual((await pompiste('POST', `/api/shifts/${shift.id}/checkpoints`, { kind: 'releve', readings: at(10) })).status, 403);
  await nextSecond();

  // Béa carries on with the money Paul passed on, then closes the station at 19:00.
  assert.strictEqual((await bea('POST', `/api/shifts/${shift.id}/checkpoints`, { kind: 'fermeture', readings: at(10) })).status, 400, 'index plus bas que le dernier relevé');
  // 5 L paid by mobile money: they stay on the station's account, the cash counted is the rest.
  const momo = (await bea('POST', `/api/shifts/${shift.id}/momo`, { productId: diesel.product_id, liters: 5 })).data.amount;
  const evening = await bea('POST', `/api/shifts/${shift.id}/checkpoints`, { kind: 'fermeture', readings: at(30), cash: Math.round((preview.expected + 10 * diesel.unit_price - momo) * 100) / 100 });
  assert.strictEqual(evening.status, 201);
  // Every report counts from the shift's opening: its indexes, the change it received, all its operations.
  assert.strictEqual(evening.data.report.received, 0);
  assert.strictEqual(evening.data.report.liters, 30, 'depuis l’ouverture du poste');
  assert.strictEqual(evening.data.report.credits, 6);
  assert.strictEqual(evening.data.report.nozzles.find((n) => n.nozzle_id === diesel.nozzle_id).from, diesel.start_meter);
  assert.strictEqual(evening.data.report.mobile_money, momo);
  assert.strictEqual(evening.data.report.expected_cash, evening.data.report.cash);
  assert.strictEqual(evening.data.report.variance, 0);
  assert.ok(evening.data.shift.station_closed_at);
  assert.strictEqual(evening.data.shift.status, 'open', 'la fermeture ne clôture pas le poste');
  assert.strictEqual((await bea('POST', `/api/shifts/${shift.id}/join`)).data.code, 'station_closed');
  await nextSecond();

  // Paul opens in the morning: same indexes, same money; the shift continues.
  const state = (await pompiste('GET', '/api/shifts/state')).data;
  assert.strictEqual(state.lastReport.kind, 'fermeture');
  const morning = await pompiste('POST', `/api/shifts/${shift.id}/checkpoints`, { kind: 'ouverture', readings: at(30), cash: evening.data.report.cash });
  assert.strictEqual(morning.status, 201);
  assert.strictEqual(morning.data.report.liters, 30, 'depuis l’ouverture du poste');
  assert.strictEqual(morning.data.report.variance, 0);
  assert.strictEqual(morning.data.shift.station_closed_at, null);
  assert.deepStrictEqual(morning.data.shift.on_duty, ['Paul']);
  assert.strictEqual(morning.data.shift.checkpoints.length, 3);

  // 15:30: the manager closes; the next shift opens with Paul on it.
  assert.strictEqual((await gerant('PUT', `/api/nozzles/${diesel.nozzle_id}`, { meter: 99999 })).status, 409, 'index déjà relevé sur ce poste');
  const done = await closeShift(morning.data.shift, Object.fromEntries(at(30).map((r) => [r.nozzleId, r.meter])), { cash: 0 });
  assert.strictEqual(done.status, 200);
  assert.strictEqual(done.data.total_liters, 30);
  const next = (await pompiste('GET', '/api/shifts/state')).data;
  assert.strictEqual(next.shift.id, done.data.next_shift_id);
  assert.strictEqual(next.onDuty, true);
  assert.strictEqual((await pompiste('POST', `/api/shifts/${next.shift.id}/close`, {})).status, 403, 'le pompiste ne clôture jamais');
  // The manager's state of the shift: who entered what, and a reading of the meters without saving it.
  const live = await gerant('POST', `/api/shifts/${next.shift.id}/checkpoints/preview`, { readings: next.shift.readings.map((r) => ({ nozzleId: r.nozzle_id, meter: r.start_meter + 5 })) });
  assert.strictEqual(live.status, 200);
  assert.strictEqual(live.data.liters, 5 * next.shift.readings.length);
  assert.strictEqual((await gerant('GET', `/api/shifts/${next.shift.id}`)).data.checkpoints.length, 0, 'le contrôle n’enregistre rien');
  assert.strictEqual((await gerant('GET', `/api/shifts/${shift.id}`)).data.sales.find((s) => s.id === credit.id).user_name, 'Paul');
  assert.strictEqual(dieselOf(next.shift).start_meter, diesel.start_meter + 30);

  // The station's starting index, set while the shift is open and nothing read yet: the shift starts from it.
  const set = await gerant('PUT', `/api/nozzles/${diesel.nozzle_id}`, { meter: 96677.58 });
  assert.strictEqual(set.status, 200);
  assert.strictEqual(dieselOf((await gerant('GET', `/api/shifts/${next.shift.id}`)).data).start_meter, 96677.58);
  assert.ok((await gerant('GET', '/api/audit?category=reglages')).data.some((a) => a.summary.includes('96677.58') && a.summary.includes(`poste n°${next.shift.id}`)));
});

test('tests de pompe : remis en cuve une fois approuvés par le gérant, pas vendus', async () => {
  const shift = (await pompiste('GET', '/api/shifts/state')).data.shift;
  const diesel = dieselOf(shift);
  const stock = async () => (await gerant('GET', '/api/tanks')).data.find((t) => t.id === diesel.tank_id).book_stock;
  const before = await stock();

  // The attendant enters two tests: they wait for the manager. Sending one again changes nothing.
  const t1 = await pompiste('POST', `/api/shifts/${shift.id}/tests`, { nozzleId: diesel.nozzle_id, liters: 20, note: 'étalonnage', clientRef: 'test-pompe-1' });
  assert.strictEqual(t1.status, 201);
  assert.strictEqual(t1.data.status, 'pending');
  assert.strictEqual((await pompiste('POST', `/api/shifts/${shift.id}/tests`, { nozzleId: diesel.nozzle_id, liters: 20, clientRef: 'test-pompe-1' })).data.id, t1.data.id);
  const t2 = (await pompiste('POST', `/api/shifts/${shift.id}/tests`, { nozzleId: diesel.nozzle_id, liters: 5 })).data;
  const t3 = (await pompiste('POST', `/api/shifts/${shift.id}/tests`, { nozzleId: diesel.nozzle_id, liters: 3 })).data;
  assert.ok((await gerant('GET', '/api/dashboard')).data.alerts.some((a) => a.text.includes('tests de pompe') && a.link === `#/postes/${shift.id}`));
  assert.strictEqual((await pompiste('POST', `/api/shifts/${shift.id}/tests/${t1.data.id}/decide`, { approve: true })).status, 403, 'seul le gérant approuve');

  // Approved before the closing: 50 L on the meter, 20 L back in the tank, 30 L sold.
  assert.strictEqual((await gerant('POST', `/api/shifts/${shift.id}/tests/${t1.data.id}/decide`, { approve: true })).status, 200);
  const closed = await closeShift(shift, { [diesel.nozzle_id]: diesel.start_meter + 50 }, { cash: 0 });
  assert.strictEqual(closed.status, 200);
  assert.strictEqual(dieselOf(closed.data).liters, 30);
  assert.strictEqual(dieselOf(closed.data).tested, 20);
  assert.strictEqual(await stock(), Math.round((before - 30) * 100) / 100);

  // The second, approved after the closing: the shift is recomputed (5 L less sold, back in the tank).
  const expected = closed.data.expected_amount;
  const approved = (await gerant('POST', `/api/shifts/${shift.id}/tests/${t2.id}/decide`, { approve: true })).data;
  assert.strictEqual(dieselOf(approved).liters, 25);
  assert.strictEqual(approved.expected_amount, Math.round((expected - 5 * diesel.unit_price) * 100) / 100);
  assert.strictEqual(await stock(), Math.round((before - 25) * 100) / 100);
  // Decided once: a confirmed test can not change any more. A cancelled one stays sold.
  assert.strictEqual((await gerant('POST', `/api/shifts/${shift.id}/tests/${t2.id}/decide`, { approve: false })).status, 409);
  const refused = (await gerant('POST', `/api/shifts/${shift.id}/tests/${t3.id}/decide`, { approve: false })).data;
  assert.strictEqual(dieselOf(refused).liters, 25);
  assert.strictEqual(refused.pump_tests.find((t) => t.id === t3.id).status, 'rejected');
  assert.ok((await gerant('GET', '/api/audit?category=postes')).data.some((a) => a.action === 'pump_test_approved'));
  assert.strictEqual((await gerant('GET', `/api/shifts/${shift.id}/report.pdf`)).raw.subarray(0, 5).toString(), '%PDF-');

  // More litres approved than the meter counted: refused.
  const big = (await pompiste('POST', `/api/shifts/${shift.id}/tests`, { nozzleId: diesel.nozzle_id, liters: 1 })).status;
  assert.strictEqual(big, 409, 'poste clôturé : plus de saisie');
  const next = (await gerant('GET', `/api/shifts/${closed.data.next_shift_id}`)).data;
  const own = await gerant('POST', `/api/shifts/${next.id}/tests`, { nozzleId: diesel.nozzle_id, liters: 10 });
  assert.strictEqual(own.data.status, 'approved', 'saisi par le gérant : approuvé d’office');
  const tooMuch = await closeShift(next, { [diesel.nozzle_id]: dieselOf(next).start_meter + 4 }, { cash: 0 });
  assert.strictEqual(tooMuch.status, 400);
  assert.match(tooMuch.data.error, /tests de pompe/);
});

test('monnaie laissée aux pompistes, dépense du pompiste dans la caisse, cuves du rapport', async () => {
  const shift = (await gerant('GET', `/api/shifts/${(await gerant('GET', '/api/shifts/open')).data.id}`)).data;
  const diesel = dieselOf(shift);
  const ends = { [diesel.nozzle_id]: diesel.start_meter + 20 }; // 10 L of it went back in after a test
  const book = async () => (await gerant('GET', '/api/cashbook')).data;

  // The attendant's expense shows in the cash book as soon as it is entered.
  const spent = (await pompiste('POST', `/api/shifts/${shift.id}/expenses`, { category: 'Fournitures', amount: 3, description: 'Savon' })).data;
  assert.ok((await book()).movements.some((m) => m.source === 'expense' && m.id === spent.id && m.out === 3), 'sortie visible tout de suite');

  // The change left stays with the attendants: the cash handed over is the rest, and the gap counts both.
  const before = (await book()).balances.cash.balance;
  const closed = (await closeShift(shift, ends, { cash: 30, changeLeft: 20 })).data;
  assert.strictEqual(closed.change_left, 20);
  assert.strictEqual(closed.variance, Math.round((30 + 20 + closed.mobile_money - closed.expected_amount) * 100) / 100);
  // The till gets the cash handed over (the expense already went out): 30 + 3.
  const after = await book();
  assert.strictEqual(after.balances.cash.balance, Math.round((before + 30 + 3) * 100) / 100);
  assert.ok(after.movements.find((m) => m.source === 'shift' && m.id === shift.id).label.includes('monnaie laissée'));

  // The next shift starts with the change: its first relief and its closing count it.
  const next = (await gerant('GET', `/api/shifts/${closed.next_shift_id}`)).data;
  assert.strictEqual(next.change_received, 20);
  const preview = await gerant('POST', `/api/shifts/${next.id}/checkpoints/preview`, { readings: next.readings.map((r) => ({ nozzleId: r.nozzle_id, meter: r.start_meter })) });
  assert.strictEqual(preview.data.received, 20);
  const second = (await closeShift(next, {}, { cash: 20 })).data;
  assert.strictEqual(second.expected_amount, 20);
  assert.strictEqual(second.variance, 0);

  // The tanks as the shift left them, in its detail and its report.
  assert.ok(closed.tanks.length >= 2);
  assert.strictEqual(closed.tanks.find((t) => t.tank_id === diesel.tank_id).sold, 10);
  const pdf = await gerant('GET', `/api/shifts/${shift.id}/report.pdf`);
  assert.strictEqual(pdf.raw.subarray(0, 5).toString(), '%PDF-');
});

test('clôture en deux temps : les index d’abord, l’argent ensuite', async () => {
  const open = (await gerant('GET', '/api/shifts/current')).data;
  const closed = (await gerant('POST', `/api/shifts/${open.id}/close`, { readings: open.readings.map((r) => ({ nozzleId: r.nozzle_id, endMeter: r.start_meter + 10 })) })).data;
  assert.strictEqual(closed.counted_at, null, 'argent pas encore compté');
  assert.strictEqual(closed.variance, null);
  assert.ok(closed.next_shift_id, 'le poste suivant est ouvert aussitôt');
  assert.ok((await gerant('GET', '/api/dashboard')).data.alerts.some((a) => a.text === `Poste n°${open.id} : argent à compter`));
  assert.strictEqual((await gerant('GET', `/api/shifts/${open.id}/report.pdf`)).status, 200);
  const cash = Math.round((closed.expected_amount - 5 - closed.mobile_money) * 100) / 100;
  const counted = (await gerant('POST', `/api/shifts/${open.id}/count`, { cash, changeLeft: 5 })).data;
  assert.ok(counted.counted_at);
  assert.strictEqual(counted.variance, 0);
  assert.strictEqual((await gerant('GET', `/api/shifts/${closed.next_shift_id}`)).data.change_received, 5, 'la monnaie passe au poste en cours');
  assert.strictEqual((await gerant('POST', `/api/shifts/${open.id}/count`, { cash: 1 })).status, 409, 'compté une seule fois');
  assert.strictEqual((await gerant('POST', `/api/shifts/${open.id}/correct`, { reason: 'x', readings: [] })).status, 400, 'une correction redonne l’argent');

  // Forgotten operations, added by the manager after the closing: the shift is recomputed.
  assert.strictEqual((await gerant('POST', `/api/shifts/${open.id}/expenses`, { amount: 5, category: 'Autre', description: 'Oubliée' })).status, 201);
  assert.strictEqual((await gerant('GET', `/api/shifts/${open.id}`)).data.variance, 5, 'la dépense oubliée explique un surplus');
  await gerant('POST', `/api/shifts/${open.id}/momo`, { productId: ctx.diesel.id, liters: 2 });
  const late = (await gerant('GET', `/api/shifts/${open.id}`)).data;
  assert.ok(late.mobile_money > closed.mobile_money, 'le mobile money oublié compte');
  assert.ok((await gerant('GET', '/api/audit?category=postes')).data.some((a) => a.summary.startsWith(`Oubli ajouté au poste n°${open.id}`)));
  assert.strictEqual((await pompiste('POST', `/api/shifts/${open.id}/expenses`, { amount: 1, category: 'Autre', description: 'x' })).status, 409, 'le pompiste n’ajoute rien à un poste clôturé');

  // An operation entered wrongly: the manager corrects it, the closed shift is recomputed.
  const expense = (await gerant('GET', `/api/shifts/${open.id}`)).data.expenses.find((e) => e.description === 'Oubliée');
  const fixed = await gerant('PUT', `/api/shifts/${open.id}/expenses/${expense.id}`, { amount: 8, description: 'Oubliée (8 $)' });
  assert.strictEqual(fixed.status, 200);
  assert.strictEqual(fixed.data.amount, 8);
  assert.strictEqual((await gerant('GET', `/api/shifts/${open.id}`)).data.expenses_amount, round2(closed.expenses_amount + 8));
  const momoRow = (await gerant('GET', `/api/shifts/${open.id}`)).data.momo.at(-1);
  assert.strictEqual((await gerant('PUT', `/api/shifts/${open.id}/momo/${momoRow.id}`, { liters: 4 })).data.liters, 4);
  assert.ok((await gerant('GET', '/api/audit?category=postes')).data.some((a) => a.summary.startsWith(`Opération corrigée par le gérant, poste n°${open.id}`)));
  assert.strictEqual((await pompiste('PUT', `/api/shifts/${open.id}/expenses/${expense.id}`, { amount: 1 })).status, 403, 'le gérant seul corrige');
});

test('particulier : pas de nouveau crédit avant paiement du précédent ; livre de caisse par entrées ou sorties', async () => {
  const open = (await gerant('GET', '/api/shifts/current')).data;
  const c = (await gerant('POST', '/api/customers/quick', { name: 'Jean Particulier' })).data;
  assert.strictEqual((await gerant('POST', `/api/shifts/${open.id}/sales`, { customerId: c.id, productId: ctx.diesel.id, amount: 10 })).status, 201);
  const second = await gerant('POST', `/api/shifts/${open.id}/sales`, { customerId: c.id, productId: ctx.diesel.id, amount: 5 });
  assert.strictEqual(second.status, 409);
  assert.strictEqual(second.data.code, 'has_credit');
  assert.match(second.data.error, /déjà un crédit non payé de 10,00/);
  assert.strictEqual((await gerant('POST', `/api/shifts/${open.id}/sales`, { customerId: c.id, productId: ctx.diesel.id, amount: 5, grantCredit: true })).status, 409, 'personne ne peut l’accorder');
  // A credit entered wrongly: 10 $ instead of 4 $, corrected by the manager.
  const sale = (await gerant('GET', `/api/shifts/${open.id}`)).data.sales.find((s) => s.customer_id === c.id);
  const corrected = (await gerant('PUT', `/api/shifts/${open.id}/sales/${sale.id}`, { amount: 4 })).data;
  assert.strictEqual(corrected.amount, 4);
  assert.strictEqual((await customer(c.id)).customer.balance, 4, 'le solde du client suit');

  for (const part of ['all', 'in', 'out']) {
    const pdf = await gerant('GET', `/api/cashbook.pdf?part=${part}&from=2026-01-01&to=2026-12-31`);
    assert.strictEqual(pdf.status, 200, part);
    assert.ok(pdf.raw.subarray(0, 5).toString() === '%PDF-');
  }
  assert.strictEqual((await gerant('GET', '/api/cashbook.pdf?part=tout')).status, 400);
  assert.strictEqual((await gerant('GET', '/api/cashbook.pdf?from=2026-02-01&to=2026-01-01')).status, 400);
});

test('livraison pendant le poste : le carburant déjà vendu (index) sort du stock ; fournisseurs et coordonnées', async () => {
  const shift = (await gerant('GET', '/api/shifts/current')).data;
  const diesel = dieselOf(shift);
  const tank = (await gerant('GET', '/api/tanks')).data.find((t) => t.id === diesel.tank_id);
  const m = (await gerant('GET', '/api/stock/meters')).data.find((x) => x.nozzleId === diesel.nozzle_id);
  assert.strictEqual(m.tankId, tank.id);

  // 400 L sold since the opening: without the index the tank would overflow; with it, it fits.
  const room = round2(tank.capacity - tank.book_stock);
  const delivery = { tankId: tank.id, litersOrdered: room + 100, litersReceived: room + 100, payment: 'credit', unitCost: 1, supplier: 'Engen Goma' };
  const over = await gerant('POST', '/api/deliveries', delivery);
  assert.strictEqual(over.status, 409);
  assert.strictEqual(over.data.code, 'over_capacity');
  assert.strictEqual((await gerant('POST', '/api/deliveries', { ...delivery, meters: [{ nozzleId: diesel.nozzle_id, meter: m.latest - 1 }] })).status, 400, 'index en arrière');
  const meter = round2(m.latest + 400);
  const ok = await gerant('POST', '/api/deliveries', { ...delivery, meters: [{ nozzleId: diesel.nozzle_id, meter }] });
  assert.strictEqual(ok.status, 201);
  assert.strictEqual(ok.data.book_before, round2(tank.book_stock - 400));
  const stock = async () => (await gerant('GET', '/api/tanks')).data.find((t) => t.id === tank.id).book_stock;
  assert.strictEqual(await stock(), round2(tank.capacity - 300), 'stock réel : jamais au-dessus de la capacité');

  // A dip during the shift compares with the stock now, and the closing takes the 400 L off only once.
  const dip = (await gerant('POST', '/api/dips', { tankId: tank.id, measured: round2(tank.capacity - 310) })).data;
  assert.strictEqual(dip.variance, -10);
  assert.strictEqual((await closeShift(shift, { [diesel.nozzle_id]: meter - 1 })).status, 400, 'pas sous l’index de la livraison');
  assert.strictEqual((await closeShift(shift, { [diesel.nozzle_id]: meter })).status, 200);
  assert.strictEqual(await stock(), round2(tank.capacity - 310));

  // Suppliers: the admin keeps their contacts and may rename them; the debt follows the name.
  let sup = (await gerant('GET', '/api/suppliers')).data.suppliers.find((s) => s.name === 'Engen Goma');
  assert.ok(sup.id);
  assert.strictEqual(sup.balance, room + 100);
  const chef = client();
  await chef('POST', '/api/auth/login', { login: 'chef', password: 'gerant123' });
  assert.strictEqual((await chef('PUT', `/api/suppliers/${sup.id}`, { phone: '0990000000' })).data.code, 'admin_only');
  assert.strictEqual((await gerant('POST', '/api/suppliers', { name: 'engen goma' })).data.code, 'duplicate');
  const renamed = await gerant('PUT', `/api/suppliers/${sup.id}`, { name: 'Engen RDC', phone: '+243 990 000 000', email: 'goma@engen.cd' });
  assert.strictEqual(renamed.status, 200);
  sup = (await gerant('GET', '/api/suppliers')).data.suppliers.find((s) => s.id === sup.id);
  assert.deepStrictEqual([sup.name, sup.phone, sup.email, sup.balance], ['Engen RDC', '+243 990 000 000', 'goma@engen.cd', room + 100]);
  assert.ok((await gerant('GET', '/api/deliveries')).data.some((d) => d.supplier === 'Engen RDC'));
  assert.strictEqual((await gerant('POST', '/api/suppliers', { name: 'Petro Kivu', phone: '0810000000' })).status, 201);
  assert.ok((await gerant('GET', '/api/suppliers')).data.names.includes('Petro Kivu'));
});

test('livraison payée avec l’argent du poste : une dépense du poste ouvert', async () => {
  const shift = (await gerant('GET', '/api/shifts/current')).data;
  const tank = (await gerant('GET', '/api/tanks')).data.find((t) => t.id === dieselOf(shift).tank_id);
  const body = { tankId: tank.id, litersOrdered: 5, litersReceived: 5, payment: 'shift', supplier: 'Petro Kivu', reference: 'BL-77' };
  assert.strictEqual((await gerant('POST', '/api/deliveries', body)).status, 400, 'prix d’achat obligatoire');
  assert.strictEqual((await gerant('POST', '/api/deliveries', { ...body, unitCost: 1, supplier: '' })).status, 400, 'fournisseur obligatoire');
  const d = (await gerant('POST', '/api/deliveries', { ...body, unitCost: 1 })).data;
  const expense = async () => (await gerant('GET', '/api/expenses')).data.expenses.find((e) => e.id === d.expense_id);
  assert.ok(d.expense_id);
  let e = await expense();
  assert.deepStrictEqual([e.category, e.amount, e.shift_id, e.beneficiary, e.reference, e.method], ['Paiement fournisseur', 5, shift.id, 'Petro Kivu', 'BL-77', 'espèces']);

  // The amount follows the delivery; another payment takes the expense off the shift, and back.
  await gerant('PUT', `/api/deliveries/${d.id}`, { payment: 'shift', amount: 6 });
  assert.strictEqual((await expense()).amount, 6);
  const cash = (await gerant('PUT', `/api/deliveries/${d.id}`, { payment: 'cash' })).data;
  assert.strictEqual(cash.expense_id, null);
  assert.strictEqual(await expense(), undefined);
  const again = (await gerant('PUT', `/api/deliveries/${d.id}`, { payment: 'shift' })).data;
  e = (await gerant('GET', '/api/expenses')).data.expenses.find((x) => x.id === again.expense_id);
  assert.deepStrictEqual([e.amount, e.shift_id], [6, shift.id]);
  // The expense cancelled from the shift: the delivery waits for its payment.
  assert.strictEqual((await gerant('DELETE', `/api/shifts/${shift.id}/expenses/${e.id}`)).status, 204);
  const left = (await gerant('GET', '/api/deliveries')).data.find((x) => x.id === d.id);
  assert.deepStrictEqual([left.payment, left.expense_id], [null, null]);
  // A delivery's own expense paid that delivery: the supplier owes nothing back.
  assert.strictEqual((await gerant('GET', '/api/suppliers')).data.suppliers.find((s) => s.name === 'Petro Kivu').balance, 0);

  // A supplier paid by an expense of the shift: its debt goes down, its spelling is the record's.
  const balance = async () => (await gerant('GET', '/api/suppliers')).data.suppliers.find((s) => s.name === 'Engen RDC').balance;
  const owed = await balance();
  const pay = { category: 'Paiement fournisseur', amount: 40, description: 'Acompte livraison' };
  assert.strictEqual((await gerant('POST', `/api/shifts/${shift.id}/expenses`, { ...pay, beneficiary: 'Inconnu' })).data.code, 'supplier_unknown');
  const paid = (await gerant('POST', `/api/shifts/${shift.id}/expenses`, { ...pay, beneficiary: ' engen rdc ' })).data;
  assert.strictEqual(paid.beneficiary, 'Engen RDC');
  assert.strictEqual(await balance(), round2(owed - 40));
  const listed = (await gerant('GET', '/api/suppliers')).data.payments.find((p) => p.expense_id === paid.id);
  assert.deepStrictEqual([listed.amount, listed.method], [40, `dépense du poste n°${shift.id}`]);
  // Outside a shift too.
  await gerant('POST', '/api/expenses', { ...pay, amount: 10, beneficiary: 'Engen RDC' });
  assert.strictEqual(await balance(), round2(owed - 50));
  assert.deepStrictEqual((await gerant('GET', '/api/auth/me')).data.settings.supplierNames.includes('Engen RDC'), true);
});

test('une entrée de la caisse dans l’argent du poste compte dans ce qu’il remet', async () => {
  let shift = (await gerant('GET', '/api/shifts/current')).data;
  const cashBalance = async () => (await gerant('GET', '/api/cashbook')).data.balances.cash.balance;
  const before = await cashBalance();
  const entry = await gerant('POST', '/api/cashbook/movements', { kind: 'autre_entree', account: 'cash', amount: 50, note: 'Monnaie', toShift: true });
  assert.strictEqual(entry.status, 201);
  await gerant('POST', '/api/cashbook/movements', { kind: 'autre_sortie', account: 'cash', amount: 20, note: 'Course', toShift: true });
  await gerant('POST', '/api/cashbook/movements', { kind: 'autre_entree', account: 'cash', amount: 5, note: 'Coffre' });
  shift = (await gerant('GET', `/api/shifts/${shift.id}`)).data;
  assert.deepStrictEqual([shift.movements.length, shift.movements_amount], [2, 30]);

  await nextSecond();
  const closing = await closeShift(shift, {});
  assert.strictEqual(closing.status, 200, JSON.stringify(closing.data));
  let closed = (await gerant('GET', `/api/shifts/${shift.id}`)).data;
  const base = round2(closed.change_received + closed.total_amount - closed.credit_amount - closed.combo_amount + closed.payments_amount - closed.expenses_amount);
  assert.strictEqual(closed.expected_amount, round2(base + 30), 'entrée + 50, sortie − 20');
  const cash = Math.max(0, round2(closed.expected_amount - closed.mobile_money));
  assert.strictEqual((await gerant('POST', `/api/shifts/${shift.id}/count`, { cash, changeLeft: 0 })).status, 200);
  closed = (await gerant('GET', `/api/shifts/${shift.id}`)).data;
  assert.strictEqual(closed.variance, round2(cash + closed.mobile_money - closed.expected_amount));
  // The book: the movements at their time, then the shift brings in the rest (no double count).
  assert.strictEqual(await cashBalance(), round2(before + 5 + cash + closed.expenses_amount));
  assert.strictEqual((await gerant('DELETE', `/api/cashbook/movements/${entry.data.id}`)).data.code, 'shift_closed');

  // A movement entered without the switch, put afterwards in the money of the shift open at its time.
  const coffre = (await gerant('GET', '/api/cashbook')).data.movements.find((m) => m.source === 'movement' && m.label.startsWith('Entrée : Coffre'));
  assert.deepStrictEqual([coffre.shiftable, coffre.shift_id], [true, null]);
  const linked = await gerant('POST', `/api/cashbook/movements/${coffre.id}/shift`, { link: true });
  assert.strictEqual(linked.data.shiftId, shift.id);
  closed = (await gerant('GET', `/api/shifts/${shift.id}`)).data;
  assert.strictEqual(closed.expected_amount, round2(base + 35), 'reconcilié avec la nouvelle entrée');
  assert.strictEqual(await cashBalance(), round2(before + cash + closed.expenses_amount), 'les 5 $ sont désormais dans l’argent remis, comptés une fois');
  await gerant('POST', `/api/cashbook/movements/${coffre.id}/shift`, { link: false });
  assert.strictEqual((await gerant('GET', `/api/shifts/${shift.id}`)).data.expected_amount, round2(base + 30));

  // Mobile money withdrawn into the open shift's till: more cash to hand over.
  const open = (await gerant('GET', '/api/shifts/current')).data;
  await gerant('POST', '/api/cashbook/movements', { kind: 'retrait_momo', account: 'momo', amount: 15, note: 'Retrait agent', toShift: true });
  await gerant('POST', '/api/cashbook/movements', { kind: 'frais_momo', account: 'momo', amount: 1, toShift: true });
  const now = (await gerant('GET', `/api/shifts/${open.id}`)).data;
  assert.deepStrictEqual([now.movements.length, now.movements_amount], [1, 15]);
});

test('alertes : chacun masque une alerte ou coupe un type, pour lui seul', async () => {
  const dash = (await gerant('GET', '/api/dashboard')).data;
  const first = dash.alerts[0];
  const other = dash.alerts.find((a) => a.type !== first.type);
  assert.ok(first && other, 'au moins deux types d’alertes');
  assert.ok(dash.alertsManage.types.some((t) => t.type === other.type && !t.off));

  await gerant('PUT', '/api/alerts', { off: [other.type, 'inconnu'], hidden: [{ key: first.key, text: first.text }] });
  const after = (await gerant('GET', '/api/dashboard')).data;
  assert.ok(!after.alerts.some((a) => a.key === first.key || a.type === other.type));
  assert.ok(after.alertsManage.all.find((a) => a.key === first.key).hidden);
  assert.ok(after.alertsManage.types.find((t) => t.type === other.type).off);
  assert.ok(!after.alertsManage.types.some((t) => t.type === 'inconnu'));

  const chef = client();
  await chef('POST', '/api/auth/login', { login: 'chef', password: 'gerant123' });
  assert.ok((await chef('GET', '/api/dashboard')).data.alerts.some((a) => a.key === first.key), 'un autre gérant les voit toujours');
  // A hidden alert comes back when its text changes.
  db.prepare('UPDATE alert_hidden SET text = ? WHERE key = ?').run('ancien texte', first.key);
  assert.ok((await gerant('GET', '/api/dashboard')).data.alerts.some((a) => a.key === first.key));
  await gerant('PUT', '/api/alerts', {});
  assert.strictEqual((await gerant('GET', '/api/dashboard')).data.alerts.length, dash.alerts.length);
});

test('accès client avec le mot de passe par défaut, changé par le client ; numéro de la station', async () => {
  // At the pump: a name, then the manager completes the phone and creates the access.
  const pump = (await gerant('POST', '/api/customers/quick', { name: 'Patrick Mumbere' })).data;
  await gerant('PUT', `/api/customers/${pump.id}`, { phone: '+243 970 555 666' });
  assert.strictEqual((await gerant('POST', `/api/customers/${pump.id}/login`, { login: '+243970555666', password: '12345678' })).status, 200);
  const patrick = client();
  assert.strictEqual((await patrick('POST', '/api/auth/login', { login: '+243970555666', password: '12345678' })).status, 200);
  assert.strictEqual((await patrick('GET', '/api/me/account')).data.customer.id, pump.id, 'il voit la fiche de la pompe');
  assert.strictEqual((await patrick('POST', '/api/auth/password', { current: '12345678', password: 'patrick-2026' })).status, 200);
  assert.strictEqual((await client()('POST', '/api/auth/login', { login: '+243970555666', password: 'patrick-2026' })).status, 200);

  // The station's number at the bottom of the client space: set by the admin.
  const chef = client();
  await chef('POST', '/api/auth/login', { login: 'chef', password: 'gerant123' });
  assert.strictEqual((await patrick('GET', '/api/auth/me')).data.settings.stationPhone, '+243974105000');
  assert.strictEqual((await chef('PUT', '/api/settings', { stationPhone: '+243990000000' })).data.code, 'admin_only');
  assert.strictEqual((await gerant('PUT', '/api/settings', { stationPhone: '+243 990 000 000' })).status, 200);
  assert.strictEqual((await patrick('GET', '/api/auth/me')).data.settings.stationPhone, '+243 990 000 000');
  await gerant('PUT', '/api/settings', { stationPhone: '+243974105000' });
});

test('mails : adresse confirmée, mot de passe oublié, reçus, rapports, alertes, relevés', async () => {
  const { mailer, mailJobs } = locals;
  const outbox = mailer.mail.outbox;
  const last = (pred) => [...outbox].reverse().find(pred);
  const linkIn = (m, re) => m?.text.match(re)?.[1];
  const tick = (now) => mailJobs.tick({ settle: 0, ...(now ? { now } : {}) });
  tick(); // first tick: nothing from before is sent
  const before = outbox.length;

  // The admin adds their address: not used until confirmed by the link.
  const mine = await gerant('PUT', '/api/me/mail', { email: 'Gerant@Example.com' });
  assert.strictEqual(mine.data.email, 'gerant@example.com');
  assert.strictEqual(mine.data.verified, false);
  assert.strictEqual(mine.data.confirmationSent, true);
  assert.ok(mine.data.kinds.some((k) => k.kind === 'sauvegarde'), 'la sauvegarde, pour l’administrateur');
  assert.strictEqual((await gerant('PUT', '/api/me/mail', { email: 'pas-une-adresse' })).status, 400);
  const confirm = last((m) => m.kind === 'confirmation' && m.to === 'gerant@example.com');
  const verify = linkIn(confirm, /(\/api\/mail\/verify\?t=[\w-]+)/);
  const opened = await fetch(baseUrl + verify, { redirect: 'manual' });
  assert.strictEqual(opened.status, 303);
  assert.strictEqual(opened.headers.get('location'), '/?mail=confirme');
  assert.strictEqual((await gerant('GET', '/api/me/mail')).data.verified, true);
  assert.strictEqual((await fetch(baseUrl + verify, { redirect: 'manual' })).headers.get('location'), '/?mail=lien-expire', 'le lien ne sert qu’une fois');

  // Forgotten password: same answer for an unknown login, the link only to a confirmed address.
  const sent = outbox.length;
  assert.strictEqual((await client()('POST', '/api/auth/forgot', { login: 'personne' })).status, 200);
  assert.strictEqual(outbox.length, sent, 'aucun mail pour un compte inconnu');
  assert.strictEqual((await client()('POST', '/api/auth/forgot', { login: 'GERANT@example.com' })).status, 200);
  const reset = linkIn(last((m) => m.kind === 'mot_de_passe'), /#\/mot-de-passe\/([\w-]+)/);
  assert.ok(reset, 'lien de réinitialisation');
  assert.strictEqual((await client()('GET', `/api/auth/reset/${reset}`)).data.valid, true);
  assert.strictEqual((await gerant('POST', '/api/auth/reset', { token: reset, password: 'court' })).status, 400);
  assert.strictEqual((await gerant('POST', '/api/auth/reset', { token: reset, password: 'nouveau-mdp-2026' })).status, 200);
  assert.strictEqual((await gerant('GET', '/api/auth/me')).status, 200, 'connecté par le lien');
  assert.strictEqual((await gerant('POST', '/api/auth/reset', { token: reset, password: 'encore-un-autre' })).data.code, 'expired');
  assert.strictEqual((await client()('POST', '/api/auth/login', { login: 'gerant', password: 'motdepasse1' })).status, 401);
  assert.ok(last((m) => m.kind === 'securite' && m.subject === 'Votre mot de passe a été modifié'));
  // A new device for this account: « Nouvelle connexion ».
  assert.strictEqual((await client()('POST', '/api/auth/login', { login: 'gerant', password: 'nouveau-mdp-2026' })).status, 200);
  assert.ok(last((m) => m.kind === 'connexion' && m.to === 'gerant@example.com'));

  // A team member's address entered by the admin gets its own confirmation link.
  const member = await gerant('POST', '/api/users', { name: 'Comptable', login: 'compta', role: 'owner', password: 'compta-2026', email: 'compta@example.com' });
  assert.strictEqual(member.data.email, 'compta@example.com');
  assert.ok(last((m) => m.kind === 'confirmation' && m.to === 'compta@example.com'));

  // A customer's receipt, with a link to stop that kind of mail.
  await gerant('PUT', `/api/customers/${ctx.person.id}`, { email: 'marie@example.com' });
  await gerant('POST', `/api/customers/${ctx.person.id}/payments`, { amount: 1, method: 'mobile money' });
  tick();
  const receipt = last((m) => m.kind === 'recu');
  assert.strictEqual(receipt.to, 'marie@example.com');
  assert.match(receipt.text, /Montant reçu : 1,00/);
  const stop = linkIn(receipt, /Ne plus recevoir ces mails : \S+(\/api\/mail\/stop\S+)/);
  assert.strictEqual((await fetch(baseUrl + stop.replace(/s=[\w-]+/, 's=faux'), { redirect: 'manual' })).headers.get('location'), '/?mail=lien-expire');
  assert.strictEqual((await fetch(baseUrl + stop, { redirect: 'manual' })).headers.get('location'), '/?mail=arret');
  await gerant('POST', `/api/customers/${ctx.person.id}/payments`, { amount: 1, method: 'espèces' });
  const receipts = outbox.filter((m) => m.kind === 'recu').length;
  tick();
  assert.strictEqual(outbox.filter((m) => m.kind === 'recu').length, receipts, 'plus de reçu après « ne plus recevoir »');

  // « Créer un accès » on a customer with an address: the access goes by mail too.
  const kivu = (await gerant('POST', '/api/customers', { type: 'account', name: 'Kivu Logistique', email: 'kivu@example.com', phone: '0970111222' })).data;
  assert.strictEqual((await gerant('POST', `/api/customers/${kivu.id}/login`, { login: '0970111222', password: '12345678' })).data.mailed, true);
  assert.match(last((m) => m.kind === 'acces').text, /Mot de passe : 12345678/);

  // A new alert reaches the team once.
  const tank = ctx.tanks[0];
  db.prepare('UPDATE tanks SET low_level = 1e9 WHERE id = ?').run(tank.id);
  tick();
  assert.ok(last((m) => m.kind === 'alertes' && m.to === 'gerant@example.com' && /stock bas/.test(m.text)));
  const alertMails = outbox.filter((m) => m.kind === 'alertes').length;
  tick();
  assert.strictEqual(outbox.filter((m) => m.kind === 'alertes').length, alertMails, 'une fois seulement');
  db.prepare('UPDATE tanks SET low_level = ? WHERE id = ?').run(tank.low_level, tank.id);

  // The shift report, once the money is counted, with its PDF.
  const open = (await gerant('GET', '/api/dashboard')).data.openShifts[0];
  const shift = (await gerant('GET', `/api/shifts/${open.id}`)).data;
  assert.strictEqual((await closeShift(shift, {}, { cash: 0 })).status, 200);
  tick();
  const report = last((m) => m.kind === 'rapport_poste');
  assert.strictEqual(report.subject.startsWith(`Poste n°${shift.id}`), true);
  assert.deepStrictEqual(report.attachments, [`rapport-poste-${shift.id}.pdf`]);

  // Switched off in « Mes mails »: no more of that kind.
  await gerant('PUT', '/api/me/mail', { kinds: { rapport_poste: false } });
  assert.strictEqual((await gerant('GET', '/api/me/mail')).data.kinds.find((k) => k.kind === 'rapport_poste').on, false);
  await gerant('PUT', '/api/me/mail', { kinds: { rapport_poste: true } });

  // On the 1st (8 a.m. in Goma): last month's report to the team, statements to the customers.
  const [y, m] = today().split('-').map(Number);
  const first = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 6, 0));
  tick(first);
  assert.ok(last((x) => x.kind === 'rapport_mois' && x.attachments[0]?.startsWith('rapport-')), 'rapport du mois');
  const statement = last((x) => x.kind === 'releve' && x.to === 'marie@example.com');
  assert.ok(statement?.attachments[0]?.startsWith('releve-marie-'), 'relevé de Marie en PDF');
  const monthly = outbox.length;
  tick(first);
  assert.strictEqual(outbox.length, monthly, 'une seule fois par mois');
  // Sunday evening: the backup for the admin.
  const sunday = new Date(Date.UTC(2026, 9, 11, 20, 30));
  tick(sunday);
  assert.match(last((x) => x.kind === 'sauvegarde').attachments[0], /^station-2026-10-11\.db\.gz$/);

  // A subscriber who owes last month: a reminder before their payment day.
  await gerant('PUT', `/api/customers/${ctx.fleet.id}`, { email: 'kivu-transports@example.com' });
  const owed = db
    .prepare(
      `INSERT INTO sales (shift_id, customer_id, nozzle_id, product_id, kind, liters, unit_price, amount, created_at)
       SELECT shift_id, ?, nozzle_id, product_id, 'credit', 5000, 1, 5000, datetime('now', 'start of month', '-3 days') FROM sales LIMIT 1`,
    )
    .run(ctx.fleet.id).lastInsertRowid;
  db.prepare('UPDATE customers SET payment_day = ? WHERE id = ?').run(new Date().getDate(), ctx.fleet.id);
  db.exec("DELETE FROM mail_jobs WHERE job LIKE 'rappels:%'"); // the day's run may already have passed
  tick(new Date(`${today()}T07:00:00Z`));
  assert.match(last((x) => x.kind === 'rappel' && x.to === 'kivu-transports@example.com').text, /Montant à payer : /);
  db.prepare('DELETE FROM sales WHERE id = ?').run(owed);
  db.prepare("UPDATE mail_cursors SET last_id = (SELECT MAX(id) FROM sales) WHERE name = 'sales'").run();

  // Réglages → Mails: not configured here, every mail is noted.
  const status = (await gerant('GET', '/api/mail/status')).data;
  assert.strictEqual(status.configured, false);
  assert.ok(status.log.length > 5 && status.log.every((l) => l.status === 'skipped'));
  assert.ok(outbox.length > before);
  assert.strictEqual((await gerant('POST', '/api/mail/test')).status, 404, 'plus de mail d’essai');

  // Near the sending limit: an alert on the dashboard.
  assert.strictEqual(status.usage.day.limit, 100);
  const insert = db.prepare("INSERT INTO mail_log (kind, to_addr, subject, status) VALUES ('rapport', 'x@example.com', 'x', 'sent')");
  for (let i = status.usage.day.count; i < 85; i++) insert.run();
  const alert = (await gerant('GET', '/api/dashboard')).data.alerts.find((a) => a.type === 'mails_limite');
  assert.deepStrictEqual([alert.level, alert.text], ['warning', 'Mails : 85 envoyés aujourd’hui sur 100 permis']);
  db.prepare("DELETE FROM mail_log WHERE subject = 'x'").run();
});

test('crédit payé pendant son propre poste : une vente payée, ni crédit ni règlement', async () => {
  const shift = (await gerant('GET', '/api/shifts/current')).data;
  const nozzle = dieselOf(shift);
  const totals = async () => {
    const s = (await gerant('GET', `/api/shifts/${shift.id}`)).data;
    return { credits: s.credit_amount, payments: round2(s.payments.reduce((t, p) => t + p.amount, 0)), momo: db.prepare("SELECT COALESCE(SUM(amount), 0) AS v FROM momo_sales WHERE shift_id = ?").get(shift.id).v };
  };
  const start = await totals();

  // Paid whole, in cash: the credit is a paid sale, no payment written.
  const a = (await gerant('POST', '/api/customers', { type: 'individual', name: 'Mutombo Paye' })).data;
  const credit = (await gerant('POST', `/api/shifts/${shift.id}/sales`, { customerId: a.id, nozzleId: nozzle.nozzle_id, amount: 50 })).data;
  const body = { customerId: a.id, amount: 50, method: 'espèces', clientRef: 'regl-meme-poste-1' };
  const paid = await gerant('POST', `/api/shifts/${shift.id}/payments`, body);
  assert.deepStrictEqual([paid.status, paid.data.id, paid.data.settled, paid.data.balance], [201, null, 50, 0]);
  assert.strictEqual((await gerant('POST', `/api/shifts/${shift.id}/payments`, body)).data.balance, 0, 'renvoyé : rien de plus');
  assert.strictEqual(db.prepare('SELECT kind FROM sales WHERE id = ?').get(credit.id).kind, 'paid');
  assert.deepStrictEqual(await totals(), start);

  // Paid in part by mobile money, then more than what is left: split litres, a mobile money entry, the surplus is an advance.
  const b = (await gerant('POST', '/api/customers', { type: 'individual', name: 'Bahati Partiel' })).data;
  const big = (await gerant('POST', `/api/shifts/${shift.id}/sales`, { customerId: b.id, nozzleId: nozzle.nozzle_id, amount: 40 })).data;
  const part = (await gerant('POST', `/api/shifts/${shift.id}/payments`, { customerId: b.id, amount: 10, method: 'mobile money' })).data;
  assert.deepStrictEqual([part.id, part.settled, part.balance], [null, 10, 30]);
  const left = db.prepare('SELECT kind, amount, liters FROM sales WHERE id = ?').get(big.id);
  const split = db.prepare("SELECT liters FROM sales WHERE customer_id = ? AND kind = 'paid'").get(b.id);
  assert.deepStrictEqual([left.kind, left.amount], ['credit', 30]);
  assert.ok(Math.abs(left.liters + split.liters - big.liters) < 0.001, 'litres répartis');
  let now = await totals();
  assert.deepStrictEqual([now.credits, now.payments, now.momo], [round2(start.credits + 30), start.payments, round2(start.momo + 10)]);
  const more = (await gerant('POST', `/api/shifts/${shift.id}/payments`, { customerId: b.id, amount: 35, method: 'espèces' })).data;
  assert.deepStrictEqual([more.settled, more.balance, typeof more.id], [30, -5, 'number']);
  now = await totals();
  assert.deepStrictEqual([now.credits, now.payments], [start.credits, round2(start.payments + 5)]);
  assert.ok((await gerant('GET', '/api/audit?category=postes')).data.some((x) => x.action === 'credit_paid_in_shift'));
});

test('photo d’un compteur : l’index lu revient au formulaire, rien n’est enregistré', async () => {
  const reader = require('../src/meterReader');
  const photo = 'A'.repeat(400);
  delete process.env.ANTHROPIC_API_KEY;
  assert.strictEqual((await pompiste('GET', '/api/auth/me')).data.settings.meterReader, false);
  const off = await gerant('POST', '/api/meters/read', { image: photo });
  assert.strictEqual(off.data?.code, 'no_reader', JSON.stringify([off.status, off.data]));

  const { readMeter } = reader;
  const seen = [];
  process.env.ANTHROPIC_API_KEY = 'cle-de-test';
  reader.readMeter = async (args) => (seen.push(args), args.last === 0 ? null : 123456.7);
  try {
    assert.strictEqual((await gerant('GET', '/api/auth/me')).data.settings.meterReader, true);
    const read = await gerant('POST', '/api/meters/read', { image: photo, product: 'Gasoil', last: 123400 });
    assert.deepStrictEqual([read.status, read.data.index], [200, 123456.7]);
    assert.deepStrictEqual([seen[0].product, seen[0].last, seen[0].mediaType], ['Gasoil', 123400, 'image/jpeg']);
    assert.strictEqual((await gerant('POST', '/api/meters/read', { image: photo, last: 0 })).data.code, 'unreadable');
    assert.strictEqual((await gerant('POST', '/api/meters/read', { image: 'pas une photo' })).status, 400);
    // A real photo is bigger than a form: up to a few megabytes.
    assert.strictEqual((await gerant('POST', '/api/meters/read', { image: 'A'.repeat(1_500_000), last: 1 })).status, 200);
    assert.strictEqual((await client()('POST', '/api/meters/read', { image: photo })).status, 401);
  } finally {
    reader.readMeter = readMeter;
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('clients : jamais deux fois le même nom ; un client en double est supprimé, ses opérations vont au bon', async () => {
  const jean = await gerant('POST', '/api/customers', { type: 'individual', name: 'Jean Bosco' });
  assert.strictEqual(jean.status, 201);
  assert.strictEqual((await gerant('POST', '/api/customers', { type: 'individual', name: ' jean  bósco ' })).data.code, 'duplicate');
  assert.strictEqual((await pompiste('POST', '/api/customers/quick', { name: 'JEAN BOSCO' })).data.code, 'duplicate');

  // Entered again under another name, with a payment and an old debt.
  const dup = (await gerant('POST', '/api/customers', { type: 'individual', name: 'Bosco J.', phone: '+243990001122' })).data;
  await gerant('POST', `/api/customers/${dup.id}/old-debts`, { amount: 30 });
  await gerant('POST', `/api/customers/${dup.id}/payments`, { amount: 10, method: 'espèces' });
  assert.strictEqual((await gerant('PUT', `/api/customers/${dup.id}`, { name: 'Jean Bosco' })).data.code, 'duplicate');
  assert.strictEqual((await customer(dup.id)).customer.operations, 2);
  assert.strictEqual((await gerant('DELETE', `/api/customers/${dup.id}`)).data.code, 'has_operations');
  assert.strictEqual((await pompiste('POST', `/api/customers/${dup.id}/merge`, { into: jean.data.id })).status, 403);

  const merged = await gerant('POST', `/api/customers/${dup.id}/merge`, { into: jean.data.id });
  assert.strictEqual(merged.status, 200);
  assert.deepStrictEqual([merged.data.balance, merged.data.operations, merged.data.phone], [20, 2, '+243990001122']);
  assert.strictEqual((await gerant('GET', `/api/customers/${dup.id}`)).status, 404);
  assert.ok((await gerant('GET', '/api/audit?category=clients')).data.some((a) => a.action === 'customer_merged'));

  // Nothing on it: removed as is.
  const typo = (await gerant('POST', '/api/customers', { type: 'individual', name: 'Erreur de saisie' })).data;
  assert.strictEqual((await gerant('DELETE', `/api/customers/${typo.id}`)).status, 200);
  assert.strictEqual((await gerant('GET', `/api/customers/${typo.id}`)).status, 404);
});

test('migration : une base ancienne est convertie (loyalty → paid, combos)', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { openDb, SCHEMA_VERSION } = require('../src/db');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'station-'));
  const file = path.join(dir, 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE customers (id INTEGER PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, phone TEXT, email TEXT, address TEXT, plate TEXT,
      credit_limit REAL NOT NULL DEFAULT 0, loyalty_points INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT);
    INSERT INTO customers (type, name, loyalty_points) VALUES ('individual', 'Ancien', 15);
    CREATE TABLE sales (id INTEGER PRIMARY KEY, shift_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, nozzle_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('credit', 'loyalty')), liters REAL NOT NULL, unit_price REAL NOT NULL,
      amount REAL NOT NULL, points INTEGER NOT NULL DEFAULT 0, plate TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO sales (shift_id, customer_id, nozzle_id, product_id, kind, liters, unit_price, amount, points)
      VALUES (1, 1, 1, 1, 'loyalty', 10, 1, 10, 10), (1, 1, 1, 1, 'credit', 5, 1, 5, 5);
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, login TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('manager', 'attendant', 'customer')), customer_id INTEGER UNIQUE REFERENCES customers(id),
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO users (name, login, password_hash, role) VALUES ('Ancien gérant', 'g', 'x', 'manager');
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO settings VALUES ('combos_enabled', '1'), ('cdf_rate', '2800');`);
  old.close();
  const migrated = openDb(file);
  assert.deepStrictEqual(migrated.prepare('SELECT kind FROM sales ORDER BY id').all().map((r) => r.kind), ['paid', 'credit']);
  assert.strictEqual(migrated.prepare('SELECT loyalty_points FROM customers').get().loyalty_points, 10, 'le crédit non payé ne rapporte plus');
  assert.strictEqual(migrated.prepare('SELECT credit_limit FROM customers').get().credit_limit, 50);
  assert.strictEqual(migrated.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(migrated.prepare("SELECT sql FROM sqlite_master WHERE name = 'users'").get().sql.includes("'owner'"), 'version 15 : rôle actionnaire');
  assert.strictEqual(migrated.prepare('SELECT login FROM users').get().login, 'g', 'les comptes sont gardés');
  assert.strictEqual(migrated.prepare('SELECT role FROM users').get().role, 'admin', 'version 17 : le premier gérant devient l’administrateur');
  const setting = (key) => migrated.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
  assert.strictEqual(setting('combos_enabled'), '0', 'version 6 : combos coupés');
  assert.strictEqual(setting('cdf_rate'), undefined, 'version 6 : tout en dollars');
  // Version 11: a validated shift is simply closed.
  migrated.exec("INSERT INTO users (name, login, password_hash, role) VALUES ('P', 'p', 'x', 'attendant'); INSERT INTO shifts (attendant_id, status) VALUES (1, 'validated'); INSERT INTO supplier_payments (supplier, amount, method) VALUES (' Total Goma ', 10, 'espèces'); INSERT INTO customers (type, name) VALUES ('account', 'Abonné ancien'); UPDATE sales SET over_limit = 1; PRAGMA user_version = 10");
  migrated.close();
  const reopened = openDb(file);
  assert.strictEqual(reopened.prepare('SELECT status FROM shifts').get().status, 'closed', 'version 11 : plus de validation');
  assert.strictEqual(reopened.prepare('SELECT name FROM suppliers').get().name, 'Total Goma', 'version 18 : fiche fournisseur');
  assert.strictEqual(reopened.prepare("SELECT payment_day FROM customers WHERE type = 'account'").get().payment_day, 5, 'version 21 : jour de paiement de l’abonné');
  assert.strictEqual(reopened.prepare('SELECT SUM(over_limit) AS n FROM sales').get().n, 0, 'version 21 : plus de « hors plafond » pour un particulier');
  assert.ok(reopened.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'email'").get(), 'version 22 : e-mail de l’équipe');
  assert.ok(reopened.prepare("SELECT value FROM settings WHERE key = 'mail_secret'").get().value.length >= 32, 'version 22 : clé des liens de désinscription');
  reopened.close();
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('old.db.avant-migration-')), 'copie gardée avant la mise à jour');
  fs.rmSync(dir, { recursive: true, force: true });
});
