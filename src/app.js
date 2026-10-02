const path = require('node:path');
const express = require('express');
const { openDb } = require('./db');
const { loadUser } = require('./auth');

function createApp({ dbFile }) {
  const db = openDb(dbFile);
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const api = express.Router();
  api.use(loadUser(db));
  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  for (const routes of ['auth', 'config', 'stock', 'shifts', 'customers', 'expenses', 'users', 'reports']) {
    api.use(require(`./routes/${routes}`)(db));
  }
  api.use((req, res) => res.status(404).json({ error: 'Route inconnue.' }));
  app.use('/api', api);

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    const message =
      err.type === 'entity.parse.failed' ? 'Requête invalide.' : status >= 500 ? 'Erreur interne du serveur.' : err.message;
    res.status(status).json({ error: message, code: status < 500 ? err.code : undefined });
  });

  app.locals.db = db;
  return app;
}

module.exports = { createApp };
