const path = require('node:path');
const { createApp } = require('./src/app');

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'station.db');

const app = createApp({ dbFile: DB_FILE });

app.listen(PORT, () => {
  console.log(`Station service démarrée sur http://localhost:${PORT}`);
});
