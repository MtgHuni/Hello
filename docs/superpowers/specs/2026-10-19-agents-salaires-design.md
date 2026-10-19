# Agents et salaires : fiche, avances, paie du mois

Conception validée le 2026-10-19. Elle couvre les points 1, 2 et 3 du plan proposé : la fiche de chaque agent, les avances sur salaire et la paie du mois. Viendront plus tard : les retenues sur les manques (4), l'espace de l'agent sur son téléphone (7) et le suivi par agent dans les rapports (8). La présence (5) et les primes (6) ne sont pas retenues.

## Ce que veut l'utilisateur

- Tous les agents de la station ont une fiche : pompistes, gérant, caissier, gardiens…, même ceux qui ne se connectent pas à l'appli.
- L'administrateur crée les fiches et fixe les salaires. Le gérant donne les avances et paie, comme il saisit déjà les dépenses. L'actionnaire lit tout et ne change rien.
- Une avance sort de la caisse (espèces ou mobile money), ou de l'argent du poste en cours ; le gérant choisit à chaque fois.
- Les salaires sont mensuels, en dollars.

## Principe

Une avance et un paiement de salaire sont des **dépenses « Salaires » reliées à l'agent**. La caisse, le rapprochement du poste, les rapports, le rapport financier et le journal en tiennent donc compte sans rien changer chez eux :

- payée depuis la caisse, la dépense sort du livre de caisse par son mode (espèces ou mobile money), comme toute dépense hors poste ;
- payée avec l'argent du poste en cours, c'est une dépense de ce poste : elle diminue ce que les pompistes remettent à la clôture, comme une dépense saisie au poste.

## 1. Fiche agent

Champs : nom, téléphone, fonction (Pompiste, Gérant, Caissier, Gardien, Autre), date d'entrée, salaire mensuel ($), compte de connexion relié (facultatif, un compte au plus par fiche et une fiche au plus par compte), date de départ (vide tant que l'agent est là).

- **Paie depuis** : le mois à partir duquel l'appli compte le salaire (par défaut le mois où la fiche est créée). Les mois d'avant ne comptent pas, même si l'agent est entré bien avant : rien ne reste dû sur des mois payés hors de l'appli.
- **Changement de salaire** : l'administrateur donne le nouveau montant et le mois d'où il compte ; les mois d'avant gardent l'ancien. L'historique est gardé.
- **Mois partiel** : un mois commencé (date d'entrée) ou fini (date de départ) en cours de route est payé au prorata des jours du mois. Exemple : entré le 16 octobre, il touche 16/31 du salaire d'octobre.
- Création et changements (salaire, départ, compte relié) sont notés au journal.

## 2. Avances

Sur la fiche de l'agent, le gérant saisit : le montant, la date (aujourd’hui par défaut, jamais plus tard) et d'où sort l'argent : « Espèces », « Mobile money » ou « Argent du poste ».

- L'avance devient une dépense « Salaires » (description « Avance sur salaire », bénéficiaire le nom de l'agent), datée du jour saisi.
- « Argent du poste » : seulement s'il y a un poste ouvert ; la dépense est celle de ce poste, à la date du jour.
- L'avance se retire du salaire du **mois de sa date**.
- Le gérant peut l'annuler depuis la fiche ; elle est alors supprimée comme une dépense (gardée au journal). Prise dans l'argent d'un poste déjà clôturé, le poste est recalculé, comme pour toute dépense de poste annulée après la clôture.

## 3. Paie du mois

Écran « Agents » : le mois choisi (le mois en cours par défaut, avec le mois précédent et les autres à choisir), puis une ligne par agent :

| Salaire du mois | Reste du mois d'avant | Avances | Déjà payé | Net à payer |
|---|---|---|---|---|

- **Salaire du mois** : le salaire en vigueur ce mois-là, au prorata si le mois est partiel.
- **Reste du mois d'avant** : positif si le salaire d'avant n'est pas entièrement payé, négatif si les avances ont dépassé le salaire.
- **Net à payer** = salaire du mois + reste du mois d'avant − avances du mois − déjà payé pour ce mois. Ce qui reste (dû ou trop avancé) passe au mois suivant.
- **Payer** : le montant proposé est le net, modifiable (payer en plusieurs fois) ; d'où sort l'argent comme pour une avance. Le paiement devient une dépense « Salaires » (description « Salaire d'octobre 2026 »), datée du jour, et compte pour le mois affiché, même payé le 3 du mois suivant.
- En haut : le total des salaires du mois, ce qui est payé, ce qui reste à payer.
- Un agent apparaît dans un mois s'il y a un salaire, un reste du mois d'avant ou une opération ce mois-là ; un agent parti disparaît une fois son reste à zéro.
- **Bulletin de paie** (PDF, A4, comme les autres rapports) d'un agent pour un mois : station, agent, fonction, mois ; salaire (avec les jours si le mois est partiel), reste du mois d'avant, chaque avance (date, d'où), chaque paiement (date, d'où), net payé et reste. Bouton « Partager » (feuille de partage du téléphone : WhatsApp…), comme les autres PDF.

## La catégorie « Salaires » ailleurs

- Elle n'est plus proposée dans les formulaires de dépense ordinaires (Dépenses, dépense du poste du pompiste, « Ajouter une opération » de la clôture) : un salaire passe toujours par Agents. Le serveur refuse une nouvelle dépense « Salaires » hors d'Agents.
- Les dépenses « Salaires » déjà saisies restent telles quelles, modifiables comme avant (leur catégorie reste affichée dans le formulaire de modification).
- Une dépense reliée à un agent ne se modifie pas depuis Dépenses ni depuis le poste ; on l'annule depuis la fiche de l'agent et on la refait. Sa suppression depuis Dépenses reste possible et la retire de la paie.

## Écrans

- Nouvelle rubrique « Agents » dans le menu du gérant et de l'actionnaire (icône `user` déjà dans l'appli), entre Dépenses et Cuves.
- `#/agents` : la paie du mois (ci-dessus) ; « Nouvel agent » pour l'administrateur ; une ligne touchée ouvre la fiche.
- `#/agents/<id>` : la fiche (coordonnées, salaire et son historique), « Avance » et « Payer » (gérant), « Modifier » (administrateur), puis les avances et paiements par mois, chacun avec son bulletin.
- L'actionnaire voit tout sans aucun bouton qui écrit. Les pompistes ne voient rien.
- Pas de texte d'explication : seulement les chiffres, les statuts (« Parti le … », « Payé », « Reste à payer ») et les états vides.

## Données (version 31 de la base)

- `staff` : id, name, phone, function, hired_on, left_on, pay_from (`AAAA-MM`), user_id (unique, facultatif), created_at.
- `staff_salaries` : staff_id, from_month (`AAAA-MM`), amount ; un montant par mois de départ.
- `expenses` gagne trois colonnes (migrations) : `staff_id`, `pay_month` (`AAAA-MM`), `pay_kind` (`avance` | `salaire`).
- Copie de la base avant la mise à jour, comme d'habitude ; test de migration depuis la version 30.

## Serveur

- `src/routes/staff.js` : `GET /staff?month=` (la paie du mois), `GET /staff/:id`, `POST /staff` et `PUT /staff/:id` (administrateur), `POST /staff/:id/advances` et `POST /staff/:id/payments` (gérant), `DELETE /staff/:id/operations/:expenseId` (gérant), `GET /staff/:id/payslip.pdf?month=`.
- Le calcul d'un mois (salaire, prorata, reste reporté, net) est une seule fonction partagée par l'écran, la fiche et le bulletin.
- Erreurs par `fail()`, en français ; écritures en transaction ; journal pour chaque création, changement, avance, paiement et annulation.

## Tests

Dans `test/api.test.js` : création de fiches (avec et sans compte), droits (administrateur, gérant, actionnaire en lecture, pompiste refusé), prorata d'un mois partiel, changement de salaire, avance depuis la caisse (sortie du livre de caisse) et depuis le poste (rapprochement de la clôture), paiement en deux fois et reste reporté, avance plus grande que le salaire, annulation (avec poste recalculé), refus d'une nouvelle dépense « Salaires » hors d'Agents, bulletin PDF, migration 30 → 31.

## Documentation

README (règles de gestion : agents, avances, paie) et CLAUDE.md (architecture) mis à jour ; captures d'écran de chaque écran.
