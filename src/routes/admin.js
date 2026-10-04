const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { requireRole } = require('../auth');
const { audit } = require('../audit');

const manager = requireRole('manager');
const CATEGORIES = ['annulations', 'prix', 'reglages', 'equipe', 'clients', 'postes', 'donnees'];

module.exports = function adminRoutes(db) {
  const router = express.Router();

  // Backup of the whole database. VACUUM INTO writes a consistent copy, WAL included
  // (copying station.db alone can miss the latest writes).
  router.get('/backup', manager, (req, res) => {
    const day = db.prepare("SELECT date('now', 'localtime') AS d").get().d;
    const file = path.join(os.tmpdir(), `station-${crypto.randomUUID()}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    audit(db, req, { category: 'donnees', action: 'backup', entity: 'database', summary: 'Sauvegarde de la base téléchargée' });
    res.download(file, `station-${day}.db`, () => fs.rm(file, { force: true }, () => {}));
  });

  router.get('/audit', manager, (req, res) => {
    const category = CATEGORIES.includes(req.query.category) ? req.query.category : null;
    res.json(
      db
        .prepare(
          `SELECT a.id, a.created_at, a.category, a.action, a.entity, a.entity_id, a.summary, a.reason, u.name AS user_name
           FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
           WHERE (? IS NULL OR a.category = ?)
           ORDER BY a.id DESC LIMIT 300`,
        )
        .all(category, category),
    );
  });

  return router;
};
