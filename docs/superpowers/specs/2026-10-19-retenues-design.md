# Retenues sur salaire : crédits de plus d'un mois, dépenses marquées

Conception validée le 2026-10-19 (suite de `2026-10-19-agents-salaires-design.md`). L'administrateur peut tout ce que peut le gérant ; seul le changement d'agent d'un crédit lui est réservé.

## Ce que veut l'utilisateur

- Un particulier peut avoir plusieurs crédits.
- Quand le premier crédit non payé d'un particulier a plus d'un mois, chacun de ses crédits non payés est retenu sur le salaire de l'agent qui l'a accordé.
- Les dépenses faites par un agent peuvent être retenues sur son salaire : celles que le gérant marque.
- Si le client paie ensuite, l'agent est remboursé sur la paie suivante.
- La retenue est automatique ; le gérant peut la pardonner (journal).
- L'administrateur peut indiquer qui a accordé un crédit.

## 1. Plusieurs crédits pour un particulier

- Un particulier qui doit encore peut recevoir un nouveau crédit si le pompiste confirme « Accorder quand même » (`grantCredit`). Le crédit est marqué `over_limit = 2` (1 reste « malgré le retard » d'un abonné) : « Crédit malgré un crédit en cours » à l'écran, dans le PDF du poste et le relevé ; une alerte « Crédit accordé malgré un crédit en cours » (type `credit_en_cours`) prévient le gérant.
- La demande d'achat du client depuis son téléphone reste refusée tant qu'il doit (inchangé).

## 2. Qui a accordé le crédit

- L'agent du crédit : `sales.staff_id` s'il est donné par l'administrateur, sinon la fiche reliée au compte qui a saisi le crédit (`sales.user_id`). Sans fiche : pas de retenue.
- `PUT /staff/credits/:saleId { staffId }` (administrateur, journal `agents`) : depuis le poste (crédit touché → « Accordé par… ») et depuis la retenue sur la fiche de l'agent.

## 3. Retenue d'un crédit

- Un client particulier est « en retard » quand son plus ancien crédit non payé (vente à crédit de l'appli, les règlements soldant du plus ancien au plus récent, anciennes dettes d'abord) date de plus d'un mois : `date(jour, '+1 month') < aujourd'hui` (un crédit du 19 septembre compte à partir du 20 octobre).
- Pour chaque crédit d'un client en retard, la partie non payée est retenue à son agent. Un crédit déjà retenu le reste sur sa partie non payée, même si le client n'est plus en retard. Un nouveau crédit d'un client en retard est retenu aussitôt.
- Ce que le client paie ensuite sur un crédit retenu est rendu à l'agent ; un crédit annulé ou changé d'agent aussi.
- Seuls les crédits du mois « Paie depuis » de l'agent ou d'après comptent. Les abonnés ne sont pas concernés.

## 4. Retenue d'une dépense

- Le gérant touche une dépense (au poste ou dans Dépenses) → « Retenir sur un salaire » → l'agent (par défaut celui qui l'a saisie). Une dépense n'est retenue qu'une fois (409 sinon).
- Retenue pour son montant ; dépense annulée → rendu ; montant corrigé → la différence. La dépense reste une dépense de la station.

## 5. Calcul et paie

- Table `staff_deductions` (version 32) : une ligne par mouvement, `amount` > 0 retenue, < 0 rendu ; `reason` `retenue` | `rendu` | `pardon` ; la source (`sale_id` ou `expense_id`) ; `pay_month` = le mois où la ligne est écrite. Rien n'est réécrit : un mois passé ne change pas.
- `syncDeductions(db)` (`src/deductions.js`) : pour chaque source, cible − déjà retenu = la ligne à écrire (retenue ou rendu). Appelé chaque minute (tâches des mails), à la lecture de la paie et après chaque action.
- Pardon : `POST /staff/:id/deductions/forgive { saleId | expenseId }` (gérant) écrit `pardon` de −(ce qui reste retenu) ; la source n'est plus jamais retenue pour cet agent.
- Marquer une dépense : `POST /staff/:id/deductions { expenseId }` (gérant).
- Paie : `retenu` du mois = somme des lignes du mois ; net = salaire + reste d'avant − avances − payé − retenues. Colonne « Retenues » de la paie ; sur la fiche, une ligne par mouvement (client et date du crédit, ou dépense) que le gérant touche pour pardonner, l'administrateur pour changer l'agent d'un crédit ; une section « Retenues » dans le bulletin.

## Tests

Deux crédits (le 2ᵉ avec confirmation), agent donné par l'administrateur (gérant refusé), le 1er vieilli de 40 jours → les deux retenus ; le client paie une partie → rendu ; pardon → plus rien ; un crédit récent d'un autre client → rien ; dépense marquée, marquée deux fois (409), annulée → rendue ; bulletin ; actionnaire en lecture ; migration 31 → 32.
