const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/app');

let server;
let baseUrl;

before(async () => {
  const app = createApp({ dbFile: ':memory:' });
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
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, data };
  };
}

const gerant = client();
const pompiste = client();
const clientSpace = client();
const ctx = {};

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
  assert.strictEqual((await gerant('GET', '/api/setup')).data.needsSetup, false);
  assert.strictEqual((await gerant('POST', '/api/setup', {})).status, 400);

  const me = await gerant('GET', '/api/auth/me');
  assert.strictEqual(me.data.user.role, 'manager');
  assert.strictEqual(me.data.settings.stationName, 'Station Test');

  const pumps = (await gerant('GET', '/api/pumps')).data;
  assert.strictEqual(pumps.length, 2);
  ctx.pumps = pumps;
  ctx.tanks = (await gerant('GET', '/api/tanks')).data;
});

test('livraison puis jaugeage', async () => {
  const diesel = ctx.tanks.find((t) => t.product_name === 'Gasoil');
  ctx.diesel = diesel;
  const del = await gerant('POST', '/api/deliveries', { tankId: diesel.id, litersOrdered: 10000, litersReceived: 9950 });
  assert.strictEqual(del.status, 201);
  const dip = await gerant('POST', '/api/dips', { tankId: diesel.id, measured: 9940 });
  assert.strictEqual(dip.data.variance, -10);
  const tank = (await gerant('GET', '/api/tanks')).data.find((t) => t.id === diesel.id);
  assert.strictEqual(tank.book_stock, 9940);
});

test("création d'un pompiste et de clients", async () => {
  const u = await gerant('POST', '/api/users', { name: 'Paul', login: 'paul', password: 'pompiste1', role: 'attendant' });
  assert.strictEqual(u.status, 201);
  assert.strictEqual((await pompiste('POST', '/api/auth/login', { login: 'paul', password: 'faux' })).status, 401);
  assert.strictEqual((await pompiste('POST', '/api/auth/login', { login: 'PAUL', password: 'pompiste1' })).status, 200);
  assert.strictEqual((await pompiste('GET', '/api/dashboard')).status, 403);

  ctx.fleet = (await gerant('POST', '/api/customers', { type: 'account', name: 'Transports Kivu', creditLimit: 100 })).data;
  ctx.person = (await gerant('POST', '/api/customers', { type: 'individual', name: 'Marie' })).data;

  const list = (await pompiste('GET', '/api/customers')).data;
  assert.strictEqual(list.find((c) => c.id === ctx.fleet.id).available, 100);
  assert.strictEqual(list[0].credit_limit, undefined, 'le pompiste ne voit pas les détails');
});

test('poste complet : ouverture, ventes clients, clôture et rapprochement', async () => {
  const dieselPump = ctx.pumps.find((p) => p.nozzles[0].product_name === 'Gasoil');
  const nozzle = dieselPump.nozzles[0];

  const opened = await pompiste('POST', '/api/shifts', { pumpIds: [dieselPump.id] });
  assert.strictEqual(opened.status, 201);
  const shift = opened.data;
  assert.strictEqual(shift.readings[0].start_meter, 0);
  assert.strictEqual(shift.readings[0].unit_price, 1.2);

  assert.strictEqual((await pompiste('POST', '/api/shifts', { pumpIds: [dieselPump.id] })).status, 409);

  // A price change during the shift does not affect it.
  await gerant('PUT', `/api/products/${nozzle.product_id}`, { price: 1.3 });

  const credit = await pompiste('POST', `/api/shifts/${shift.id}/sales`, { customerId: ctx.fleet.id, nozzleId: nozzle.id, liters: 50 });
  assert.strictEqual(credit.status, 201);
  assert.strictEqual(credit.data.amount, 60);
  const over = await pompiste('POST', `/api/shifts/${shift.id}/sales`, { customerId: ctx.fleet.id, nozzleId: nozzle.id, liters: 40 });
  assert.strictEqual(over.status, 409, 'plafond de crédit');

  const loyalty = await pompiste('POST', `/api/shifts/${shift.id}/sales`, { customerId: ctx.person.id, nozzleId: nozzle.id, liters: 20.5 });
  assert.strictEqual(loyalty.data.points, 20);

  const bad = await pompiste('POST', `/api/shifts/${shift.id}/close`, {
    readings: [{ nozzleId: nozzle.id, endMeter: 30 }],
    cash: 0,
  });
  assert.strictEqual(bad.status, 400, 'ventes clients > litres du compteur');

  // 500 L at 1.20 $ = 600 $; 60 $ on credit, so 540 $ expected; 538 $ declared.
  const closed = await pompiste('POST', `/api/shifts/${shift.id}/close`, {
    readings: [{ nozzleId: nozzle.id, endMeter: 500 }],
    cash: 438,
    card: 100,
  });
  assert.strictEqual(closed.status, 200);
  assert.strictEqual(closed.data.total_liters, 500);
  assert.strictEqual(closed.data.total_amount, 600);
  assert.strictEqual(closed.data.credit_amount, 60);
  assert.strictEqual(closed.data.expected_amount, 540);
  assert.strictEqual(closed.data.variance, -2);

  const tank = (await gerant('GET', '/api/tanks')).data.find((t) => t.id === ctx.diesel.id);
  assert.strictEqual(tank.book_stock, 9440);
  const pumps = (await gerant('GET', '/api/pumps')).data;
  assert.strictEqual(pumps.find((p) => p.id === dieselPump.id).nozzles[0].meter, 500);

  const dash = (await gerant('GET', '/api/dashboard')).data;
  assert.strictEqual(dash.todayTotal.amount, 600);
  assert.strictEqual(dash.toValidate, 1);
  assert.ok(dash.alerts.some((a) => a.text.includes('écart de caisse')));

  const validated = await gerant('POST', `/api/shifts/${shift.id}/validate`, { comment: 'Écart expliqué' });
  assert.strictEqual(validated.data.status, 'validated');

  const next = await pompiste('POST', '/api/shifts', { pumpIds: [dieselPump.id] });
  assert.strictEqual(next.data.readings[0].start_meter, 500, "l'index repart de la fin du poste précédent");
  assert.strictEqual(next.data.readings[0].unit_price, 1.3);
});

test('règlement client, relevé et espace client', async () => {
  const pay = await gerant('POST', `/api/customers/${ctx.fleet.id}/payments`, { amount: 25, method: 'virement' });
  assert.strictEqual(pay.data.balance, 35);

  const acc = (await gerant('GET', `/api/customers/${ctx.fleet.id}`)).data;
  assert.strictEqual(acc.closing, 35);
  assert.strictEqual(acc.movements.length, 2);

  await gerant('POST', `/api/customers/${ctx.fleet.id}/login`, { login: 'kivu', password: 'clientkivu' });
  await clientSpace('POST', '/api/auth/login', { login: 'kivu', password: 'clientkivu' });
  const mine = await clientSpace('GET', '/api/me/account');
  assert.strictEqual(mine.data.customer.name, 'Transports Kivu');
  assert.strictEqual((await clientSpace('GET', `/api/customers/${ctx.person.id}`)).status, 403);
  assert.strictEqual((await clientSpace('GET', '/api/shifts')).status, 403);
});

test('rapport des ventes et export CSV', async () => {
  const today = new Date().toLocaleDateString('sv-SE');
  const rep = await gerant('GET', `/api/reports/sales?from=${today}&to=${today}`);
  assert.strictEqual(rep.data.totals.amount, 600);
  assert.strictEqual(rep.data.byAttendant[0].attendant, 'Paul');

  const res = await fetch(`${baseUrl}/api/reports/sales?from=${today}&to=${today}&format=csv`, {
    headers: { Cookie: '' },
  });
  assert.strictEqual(res.status, 401);
});

test('pompiste : nouveau client rapide, crédit hors plafond, règlement et dépense à la pompe', async () => {
  const shift = (await pompiste('GET', '/api/shifts/current')).data;
  const nozzle = shift.readings[0];

  const quick = await pompiste('POST', '/api/customers/quick', { name: 'Garage Mwami' });
  assert.strictEqual(quick.status, 201);
  assert.strictEqual(quick.data.available, 100, 'plafond par défaut des nouveaux clients');
  const dup = await pompiste('POST', '/api/customers/quick', { name: 'garage mwami' });
  assert.strictEqual(dup.status, 409);
  assert.strictEqual(dup.data.code, 'duplicate');

  // 100 L × 1,30 $ = 130 $ > 100 $ : refusé sans confirmation, accepté si le pompiste accorde le crédit.
  const sale = { customerId: quick.data.id, nozzleId: nozzle.nozzle_id, liters: 100 };
  const refused = await pompiste('POST', `/api/shifts/${shift.id}/sales`, sale);
  assert.strictEqual(refused.status, 409);
  assert.strictEqual(refused.data.code, 'over_limit');
  const granted = await pompiste('POST', `/api/shifts/${shift.id}/sales`, { ...sale, grantCredit: true });
  assert.strictEqual(granted.status, 201);
  assert.strictEqual(granted.data.over_limit, 1);

  const pay = await pompiste('POST', `/api/shifts/${shift.id}/payments`, { customerId: ctx.fleet.id, amount: 20 });
  assert.strictEqual(pay.status, 201);
  assert.strictEqual(pay.data.balance, 15);

  assert.strictEqual((await pompiste('POST', `/api/shifts/${shift.id}/expenses`, { category: 'Inconnue', amount: 5, description: 'x' })).status, 400);
  const exp = await pompiste('POST', `/api/shifts/${shift.id}/expenses`, { category: 'Fournitures', amount: 15, description: 'Eau et savon' });
  assert.strictEqual(exp.status, 201);

  const dash = (await gerant('GET', '/api/dashboard')).data;
  assert.ok(dash.alerts.some((a) => a.text.includes('hors plafond')));
  assert.ok(dash.alerts.some((a) => a.text.includes('à compléter')));
  assert.strictEqual(dash.todayExpenses, 15);

  // 200 L × 1,30 = 260 ; − 130 crédit + 20 règlement − 15 dépense = 135 à remettre.
  const closed = await pompiste('POST', `/api/shifts/${shift.id}/close`, {
    readings: [{ nozzleId: nozzle.nozzle_id, endMeter: nozzle.start_meter + 200 }],
    cash: 135,
  });
  assert.strictEqual(closed.status, 200);
  assert.strictEqual(closed.data.expected_amount, 135);
  assert.strictEqual(closed.data.payments_amount, 20);
  assert.strictEqual(closed.data.expenses_amount, 15);
  assert.strictEqual(closed.data.variance, 0);

  const done = await gerant('PUT', `/api/customers/${quick.data.id}`, { phone: '+243 970 000 000', creditLimit: 500 });
  assert.strictEqual(done.data.needs_review, 0);
});

test('dépenses du gérant et rapport avec marge', async () => {
  const today = new Date().toLocaleDateString('sv-SE');
  assert.strictEqual((await pompiste('GET', '/api/expenses')).status, 403);

  const created = await gerant('POST', '/api/expenses', { category: 'Salaires', amount: 300, description: 'Avance Paul', method: 'mobile money' });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.data.expense_date, today);

  const list = (await gerant('GET', `/api/expenses?from=${today}&to=${today}`)).data;
  assert.strictEqual(list.total, 315);
  assert.strictEqual(list.byCategory[0].category, 'Salaires');

  const shiftExpense = list.expenses.find((e) => e.shift_id);
  assert.strictEqual((await gerant('DELETE', `/api/expenses/${shiftExpense.id}`)).status, 409, 'dépense de caisse figée');
  assert.strictEqual((await gerant('PUT', `/api/expenses/${created.data.id}`, { amount: 250 })).data.amount, 250);

  const tank = (await gerant('GET', '/api/tanks')).data.find((t) => t.product_name === 'Gasoil');
  await gerant('POST', '/api/deliveries', { tankId: tank.id, litersOrdered: 1000, litersReceived: 1000, unitCost: 1 });

  const rep = (await gerant('GET', `/api/reports/sales?from=${today}&to=${today}`)).data;
  assert.strictEqual(rep.totals.expenses, 265);
  const diesel = rep.byProduct.find((p) => p.product === 'Gasoil');
  assert.strictEqual(diesel.avg_cost, 1);
  assert.strictEqual(diesel.margin, Math.round((diesel.amount - diesel.liters) * 100) / 100);
  assert.strictEqual(rep.totals.costKnown, true, 'seul le gasoil a été vendu, et son coût est connu');
  assert.strictEqual(rep.totals.net, Math.round((rep.totals.grossMargin - 265) * 100) / 100);
});
