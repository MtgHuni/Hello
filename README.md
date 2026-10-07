# Station service

Application web de gestion d'une station-service (gasoil, essence) : postes des pompistes avec rapprochement index/caisse, cuves et livraisons, clients en compte et clients fidélité, tableau de bord et rapports.

Cinq espaces, selon le rôle :

| Rôle | Ce qu'il fait |
|------|---------------|
| **Administrateur** | Tout ce que fait le gérant, et seul à modifier les **réglages** (prix, compteurs, équipe, station, catégories de clients), la **caisse** (mouvements, solde de départ, comptages) et les **fiches fournisseurs** (nom, téléphone, e-mail ; un nouveau nom suit sur leurs livraisons et paiements). Il télécharge la sauvegarde et ouvre le journal. Le compte créé à l’installation est l’administrateur ; à la mise à jour, le premier gérant le devient |
| **Gérant** | Voit les réglages tels qu’ils sont choisis, sans aucun bouton, et consulte la caisse sans la modifier (il télécharge le livre de caisse). Tableau de bord et alertes, **état du poste en cours** (ventes relevées, crédits, règlements, dépenses, argent remis à chaque relève, contrôle des index sans rien enregistrer), clôture du poste à 15 h 30 **en deux temps** (les index seulement : le poste se ferme et le suivant s’ouvre aussitôt ; puis « Compter l’argent » quand il est prêt, avec une alerte « argent à compter » en attendant ; définitive, sans validation ; correction d’une clôture (index et argent) ; une opération mal saisie par le pompiste (crédit, règlement, mobile money, dépense) se corrige ou s’annule en la touchant dans sa liste, poste ouvert ou clôturé ; le poste est recalculé et tout est gardé au journal), cuves (livraisons payées avec la caisse, avec l’argent du poste en cours — une dépense « Paiement fournisseur » du poste, retirée de l’argent à remettre et du résultat net, déjà compté dans la marge —, ou à crédit, dettes et paiements fournisseurs avec leurs coordonnées — un fournisseur se paie aussi par une dépense « Paiement fournisseur » (du poste ou hors poste) en le nommant dans « Payé à », ce qui baisse son reste à payer —, jaugeages), **livre de caisse** (espèces et mobile money séparés, apports, retraits, comptages ; PDF du livre entier, des entrées seules ou des sorties seules sur une période ; pas de banque), clients (crédit — un particulier qui doit encore un crédit n’en reçoit pas d’autre avant de l’avoir payé, personne ne peut l’accorder, même par une demande préparée ; sa fiche montre seulement le solde et les achats —, règlements, anciennes dettes d’avant l’application, créances par ancienneté avec relance WhatsApp, relevé PDF partagé sur la période affichée), dépenses, rapports (marge, écarts par pompiste, caisse : soldes et mouvements des espèces et du mobile money) en PDF et Excel, réglages (prix, prix programmés, compteurs essence et gasoil, équipe), sauvegarde et journal |
| **Pompiste** | Sur téléphone : prend le poste (plusieurs pompistes peuvent y être ensemble), passe le relais à la pause (index et argent remis au suivant, qui reçoit un mini-rapport), fait la fermeture du soir (19 h : index, argent, rapport de ses ventes) et l’ouverture du matin (6 h 30) ; saisit les **crédits** (et crée un client avec son seul nom), encaisse un règlement, même d’une dette d’avant l’application (le client inconnu est créé sur place ; le surplus est déclaré comme ancienne dette ou gardé en avance), note une dépense payée en caisse. La clôture de 15 h 30 (index de fin et comptage en dollars) est faite par le gérant et ouvre aussitôt le poste suivant ; le rapport PDF du poste se télécharge ou se partage. Lit les remarques du gérant sur ses postes (accueil et historique) |
| **Actionnaire** | Consulte ce que voit le gérant (tableau de bord, postes et leurs rapports PDF, caisse, clients, dépenses, cuves, rapports), sauf les réglages et le journal, sans rien pouvoir modifier : les boutons d’écriture n’apparaissent pas et le serveur refuse toute modification. Peut contrôler les compteurs sur l’état du poste (rien n’est enregistré) et changer son mot de passe ; la sauvegarde reste au gérant. Le gérant crée son accès dans Réglages → Équipe |
| **Client** | Crée son compte avec son téléphone, ou reçoit son accès du gérant (« Créer un accès » sur sa fiche : identifiant = son téléphone, mot de passe par défaut 12345678 qu'il change ensuite dans son espace ; le lien, l'identifiant et le mot de passe partent par le partage du téléphone : WhatsApp, SMS…), prépare un achat à crédit pendant qu'il attend (le pompiste confirme d'un geste), suit son solde et partage son relevé PDF sur la période affichée (« Partager » dans le relevé) ; en pied de page, « Pour toute question ou plus d’informations, contactez-nous » avec SMS, WhatsApp et appel vers le numéro de la station (Réglages → Station) |

## Principes de gestion

- **Rapprochement de poste** : litres = index fin − index début − tests de pompe confirmés (par produit : une pompe, un compteur essence et un compteur gasoil). Montant à remettre = monnaie reçue à l'ouverture + litres × prix public + supplément des abonnés − ventes à crédit − carburant échangé contre des combos + règlements encaissés − dépenses payées en caisse ± mouvements du livre de caisse faits dans l’argent du poste (une entrée ou une sortie d’espèces, ou un retrait de mobile money vers la caisse, enregistré dans Caisse avec « Dans l’argent du poste en cours »). Le mobile money ne se compte pas : le pompiste saisit chaque paiement mobile money au moment où il est fait (les litres et le carburant, le montant au prix du poste), et le total, avec les règlements reçus en mobile money, s'affiche à la clôture. Écart = espèces comptées + mobile money saisi − montant à remettre. Tout est compté en dollars.
- **Monnaie laissée aux pompistes** : à la clôture, le gérant indique la monnaie qu'il laisse aux pompistes, puis les espèces qu'ils lui remettent. Espèces à remettre = à remettre − mobile money − monnaie laissée ; seules les espèces remises vont à la caisse. Le poste suivant reçoit la monnaie : elle compte dans ses rapports de relève (« Monnaie reçue à la clôture ») et s'ajoute à ce qu'il doit remettre à sa clôture.
- **Relèves, fermeture et ouverture** : chaque rapport part toujours des index de l'ouverture du poste (litres, ventes, crédits, règlements, dépenses depuis l'ouverture) et compare l'argent attendu à l'argent en caisse à ce moment ; l'état du poste du gérant compte aussi depuis l'ouverture. Quand un pompiste fait une relève, tous les autres pompistes voient son mini-rapport s'afficher sur leur téléphone, même s'ils sont déjà en service, une seule fois chacun. Le rapport du poste montre la monnaie reçue, la monnaie laissée, les espèces à remettre et remises ; il montre aussi les cuves à la clôture (vendu, stock, niveau). Ordre du rapport PDF : ventes par les index, crédits, dépenses, règlements, tests de pompe, caisse, cuves.
- **Caisse** : une dépense payée par le pompiste sort du livre de caisse dès qu'elle est saisie ; à la clôture, le poste entre avec ses dépenses (le solde ne change pas). Un mouvement saisi à la main est une entrée ou une sortie, avec son motif ; depuis le mobile money, aussi un retrait vers la caisse.
- **Tests de pompe** : le carburant sorti à la pompe pour un test puis remis dans la cuve. Le pompiste le saisit (produit, litres) sur « Mon poste » ; une alerte prévient le gérant, qui le confirme ou l'annule une seule fois sur la fiche du poste, même après la clôture (le poste est alors recalculé). Confirmé, il n'est pas compté comme vendu et reste dans le stock de la cuve ; annulé, il est vendu. Saisi par le gérant, il est confirmé d'office.
- **Catégories de clients** (réglées dans Réglages → Clients et combos) :
  - **Particulier** : un seul crédit à la fois, sans plafond : tant qu'il doit un crédit, il n'en reçoit pas d'autre (une carte d'alerte au centre de l'écran le dit au pompiste, avec chaque crédit encore dû : date, carburant, litres, reste à payer, qui l'a saisi) ;
  - **Abonné** : prix au litre plus élevé (colonne « Prix abonnés » de chaque produit), pas de plafond, et le total du mois doit être payé avant **son** jour de paiement du mois suivant (réglé sur la fiche de chaque abonné, de 1 à 28 ; le réglage de la station n'est que la valeur proposée pour un nouvel abonné) ; passé ce jour, un abonné qui doit encore le mois précédent ne peut plus prendre à crédit (sauf crédit accordé par le pompiste, signalé au gérant).
- **Combos** (points de fidélité, désactivés par défaut, à activer dans Réglages) : X combos par litre acheté à crédit, gagnés seulement quand le crédit est entièrement payé (les règlements soldent les crédits du plus ancien au plus récent). À partir du seuil, le client échange ses combos contre du carburant (valeur d'un combo en $), à la pompe ou depuis son téléphone.
- **Nouveau client à la pompe** : le pompiste saisit seulement le nom ; le client est créé comme particulier et apparaît « À compléter » chez le gérant jusqu'à ce que sa fiche soit remplie.
- **Noms des clients** : deux clients ne portent jamais le même nom (comparé sans majuscules, accents ni espaces en trop), à la création, au renommage, à la pompe et à l’inscription. Les homonymes d’avant cette règle sont marqués « Même nom » dans la liste. **Client en double ou saisi par erreur** : « Supprimer » sur sa fiche le retire tel quel s’il n’a aucune opération ; sinon le gérant choisit le bon client, qui reçoit ses crédits, règlements, anciennes dettes, demandes et son accès client (et son téléphone, son e-mail, sa plaque, son adresse s’il n’en a pas), puis la fiche est supprimée (gardée au journal).
- **Il n'y a plus de plafond de crédit.** **Crédit accordé par le pompiste** : à un abonné en retard, le pompiste peut accorder le crédit après confirmation ; la vente est marquée « crédit malgré le retard » avec son nom et signalée au gérant.
- **Alertes du tableau de bord** : « Gérer » sur la carte Alertes permet à chacun (gérant, administrateur, actionnaire) de masquer une alerte (elle revient si elle change ou se reproduit) ou de couper un type d'alerte entier ; ces choix ne changent que son propre tableau de bord.
- **Annulation d'une opération** (vente, paiement mobile money, règlement, dépense) : le pompiste la demande, avec une raison ; l'opération reste comptée jusqu'à la décision du gérant, qui l'annule ou la garde depuis la fiche du poste (alerte sur le tableau de bord). Une annulation acceptée après la clôture refait le rapprochement.
- **Dépenses** : par catégorie (salaires, électricité, générateur…). Celles payées avec la caisse d'un poste font partie de son rapprochement et ne sont plus modifiables après la clôture.
- **Marge brute estimée** = litres vendus × (prix de vente − coût d'achat moyen pondéré des livraisons) ; **résultat net estimé** = marge brute − dépenses.
- Les **index de début** sont repris automatiquement de la clôture précédente : le pompiste ne peut pas les modifier.
- Le **prix** est figé à l'ouverture du poste : un changement de prix s'applique au poste suivant.
- **Stock théorique** d'une cuve = dernier jaugeage + livraisons − litres vendus. Chaque jaugeage enregistre l'écart, puis devient la nouvelle référence.
- **Livraison ou jaugeage pendant le poste** : les litres vendus ne sortent du stock qu'à la clôture. Le formulaire demande donc l'index actuel de l'essence ou du gasoil (pistolet de la cuve) : le carburant vendu depuis l'ouverture (index − index d'ouverture − tests de pompe approuvés) est retiré du stock affiché, qui reste ainsi sous la capacité. Une livraison qui ferait dépasser la capacité demande confirmation ; la clôture refuse un index inférieur à celui donné à la livraison.
- **Ventes** : les ventes payées ne sont **pas saisies** : les index les comptent à la clôture. Le pompiste ne saisit que les **crédits** (et les échanges de combos s'ils sont actifs) ; ils s'ajoutent au solde du client ; un particulier qui doit encore un crédit n'en reçoit pas d'autre.
- **Crédit payé pendant son propre poste** : le règlement ne s’écrit pas comme un règlement, et le crédit n’est plus un crédit : le plein devient une vente payée (comptée par les index comme les autres), dans le rapport, les relèves, le PDF et le relevé du client. Payé en partie, le plein est coupé en deux (la partie payée et le crédit qui reste, litres répartis) ; payé par mobile money, la partie payée est aussi une entrée mobile money du poste ; ce qui dépasse le crédit est un règlement ordinaire (ancienne dette ou avance). Un crédit d’un poste précédent se règle comme avant. Chaque cas est noté au journal.
- **Index pris en photo** : à côté de chaque index (clôture, relève, fermeture, livraison, jaugeage), le bouton appareil photo ouvre la caméra du téléphone ; la photo, réduite sur le téléphone, est lue par l’IA de Claude (quelques secondes), qui cherche le totalisateur et non l’affichage de la vente. Le chiffre lu se met dans le champ : le pompiste le vérifie avant d’enregistrer. Une virgule mal placée est corrigée d’après le dernier index ; un chiffre qui ne peut pas suivre le dernier index est signalé « À vérifier ». Rien n’est gardé de la photo. Illisible ou sans réseau : on tape l’index comme avant.
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
| `RESEND_API_KEY` | Clé [Resend](https://resend.com) : sans elle, les mails sont notés (Réglages → Mails) mais pas envoyés | — |
| `ANTHROPIC_API_KEY` | Clé de l’API Claude ([console.anthropic.com](https://console.anthropic.com)) : lit l’index sur la photo d’un compteur (bouton appareil photo à côté de chaque index). Sans elle, le bouton n’apparaît pas et l’index se tape | — |
| `METER_MODEL` | Modèle qui lit les photos de compteur | `claude-sonnet-5-5` |
| `MAIL_FROM` | Expéditeur des mails, sur un domaine vérifié dans Resend | `MTG Station <station@mtgindustrie.com>` |
| `MAIL_REPLY_TO` | Adresse où vont les réponses des clients | l’expéditeur |
| `MAIL_DAY_LIMIT` / `MAIL_MONTH_LIMIT` | Limites d’envoi du forfait Resend : alerte au tableau de bord dès 80 % | `100` / `3000` (forfait gratuit) |
| `APP_URL` | Adresse de l’application, pour les liens des mails | l’adresse par laquelle on l’a ouverte |
| `MAIL_DEBUG` | `1` : affiche dans le terminal les mails non envoyés | — |

## Mise en ligne

Le fichier `render.yaml` permet de déployer sur [Render](https://render.com) : *New → Blueprint*, choisir ce dépôt. Il prévoit un disque persistant pour la base de données (offre payante « Starter »). Sans disque persistant, les données seraient perdues à chaque redémarrage : sur un service créé à la main, ajoutez un disque (*Disks*, chemin `/var/data`) et la variable `DB_FILE=/var/data/station.db`. Sur Render, `/api/health` indique `storage: "disque"` ou `"temporaire"`.

Sauvegarde : Réglages → Données → **Télécharger une sauvegarde** (copie complète et cohérente de la base, à garder ailleurs). Ne copiez pas `station.db` seul : en mode WAL, les dernières écritures sont dans `station.db-wal`. Avant chaque mise à jour de la structure de la base, une copie `station.db.avant-migration-…` est gardée à côté.

## Mails

Envoyés par [Resend](https://resend.com) depuis `station@mtgindustrie.com` (`src/mail.js`, sans dépendance), aux couleurs de la station (`src/mailTemplates.js`), avec une version texte. Tant que `RESEND_API_KEY` manque, chaque mail est seulement noté dans Réglages → Mails (« Derniers mails »).

| Pour | Mails |
|------|-------|
| Tout compte | Lien « Mot de passe oublié » (écran de connexion ; valable une heure, une seule fois, seulement vers une adresse confirmée), « Mot de passe modifié », « Nouvelle connexion » depuis un appareil inconnu, confirmation d’une nouvelle adresse |
| Client (adresse de sa fiche) | Accès à l’espace client (« Créer un accès »), reçu de chaque règlement, chaque plein à crédit, relevé du mois en PDF le 1er, rappel avant le jour de paiement d’un abonné puis relance en cas de retard (le lendemain et une semaine après), nouveaux prix. Chaque mail porte un lien « Ne plus recevoir ces mails » |
| Gérant, administrateur, actionnaire | Rapport PDF de chaque poste une fois l’argent compté, rapport de la semaine (lundi) et du mois (le 1er), nouvelles alertes du tableau de bord (une fois chacune, selon ses choix d’alertes) |
| Administrateur | Sauvegarde de la base, compressée, le dimanche soir |

Chacun donne son adresse et choisit ses mails dans son menu (ses initiales) → **Mes mails** ; l’administrateur peut saisir l’adresse d’un membre dans Réglages → Équipe. Une adresse de l’équipe ne reçoit rien avant d’être confirmée par le lien reçu. Les envois programmés suivent l’heure de Goma (rapports à 7 h, relevés et rappels à 8 h, sauvegarde à 22 h) ; les reçus et pleins partent une minute après la saisie.

Pour brancher l’envoi : créer un compte Resend, y ajouter le domaine `mtgindustrie.com` et recopier ses enregistrements DNS (SPF, DKIM) chez l’hébergeur du domaine, puis mettre la clé dans `RESEND_API_KEY` sur Render. L’offre gratuite de Resend envoie 100 mails par jour (3 000 par mois).

Le logo rond à côté de l’expéditeur, dans la liste des mails, vient du domaine (BIMI), pas du mail : le logo est `public/media/bimi-mtg.svg` (SVG Tiny PS), à déclarer dans le DNS de `mtgindustrie.com` avec une politique DMARC appliquée :

| Nom | Type | Valeur |
|---|---|---|
| `_dmarc` | TXT | `v=DMARC1; p=quarantine; pct=100; adkim=r; aspf=r` |
| `default._bimi` | TXT | `v=BIMI1; l=https://station.mtgindustrie.com/media/bimi-mtg.svg;` |

Yahoo et d’autres l’affichent ainsi ; Apple Mail demande en plus Apple Business Connect (« Branded Mail », gratuit), Gmail un certificat de logo (VMC ou CMC, payant).

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
