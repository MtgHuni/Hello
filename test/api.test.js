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

  // Loyalty programme switched off: no points are awarded.
  const current = (await gerant('GET', '/api/settings')).data;
  assert.strictEqual(current.loyaltyEnabled, true);
  const off = await gerant('PUT', '/api/settings', { ...current, loyaltyEnabled: false });
  assert.strictEqual(off.data.loyaltyEnabled, false);
  const noPoints = await pompiste('POST', `/api/shifts/${shift.id}/sales`, { customerId: ctx.person.id, nozzleId: nozzle.id, liters: 10 });
  assert.strictEqual(noPoints.data.points, 0);
  assert.strictEqual((await gerant('PUT', '/api/settings', { ...current, loyaltyEnabled: true })).data.loyaltyEnabled, true);

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
