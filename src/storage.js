// Where the database lives. On Render, only a persistent disk survives a deploy: a database on
// the instance's own file system is erased each time, and the station has to be set up again.
const fs = require('node:fs');
const path = require('node:path');

let storage = null;

// 'disque': its folder is a mounted disk (another device than the root), 'temporaire' otherwise.
// Only said on Render: elsewhere (a computer, the tests) the question does not arise.
function checkStorage(dbFile) {
  storage = null;
  if (!process.env.RENDER || dbFile === ':memory:') return null;
  try {
    const dir = path.dirname(path.resolve(dbFile));
    storage = fs.statSync(dir).dev !== fs.statSync(path.parse(dir).root).dev ? 'disque' : 'temporaire';
  } catch {
    storage = 'temporaire';
  }
  if (storage === 'temporaire') {
    console.warn(`ATTENTION : la base ${dbFile} n'est pas sur un disque persistant : elle sera effacée au prochain déploiement. Ajoutez un disque sur Render (Disks, chemin /var/data) et DB_FILE=/var/data/station.db.`);
  }
  return storage;
}

const storageOf = () => storage;

module.exports = { checkStorage, storageOf };
