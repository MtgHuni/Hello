const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// Meter photos are files beside the database (on Render, the persistent disk), not rows in it: the
// base and its backups stay small. Each is kept a week as the proof of an index, then deleted.
const KEEP_DAYS = 7;

function createPhotoStore(db, dbFile) {
  const dir =
    dbFile && dbFile !== ':memory:' ? path.join(path.dirname(path.resolve(dbFile)), 'photos') : fs.mkdtempSync(path.join(os.tmpdir(), 'station-photos-'));
  fs.mkdirSync(dir, { recursive: true });
  const fileOf = (name) => path.join(dir, path.basename(name));

  // A JPEG sent by the app (base64): written, its row added, its id returned.
  function save({ base64, shiftId, nozzleId, index, userId }) {
    const file = `${crypto.randomUUID()}.jpg`;
    fs.writeFileSync(fileOf(file), Buffer.from(base64, 'base64'));
    return Number(
      db
        .prepare('INSERT INTO meter_photos (file, shift_id, nozzle_id, read_index, user_id) VALUES (?, ?, ?, ?, ?)')
        .run(file, shiftId ?? null, nozzleId ?? null, index ?? null, userId ?? null).lastInsertRowid,
    );
  }

  // The file of a photo still kept, or null.
  function read(id) {
    const row = db.prepare('SELECT file FROM meter_photos WHERE id = ?').get(id);
    if (!row || !fs.existsSync(fileOf(row.file))) return null;
    return fileOf(row.file);
  }

  // Photos older than a week: the files, then their rows.
  function cleanup() {
    const old = db.prepare(`SELECT id, file FROM meter_photos WHERE created_at < datetime('now', '-${KEEP_DAYS} days')`).all();
    for (const p of old) fs.rmSync(fileOf(p.file), { force: true });
    if (old.length) db.prepare(`DELETE FROM meter_photos WHERE created_at < datetime('now', '-${KEEP_DAYS} days')`).run();
    return old.length;
  }

  return { dir, save, read, cleanup };
}

module.exports = { createPhotoStore, KEEP_DAYS };
