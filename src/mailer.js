// What the station sends by mail, and to whom (the scheduled and event mails are in src/mailJobs.js).
// - The team (manager, admin, owner) gets mails at their own address (users.email) once it is
//   confirmed by the link sent when it is entered.
// - A customer's address is on their record (customers.email): receipts and statements go there,
//   each with a link to stop that kind of mail; it must be confirmed for « mot de passe oublié ».
// - Security mails (reset link, password changed, address confirmation, access) always go.
// Each person switches the other kinds off in « Mes mails » (MAIL_KINDS).
const crypto = require('node:crypto');
const { getSettings } = require('./db');
const { renderMail } = require('./mailTemplates');
const { readCookie } = require('./auth');
const { fmt } = require('./pdfReport');

const MAIL_KINDS = {
  rapport_poste: 'Rapport de chaque poste clôturé (PDF)',
  rapport_semaine: 'Rapport de la semaine (PDF, le lundi)',
  rapport_mois: 'Rapport du mois (PDF, le 1er)',
  alertes: 'Nouvelles alertes du tableau de bord',
  sauvegarde: 'Sauvegarde de la base (le dimanche soir)',
  recu: 'Reçu de chaque règlement',
  plein: 'Chaque plein à crédit',
  releve: 'Relevé du mois (PDF, le 1er)',
  rappel: 'Rappels de paiement',
  prix: 'Changements de prix',
  connexion: 'Nouvelle connexion à mon compte',
};
const CUSTOMER_KINDS = ['recu', 'plein', 'releve', 'rappel', 'prix'];

// A short description of the browser, for « Nouvelle connexion ».
function device(req) {
  const ua = String(req.headers['user-agent'] || '');
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : null;
  const browser = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  return [browser, os].filter(Boolean).join(' sur ') || 'Navigateur inconnu';
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

function createMailer(db, mail) {
  let lastOrigin = null;
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const appUrl = () => (process.env.APP_URL || lastOrigin || 'http://localhost:3000').replace(/\/+$/, '');
  const station = () => {
    const s = getSettings(db);
    return { name: s.stationName || 'MTG Station', phone: s.stationPhone, appUrl: appUrl() };
  };
  // The links in a mail need the app's address: APP_URL, or the one the app was last reached at.
  function seeRequest(req) {
    const host = req.get('host');
    if (host && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) lastOrigin = `${req.protocol}://${host}`;
    else if (!lastOrigin && host) lastOrigin = `${req.protocol}://${host}`;
  }

  function send(to, m, extra) {
    const { html, text } = renderMail(m, station());
    return mail.queue({ to, subject: m.subject || m.title, html, text, ...extra });
  }

  // ---------- Who receives what ----------

  // The account and its address (a customer's is on their record).
  function account(userId) {
    return db
      .prepare(
        `SELECT u.id, u.name, u.login, u.role, u.active, u.customer_id, c.type AS customer_type,
           CASE WHEN u.customer_id IS NULL THEN u.email ELSE c.email END AS email,
           CASE WHEN u.customer_id IS NULL THEN u.email_verified_at ELSE c.email_verified_at END AS verified_at
         FROM users u LEFT JOIN customers c ON c.id = u.customer_id WHERE u.id = ?`,
      )
      .get(userId);
  }

  // The kinds this account may switch on or off.
  function kindsFor(a) {
    if (a.role === 'customer') return ['recu', 'plein', 'releve', ...(a.customer_type === 'account' ? ['rappel'] : []), 'prix', 'connexion'];
    if (a.role === 'attendant') return ['connexion'];
    return ['rapport_poste', 'rapport_semaine', 'rapport_mois', 'alertes', ...(a.role === 'admin' ? ['sauvegarde'] : []), 'connexion'];
  }
  const userOff = (userId, kind) => !!db.prepare('SELECT 1 FROM mail_prefs WHERE user_id = ? AND kind = ?').get(userId, kind);
  const customerOff = (customerId, kind) => !!db.prepare('SELECT 1 FROM customer_mail_prefs WHERE customer_id = ? AND kind = ?').get(customerId, kind);

  // The team members with a confirmed address who want this kind.
  function staffRecipients(kind) {
    return db
      .prepare(
        `SELECT id, name, role, email FROM users u
         WHERE role IN ('manager', 'admin', 'owner') AND active = 1 AND email IS NOT NULL AND email_verified_at IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM mail_prefs p WHERE p.user_id = u.id AND p.kind = ?)`,
      )
      .all(kind)
      .filter((u) => kind !== 'sauvegarde' || u.role === 'admin');
  }

  // The customer record, if it has an address and wants this kind.
  function customerFor(customerId, kind) {
    const c = db.prepare('SELECT id, name, type, email, active, payment_day FROM customers WHERE id = ?').get(customerId);
    if (!c?.email || !c.active || customerOff(c.id, kind)) return null;
    return c;
  }

  // « Ne plus recevoir ces mails »: a signed link per customer and kind, no login needed.
  const secret = () => db.prepare("SELECT value FROM settings WHERE key = 'mail_secret'").get()?.value || 'mtg';
  const sign = (s) => crypto.createHmac('sha256', secret()).update(s).digest('base64url').slice(0, 24);
  const stopUrl = (customerId, kind) => `${appUrl()}/api/mail/stop?c=${customerId}&k=${kind}&s=${sign(`${customerId}:${kind}`)}`;
  function checkStop(customerId, kind, signature) {
    const expected = sign(`${customerId}:${kind}`);
    return typeof signature === 'string' && signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }
  const manageUrl = () => `${appUrl()}/?mail=reglages`;

  function toCustomer(c, kind, m, attachments) {
    const unsubscribeUrl = stopUrl(c.id, kind);
    return send(c.email, { ...m, unsubscribeUrl }, { kind, customerId: c.id, attachments, unsubscribeUrl });
  }
  function toStaff(kind, m, attachments) {
    const sent = staffRecipients(kind);
    for (const u of sent) send(u.email, { ...m, manageUrl: manageUrl() }, { kind, userId: u.id, attachments });
    return sent.length;
  }

  // ---------- One-time links ----------

  function token(kind, { userId = null, customerId = null, email = null }, minutes) {
    const raw = crypto.randomBytes(32).toString('base64url');
    db.prepare("INSERT INTO mail_tokens (token_hash, kind, user_id, customer_id, email, expires_at) VALUES (?, ?, ?, ?, ?, datetime('now', ?))").run(
      sha(raw),
      kind,
      userId,
      customerId,
      email,
      `+${minutes} minutes`,
    );
    return raw;
  }
  function findToken(kind, raw) {
    if (typeof raw !== 'string' || raw.length < 20 || raw.length > 100) return null;
    return db.prepare("SELECT * FROM mail_tokens WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > datetime('now')").get(sha(raw), kind) || null;
  }
  const useToken = (raw) => db.prepare("UPDATE mail_tokens SET used_at = datetime('now') WHERE token_hash = ?").run(sha(raw));
  const verifyUrl = (raw) => `${appUrl()}/api/mail/verify?t=${raw}`;

  // ---------- Security mails ----------

  // « Mot de passe oublié » : a link valid one hour, only to a confirmed address.
  function sendReset(userId) {
    const a = account(userId);
    if (!a?.active || !a.email || !a.verified_at) return false;
    db.prepare("UPDATE mail_tokens SET used_at = datetime('now') WHERE kind = 'reset' AND user_id = ? AND used_at IS NULL").run(a.id);
    const raw = token('reset', { userId: a.id }, 60);
    send(
      a.email,
      {
        subject: 'Réinitialiser votre mot de passe',
        eyebrow: 'Mot de passe',
        title: 'Choisissez un nouveau mot de passe',
        preheader: 'Le lien est valable une heure.',
        blocks: [
          { p: `Bonjour ${firstName(a.name)},` },
          { p: `Une demande de nouveau mot de passe a été faite pour votre compte ${station().name} (identifiant ${a.login}).` },
          { button: { label: 'Choisir un nouveau mot de passe', url: `${appUrl()}/#/mot-de-passe/${raw}` } },
          { note: 'Ce lien est valable une heure et ne sert qu’une fois. Si vous n’avez rien demandé, ignorez ce mail : votre mot de passe ne change pas.' },
        ],
      },
      { kind: 'mot_de_passe', userId: a.id },
    );
    return true;
  }

  // A new address: a link to confirm it (7 days).
  function sendVerify({ userId = null, customerId = null, email, name }) {
    if (!email) return false;
    const raw = token('verify', { userId, customerId, email }, 7 * 24 * 60);
    send(
      email,
      {
        subject: 'Confirmez votre adresse e-mail',
        eyebrow: 'Adresse e-mail',
        title: 'Confirmez votre adresse',
        preheader: `Pour recevoir les mails de ${station().name}.`,
        blocks: [
          { p: `Bonjour ${firstName(name)},` },
          { p: `Cette adresse a été ajoutée à votre compte ${station().name}. Confirmez-la pour recevoir vos mails et pouvoir retrouver votre mot de passe si vous l’oubliez.` },
          { button: { label: 'Confirmer mon adresse', url: verifyUrl(raw) } },
          { note: 'Ce lien est valable 7 jours. Si vous ne connaissez pas cette station, ignorez ce mail.' },
        ],
      },
      { kind: 'confirmation', userId, customerId },
    );
    return true;
  }

  // The link in a confirmation mail (or in the access mail) was opened.
  function confirm(raw) {
    const t = findToken('verify', raw);
    if (!t) return false;
    useToken(raw);
    if (t.customer_id) db.prepare("UPDATE customers SET email_verified_at = datetime('now') WHERE id = ? AND email = ?").run(t.customer_id, t.email);
    else db.prepare("UPDATE users SET email_verified_at = datetime('now') WHERE id = ? AND email = ?").run(t.user_id, t.email);
    return true;
  }

  function passwordChanged(userId, req, { byAdmin = false } = {}) {
    const a = account(userId);
    if (!a?.email) return;
    send(
      a.email,
      {
        subject: 'Votre mot de passe a été modifié',
        eyebrow: 'Sécurité',
        title: 'Mot de passe modifié',
        blocks: [
          { p: `Bonjour ${firstName(a.name)},` },
          { p: byAdmin ? `L’administrateur de ${station().name} a remplacé le mot de passe de votre compte.` : `Le mot de passe de votre compte ${station().name} vient d’être modifié.` },
          { rows: [['Date', fmt.dateTime(new Date())], ['Appareil', device(req)]] },
          { p: 'Si c’est bien vous, il n’y a rien à faire. Sinon, choisissez tout de suite un nouveau mot de passe et prévenez la station.' },
          { button: { label: 'Choisir un nouveau mot de passe', url: `${appUrl()}/#/mot-de-passe-oublie` } },
        ],
      },
      { kind: 'securite', userId: a.id },
    );
  }

  // Each sign-in from a device not seen before for this account sends « Nouvelle connexion »
  // (not the very first one). The device keeps a random id in a long-lived cookie.
  function noteLogin(req, res, userId) {
    let did = readCookie(req, 'did');
    if (!did || !/^[\w-]{20,64}$/.test(did)) did = crypto.randomBytes(24).toString('base64url');
    res.cookie('did', did, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 400 * 86400e3, path: '/' });
    const hash = sha(did);
    if (db.prepare('SELECT 1 FROM known_devices WHERE user_id = ? AND device_hash = ?').get(userId, hash)) return;
    const first = !db.prepare('SELECT 1 FROM known_devices WHERE user_id = ?').get(userId);
    db.prepare('INSERT OR IGNORE INTO known_devices (user_id, device_hash) VALUES (?, ?)').run(userId, hash);
    const a = account(userId);
    if (first || !a?.email || userOff(userId, 'connexion')) return;
    send(
      a.email,
      {
        subject: 'Nouvelle connexion à votre compte',
        eyebrow: 'Sécurité',
        title: 'Nouvelle connexion',
        preheader: `${device(req)} · ${fmt.dateTime(new Date())}`,
        blocks: [
          { p: `Bonjour ${firstName(a.name)},` },
          { p: `Votre compte ${station().name} vient d’être ouvert sur un appareil qui ne l’avait jamais été.` },
          { rows: [['Date', fmt.dateTime(new Date())], ['Appareil', device(req)], ['Adresse IP', req.ip || '—']] },
          { p: 'Si c’est vous, il n’y a rien à faire. Sinon, changez votre mot de passe tout de suite.' },
          { button: { label: 'Changer mon mot de passe', url: `${appUrl()}/#/mot-de-passe-oublie` } },
        ],
      },
      { kind: 'connexion', userId: a.id },
    );
  }

  // « Créer un accès » on a customer with an address: their login and password by mail too.
  // The button confirms the address and opens their space.
  function sendAccess(customerId, { login, password }) {
    const c = db.prepare('SELECT id, name, email FROM customers WHERE id = ?').get(customerId);
    if (!c?.email) return false;
    const user = db.prepare('SELECT id FROM users WHERE customer_id = ?').get(c.id);
    const raw = token('verify', { userId: user?.id ?? null, customerId: c.id, email: c.email }, 7 * 24 * 60);
    send(
      c.email,
      {
        subject: `Votre espace client ${station().name}`,
        eyebrow: 'Espace client',
        title: 'Votre espace client est prêt',
        preheader: 'Votre identifiant et votre mot de passe.',
        blocks: [
          { p: `Bonjour ${firstName(c.name)},` },
          { p: `Vous pouvez suivre votre solde, vos pleins et vos relevés, et préparer un achat avant d’arriver à la pompe.` },
          { code: [['Identifiant', login], ['Mot de passe', password]] },
          { button: { label: 'Ouvrir mon espace', url: verifyUrl(raw) } },
          { note: 'Changez ce mot de passe dès votre première connexion : touchez vos initiales en haut à droite, puis « Changer le mot de passe ».' },
        ],
      },
      { kind: 'acces', customerId: c.id },
    );
    return true;
  }

  return {
    MAIL_KINDS,
    CUSTOMER_KINDS,
    mail,
    appUrl,
    station,
    seeRequest,
    send,
    account,
    kindsFor,
    userOff,
    customerOff,
    staffRecipients,
    customerFor,
    toCustomer,
    toStaff,
    checkStop,
    findToken,
    useToken,
    sendReset,
    sendVerify,
    confirm,
    passwordChanged,
    noteLogin,
    sendAccess,
    services: {}, // PDF builders the routes provide (src/app.js)
  };
}

module.exports = { createMailer, MAIL_KINDS, CUSTOMER_KINDS, firstName };
