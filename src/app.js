const path = require('node:path');
const express = require('express');
const { openDb } = require('./db');
const { loadUser } = require('./auth');
const { HttpError } = require('./util');

// Everything the app loads comes from its own origin (fonts and film are self-hosted).
const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function createApp({ dbFile }) {
  const db = openDb(dbFile);
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Health check for the host: the database answers.
  app.get('/api/health', (req, res) => {
    db.prepare('SELECT 1').get();
    res.set('Cache-Control', 'no-store').json({ ok: true });
  });

  const api = express.Router();
  // Requests that change data must come from the app's own pages (CSRF): a foreign Origin is refused.
  api.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && req.method !== 'GET' && req.method !== 'HEAD') {
      let hostname = null;
      try {
        hostname = new URL(origin).hostname;
      } catch {}
      if (hostname !== req.hostname) throw new HttpError(403, 'Origine de la requête refusée.');
    }
    next();
  });
  api.use(loadUser(db));
  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  for (const routes of ['auth', 'config', 'stock', 'shifts', 'customers', 'requests', 'expenses', 'users', 'reports', 'admin']) {
    api.use(require(`./routes/${routes}`)(db));
  }
  api.use((req, res) => res.status(404).json({ error: 'Route inconnue.' }));
  app.use('/api', api);

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // A database constraint (linked rows, duplicates) is a conflict, not a crash.
    const constraint = err.code === 'ERR_SQLITE_ERROR' && /constraint/i.test(err.message);
    const status = constraint ? 409 : err.status || err.statusCode || 500;
    if (status >= 500 || constraint) console.error(err);
    const message = err.type // body parser
      ? err.type === 'entity.too.large'
        ? 'Requête trop volumineuse.'
        : 'Requête invalide.'
      : constraint
        ? 'Opération impossible : des données liées l’en empêchent.'
        : status >= 500
          ? 'Erreur interne du serveur.'
          : err.message;
    res.status(status).json({ error: message, code: constraint ? 'constraint' : status < 500 && !err.type ? err.code : undefined });
  });

  app.locals.db = db;
  return app;
}

module.exports = { createApp };
