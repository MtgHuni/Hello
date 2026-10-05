# Station service

Application web de gestion d'une station-service (gasoil, essence) : postes des pompistes avec rapprochement index/caisse, cuves et livraisons, clients en compte et clients fidélité, tableau de bord et rapports.

Trois espaces, selon le rôle :

| Rôle | Ce qu'il fait |
|------|---------------|
| **Gérant** | Tableau de bord et alertes, **état du poste en cours** (ventes relevées, crédits, règlements, dépenses, argent remis à chaque relève, contrôle des index sans rien enregistrer), clôture du poste à 15 h 30 (définitive, sans validation ; correction d'une clôture, remarque au pompiste), cuves (livraisons payées comptant ou à crédit, dettes et paiements fournisseurs, jaugeages), **livre de caisse** (espèces et mobile money séparés, apports, retraits, comptages, PDF ; pas de banque), clients (crédit, règlements, anciennes dettes d’avant l’application, créances par ancienneté avec relance WhatsApp, relevés PDF), dépenses, rapports (marge, écarts par pompiste) en PDF et Excel, réglages (prix, prix programmés, pompes, équipe), sauvegarde et journal |
| **Pompiste** | Sur téléphone : prend le poste (plusieurs pompistes peuvent y être ensemble), passe le relais à la pause (index et argent remis au suivant, qui reçoit un mini-rapport), fait la fermeture du soir (19 h : index, argent, rapport de ses ventes) et l’ouverture du matin (6 h 30) ; saisit les **crédits** (et crée un client avec son seul nom), encaisse un règlement, même d’une dette d’avant l’application (le client inconnu est créé sur place ; le surplus est déclaré comme ancienne dette ou gardé en avance), note une dépense payée en caisse. La clôture de 15 h 30 (index de fin et comptage en dollars) est faite par le gérant et ouvre aussitôt le poste suivant ; le rapport PDF du poste se télécharge ou se partage. Lit les remarques du gérant sur ses postes (accueil et historique) |
| **Client** | Crée son compte avec son téléphone, prépare un achat à crédit pendant qu'il attend (le pompiste confirme d'un geste), suit son solde et télécharge son relevé du mois |

## Principes de gestion

- **Rapprochement de poste** : litres = index fin − index début − tests de pompe approuvés (par pistolet). Montant à remettre = monnaie reçue à l'ouverture + litres × prix public + supplément des abonnés − ventes à crédit − carburant échangé contre des combos + règlements encaissés − dépenses payées en caisse. Le mobile money ne se compte pas : le pompiste saisit chaque paiement mobile money au moment où il est fait (les litres et le carburant, le montant au prix du poste), et le total, avec les règlements reçus en mobile money, s'affiche à la clôture. Écart = espèces comptées + mobile money saisi − montant à remettre. Tout est compté en dollars.
- **Monnaie laissée aux pompistes** : à la clôture, le gérant indique la monnaie qu'il laisse aux pompistes, puis les espèces qu'ils lui remettent. Espèces à remettre = à remettre − mobile money − monnaie laissée ; seules les espèces remises vont à la caisse. Le poste suivant reçoit la monnaie : elle compte dans le premier rapport de relève (« Monnaie reçue à la clôture ») et s'ajoute à ce qu'il doit remettre à sa clôture. Le rapport du poste montre la monnaie reçue, la monnaie laissée, les espèces à remettre et remises ; il montre aussi les cuves à la clôture (vendu, stock, niveau).
- **Caisse** : une dépense payée par le pompiste sort du livre de caisse dès qu'elle est saisie ; à la clôture, le poste entre avec ses dépenses (le solde ne change pas). Un mouvement saisi à la main est une entrée ou une sortie, avec son motif ; depuis le mobile money, aussi un retrait vers la caisse.
- **Tests de pompe** : le carburant sorti à la pompe pour un test puis remis dans la cuve. Le pompiste le saisit (pistolet, litres) sur « Mon poste » ; le gérant l'approuve ou le refuse sur la fiche du poste, même après la clôture (le poste est alors recalculé). Approuvé, il n'est pas compté comme vendu et reste dans le stock de la cuve ; refusé, il est vendu. Saisi par le gérant, il est approuvé d'office.
- **Catégories de clients** (réglées dans Réglages → Clients et combos) :
  - **Particulier** : plafond de crédit fixe, le même pour tous ;
  - **Abonné** : prix au litre plus élevé (colonne « Prix abonnés » de chaque produit), plafond plus haut, et le total du mois doit être payé avant le jour fixé du mois suivant ; passé ce jour, un abonné qui doit encore le mois précédent ne peut plus prendre à crédit (sauf crédit accordé par le pompiste, signalé au gérant).
- **Combos** (points de fidélité, désactivés par défaut, à activer dans Réglages) : X combos par litre acheté à crédit, gagnés seulement quand le crédit est entièrement payé (les règlements soldent les crédits du plus ancien au plus récent). À partir du seuil, le client échange ses combos contre du carburant (valeur d'un combo en $), à la pompe ou depuis son téléphone.
- **Nouveau client à la pompe** : le pompiste saisit seulement le nom ; le client est créé comme particulier et apparaît « À compléter » chez le gérant jusqu'à ce que sa fiche soit remplie.
- **Crédit accordé par le pompiste** : au-delà du plafond, le pompiste peut accorder le crédit après confirmation ; la vente est marquée « hors plafond » avec son nom et signalée au gérant.
- **Annulation d'une opération** (vente, paiement mobile money, règlement, dépense) : le pompiste la demande, avec une raison ; l'opération reste comptée jusqu'à la décision du gérant, qui l'annule ou la garde depuis la fiche du poste (alerte sur le tableau de bord). Une annulation acceptée après la clôture refait le rapprochement.
- **Dépenses** : par catégorie (salaires, électricité, générateur…). Celles payées avec la caisse d'un poste font partie de son rapprochement et ne sont plus modifiables après la clôture.
- **Marge brute estimée** = litres vendus × (prix de vente − coût d'achat moyen pondéré des livraisons) ; **résultat net estimé** = marge brute − dépenses.
- Les **index de début** sont repris automatiquement de la clôture précédente : le pompiste ne peut pas les modifier.
- Le **prix** est figé à l'ouverture du poste : un changement de prix s'applique au poste suivant.
- **Stock théorique** d'une cuve = dernier jaugeage + livraisons − litres vendus. Chaque jaugeage enregistre l'écart, puis devient la nouvelle référence.
- **Ventes** : les ventes payées ne sont **pas saisies** : les index les comptent à la clôture. Le pompiste ne saisit que les **crédits** (et les échanges de combos s'ils sont actifs) ; ils s'ajoutent au solde du client et sont bloqués au-delà du plafond, sauf crédit accordé par le pompiste.
- **Demande d'achat du client** : depuis son téléphone, le client choisit le carburant et le montant ($ ou litres), **à crédit** (un achat comptant se paie directement à la pompe). La demande apparaît en haut de l'écran du pompiste (actualisé toutes les 4 secondes, avec vibration) ; elle ne devient une vente, visible du gérant, qu'une fois confirmée. Les demandes non traitées expirent après 30 minutes.
- **Saisie rapide par le pompiste** : un seul champ client (nom, plaque ou téléphone) avec les trois clients les plus proches à toucher ; un nouveau client se crée par sa propre pastille. Produit et unité en un geste, montant en dollars converti en litres au prix du poste. Un formulaire renvoyé après une coupure réseau n'enregistre jamais deux fois.
- **Clôture corrigée par le gérant** : il peut corriger les index et le comptage ; les compteurs et le stock des cuves sont recalculés, le motif est gardé au journal.
- **Prix programmé** : un nouveau prix peut prendre effet à une date ; il s'applique au premier poste ouvert ensuite.
- **Journal** (Réglages) : annulations acceptées ou refusées (l'opération supprimée y reste lisible), prix, réglages, index corrigés, équipe, clôtures corrigées, sauvegardes.
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
| `TZ` | Fuseau horaire de la station (journées des rapports) | `Africa/Lubumbashi` |

## Mise en ligne

Le fichier `render.yaml` permet de déployer sur [Render](https://render.com) : *New → Blueprint*, choisir ce dépôt. Il prévoit un disque persistant pour la base de données (offre payante « Starter »). Sans disque persistant, les données seraient perdues à chaque redémarrage : sur un service créé à la main, ajoutez un disque (*Disks*, chemin `/var/data`) et la variable `DB_FILE=/var/data/station.db`. Sur Render, `/api/health` indique `storage: "disque"` ou `"temporaire"`.

Sauvegarde : Réglages → Données → **Télécharger une sauvegarde** (copie complète et cohérente de la base, à garder ailleurs). Ne copiez pas `station.db` seul : en mode WAL, les dernières écritures sont dans `station.db-wal`. Avant chaque mise à jour de la structure de la base, une copie `station.db.avant-migration-…` est gardée à côté.

## Structure

```
server.js              démarrage
src/app.js             application Express
src/db.js              schéma SQLite et réglages
src/auth.js            mots de passe, sessions, rôles
src/routes/            API : auth, config (prix, cuves, pompes), stock, shifts, customers, requests, expenses, users, reports, admin (sauvegarde, journal)
src/pdf.js, src/pdfReport.js   PDF sans dépendance et mise en page des rapports
src/shiftReport.js, src/periodReport.js, src/statementReport.js   rapports PDF (poste, période, relevé client)
public/                interface (HTML, CSS, JavaScript sans framework)
public/js/views/       un fichier par écran
test/                  tests de l'API
```

## Données de test

Pour ne pas tout ressaisir à chaque essai :

- `npm run seed` remplit les cuves à 90 % (avec une livraison « Données de test » dans l'historique) et applique des prix de test (gasoil 1,35 ; essence 1,55). Le compte gérant doit déjà exister.
- Variable `DEMO_SEED=1` (par exemple dans Render, *Environment*) : à chaque démarrage, les cuves sous 50 % sont complétées et les prix ne sont posés que s'ils n'ont jamais été modifiés. Rien n'est ajouté dès qu'un poste existe. À retirer en production.
