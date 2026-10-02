const path = require('node:path');
const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;
const app = createApp({ dataFile: path.join(__dirname, 'data', 'tasks.json') });

app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
