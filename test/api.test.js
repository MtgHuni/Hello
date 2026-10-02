const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../app');

let server;
let baseUrl;
let tmpDir;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-'));
  const app = createApp({ dataFile: path.join(tmpDir, 'tasks.json') });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function request(method, url, body) {
  return fetch(baseUrl + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

test('cycle complet : créer, lister, cocher, supprimer', async () => {
  let res = await request('GET', '/api/tasks');
  assert.deepStrictEqual(await res.json(), []);

  res = await request('POST', '/api/tasks', { title: '  Acheter du pain  ' });
  assert.strictEqual(res.status, 201);
  const task = await res.json();
  assert.strictEqual(task.title, 'Acheter du pain');
  assert.strictEqual(task.done, false);

  res = await request('PATCH', `/api/tasks/${task.id}`, { done: true });
  assert.strictEqual((await res.json()).done, true);

  res = await request('GET', '/api/tasks');
  assert.strictEqual((await res.json()).length, 1);

  res = await request('DELETE', `/api/tasks/${task.id}`);
  assert.strictEqual(res.status, 204);

  res = await request('GET', '/api/tasks');
  assert.deepStrictEqual(await res.json(), []);
});

test('refuse un titre vide', async () => {
  const res = await request('POST', '/api/tasks', { title: '   ' });
  assert.strictEqual(res.status, 400);
});

test('renvoie 404 pour une tâche inconnue', async () => {
  assert.strictEqual((await request('PATCH', '/api/tasks/inconnue', { done: true })).status, 404);
  assert.strictEqual((await request('DELETE', '/api/tasks/inconnue')).status, 404);
});

test('sert la page d\'accueil', async () => {
  const res = await request('GET', '/');
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /Mes tâches/);
});
