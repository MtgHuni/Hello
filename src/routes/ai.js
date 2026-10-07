const express = require('express');
const { fail, num, str, round, transaction } = require('../util');
const { requireRole } = require('../auth');
const { audit } = require('../audit');
const { refreshCustomer } = require('../loyalty');
const claude = require('../claude');
const { aiEnabled, imageParam } = claude;
const reader = require('../meterReader');
const { customerNamed } = require('./customers');

const staff = requireRole('manager', 'attendant');
const manager = requireRole('manager');
const VISION = process.env.PHOTO_MODEL || 'claude-sonnet-5-5';
// The notebook is handwriting, read once: the most capable model.
const NOTEBOOK = process.env.NOTEBOOK_MODEL || 'claude-opus-5-5';

// A plate as the station writes it: capitals, no space nor dash.
const plateKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Photos read by Claude: a meter's index, a page of the old debts notebook, a car's plate.
// Nothing is saved from a photo: what was read fills a form, which is checked before saving.
function aiRoutes(db, { photos } = {}) {
  const router = express.Router();
  const ready = () => {
    if (!aiEnabled()) fail(409, 'La lecture des photos n’est pas disponible.', 'no_reader');
  };

  // ---------- Meter index ----------
  router.post('/meters/read', staff, async (req, res) => {
    ready();
    const image = imageParam(req.body);
    const product = str(req.body?.product, 'Le produit', { required: false, max: 60 });
    const last = req.body?.last == null || req.body.last === '' ? null : num(req.body.last, 'Le dernier index', { max: 1e12 });
    const nozzleId = req.body?.nozzleId ? Number(req.body.nozzleId) : null;
    let read;
    try {
      read = await reader.readMeter({ image, product, last });
    } catch (err) {
      console.error('Lecture du compteur :', err.message);
      fail(422, 'Lecture impossible : tapez l’index.', 'reader_failed');
    }
    if (!read) fail(422, 'Index illisible : reprenez la photo ou tapez-le.', 'unreadable');
    // Kept a week as the proof of the index, linked to the relief or closing the form sends it with.
    const shiftId = db.prepare("SELECT id FROM shifts WHERE status = 'open'").get()?.id;
    const photoId = photos && nozzleId ? photos.save({ base64: image.source.data, shiftId, nozzleId, index: read.index, userId: req.user.id }) : null;
    res.json({ ...read, photoId });
  });

  router.get('/meter-photos/:id', staff, (req, res) => {
    const file = photos?.read(Number(req.params.id));
    if (!file) fail(404, 'Photo effacée : les photos sont gardées une semaine.');
    res.setHeader('Cache-Control', 'private, max-age=604800');
    res.type('image/jpeg').sendFile(file);
  });

  // ---------- Car plate → the customer ----------
  const PLATE = {
    type: 'object',
    properties: { readable: { type: 'boolean' }, plate: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
    required: ['readable', 'plate'],
    additionalProperties: false,
  };
  router.post('/customers/plate/read', staff, async (req, res) => {
    ready();
    const image = imageParam(req.body);
    const out = await claude.askOr422(
      {
        model: VISION,
        schema: PLATE,
        content: [
          image,
          {
            type: 'text',
            text: [
              'Photo d’un véhicule à une station-service de Goma (RD Congo).',
              'Lis la plaque d’immatriculation : lettres et chiffres dans l’ordre, en majuscules, sans espace ni tiret (ex. « 1234AB19 », « CGO1234AA »). Ignore le drapeau, la province et les autres inscriptions.',
              'Si aucune plaque n’est lisible avec certitude, réponds readable: false, plate: null.',
            ].join('\n'),
          },
        ],
      },
      'Lecture de plaque',
    );
    const plate = out?.readable ? plateKey(out.plate) : '';
    console.log(`Lecture de plaque : ${JSON.stringify(out)}`);
    if (plate.length < 3) fail(422, 'Plaque illisible : reprenez la photo ou tapez le nom.', 'unreadable');
    const norm = (col) => `REPLACE(REPLACE(REPLACE(UPPER(${col}), ' ', ''), '-', ''), '.', '')`;
    // The customer's main plate first, else the last credit taken for that plate.
    const found =
      db.prepare(`SELECT id FROM customers WHERE active = 1 AND ${norm('plate')} = ? ORDER BY id LIMIT 1`).get(plate) ||
      db
        .prepare(`SELECT s.customer_id AS id FROM sales s JOIN customers c ON c.id = s.customer_id AND c.active = 1 WHERE ${norm('s.plate')} = ? ORDER BY s.created_at DESC LIMIT 1`)
        .get(plate);
    res.json({ plate, customerId: found?.id ?? null });
  });

  // ---------- The old debts notebook ----------
  const NOTEBOOK_SCHEMA = {
    type: 'object',
    properties: {
      readable: { type: 'boolean' },
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            amount: { type: 'number' },
            currency: { type: 'string', enum: ['USD', 'CDF', 'inconnue'] },
            note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            customer: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
          required: ['name', 'amount', 'currency', 'note', 'customer'],
          additionalProperties: false,
        },
      },
    },
    required: ['readable', 'rows'],
    additionalProperties: false,
  };
  router.post('/customers/notebook/read', manager, async (req, res) => {
    ready();
    const image = imageParam(req.body);
    const names = db.prepare('SELECT name FROM customers ORDER BY name COLLATE NOCASE').all().map((c) => c.name);
    const out = await claude.askOr422(
      {
        model: NOTEBOOK,
        effort: 'medium',
        maxTokens: 16000,
        timeoutMs: 80000,
        schema: NOTEBOOK_SCHEMA,
        content: [
          image,
          {
            type: 'text',
            text: [
              'Page du cahier des dettes d’une station-service de Goma (RD Congo), écrit à la main : qui doit combien à la station, d’avant son logiciel.',
              'Pour chaque personne ou entreprise de la page, donne une ligne : son nom tel qu’écrit (sans abréviation ajoutée), et ce qu’elle doit encore. Si la page montre plusieurs montants pour la même personne (pleins, paiements, montants barrés), calcule ce qui reste dû et explique-le en quelques mots dans « note » (ex. « 3 pleins, 1 paiement »). Sinon note: null ou la date / la plaque écrite à côté.',
              'Les montants sont en dollars (USD) sauf s’il est écrit FC, CDF ou francs (CDF). Si on ne peut pas savoir, « inconnue ». Pas de séparateur de milliers dans « amount ».',
              'Ignore les lignes entièrement barrées ou marquées payé / soldé, et les totaux de page.',
              names.length
                ? `Clients déjà enregistrés : ${names.join(' ; ')}.\nDans « customer », recopie exactement un de ces noms si c’est clairement la même personne (même orthographe à une faute près, prénom et nom inversés), sinon null.`
                : 'Aucun client n’est encore enregistré : customer: null.',
              'Si la page n’est pas lisible, réponds readable: false et rows: [].',
            ].join('\n'),
          },
        ],
      },
      'Lecture du cahier',
    );
    if (!out?.readable || !out.rows?.length) fail(422, 'Page illisible : reprenez la photo, à plat et bien éclairée.', 'unreadable');
    res.json({
      rows: out.rows
        .filter((r) => r.name?.trim() && r.amount > 0)
        .map((r) => {
          const match = customerNamed(db, r.customer || '') || customerNamed(db, r.name);
          return { name: r.name.trim(), amount: round(r.amount), currency: r.currency, note: r.note || null, customerId: match?.id ?? null, customerName: match?.name ?? null };
        }),
    });
  });

  // The rows checked by the manager: each becomes an old debt, on the customer named, created when new.
  router.post('/customers/notebook/import', manager, (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length || rows.length > 200) fail(400, 'Aucune ligne à ajouter.');
    const items = rows.map((r, i) => ({
      name: str(r.name, `Le nom (ligne ${i + 1})`, { max: 120 }),
      amount: round(num(r.amount, `Le montant (ligne ${i + 1})`, { min: 0.01, max: 1e8 })),
      note: str(r.note, `La remarque (ligne ${i + 1})`, { required: false, max: 200 }),
    }));
    const result = transaction(db, () => {
      let created = 0;
      const touched = new Set();
      for (const it of items) {
        let c = customerNamed(db, it.name);
        if (!c) {
          const id = db.prepare("INSERT INTO customers (type, name, needs_review, created_by) VALUES ('individual', ?, 1, ?)").run(it.name, req.user.id).lastInsertRowid;
          c = { id: Number(id), name: it.name };
          created++;
        }
        db.prepare('INSERT INTO old_debts (customer_id, amount, note, user_id) VALUES (?, ?, ?, ?)').run(c.id, it.amount, it.note ? `Cahier — ${it.note}` : 'Cahier', req.user.id);
        touched.add(c.id);
      }
      for (const id of touched) refreshCustomer(db, id);
      const total = round(items.reduce((t, it) => t + it.amount, 0));
      audit(db, req, {
        category: 'clients',
        action: 'notebook_import',
        entity: 'old_debts',
        summary: `Cahier des dettes : ${items.length} dette${items.length > 1 ? 's' : ''} ajoutée${items.length > 1 ? 's' : ''} (${total.toLocaleString('fr-FR')} $), ${created} client${created > 1 ? 's' : ''} créé${created > 1 ? 's' : ''}`,
        after: items,
      });
      return { count: items.length, created, total };
    });
    res.status(201).json(result);
  });

  return router;
}

module.exports = aiRoutes;
