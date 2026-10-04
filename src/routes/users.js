const express = require('express');
const { fail, str, oneOf, bool } = require('../util');
const { requireRole, hashPassword, checkPasswordStrength } = require('../auth');
const { audit } = require('../audit');

const ROLE = { manager: 'gérant', attendant: 'pompiste' };

const manager = requireRole('manager');

module.exports = function userRoutes(db) {
  const router = express.Router();
  const select = `SELECT id, name, login, role, active, created_at FROM users WHERE role IN ('manager', 'attendant')`;

  router.get('/users', manager, (req, res) => {
    res.json(db.prepare(`${select} ORDER BY role, name COLLATE NOCASE`).all());
  });

  router.post('/users', manager, async (req, res) => {
    const name = str(req.body?.name, 'Le nom', { max: 100 });
    const login = str(req.body?.login, "L'identifiant", { max: 100 });
    const role = oneOf(req.body?.role, 'Le rôle', ['manager', 'attendant']);
    const password = checkPasswordStrength(req.body?.password);
    if (db.prepare('SELECT 1 FROM users WHERE login = ?').get(login)) fail(409, 'Cet identifiant est déjà utilisé.');
    const id = db
      .prepare('INSERT INTO users (name, login, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(name, login, await hashPassword(password), role).lastInsertRowid;
    audit(db, req, { category: 'equipe', action: 'user', entity: 'users', id: Number(id), summary: `Membre ajouté : ${name} (${ROLE[role]}, identifiant ${login})` });
    res.status(201).json(db.prepare(`${select} AND id = ?`).get(id));
  });

  router.put('/users/:id', manager, async (req, res) => {
    const user = db.prepare(`${select} AND id = ?`).get(req.params.id);
    if (!user) fail(404, 'Utilisateur introuvable.');
    const name = str(req.body?.name, 'Le nom', { required: false, max: 100 }) ?? user.name;
    const role = req.body?.role ? oneOf(req.body.role, 'Le rôle', ['manager', 'attendant']) : user.role;
    const active = bool(req.body?.active, !!user.active) ? 1 : 0;
    if (user.id === req.user.id && (!active || role !== 'manager')) {
      fail(400, 'Vous ne pouvez pas désactiver ni rétrograder votre propre compte.');
    }
    const passwordHash = req.body?.password ? await hashPassword(checkPasswordStrength(req.body.password)) : null;
    db.prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?').run(name, role, active, user.id);
    if (passwordHash) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, user.id);
    const changes = [
      name !== user.name ? `nom ${user.name} → ${name}` : null,
      role !== user.role ? `${ROLE[user.role]} → ${ROLE[role]}` : null,
      active !== user.active ? (active ? 'réactivé' : 'désactivé') : null,
      passwordHash ? 'mot de passe réinitialisé' : null,
    ].filter(Boolean);
    if (changes.length) {
      audit(db, req, { category: 'equipe', action: 'user', entity: 'users', id: user.id, summary: `${user.name} : ${changes.join(', ')}` });
    }
    if (!active || req.body?.password) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    res.json(db.prepare(`${select} AND id = ?`).get(user.id));
  });

  return router;
};
