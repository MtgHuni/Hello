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
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, data };
  };
}

const gerant = client();
const pompiste = client();
const ctx = {};
const today = () => new Date().toLocaleDateString('sv-SE');
const customer = async (id) => (await gerant('GET', `/api/customers/${id}`)).data;

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

  const me = (await gerant('GET', '/api/auth/me')).data;
  assert.strictEqual(me.user.role, 'manager');
  assert.strictEqual(me.settings.combosPerLiter, 1);
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
  const opened = await pompiste('POST', '/api/shifts', { pumpIds: [ctx.dieselPump.id] });
  assert.strictEqual(opened.status, 201);
  const shift = opened.data;
  const nozzle = shift.readings[0];
  assert.strictEqual(nozzle.unit_price, 1.2);
  assert.strictEqual(nozzle.subscriber_price, 1.4);
  assert.strictEqual((await pompiste('POST', '/api/shifts', { pumpIds: [ctx.dieselPump.id] })).status, 409);

  const sell = (body) => pompiste('POST', `/api/shifts/${shift.id}/sales`, { nozzleId: nozzle.nozzle_id, ...body });

  // Subscriber on credit: 50 L × 1,40 = 70 $; combos only once paid.
  const fleetCredit = await sell({ customerId: ctx.fleet.id, liters: 50, payment: 'credit' });
  assert.strictEqual(fleetCredit.data.amount, 70);
  assert.strictEqual(fleetCredit.data.points, 0);
  assert.strictEqual(fleetCredit.data.points_due, 50);

  // Particulier paid: 20,5 L × 1,20 = 24,60 $, 20 combos at once.
  const paid = await sell({ customerId: ctx.person.id, liters: 20.5, payment: 'paid' });
  assert.strictEqual(paid.data.amount, 24.6);
  assert.strictEqual(paid.data.points, 20);

  // Particulier credit: 40 L = 48 $ fits in 50 $; 5 L more does not.
  assert.strictEqual((await sell({ customerId: ctx.person.id, liters: 40, payment: 'credit' })).status, 201);
  const over = await sell({ customerId: ctx.person.id, liters: 5, payment: 'credit' });
  assert.strictEqual(over.status, 409);
  assert.strictEqual(over.data.code, 'over_limit');

  // 20 combos < 100: no exchange yet.
  const tooFew = await sell({ customerId: ctx.person.id, amount: 1, payment: 'combo' });
  assert.strictEqual(tooFew.status, 409);
  assert.strictEqual(tooFew.data.code, 'combos');

  assert.strictEqual((await customer(ctx.person.id)).customer.loyalty_points, 20);

  // 500 L at 1,20 = 600 $ + subscriber surcharge 50 × 0,20 = 10 $ → 610 $;
  // credit 70 + 48 = 118 $ → 492 $ to hand over; 490 $ declared.
  const closed = await pompiste('POST', `/api/shifts/${shift.id}/close`, {
    readings: [{ nozzleId: nozzle.nozzle_id, endMeter: 500 }],
    cash: 390,
    card: 100,
  });
  assert.strictEqual(closed.status, 200);
  assert.strictEqual(closed.data.total_amount, 610);
  assert.strictEqual(closed.data.credit_amount, 118);
  assert.strictEqual(closed.data.expected_amount, 492);
  assert.strictEqual(closed.data.variance, -2);

  const dash = (await gerant('GET', '/api/dashboard')).data;
  assert.strictEqual(dash.todayTotal.amount, 600, 'ventes par produit selon les index');
  assert.ok(dash.alerts.some((a) => a.text.includes('écart de caisse')));
  assert.strictEqual((await gerant('POST', `/api/shifts/${shift.id}/validate`, {})).data.status, 'validated');

  ctx.shift = (await pompiste('POST', '/api/shifts', { pumpIds: [ctx.dieselPump.id] })).data;
  assert.strictEqual(ctx.shift.readings[0].start_meter, 500);
});

test('les combos d’une vente à crédit arrivent quand elle est entièrement payée', async () => {
  await gerant('POST', `/api/customers/${ctx.fleet.id}/payments`, { amount: 70, method: 'virement' });
  assert.strictEqual((await customer(ctx.fleet.id)).customer.loyalty_points, 50);

  await gerant('POST', `/api/customers/${ctx.person.id}/payments`, { amount: 20, method: 'espèces' });
  let marie = await customer(ctx.person.id);
  assert.strictEqual(marie.customer.loyalty_points, 20, 'paiement partiel : pas encore de combos');
  assert.strictEqual(marie.combos.pending, 40);

  // Paid at the pump, during the open shift.
  const pay = await pompiste('POST', `/api/shifts/${ctx.shift.id}/payments`, { customerId: ctx.person.id, amount: 28 });
  assert.strictEqual(pay.data.balance, 0);
  marie = await customer(ctx.person.id);
  assert.strictEqual(marie.customer.loyalty_points, 60);
  assert.strictEqual(marie.combos.pending, 0);

  // Cancelling that payment takes the combos back.
  await pompiste('DELETE', `/api/shifts/${ctx.shift.id}/payments/${pay.data.id}`);
  assert.strictEqual((await customer(ctx.person.id)).customer.loyalty_points, 20);
  await pompiste('POST', `/api/shifts/${ctx.shift.id}/payments`, { customerId: ctx.person.id, amount: 28 });
});

test('échange de combos contre du carburant, déduit de la caisse', async () => {
  await gerant('PUT', '/api/settings', { comboThreshold: 50, comboValue: 0.05 });
  const nozzle = ctx.shift.readings[0];
  const sell = (body) => pompiste('POST', `/api/shifts/${ctx.shift.id}/sales`, { nozzleId: nozzle.nozzle_id, customerId: ctx.person.id, payment: 'combo', ...body });

  const tooMuch = await sell({ amount: 5 }); // 100 combos needed, 60 available
  assert.strictEqual(tooMuch.status, 409);

  // 2 $ = 40 combos → 1,67 L at 1,20 $/L.
  const exchange = await sell({ amount: 2 });
  assert.strictEqual(exchange.status, 201);
  assert.strictEqual(exchange.data.kind, 'combo');
  assert.strictEqual(exchange.data.combos_used, 40);
  assert.strictEqual(exchange.data.liters, 1.67);
  assert.strictEqual(exchange.data.points, 0);
  assert.strictEqual((await customer(ctx.person.id)).customer.loyalty_points, 20);

  // 10 L at 1,20 = 12 $ + 28 $ received − 2 $ in combos = 38 $.
  const closed = await pompiste('POST', `/api/shifts/${ctx.shift.id}/close`, {
    readings: [{ nozzleId: nozzle.nozzle_id, endMeter: 510 }],
    cash: 38,
  });
  assert.strictEqual(closed.data.combo_amount, 2);
  assert.strictEqual(closed.data.payments_amount, 28);
  assert.strictEqual(closed.data.expected_amount, 38);
  assert.strictEqual(closed.data.variance, 0);
  await gerant('PUT', '/api/settings', { comboThreshold: 100 });
});

test('abonnés : le mois précédent doit être payé après le délai', async () => {
  ctx.shift = (await pompiste('POST', '/api/shifts', { pumpIds: [ctx.dieselPump.id] })).data;
  const nozzle = ctx.shift.readings[0];
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
  await gerant('POST', `/api/customers/${ctx.fleet.id}/payments`, { amount: 100, method: 'virement' });
  assert.strictEqual((await customer(ctx.fleet.id)).dues.overdue, 0);
  await gerant('PUT', '/api/settings', { subscriberGraceDays: 5 });
});

test('pompiste : client rapide (particulier), crédit accordé, règlement et dépense', async () => {
  const shift = ctx.shift;
  const nozzle = shift.readings[0];

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

  const exp = await pompiste('POST', `/api/shifts/${shift.id}/expenses`, { category: 'Fournitures', amount: 15, description: 'Eau et savon' });
  assert.strictEqual(exp.status, 201);

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

  const created = await moi('POST', '/api/me/requests', { productId: ctx.diesel.id, amount: 24, plate: 'GM-123' });
  assert.strictEqual(created.data.status, 'pending');
  const mine = (await pompiste('GET', '/api/requests/pending')).data.find((r) => r.id === created.data.id);
  assert.strictEqual(mine.customer_name, 'Jean Bahati');

  const confirmed = await pompiste('POST', `/api/requests/${mine.id}/confirm`, {});
  assert.strictEqual(confirmed.data.liters, 20);
  assert.strictEqual(confirmed.data.points, 20);
  assert.strictEqual(confirmed.data.source, 'customer');
  assert.strictEqual((await pompiste('POST', `/api/requests/${mine.id}/confirm`, {})).status, 409);
  assert.strictEqual((await moi('GET', '/api/me/requests/current')).data.status, 'confirmed');

  const again = (await moi('POST', '/api/me/requests', { productId: ctx.diesel.id, liters: 5 })).data;
  assert.strictEqual((await pompiste('POST', `/api/requests/${again.id}/reject`, { note: 'Client parti' })).status, 204);
  const third = (await moi('POST', '/api/me/requests', { productId: ctx.diesel.id, liters: 5 })).data;
  assert.strictEqual((await moi('DELETE', `/api/me/requests/${third.id}`)).status, 204);

  const account = (await moi('GET', '/api/me/account')).data;
  assert.strictEqual(account.customer.loyalty_points, 20);
  assert.strictEqual(account.combos.threshold, 100);
  assert.strictEqual((await moi('GET', `/api/customers/${ctx.person.id}`)).status, 403);
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

  const res = await fetch(`${baseUrl}/api/reports/sales?from=${today()}&to=${today()}&format=csv`);
  assert.strictEqual(res.status, 401);
});

test('migration : une base ancienne est convertie (loyalty → paid, combos)', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { openDb } = require('../src/db');
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
      VALUES (1, 1, 1, 1, 'loyalty', 10, 1, 10, 10), (1, 1, 1, 1, 'credit', 5, 1, 5, 5);`);
  old.close();
  const migrated = openDb(file);
  assert.deepStrictEqual(migrated.prepare('SELECT kind FROM sales ORDER BY id').all().map((r) => r.kind), ['paid', 'credit']);
  assert.strictEqual(migrated.prepare('SELECT loyalty_points FROM customers').get().loyalty_points, 10, 'le crédit non payé ne rapporte plus');
  assert.strictEqual(migrated.prepare('SELECT credit_limit FROM customers').get().credit_limit, 50);
  migrated.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
