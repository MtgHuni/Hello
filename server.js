// Every "today" and every report day is the station's: Goma (UTC+2), whatever the host's zone.
process.env.TZ = process.env.TZ || 'Africa/Lubumbashi';

const path = require('node:path');
const { createApp } = require('./src/app');
const { seedTestData } = require('./src/seed');

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'station.db');

const app = createApp({ dbFile: DB_FILE });

// DEMO_SEED=1 : à chaque démarrage, complète les cuves sous 50 % (essais uniquement).
if (process.env.DEMO_SEED === '1') console.log('Données de test :', JSON.stringify(seedTestData(app.locals.db)));

app.listen(PORT, () => {
  console.log(`Station service démarrée sur http://localhost:${PORT}`);
});
