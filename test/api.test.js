const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/app');

let server;
let baseUrl;
let db;

before(async () => {
  const app = createApp({ dbFile: ':memory:' });
  db = app.locals.db;
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

test('catégories de clients : plafonds et prix abonnés réglés dans les paramètres', async () => {
  await gerant('POST', '/api/users', { name: 'Paul', login: 'paul', password: 'pompiste1', role: 'attendant' });
  assert.strictEqual((await pompiste('POST', '/api/auth/login', { login: 'PAUL', password: 'pompiste1' })).status, 200);
  assert.strictEqual((await pompiste('GET', '/api/dashboard')).status, 403);

  ctx.fleet = (await gerant('POST', '/api/customers', { type: 'account', name: 'Transports Kivu', creditLimit: 99999 })).data;
  ctx.person = (await gerant('POST', '/api/customers', { type: 'individual', name: 'Marie' })).data;
  assert.strictEqual(ctx.fleet.credit_limit, 500, 'plafond abonné des paramètres (le plafond envoyé est ignoré)');
  assert.strictEqual(ctx.person.credit_limit, 50, 'plafond particulier des paramètres');

  await gerant('PUT', '/api/settings', { individualCreditLimit: 60 });
  assert.strictEqual((await customer(ctx.person.id)).customer.credit_limit, 60, 'un changement de paramètre s’applique à tous');
  await gerant('PUT', '/api/settings', { individualCreditLimit: 50 });

  const product = await gerant('PUT', `/api/products/${ctx.diesel.id}`, { subscriberPrice: 1.4 });
  assert.strictEqual(product.data.subscriber_price, 1.4);
});

test('poste : prix abonné, crédit sans combos, plafond, rapprochement', async () => {
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

  // Particulier credit: 40 L = 48 $ fits in 50 $; 5 L more does not.
  assert.strictEqual((await sell({ customerId: ctx.person.id, liters: 40, payment: 'credit' })).status, 201);
  const over = await sell({ customerId: ctx.person.id, liters: 5, payment: 'credit' });
  assert.strictEqual(over.status, 409);
  assert.strictEqual(over.data.code, 'over_limit');

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

test('abonnés : le mois précédent doit être payé après le délai', async () => {
  ctx.shift = (await pompiste('GET', '/api/shifts/current')).data;
  const nozzle = dieselOf(ctx.shift);
  const sale = (await pompiste('POST', `/api/shifts/${ctx.shift.id}/sales`, { nozzleId: nozzle.nozzle_id, customerId: ctx.fleet.id, liters: 10, payment: 'credit' })).data;
  // Last month: this sale; earlier still: the subscriber's first credit (already paid).
  db.prepare("UPDATE sales SET created_at = datetime('now', 'start of month', '-40 days') WHERE customer_id = ? AND id != ?").run(ctx.fleet.id, sale.id);
  db.prepare("UPDATE sales SET created_at = datetime('now', 'start of month', '-3 days') WHERE id = ?").run(sale.id);

  const graceDays = 1;
  await gerant('PUT', '/api/settings', { subscriberGraceDays: graceDays });
  const fleet = await customer(ctx.fleet.id);
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
});

test('pompiste : client rapide (particulier), crédit accordé, règlement et dépense', async () => {
  const shift = ctx.shift;
  const nozzle = dieselOf(shift);

  const quick = await pompiste('POST', '/api/customers/quick', { name: 'Garage Mwami' });
  assert.strictEqual(quick.status, 201);
  assert.strictEqual(quick.data.type, 'individual');
  assert.strictEqual(quick.data.available, 50);
  assert.strictEqual((await pompiste('POST', '/api/customers/quick', { name: 'garage mwami' })).data.code, 'duplicate');

  const sale = { customerId: quick.data.id, nozzleId: nozzle.nozzle_id, liters: 100, payment: 'credit' };
  const refused = await pompiste('POST', `/api/shifts/${shift.id}/sales`, sale);
  assert.strictEqual(refused.data.code, 'over_limit');
  const granted = await pompiste('POST', `/api/shifts/${shift.id}/sales`, { ...sale, grantCredit: true });
  assert.strictEqual(granted.data.over_limit, 1);

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
  assert.ok(dash.alerts.some((a) => a.text.includes('hors plafond')));
  assert.ok(dash.alerts.some((a) => a.text.includes('à compléter')));

  const done = await gerant('PUT', `/api/customers/${quick.data.id}`, { phone: '+243 970 000 000', type: 'account' });
  assert.strictEqual(done.data.needs_review, 0);
  assert.strictEqual(done.data.credit_limit, 500, 'devenu abonné : plafond abonné');
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
  await gerant('POST', '/api/deliveries', { tankId: tank.id, litersOrdered: 30, litersReceived: 30, unitCost: 1, payment: 'cash', payMethod: 'espèces' });
  assert.strictEqual((await cash()).cash.balance, 130);
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
  assert.strictEqual(book.days.at(-1).end, 70);
  const pdf = await gerant('GET', '/api/cashbook.pdf');
  assert.strictEqual(pdf.raw.subarray(0, 5).toString(), '%PDF-');
  assert.strictEqual((await pompiste('GET', '/api/cashbook')).status, 403);
  assert.ok((await gerant('GET', '/api/audit?category=caisse')).data.some((a) => a.action === 'supplier_payment'));
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
  assert.strictEqual((await pompiste('POST', `/api/shifts/${shift.id}/sales`, { customerId: kambale.id, nozzleId: diesel.nozzle_id, amount: 1 })).data.code, 'not_on_duty', 'parti en pause');
  assert.strictEqual((await pompiste('POST', `/api/shifts/${shift.id}/checkpoints`, { kind: 'releve', readings: at(10) })).status, 403);
  await nextSecond();

  // Béa carries on with the money Paul passed on, then closes the station at 19:00.
  assert.strictEqual((await bea('POST', `/api/shifts/${shift.id}/checkpoints`, { kind: 'fermeture', readings: at(10) })).status, 400, 'index plus bas que le dernier relevé');
  // 5 L paid by mobile money: they stay on the station's account, the cash counted is the rest.
  const momo = (await bea('POST', `/api/shifts/${shift.id}/momo`, { productId: diesel.product_id, liters: 5 })).data.amount;
  const evening = await bea('POST', `/api/shifts/${shift.id}/checkpoints`, { kind: 'fermeture', readings: at(30), cash: Math.round((preview.expected + 10 * diesel.unit_price - momo) * 100) / 100 });
  assert.strictEqual(evening.status, 201);
  assert.strictEqual(evening.data.report.received, preview.expected);
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
  assert.strictEqual(morning.data.report.liters, 0);
  assert.strictEqual(morning.data.report.variance, 0);
  assert.strictEqual(morning.data.shift.station_closed_at, null);
  assert.deepStrictEqual(morning.data.shift.on_duty, ['Paul']);
  assert.strictEqual(morning.data.shift.checkpoints.length, 3);

  // 15:30: the manager closes; the next shift opens with Paul on it.
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
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO settings VALUES ('combos_enabled', '1'), ('cdf_rate', '2800');`);
  old.close();
  const migrated = openDb(file);
  assert.deepStrictEqual(migrated.prepare('SELECT kind FROM sales ORDER BY id').all().map((r) => r.kind), ['paid', 'credit']);
  assert.strictEqual(migrated.prepare('SELECT loyalty_points FROM customers').get().loyalty_points, 10, 'le crédit non payé ne rapporte plus');
  assert.strictEqual(migrated.prepare('SELECT credit_limit FROM customers').get().credit_limit, 50);
  assert.strictEqual(migrated.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const setting = (key) => migrated.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
  assert.strictEqual(setting('combos_enabled'), '0', 'version 6 : combos coupés');
  assert.strictEqual(setting('cdf_rate'), undefined, 'version 6 : tout en dollars');
  // Version 11: a validated shift is simply closed.
  migrated.exec("INSERT INTO users (name, login, password_hash, role) VALUES ('P', 'p', 'x', 'attendant'); INSERT INTO shifts (attendant_id, status) VALUES (1, 'validated'); PRAGMA user_version = 10");
  migrated.close();
  const reopened = openDb(file);
  assert.strictEqual(reopened.prepare('SELECT status FROM shifts').get().status, 'closed', 'version 11 : plus de validation');
  reopened.close();
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('old.db.avant-migration-')), 'copie gardée avant la mise à jour');
  fs.rmSync(dir, { recursive: true, force: true });
});
