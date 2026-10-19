# Agents et salaires — plan de mise en œuvre

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** une fiche par agent, les avances sur salaire et la paie du mois, chaque avance et chaque paiement étant une dépense « Salaires » reliée à l'agent.

**Architecture:** deux tables (`staff`, `staff_salaries`) et trois colonnes sur `expenses` (`staff_id`, `pay_month`, `pay_kind`). Le calcul d'un mois vit dans `src/payroll.js` (une seule fonction pour l'écran, la fiche et le bulletin) ; les routes dans `src/routes/staff.js` ; l'écran dans `public/js/views/staff.js`. La caisse, le rapprochement des postes et les rapports lisent déjà les dépenses : ils ne changent pas.

**Tech Stack:** Node ≥ 22.13 (`node:sqlite`), Express 5, modules ES sans framework, `node:test`, PDF maison (`src/pdfReport.js`).

**Spec:** `docs/superpowers/specs/2026-10-19-agents-salaires-design.md`

## Global Constraints

- Tout le texte visible, les messages d'erreur et le README en français ; montants en dollars ; fuseau `Africa/Lubumbashi`.
- Aucun texte d'explication à l'écran hors Réglages : données, statuts, états vides, messages d'erreur.
- Boutons groupés de même largeur, centrés sur téléphone (`buttonRow` / `pageHeader` le font déjà).
- Erreurs levées par `fail(status, message, code)` ; écritures à plusieurs étapes dans `transaction(db, fn)` ; chaque changement au journal (`audit`, catégorie `agents`).
- Base en version 31, copie avant mise à jour (déjà faite par `openDb`), test de migration.
- `git push` seulement quand l'utilisateur écrit « push » ; captures d'écran de chaque écran.
- Fonctions : `Pompiste`, `Gérant`, `Caissier`, `Gardien`, `Autre`. Sources de l'argent : `espèces`, `mobile money`, `poste`.

## Review Focus

- Un mois partiel (entrée le 16, départ le 10) : prorata des jours du mois, arrondi au centime. → test tâche 3.
- Une avance plus grande que le salaire : le reste négatif passe au mois suivant et diminue son net. → test tâche 4.
- Le salaire d'octobre payé le 3 novembre : compte pour octobre, pas pour novembre. → test tâche 4.
- Une avance « Argent du poste » annulée après la clôture : le poste est recalculé. → test tâche 4.
- Une dépense « Salaires » existante (sans agent) reste modifiable, et son formulaire garde sa catégorie. → test tâche 4 (serveur) et tâche 6 (option gardée).

---

### Task 1: Base de données, version 31

**Files:**
- Modify: `src/db.js` (SCHEMA, MIGRATIONS, SCHEMA_VERSION, `getSettings`, exports)
- Test: `test/api.test.js` (nouveau test à la fin)

**Interfaces:**
- Produces: tables `staff (id, name, phone, function, hired_on, left_on, pay_from, user_id UNIQUE REFERENCES users(id), created_at)`, `staff_salaries (id, staff_id, from_month, amount, created_at, UNIQUE (staff_id, from_month))` ; colonnes `expenses.staff_id INTEGER REFERENCES staff(id)`, `expenses.pay_month TEXT`, `expenses.pay_kind TEXT` ; constante exportée `SALARY = 'Salaires'` ; `getSettings(db).expenseCategories` sans `SALARY` (le serveur garde `EXPENSE_CATEGORIES` complet pour lire et modifier les anciennes).

- [ ] **Step 1: test « migration 31 : fiches des agents et dépenses reliées »** — ouvre une base fichier, `DROP TABLE staff_salaries; DROP TABLE staff;` puis `ALTER TABLE expenses DROP COLUMN pay_kind/pay_month/staff_id`, `PRAGMA user_version = 30`, ferme, rouvre : `staff`, `staff_salaries` existent, `PRAGMA table_info(expenses)` a les trois colonnes, `user_version` vaut 31.
- [ ] **Step 2:** `npm test -- --test-name-pattern="migration 31"` → échoue.
- [ ] **Step 3:** ajouter tables, migrations, version, `SALARY`, filtre de `expenseCategories`.
- [ ] **Step 4:** `npm test` → tout passe (les 42 d'avant + celui-ci).
- [ ] **Step 5:** commit « Agents : tables de la base (version 31) ».

### Task 2: Calcul d'un mois de paie

**Files:**
- Create: `src/payroll.js`

**Interfaces:**
- Produces:
  - `FUNCTIONS` (liste ci-dessus), `monthLabel('2026-10') → 'octobre 2026'`, `currentMonth(db) → 'AAAA-MM'` (heure locale de SQLite), `addMonths('2026-10', n)`.
  - `salaryOf(db, staff, month) → { base, amount, days, daysInMonth }` : `base` = montant de `staff_salaries` au plus grand `from_month ≤ month` (0 sinon) ; `days` = jours du mois entre `max(hired_on, 1er)` et `min(left_on, dernier jour)` inclus (0 si aucun, et 0 avant `pay_from`) ; `amount = round(base × days / daysInMonth)`.
  - `sheetOf(db, staff, month) → { month, salary, carried, advances: [expense], payments: [expense], advanced, paid, net }` : `carried` = somme, de `pay_from` au mois d'avant, de `salary.amount − avances − paiements` de chaque mois ; `net = round(salary.amount + carried − advanced − paid)`. Les opérations d'un mois sont les dépenses `staff_id = staff.id AND pay_month = month`, par date puis id.
  - `payroll(db, month) → { month, agents: [{ ...staff, user_name, sheet }], totals: { salaries, advanced, paid, net } }` : un agent figure si `salary.amount > 0`, `carried ≠ 0` ou une opération ce mois-là ; trié par nom.

Pas de test propre : le module est vérifié par les tests d'API des tâches 3 et 4 (même app partagée).

- [ ] **Step 1:** écrire le module.
- [ ] **Step 2:** commit avec la tâche 3.

### Task 3: Fiches agents (routes, droits, journal)

**Files:**
- Create: `src/routes/staff.js`
- Modify: `src/app.js` (ajouter `'staff'` à la liste des routes), `src/routes/admin.js` (`CATEGORIES` + `'agents'`), `public/js/views/journal.js` (`['agents', 'Agents']`)
- Test: `test/api.test.js`

**Interfaces:**
- Consumes: `payroll.js` (tâche 2).
- Produces (JSON) :
  - `GET /staff?month=` (gérant, actionnaire) → `payroll(db, month)` + `firstMonth` (le plus petit `pay_from`, ou le mois en cours) ; mois par défaut le mois en cours ; un mois après le mois en cours → 400.
  - `GET /staff/:id` → `{ staff, salaries: [{ from_month, amount }], months: [sheetOf…] }` du mois en cours jusqu'à `pay_from`, le plus récent d'abord.
  - `POST /staff` (administrateur) `{ name, phone, function, hiredOn, salary, payFrom?, userId? }` → 201 la fiche ; `payFrom` par défaut le mois en cours ; `salary` ≥ 0 écrit dans `staff_salaries` au mois `payFrom`.
  - `PUT /staff/:id` (administrateur) `{ name?, phone?, function?, hiredOn?, leftOn?, userId?, salary?, salaryFrom? }` ; `salary` + `salaryFrom` (par défaut le mois en cours, jamais avant `pay_from`) font une ligne de `staff_salaries` (remplacée si le même mois).
  - Refus : compte déjà relié à une autre fiche → 409 `duplicate` ; compte inconnu ou client → 400 ; `leftOn` avant `hiredOn` → 400 ; fonction hors liste → 400.
  - Journal `agents` : « Agent ajouté : … », « Agent modifié : … (salaire 150 $ → 180 $ dès novembre 2026, parti le …) ».

- [ ] **Step 1: test « agents : fiches par l'administrateur, lues par le gérant et l'actionnaire, prorata d'un mois partiel »** :
  - le gérant-admin crée Paul (Pompiste, relié au compte du pompiste des tests, `hiredOn` = le 16 du mois en cours, salaire 155, `payFrom` = mois en cours) et Jean (Gardien, sans compte, `hiredOn` 2025-01-01, salaire 100) → 201 ;
  - une 2ᵉ fiche reliée au même compte → 409 `duplicate` ;
  - `chef` (gérant non admin) `POST /api/staff` → 403 `admin_only` ; `awa` (actionnaire, mot de passe `actionnaire2`) `GET /api/staff` → 200, `POST` → 403 `read_only` ; `pompiste` `GET /api/staff` → 403 ;
  - `GET /api/staff` : Paul `sheet.salary` = `{ base: 155, days: J − 15, daysInMonth: J, amount: round2(155 × (J − 15) / J) }` (J = jours du mois en cours), Jean `amount: 100`, `carried: 0` ;
  - `PUT` salaire de Jean 120 dès le mois suivant : le mois en cours reste 100 ; `GET /api/staff/:id` donne `salaries` des deux montants ;
  - le journal (`GET /api/audit`) a une ligne `agents`.
- [ ] **Step 2:** lancer → échoue.
- [ ] **Step 3:** écrire `src/payroll.js` (tâche 2) et `src/routes/staff.js` (lecture + fiches), brancher dans `app.js`, catégorie de journal.
- [ ] **Step 4:** `npm test` → tout passe.
- [ ] **Step 5:** commit « Agents : fiches, salaire et prorata du mois ».

### Task 4: Avances, paiements, annulation ; « Salaires » réservé aux agents

**Files:**
- Modify: `src/routes/staff.js`, `src/routes/expenses.js`, `src/routes/shifts.js` (création et correction d'une dépense de poste), `src/cashbook.js` (lien de la ligne vers `#/agents/<id>`)
- Test: `test/api.test.js`

**Interfaces:**
- Produces :
  - `POST /staff/:id/advances` (gérant) `{ amount, date?, source }` → 201 la dépense : `category = SALARY`, `description = 'Avance sur salaire : <nom>'`, `beneficiary = <nom>`, `pay_kind = 'avance'`, `pay_month` = mois de la date ; `source` `espèces` | `mobile money` → `method` ; `poste` → dépense du poste ouvert (`shift_id`, `method = 'espèces'`, date du jour ; 409 sans poste ouvert, 409 `station_closed` si la station est fermée). Date après aujourd'hui → 400 ; mois avant `pay_from` → 400.
  - `POST /staff/:id/payments` (gérant) `{ month, amount, source }` → 201 : `description = 'Salaire de <mois> : <nom>'`, `pay_kind = 'salaire'`, `pay_month = month`, datée du jour ; `month` entre `pay_from` et le mois en cours.
  - `DELETE /staff/:id/operations/:expenseId` (gérant) → 204 ; poste clôturé → `mailer.services.reconcile(shift_id)` ; journal `agents` avec la ligne supprimée (`before`).
  - Ailleurs : `POST /expenses` et `POST /shifts/:id/expenses` refusent `SALARY` → 400 `salary_staff` (« Un salaire se paie depuis Agents. ») ; `PUT /expenses/:id` et `PUT /shifts/:id/expenses/:itemId` refusent une dépense avec `staff_id` → 409 `staff_expense`, et refusent de passer une autre dépense à `SALARY` ; une ancienne dépense `SALARY` sans agent garde sa catégorie et se modifie.

- [ ] **Step 1: test « paie : avances depuis la caisse ou le poste, paiement en deux fois, reste reporté »** (Jean, Gardien, 100 $ le mois en cours M) :
  - avance espèces 30 → le livre de caisse (`GET /api/cashbook`) a une sortie espèces de 30 ; avance mobile money 10 → sortie mobile money ;
  - avance `poste` 20 → dépense du poste ouvert (`shift_id` = poste en cours), comptée dans `expenses_amount` du poste à sa clôture ;
  - `GET /api/staff?month=M` : Jean `advanced: 60`, `net: 40` ; paiement 25 puis 15 → `paid: 40`, `net: 0` ;
  - une fiche « Marie » (`payFrom` = M−1, entrée avant M−1, salaire 80) et une avance de 100 datée en M−1 → en M, `carried: -20` et `net: 60` ; un paiement de 10 avec `month: M−1`, daté d'aujourd'hui, compte pour M−1 : en M, `carried: -30`, `paid: 0`, `net: 50` ;
  - mois après le mois en cours → 400 ; date future → 400 ; actionnaire → 403 ;
  - annulation de l'avance `poste` après la clôture du poste → 204, `expenses_amount` du poste diminue de 20 ;
  - `POST /api/expenses { category: 'Salaires' }` → 400 `salary_staff` ; idem au poste ; `PUT /api/expenses/<avance espèces>` → 409 `staff_expense` ; une dépense `Salaires` insérée sans agent (`db.prepare`) se modifie en 200 et garde sa catégorie.
- [ ] **Step 2:** lancer → échoue.
- [ ] **Step 3:** écrire les routes et les refus.
- [ ] **Step 4:** `npm test` → tout passe.
- [ ] **Step 5:** commit « Agents : avances, paie du mois, annulation ».

### Task 5: Bulletin de paie (PDF)

**Files:**
- Create: `src/payslip.js` — `payslipPdf({ staff, sheet, stationName }) → Buffer` sur `Report` : titre « Bulletin de paie », sous-titre « <nom> · <fonction> · <mois> » ; section « Salaire » (salaire du mois, « <jours> jours sur <J> » si partiel, reste du mois d'avant) ; tableau « Avances » (date, d'où, montant) ; tableau « Paiements » (date, d'où, montant) ; lignes « Net payé » et « Reste » (en rouge s'il reste à payer).
- Modify: `src/routes/staff.js` — `GET /staff/:id/payslip.pdf?month=` (gérant, actionnaire), `Content-Disposition: attachment; filename="bulletin-<id>-<mois>.pdf"`.
- Test: `test/api.test.js` (dans le test de la tâche 4) : `GET` → 200, `application/pdf`, commence par `%PDF`.

- [ ] **Step 1:** ajouter l'assertion → échoue.
- [ ] **Step 2:** écrire `payslip.js` et la route.
- [ ] **Step 3:** `npm test` → tout passe.
- [ ] **Step 4:** commit « Agents : bulletin de paie en PDF ».

### Task 6: Écrans « Agents »

**Files:**
- Create: `public/js/views/staff.js` — `renderStaff(page, ctx)` (`#/agents`) et `renderStaffDetail(page, ctx)` (`#/agents/<id>`)
- Modify: `public/js/main.js` (`NAV.manager` : `['agents', 'Agents', 'user', renderStaff]` entre Dépenses et Cuves ; `DETAIL_ROUTES.manager.agents` et `.owner.agents` = `renderStaffDetail`), `public/js/views/shifts.js:192` et le formulaire de modification de `public/js/views/expenses.js` (options = catégories + la catégorie actuelle si elle manque), `public/css/app.css` si une classe manque.

**Interfaces:**
- Consumes: routes des tâches 3 à 5.
- Écran `#/agents` : `pageHeader('Agents', monthLabel)` avec « Nouvel agent » (`adminEdit`) ; sélecteur de mois (`field` select, du mois en cours au `firstMonth`) ; KPI « Salaires du mois », « Avances », « Payé », « Reste à payer » ; `table` : Agent (nom + fonction), Salaire, Reste d'avant, Avances, Payé, Net à payer (badge « Payé » à 0) ; ligne touchée → `#/agents/<id>` ; état vide « Aucun agent. ».
- Écran `#/agents/<id>` : lien retour « Agents » ; `pageHeader(nom, fonction · téléphone · « Parti le … »)` avec « Avance », « Payer » (`edit`), « Modifier » (`adminEdit`) ; carte « Salaire » (montant en vigueur, historique) ; une carte par mois (`months`) : lignes salaire / reste d'avant / avances / paiements / net, « Annuler » sur chaque opération (`edit`, `confirmDialog`), `shareButton` du bulletin.
- Formulaires (`formDialog`) : agent (nom, téléphone, fonction en `select`, date d'entrée, salaire, paie depuis — mois, compte relié — `select` des comptes de `GET /users`, date de départ et « salaire dès » en modification) ; avance (montant, date, source en `segment` : Espèces / Mobile money / Argent du poste) ; paiement (mois en `select`, montant proposé = net, source en `segment`).

- [ ] **Step 1:** écrire les deux vues et les branchements.
- [ ] **Step 2:** serveur local sur une base d'exemple (3 agents, avances, paiements), captures téléphone et bureau des deux écrans et des formulaires ; aucune erreur dans la console.
- [ ] **Step 3:** `npm test` → tout passe.
- [ ] **Step 4:** commit « Agents : écrans paie du mois et fiche ».

### Task 7: Documentation

**Files:**
- Modify: `README.md` (règles de gestion : « Agents et salaires »), `CLAUDE.md` (architecture : tables, `src/payroll.js`, routes, vues, `SALARY`)

- [ ] **Step 1:** écrire les deux paragraphes.
- [ ] **Step 2:** `npm test` → tout passe.
- [ ] **Step 3:** commit « Agents : documentation ».
