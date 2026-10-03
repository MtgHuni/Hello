# Station service

Application web de gestion d'une station-service (gasoil, essence) : postes des pompistes avec rapprochement index/caisse, cuves et livraisons, clients en compte et clients fidélité, tableau de bord et rapports.

Trois espaces, selon le rôle :

| Rôle | Ce qu'il fait |
|------|---------------|
| **Gérant** | Tableau de bord et alertes, validation des postes, cuves (livraisons, jaugeages), clients (crédit, règlements, relevés), rapports et export Excel, réglages (prix, pompes, pistolets, équipe) |
| **Pompiste** | Sur téléphone : ouvre son poste, saisit les ventes clients, clôture avec les index de fin et le comptage de caisse. L'écart s'affiche immédiatement |
| **Client** | Consulte ses achats, son solde ou ses points, imprime ses relevés |

## Principes de gestion

- **Rapprochement de poste** : litres = index fin − index début (par pistolet). Montant attendu = litres × prix − ventes à crédit. Écart = espèces + cartes déclarées − montant attendu.
- Les **index de début** sont repris automatiquement de la clôture précédente : le pompiste ne peut pas les modifier.
- Le **prix** est figé à l'ouverture du poste : un changement de prix s'applique au poste suivant.
- **Stock théorique** d'une cuve = dernier jaugeage + livraisons − litres vendus. Chaque jaugeage enregistre l'écart, puis devient la nouvelle référence.
- **Clients en compte** (sociétés, flottes) : ventes à crédit, bloquées au-delà du plafond. **Clients particuliers** : paiement normal, points de fidélité.
- Les **tolérances** (écart de caisse en $, écart de jaugeage en litres) déclenchent les alertes du tableau de bord.

## Démarrer en local

Node.js 22.13 ou plus récent est requis (la base SQLite est intégrée à Node, rien d'autre à installer).

```bash
npm install
npm start
```

Ouvrir <http://localhost:3000>. Au premier lancement, un écran crée le compte gérant et la station (une pompe gasoil et une pompe essence, modifiables ensuite).

- `npm run dev` : redémarre le serveur à chaque modification
- `npm test` : tests de l'API

Variables d'environnement :

| Variable | Rôle | Défaut |
|----------|------|--------|
| `PORT` | Port HTTP | `3000` |
| `DB_FILE` | Fichier de la base SQLite | `data/station.db` |
| `TZ` | Fuseau horaire de la station (journées des rapports) | celui du serveur |

## Mise en ligne

Le fichier `render.yaml` permet de déployer sur [Render](https://render.com) : *New → Blueprint*, choisir ce dépôt. Il prévoit un disque persistant pour la base de données (offre payante « Starter »). Sans disque persistant, les données seraient perdues à chaque redémarrage.

Sauvegarde : il suffit de copier le fichier `station.db`.

## Structure

```
server.js              démarrage
src/app.js             application Express
src/db.js              schéma SQLite et réglages
src/auth.js            mots de passe, sessions, rôles
src/routes/            API : auth, config (prix, cuves, pompes), stock, shifts, customers, users, reports
public/                interface (HTML, CSS, JavaScript sans framework)
public/js/views/       un fichier par écran
test/                  tests de l'API
```

## Données de test

Pour ne pas tout ressaisir à chaque essai :

- `npm run seed` remplit les cuves à 90 % (avec une livraison « Données de test » dans l'historique) et applique des prix de test (gasoil 1,35 ; essence 1,55). Le compte gérant doit déjà exister.
- Variable `DEMO_SEED=1` (par exemple dans Render, *Environment*) : à chaque démarrage, les cuves sous 50 % sont complétées et les prix ne sont posés que s'ils n'ont jamais été modifiés. À retirer en production.
