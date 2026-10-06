const express = require('express');
const { fail, str, transaction } = require('../util');
const { requireRole, requireAdmin, hashPassword, checkPasswordStrength, startSession, loginLimiter } = require('../auth');
const { MAIL_KINDS, CUSTOMER_KINDS } = require('../mailer');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// An address typed in a form: trimmed, lower case, checked; empty means none.
function emailParam(value) {
  const email = str(value, 'L’adresse e-mail', { required: false, max: 120 })?.toLowerCase() || null;
  if (email && !EMAIL_RE.test(email)) fail(400, 'Adresse e-mail invalide.');
  return email;
}

function mailRoutes(db, { mailer }) {
  const router = express.Router();
  const limiter = loginLimiter({ max: 5 });

  // « Mot de passe oublié » : login, phone or address. The answer is the same whether an account
  // matches or not, and the link only goes to a confirmed address.
  router.post('/auth/forgot', (req, res) => {
    const q = str(req.body?.login, 'Votre identifiant, téléphone ou e-mail', { max: 200 });
    const key = `${req.ip}|forgot`;
    limiter.check(key);
    limiter.fail(key);
    const compact = q.replace(/[\s.-]/g, '');
    const users = db
      .prepare(
        `SELECT u.id FROM users u LEFT JOIN customers c ON c.id = u.customer_id
         WHERE u.active = 1 AND (u.login = ? OR u.login = ?
           OR (u.customer_id IS NULL AND u.email = ? COLLATE NOCASE)
           OR (u.customer_id IS NOT NULL AND c.email = ? COLLATE NOCASE))`,
      )
      .all(q, compact, q, q);
    for (const u of users) mailer.sendReset(u.id);
    res.json({ ok: true });
  });

  router.get('/auth/reset/:token', (req, res) => {
    res.json({ valid: !!mailer.findToken('reset', req.params.token) });
  });

  // The new password from the link: every session of the account ends, this device signs in.
  router.post('/auth/reset', async (req, res) => {
    const raw = String(req.body?.token || '');
    if (!mailer.findToken('reset', raw)) fail(400, 'Ce lien n’est plus valable : demandez-en un nouveau.', 'expired');
    const hash = await hashPassword(checkPasswordStrength(req.body?.password));
    const t = mailer.findToken('reset', raw);
    if (!t) fail(400, 'Ce lien n’est plus valable : demandez-en un nouveau.', 'expired');
    transaction(db, () => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, t.user_id);
      mailer.useToken(raw);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.user_id);
    });
    startSession(db, req, res, t.user_id);
    mailer.noteLogin(req, res, t.user_id);
    mailer.passwordChanged(t.user_id, req);
    res.json({ ok: true });
  });

  // Links opened from a mail: back to the app, which says what happened (?mail=…).
  router.get('/mail/verify', (req, res) => {
    res.redirect(303, `/?mail=${mailer.confirm(String(req.query.t || '')) ? 'confirme' : 'lien-expire'}`);
  });
  const stop = (req) => {
    const customerId = Number(req.query.c);
    const kind = String(req.query.k || '');
    if (!CUSTOMER_KINDS.includes(kind) || !mailer.checkStop(customerId, kind, String(req.query.s || ''))) return false;
    db.prepare('INSERT OR IGNORE INTO customer_mail_prefs (customer_id, kind) VALUES (?, ?)').run(customerId, kind);
    return true;
  };
  router.get('/mail/stop', (req, res) => res.redirect(303, `/?mail=${stop(req) ? 'arret' : 'lien-expire'}`));
  // One-click unsubscribe from the mail app (List-Unsubscribe-Post).
  router.post('/mail/stop', (req, res) => res.json({ ok: stop(req) }));

  // « Mes mails » : the address and the kinds of mail, for every account.
  function myMail(userId) {
    const a = mailer.account(userId);
    const off = (kind) => (a.role === 'customer' && CUSTOMER_KINDS.includes(kind) ? mailer.customerOff(a.customer_id, kind) : mailer.userOff(a.id, kind));
    return {
      email: a.email || '',
      verified: !!a.verified_at,
      kinds: mailer.kindsFor(a).map((kind) => ({ kind, label: MAIL_KINDS[kind], on: !off(kind) })),
    };
  }

  router.get('/me/mail', requireRole(), (req, res) => res.json(myMail(req.user.id)));

  router.put('/me/mail', requireRole(), (req, res) => {
    const a = mailer.account(req.user.id);
    const b = req.body || {};
    const email = b.email === undefined ? a.email || null : emailParam(b.email);
    const changed = email !== (a.email || null);
    transaction(db, () => {
      if (changed) {
        if (a.customer_id) db.prepare('UPDATE customers SET email = ?, email_verified_at = NULL WHERE id = ?').run(email, a.customer_id);
        else db.prepare('UPDATE users SET email = ?, email_verified_at = NULL WHERE id = ?').run(email, a.id);
      }
      const kinds = b.kinds && typeof b.kinds === 'object' ? b.kinds : {};
      for (const kind of mailer.kindsFor(a)) {
        if (kinds[kind] === undefined) continue;
        const byCustomer = a.role === 'customer' && CUSTOMER_KINDS.includes(kind);
        const [table, column, id] = byCustomer ? ['customer_mail_prefs', 'customer_id', a.customer_id] : ['mail_prefs', 'user_id', a.id];
        if (kinds[kind]) db.prepare(`DELETE FROM ${table} WHERE ${column} = ? AND kind = ?`).run(id, kind);
        else db.prepare(`INSERT OR IGNORE INTO ${table} (${column}, kind) VALUES (?, ?)`).run(id, kind);
      }
    });
    // A new address, or one still unconfirmed saved again: the confirmation link (once every 10 minutes).
    let confirmationSent = false;
    const verified = !changed && !!a.verified_at;
    if (email && !verified) {
      const recent = db
        .prepare("SELECT 1 FROM mail_tokens WHERE kind = 'verify' AND email = ? AND used_at IS NULL AND created_at > datetime('now', '-10 minutes')")
        .get(email);
      if (changed || !recent) confirmationSent = mailer.sendVerify({ userId: a.id, customerId: a.customer_id, email, name: a.name });
    }
    res.json({ ...myMail(a.id), confirmationSent });
  });

  // Réglages → Mails: whether sending is on, from which address, and the latest mails.
  router.get('/mail/status', requireRole('manager'), (req, res) => {
    const cfg = mailer.mail.config();
    res.json({
      configured: !!cfg.key,
      from: cfg.from,
      replyTo: cfg.replyTo || null,
      appUrl: mailer.appUrl(),
      counts: Object.fromEntries(
        db.prepare("SELECT status, COUNT(*) AS n FROM mail_log WHERE created_at >= datetime('now', '-30 days') GROUP BY status").all().map((r) => [r.status, r.n]),
      ),
      log: db.prepare('SELECT id, created_at, kind, to_addr, subject, status, error FROM mail_log ORDER BY id DESC LIMIT 40').all(),
    });
  });

  router.post('/mail/test', requireRole('manager'), requireAdmin, (req, res) => {
    const a = mailer.account(req.user.id);
    if (!a.email) fail(400, 'Ajoutez d’abord votre adresse dans « Mes mails ».', 'no_email');
    mailer.sendTest(a.id);
    res.json({ ok: true, to: a.email, configured: mailer.mail.configured() });
  });

  return router;
}

module.exports = mailRoutes;
module.exports.emailParam = emailParam;
