const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { HttpError } = require('./util');

const scrypt = promisify(crypto.scrypt);

const COOKIE = 'sid';
const READS = new Set(['GET', 'HEAD']);
const SESSION_DAYS = 7;

// scrypt runs off the main thread, so a login never blocks the other requests.
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

// Unknown logins are checked against this hash too, so the response time does not reveal which accounts exist.
const DUMMY_HASH = `${'0'.repeat(32)}:${'0'.repeat(128)}`;

async function verifyPassword(password, stored) {
  const [salt, hash] = (stored || DUMMY_HASH).split(':');
  const candidate = await scrypt(String(password), Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex')) && Boolean(stored);
}

function checkPasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpError(400, 'Le mot de passe doit contenir au moins 8 caractères.');
  }
  return password;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function startSession(db, req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400e3);
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    sha256(token),
    userId,
    expires.toISOString().replace('T', ' ').slice(0, 19),
  );
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    expires,
    path: '/',
  });
}

// After a password change: every other session of the user ends, the current one stays.
function endOtherSessions(db, req, userId) {
  const token = readCookie(req, COOKIE);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, token ? sha256(token) : '');
}

function endSession(db, req, res) {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(COOKIE, { path: '/' });
}

// Attaches req.user when a valid session cookie is present.
function loadUser(db) {
  const stmt = db.prepare(`
    SELECT u.id, u.name, u.login, u.role, u.customer_id
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.active = 1`);
  return (req, res, next) => {
    const token = readCookie(req, COOKIE);
    req.user = token ? stmt.get(sha256(token)) || null : null;
    // The owner (actionnaire) reads what the manager reads: on a read request they pass as a
    // manager; any other request keeps the owner role, which no write route accepts.
    if (req.user?.role === 'owner') req.user = { ...req.user, owner: true, role: READS.has(req.method) ? 'manager' : 'owner' };
    // The admin is a manager who may also change the settings and the cash book (requireAdmin).
    if (req.user?.role === 'admin') req.user = { ...req.user, admin: true, role: 'manager' };
    next();
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) throw new HttpError(401, 'Veuillez vous connecter.');
    if (roles.length && !roles.includes(req.user.role)) {
      if (req.user.owner) throw new HttpError(403, 'Lecture seule : l’actionnaire consulte sans rien modifier.', 'read_only');
      throw new HttpError(403, 'Accès refusé.');
    }
    next();
  };
}

// The settings, the team and the cash book: changed by the admin only.
function requireAdmin(req, res, next) {
  if (!req.user) throw new HttpError(401, 'Veuillez vous connecter.');
  if (!req.user.admin) throw new HttpError(403, 'Réservé à l’administrateur : les réglages et la caisse ne se modifient que par lui.', 'admin_only');
  next();
}

// Simple in-memory brute-force protection for the login form.
function loginLimiter({ max = 10, windowMs = 15 * 60e3 } = {}) {
  const failures = new Map();
  return {
    check(key) {
      const entry = failures.get(key);
      if (entry && entry.until > Date.now() && entry.count >= max) {
        throw new HttpError(429, 'Trop de tentatives. Réessayez dans quelques minutes.');
      }
    },
    fail(key) {
      // Expired entries are dropped so the map cannot grow without limit.
      if (failures.size > 1000) for (const [k, e] of failures) if (e.until < Date.now()) failures.delete(k);
      const entry = failures.get(key);
      if (!entry || entry.until < Date.now()) failures.set(key, { count: 1, until: Date.now() + windowMs });
      else entry.count += 1;
    },
    reset(key) {
      failures.delete(key);
    },
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  checkPasswordStrength,
  startSession,
  endSession,
  endOtherSessions,
  loadUser,
  requireRole,
  requireAdmin,
  loginLimiter,
};
