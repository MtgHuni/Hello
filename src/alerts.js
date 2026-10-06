// The dashboard's alerts, as each manager (or owner) wants them: a type can be switched off, and an
// alert can be hidden until it changes (its text: a lower stock, a bigger debt) or goes away.

const ALERT_TYPES = {
  stock_bas: 'Stock bas d’une cuve',
  cloture: 'Clôture à faire',
  argent_a_compter: 'Argent à compter après une clôture',
  ecart_caisse: 'Écart de caisse d’un poste',
  ecart_jaugeage: 'Écart de jaugeage',
  tests_pompe: 'Tests de pompe à confirmer',
  annulations: 'Annulations à valider',
  abonne_retard: 'Abonné en retard de paiement',
  credit_retard: 'Crédit accordé à un abonné en retard',
  clients_a_completer: 'Clients créés à la pompe, à compléter',
  fournisseurs: 'Dettes envers les fournisseurs',
};

// alerts: [{ type, key, level, text, link }] -> what this user sees, and everything to manage them.
function userAlerts(db, userId, alerts) {
  const off = new Set(db.prepare('SELECT type FROM alert_prefs WHERE user_id = ?').all(userId).map((r) => r.type));
  const keys = new Set(alerts.map((a) => a.key));
  const hidden = new Map();
  for (const r of db.prepare('SELECT key, text FROM alert_hidden WHERE user_id = ?').all(userId)) {
    // Gone from the board: forget it, so the same alert shows again if it comes back.
    if (!keys.has(r.key)) db.prepare('DELETE FROM alert_hidden WHERE user_id = ? AND key = ?').run(userId, r.key);
    else hidden.set(r.key, r.text);
  }
  const all = alerts.map((a) => ({ ...a, off: off.has(a.type), hidden: hidden.get(a.key) === a.text }));
  return {
    visible: all.filter((a) => !a.off && !a.hidden).map(({ off: _o, hidden: _h, ...a }) => a),
    manage: { all, types: Object.entries(ALERT_TYPES).map(([type, label]) => ({ type, label, off: off.has(type) })) },
  };
}

module.exports = { ALERT_TYPES, userAlerts };
