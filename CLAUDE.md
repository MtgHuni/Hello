# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Fuel station management app (gasoil/essence) for a station in Goma, DRC: amounts in US dollars, timezone `Africa/Lubumbashi`. All UI text, server error messages and the README are in **French**; keep it that way. `README.md` documents the business rules (reconciliation formula, customer categories, combos) and is the reference when behavior is in doubt.

## Commands

- `npm start`: serve on `PORT` (3000), with the database at `DB_FILE` (default `data/station.db`).
- `npm run dev`: same, with `--watch`.
- `npm test`: `node:test` API tests.
- Single test: `npm test -- --test-name-pattern="combos"`. The tests in `test/api.test.js` share **one** in-memory app created in `before()` and depend on each other's state (setup → shift → sales…), so a filtered run can fail where the full run passes.

Requires Node ≥ 22.13 (built-in `node:sqlite`, hence `--disable-warning=ExperimentalWarning` in every script). The only dependency is Express 5. There is no build step, no bundler and no linter.

## Architecture

**Server** (`src/`, CommonJS):
- `createApp({ dbFile })` in `src/app.js` mounts each `src/routes/*.js` factory `(db) => Router` under `/api`.
- Errors are thrown, never returned: use `fail(status, message, code)` / `HttpError` from `src/util.js`. The error handler replies `{ error, code }`, and the frontend branches on `code` (e.g. `over_limit` opens a "grant credit?" confirmation, `duplicate`, `combos`).
- Input validation uses the `num`, `str`, `oneOf`, `bool`, `dateParam` helpers. Multi-step writes go in `transaction(db, fn)` (BEGIN IMMEDIATE).
- Auth (`src/auth.js`): cookie `sid` (sha256-hashed session token), scrypt passwords, `requireRole('manager' | 'attendant' | 'customer')`. A customer user is linked through `users.customer_id`.

**Database** (`src/db.js`):
- One `SCHEMA` string of `CREATE TABLE IF NOT EXISTS`.
- Schema changes on existing databases:
  - new columns go into `MIGRATIONS` (`[table, column, definition]`, added when missing);
  - a CHECK constraint change needs a table rebuild, like `migrateSalesKind` / `migrateRequests`.
  - Production data on Render must survive, so add a migration and a migration test.
- Settings are key/value rows. `getSettings(db)` maps them to camelCase (`combosPerLiter`, `comboValue`, `comboThreshold`, `individualCreditLimit`, `subscriberCreditLimit`, `subscriberGraceDays`, …).
- `customers.credit_limit` is a copy of the category limit, kept in sync by `syncCreditLimits` after settings or category changes.
- Naming: customer `type` is `'account'` = abonné (subscriber) and `'individual'` = particulier.

**Core business logic** (shared by several routes):
- `src/sales.js` `createSale(db, shift, input)`: the only way a sale is created. It is used both by the attendant's sale form and by the confirmation of a customer purchase request (`afterInsert` marks the request confirmed in the same transaction). It handles:
  - subscriber price;
  - $ ↔ litres conversion at the shift's frozen price;
  - payment `paid` | `credit` | `combo`;
  - credit limit and late-subscriber checks (`grantCredit` overrides them and sets `over_limit`).
- `src/loyalty.js`:
  - payments settle credit sales FIFO (`creditAllocation`);
  - a credit sale's combos (`points_due`) only become `points` once fully paid;
  - `refreshCustomer` recomputes this and `customers.loyalty_points`, so call it after any change to a customer's sales or payments;
  - `subscriberDues` computes what a subscriber owes for previous months.
- Shifts (`src/routes/shifts.js`):
  - opening snapshots meter indexes and prices into `shift_readings` (prices are frozen for the shift);
  - closing reconciles litres from the indexes against cash: `expected = sold + subscriber surcharge − credit − combos + payments collected − cash expenses`.
- Customer purchase requests (`src/routes/requests.js`): pending for 30 min. Attendants poll `/requests/pending` (every 4 s on the client); a request becomes a sale only when confirmed.

**Frontend** (`public/`, no framework, native ES modules):
- `public/js/main.js`: hash router, a `NAV` table per role, a persistent app shell, and View Transitions between screens.
- One file per screen in `public/js/views/`; each exports `render*(page, ctx)`.
- `public/js/ui.js` is the shared toolkit:
  - `h(tag, attrs, ...children)` DOM builder;
  - `setContent(el, ...children)`: always use it instead of `replaceChildren`, because it flattens arrays and skips null;
  - `fmt` (fr-FR money/litres/dates; `parseServerDate` handles SQLite UTC timestamps and date-only strings);
  - `formDialog` (iOS-style sheet; field types include `segment`, `checkbox` switch, `select`, `hidden`, `list` datalist), `confirmDialog`, `actionSheet`, `segmented`, `toast`.
- `public/js/api.js` throws errors carrying `.status` and `.code`.
- Design target: Apple iOS/macOS 26 "Liquid Glass". Tokens, glass materials, spring easings and dark mode are in `public/css/app.css`; reuse its existing classes rather than inline styles where possible.
- The attendant screen is used on a phone with a queue of customers waiting, so keep it to as few taps as possible.

## Deployment

`render.yaml` is a Render blueprint (`TZ=Africa/Lubumbashi`, `DB_FILE` on a persistent disk). The SQLite file is the whole state; back it up by copying `station.db`.
