// Sending e-mail through Resend (https://resend.com), with Node's own fetch: no dependency.
// RESEND_API_KEY turns sending on; without it every mail is still written to mail_log
// (status « skipped »), so nothing breaks in development or in the tests.
// MAIL_FROM is the sender (an address on a domain verified in Resend), MAIL_REPLY_TO where
// replies go. Mails leave one by one (Resend accepts 2 requests a second) after the request
// that asked for them has answered: a slow or failing mail never holds the app up.

const RESEND_URL = 'https://api.resend.com/emails';
const GAP_MS = 600;

function mailConfig() {
  return {
    key: process.env.RESEND_API_KEY || '',
    from: process.env.MAIL_FROM || 'MTG Station <station@mtgindustrie.com>',
    replyTo: process.env.MAIL_REPLY_TO || '',
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mails sent (or on their way) today and this month, against the provider's limits.
function mailUsage(db) {
  const limit = (name, fallback) => Math.max(1, Number(process.env[name]) || fallback);
  const count = (where) => db.prepare(`SELECT COUNT(*) AS n FROM mail_log WHERE status IN ('sent', 'queued') AND ${where}`).get().n;
  return {
    day: { count: count("date(created_at, 'localtime') = date('now', 'localtime')"), limit: limit('MAIL_DAY_LIMIT', 100) },
    month: { count: count("strftime('%Y-%m', created_at, 'localtime') = strftime('%Y-%m', 'now', 'localtime')"), limit: limit('MAIL_MONTH_LIMIT', 3000) },
  };
}

function createMail(db) {
  db.prepare("DELETE FROM mail_log WHERE kind = 'essai'").run();
  const insert = db.prepare('INSERT INTO mail_log (kind, to_addr, subject, status, user_id, customer_id) VALUES (?, ?, ?, ?, ?, ?)');
  const done = db.prepare("UPDATE mail_log SET status = 'sent', provider_id = ? WHERE id = ?");
  const failed = db.prepare("UPDATE mail_log SET status = 'failed', error = ? WHERE id = ?");
  let chain = Promise.resolve();
  // The latest mails, in memory (tests, and MAIL_DEBUG in development).
  const outbox = [];

  async function deliver(id, cfg, m) {
    try {
      const res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: cfg.from,
          to: [m.to],
          subject: m.subject,
          html: m.html,
          text: m.text,
          ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}),
          ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64') })) } : {}),
          ...(m.unsubscribeUrl ? { headers: { 'List-Unsubscribe': `<${m.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}),
        }),
        signal: AbortSignal.timeout(30e3),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || `réponse ${res.status}`);
      done.run(body.id ?? null, id);
    } catch (err) {
      failed.run(String(err.message || err).slice(0, 300), id);
      console.error(`Mail n°${id} non envoyé (${m.kind}, ${m.to}) : ${err.message || err}`);
    }
  }

  // m: { kind, to, subject, html, text, attachments?: [{ filename, content }], unsubscribeUrl?, userId?, customerId? }
  // The mail is logged at once (the caller's transaction keeps it or not), sent afterwards.
  function queue(m) {
    const cfg = mailConfig();
    const id = Number(insert.run(m.kind, m.to, m.subject, cfg.key ? 'queued' : 'skipped', m.userId ?? null, m.customerId ?? null).lastInsertRowid);
    outbox.push({ id, kind: m.kind, to: m.to, subject: m.subject, text: m.text, attachments: (m.attachments || []).map((a) => a.filename) });
    if (outbox.length > 100) outbox.shift();
    if (!cfg.key) {
      if (process.env.MAIL_DEBUG === '1') console.log(`[mail non envoyé] ${m.to} · ${m.subject}\n${m.text}\n`);
      return id;
    }
    chain = chain.then(() => deliver(id, cfg, m)).then(() => sleep(GAP_MS));
    return id;
  }

  // Waits for the mails already queued (tests, shutdown).
  const flush = () => chain;

  return { queue, flush, outbox, configured: () => !!mailConfig().key, config: mailConfig };
}

module.exports = { createMail, mailConfig, mailUsage };
