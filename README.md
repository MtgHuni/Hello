# Station service

Application web de gestion d'une station-service (gasoil, essence) : postes des pompistes avec rapprochement index/caisse, cuves et livraisons, clients en compte et clients fidélité, tableau de bord et rapports.

Trois espaces, selon le rôle :

| Rôle | Ce qu'il fait |
|------|---------------|
| **Gérant** | Tableau de bord et alertes, validation des postes, cuves (livraisons, jaugeages), clients (crédit, règlements, relevés, fiches à compléter), dépenses, rapports (marge, résultat) et export Excel, réglages (prix, pompes, pistolets, équipe) |
| **Pompiste** | Sur téléphone : ouvre son poste, saisit les ventes clients (et crée un client avec son seul nom), accorde un crédit, encaisse un règlement, note une dépense payée en caisse, clôture avec les index de fin et le comptage. L'écart s'affiche immédiatement |
| **Client** | Crée son compte avec son téléphone, prépare son plein depuis son téléphone pendant qu'il attend (le pompiste confirme d'un geste), suit ses points, son solde et ses relevés |

## Principes de gestion

- **Rapprochement de poste** : litres = index fin − index début (par pistolet). Montant à remettre = litres × prix public + supplément des abonnés − ventes à crédit − carburant échangé contre des combos + règlements encaissés − dépenses payées en caisse. Écart = espèces + cartes déclarées − montant à remettre.
- **Catégories de clients** (réglées dans Réglages → Clients et combos) :
  - **Particulier** : plafond de crédit fixe, le même pour tous ;
  - **Abonné** : prix au litre plus élevé (colonne « Prix abonnés » de chaque produit), plafond plus haut, et le total du mois doit être payé avant le jour fixé du mois suivant ; passé ce jour, un abonné qui doit encore le mois précédent ne peut plus prendre à crédit (sauf crédit accordé par le pompiste, signalé au gérant).
- **Combos** (points de fidélité) : X combos par litre acheté. Une vente payée les rapporte aussitôt ; une vente à crédit seulement quand elle est entièrement payée (les règlements soldent les crédits du plus ancien au plus récent). À partir du seuil, le client échange ses combos contre du carburant (valeur d'un combo en $), à la pompe ou depuis son téléphone.
- **Nouveau client à la pompe** : le pompiste saisit seulement le nom ; le client est créé comme particulier et apparaît « À compléter » chez le gérant jusqu'à ce que sa fiche soit remplie.
- **Crédit accordé par le pompiste** : au-delà du plafond, le pompiste peut accorder le crédit après confirmation ; la vente est marquée « hors plafond » avec son nom et signalée au gérant.
- **Annulation d'une opération** (vente, règlement, dépense) : le pompiste la demande, avec une raison ; l'opération reste comptée jusqu'à la décision du gérant, qui l'annule ou la garde depuis la fiche du poste (alerte sur le tableau de bord). Un poste ne peut pas être validé tant qu'une annulation est en attente ; une annulation acceptée après la clôture refait le rapprochement.
- **Dépenses** : par catégorie (salaires, électricité, générateur…). Celles payées avec la caisse d'un poste font partie de son rapprochement et ne sont plus modifiables après la clôture.
- **Marge brute estimée** = litres vendus × (prix de vente − coût d'achat moyen pondéré des livraisons) ; **résultat net estimé** = marge brute − dépenses.
- Les **index de début** sont repris automatiquement de la clôture précédente : le pompiste ne peut pas les modifier.
- Le **prix** est figé à l'ouverture du poste : un changement de prix s'applique au poste suivant.
- **Stock théorique** d'une cuve = dernier jaugeage + livraisons − litres vendus. Chaque jaugeage enregistre l'écart, puis devient la nouvelle référence.
- **Ventes clients** : chaque vente à un client identifié est enregistrée : **payée**, **à crédit** ou **en combos**. Seules les ventes à crédit s'ajoutent au solde du client ; elles sont bloquées au-delà du plafond, sauf crédit accordé par le pompiste.
- **Demande d'achat du client** : depuis son téléphone, le client choisit le carburant, le montant ($ ou litres) et le paiement. La demande apparaît en haut de l'écran du pompiste (actualisé toutes les 4 secondes, avec vibration) ; elle ne devient une vente, visible du gérant, qu'une fois confirmée. Les demandes non traitées expirent après 30 minutes.
- **Saisie rapide par le pompiste** : un seul champ client (nom, plaque ou téléphone ; un nom inconnu crée le client), produit, paiement et unité en un geste, montant en dollars converti en litres au prix du poste.
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
