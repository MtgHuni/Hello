// Journal: who changed what and when. Entries stay even when the item itself is
// deleted (an accepted cancellation keeps the full row in `before`).
//   category: the Journal filter — annulations, prix, reglages, equipe, clients, postes, donnees
//   summary:  the French line shown to the manager
function audit(db, req, { category, action, entity, id = null, summary, before = null, after = null, reason = null }) {
  db.prepare(
    `INSERT INTO audit_log (user_id, category, action, entity, entity_id, summary, before, after, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    req.user?.id ?? null,
    category,
    action,
    entity,
    id,
    summary,
    before == null ? null : JSON.stringify(before),
    after == null ? null : JSON.stringify(after),
    reason || null,
  );
}

module.exports = { audit };
