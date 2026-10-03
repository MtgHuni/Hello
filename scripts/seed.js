// npm run seed : remplit les cuves et applique des prix de test sur la base DB_FILE.
const path = require('node:path');
const { openDb } = require('../src/db');
const { seedTestData } = require('../src/seed');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'station.db');
const result = seedTestData(openDb(DB_FILE), { force: true });

if (result.skipped) {
  console.log(result.skipped);
  process.exit(1);
}
for (const t of result.tanks) console.log(`${t.name} : ${t.liters} L`);
for (const p of result.prices) console.log(`Prix ${p.name} : ${p.price}`);
if (!result.tanks.length && !result.prices.length) console.log('Rien à faire : cuves déjà pleines et prix déjà appliqués.');
