// « Demander à l'appli » : a question in French from the manager or the owner, answered by Claude
// from the station's database. Claude writes SELECT queries (the `sql` tool) and reads their rows;
// the connection is read-only while they run, and secrets (passwords, sessions, keys) stay out.
const claude = require('./claude');

const MODEL = process.env.ASK_MODEL || 'claude-sonnet-5-5';
const MAX_TURNS = 8;
const MAX_ROWS = 200;

// Tables Claude does not see: sign-in, mail plumbing, per-user screen preferences, its own log.
const HIDDEN = new Set([
  'sessions', 'mail_tokens', 'known_devices', 'mail_log', 'mail_prefs', 'customer_mail_prefs', 'mail_jobs', 'mail_cursors',
  'mail_alerts_sent', 'alert_prefs', 'alert_hidden', 'checkpoint_seen', 'ai_questions', 'meter_photos',
]);
const FORBIDDEN = new RegExp(`\\b(${[...HIDDEN, 'password_hash', 'token', 'token_hash', 'mail_secret', 'sqlite_master', 'sqlite_schema', 'pragma', 'attach', 'detach', 'load_extension', 'vacuum'].join('|')})\\b`, 'i');

const SQL_TOOL = {
  name: 'sql',
  description: `Exécute une requête SELECT (ou WITH … SELECT) en lecture seule sur la base SQLite de la station. Renvoie au plus ${MAX_ROWS} lignes en JSON.`,
  input_schema: { type: 'object', properties: { sql: { type: 'string', description: 'Une seule requête SQLite, sans point-virgule.' } }, required: ['sql'], additionalProperties: false },
};

// The tables as they are now (with the columns added by migrations), and how to read them.
function systemPrompt(db) {
  const tables = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid")
    .all()
    .filter((t) => !HIDDEN.has(t.name))
    .map((t) => t.sql.replace(/password_hash[^,\n]*,?/g, ''));
  return [
    'Tu réponds aux questions du gérant ou de l’actionnaire d’une station-service à Goma (RD Congo), à partir de sa base de données SQLite.',
    'Utilise l’outil sql autant que nécessaire (requêtes SELECT), puis réponds.',
    '',
    'Règles de la station :',
    '- Montants en dollars US. Heure locale : Africa/Lubumbashi. Les colonnes created_at, opened_at, closed_at sont en UTC : utilise date(x, \'localtime\') ou datetime(x, \'localtime\') pour les jours et les heures. expense_date est déjà une date locale.',
    '- Un poste (shifts) va d’une clôture (vers 15 h 30) à la suivante ; un seul est ouvert (status \'open\'), les autres sont \'closed\' (\'validated\' = ancien clôturé).',
    '- Les ventes de carburant d’un poste viennent des index : shift_readings (start_meter, end_meter, liters, amount, unit_price) ; shifts.total_liters et total_amount pour un poste clôturé. Le poste ouvert n’a pas encore d’index de fin.',
    '- La table sales ne contient PAS toutes les ventes : seulement les crédits (kind \'credit\'), le carburant échangé contre des combos (\'combo\') et les crédits payés dans leur propre poste (\'paid\').',
    '- Solde d’un client = crédits (sales kind \'credit\') + anciennes dettes (old_debts) − règlements (payments). Négatif = avance. customers.type : \'account\' = abonné, \'individual\' = particulier.',
    '- Mobile money : momo_sales (carburant payé) et payments.method = \'mobile money\'. Dépenses : expenses (shift_id vide = hors poste). Livraisons : deliveries ; jaugeages : dips ; tests de pompe approuvés (pump_tests.status \'approved\') : remis en cuve, pas vendus.',
    '- shifts.variance : écart de caisse à la clôture (négatif = manque). Pompistes : users (role \'attendant\') et shift_attendants.',
    '- Une ligne avec cancel_requested_at attend une annulation ; une opération annulée n’existe plus.',
    '',
    'Réponse : en français, courte (1 à 6 lignes), les chiffres à la française (1 234,50 $ ; 2 345,6 L), sans Markdown (ni astérisques ni tableaux) ; un tiret en début de ligne pour une liste. Dis sur quelle période tu as compté quand la question ne la précise pas.',
    'Si les données ne permettent pas de répondre, ou si la question ne porte pas sur la station, dis-le en une phrase. Ne donne jamais de mot de passe, de jeton ni de clé.',
    '',
    'Tables :',
    ...tables,
  ].join('\n');
}

// Values that must never leave: the mail signing key, password hashes.
function scrub(db, rows) {
  const secret = db.prepare("SELECT value FROM settings WHERE key = 'mail_secret'").get()?.value;
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row)
        .filter(([key]) => !/password|token|secret/i.test(key))
        .map(([key, v]) => [key, typeof v === 'string' && ((secret && v.includes(secret)) || /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(v)) ? '[masqué]' : v]),
    ),
  );
}

// One query from Claude: SELECT only, read-only connection, at most MAX_ROWS rows.
function runSql(db, sql) {
  const text = String(sql || '').trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(text) || text.includes(';')) return { error: 'Une seule requête SELECT, sans point-virgule.' };
  if (FORBIDDEN.test(text)) return { error: 'Ces données ne sont pas accessibles.' };
  db.exec('PRAGMA query_only = 1');
  try {
    const rows = db.prepare(`SELECT * FROM (${text}) LIMIT ${MAX_ROWS + 1}`).all();
    return { rows: scrub(db, rows.slice(0, MAX_ROWS)), ...(rows.length > MAX_ROWS ? { truncated: true } : {}) };
  } catch (err) {
    return { error: err.message };
  } finally {
    db.exec('PRAGMA query_only = 0');
  }
}

// The answer (text) and the tokens spent; text null when Claude gave none.
async function answer(db, question) {
  const system = [{ type: 'text', text: systemPrompt(db), cache_control: { type: 'ephemeral' } }];
  const today = db.prepare("SELECT datetime('now', 'localtime') AS t").get().t;
  const messages = [{ role: 'user', content: `Nous sommes le ${today} (heure de Goma).\n\nQuestion : ${question}` }];
  const usage = { input: 0, output: 0 };
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const last = turn === MAX_TURNS - 1; // the last turn answers with what was found
    const msg = await claude.converse({ model: MODEL, system, tools: [SQL_TOOL], toolChoice: last ? { type: 'none' } : undefined, messages });
    usage.input += (msg.usage?.input_tokens || 0) + (msg.usage?.cache_read_input_tokens || 0) + (msg.usage?.cache_creation_input_tokens || 0);
    usage.output += msg.usage?.output_tokens || 0;
    messages.push({ role: 'assistant', content: msg.content });
    const calls = msg.content.filter((b) => b.type === 'tool_use');
    if (msg.stop_reason !== 'tool_use' || !calls.length) {
      const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { text: text || null, usage };
    }
    messages.push({ role: 'user', content: calls.map((c) => ({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(runSql(db, c.input?.sql)) })) });
  }
  return { text: null, usage };
}

module.exports = { answer, runSql, systemPrompt, MODEL };
