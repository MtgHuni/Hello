class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const fail = (status, message, code) => {
  throw new HttpError(status, message, code);
};

const round = (n, digits = 2) => {
  const f = 10 ** digits;
  return Math.round((Number(n) + Number.EPSILON) * f) / f;
};

function num(value, label, { min = 0, max = 1e12, required = true, integer = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) fail(400, `${label} est obligatoire.`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) fail(400, `${label} doit être un nombre.`);
  if (integer && !Number.isInteger(n)) fail(400, `${label} doit être un nombre entier.`);
  if (n < min) fail(400, `${label} doit être supérieur ou égal à ${min}.`);
  if (n > max) fail(400, `${label} doit être inférieur ou égal à ${max}.`);
  return n;
}

function str(value, label, { required = true, max = 200 } = {}) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) {
    if (required) fail(400, `${label} est obligatoire.`);
    return null;
  }
  if (s.length > max) fail(400, `${label} est trop long (${max} caractères max).`);
  return s;
}

function oneOf(value, label, allowed) {
  if (!allowed.includes(value)) fail(400, `${label} invalide.`);
  return value;
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function dateParam(value, label) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, `${label} doit être au format AAAA-MM-JJ.`);
  return value;
}

// Runs fn inside a SQLite transaction (synchronous driver, so no interleaving).
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// CSV cell for Excel: quoted, and text starting with = + - @ is prefixed with ' so it never runs as a formula.
function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

// Amount in dollars for messages and the journal: 1 234,50 $.
const money = (n) => `${(Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

module.exports = { HttpError, fail, round, num, str, oneOf, bool, dateParam, transaction, csvCell, money };
