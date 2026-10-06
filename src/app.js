const path = require('node:path');
const express = require('express');
const { openDb } = require('./db');
const { loadUser } = require('./auth');
const { HttpError } = require('./util');
const { checkStorage, storageOf } = require('./storage');
const { createMail } = require('./mail');
const { createMailer } = require('./mailer');
const { createMailJobs } = require('./mailJobs');

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
  checkStorage(dbFile);
  const mailer = createMailer(db, createMail(db));
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
  const pub = path.join(__dirname, '..', 'public');
  for (const dir of ['fonts', 'media', 'icons']) app.use(`/${dir}`, express.static(path.join(pub, dir), { maxAge: '7d' }));
  app.use(express.static(pub));

  // Health check for the host: the database answers.
  app.get('/api/health', (req, res) => {
    db.prepare('SELECT 1').get();
    // On Render, also where the database lives: « disque » survives a deploy, « temporaire » does not.
    res.set('Cache-Control', 'no-store').json({ ok: true, ...(storageOf() ? { storage: storageOf() } : {}) });
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
  api.use((req, res, next) => {
    mailer.seeRequest(req); // the address the links in mails point to
    next();
  });
  api.use(loadUser(db));
  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  const routers = {};
  for (const routes of ['auth', 'mail', 'config', 'stock', 'shifts', 'customers', 'requests', 'expenses', 'users', 'reports', 'admin', 'cashbook']) {
    routers[routes] = require(`./routes/${routes}`)(db, { mailer });
    api.use(routers[routes]);
  }
  // The PDFs and alerts the mails carry come from the routes that build them for the screens.
  Object.assign(mailer.services, {
    shiftPdf: routers.shifts.shiftPdf,
    reconcile: routers.shifts.reconcile,
    periodPdf: routers.reports.periodPdf,
    stationAlerts: routers.reports.stationAlerts,
    customerStatement: routers.customers.customerStatement,
  });
  app.locals.mailer = mailer;
  app.locals.mailJobs = createMailJobs(db, mailer);
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
