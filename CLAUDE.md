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
  - new columns go into `MIGRATIONS` (`[table, column, definition]`, added when missing, in one transaction) and bump `SCHEMA_VERSION` (`PRAGMA user_version`);
  - a database holding data is copied to `<db>.avant-migration-…` before any change;
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
  - one shift, always open, for the whole station and every active pump: `POST /shifts` only opens the very first one; the manager's 15:30 closing (`POST /shifts/:id/close`, manager only) opens the next at once (`openShift()`), carrying the attendants on duty. `closing_time` (setting) drives the reminder (`closingCutoff()` in `src/checkpoints.js`);
  - attendants are in `shift_attendants` (several at once; `left_at` on relief or evening closing). To enter anything an attendant must be on duty (`not_on_duty`) and the station open (`station_closed`); `GET /shifts/state` drives the attendant's screen;
  - the manager's « État du poste » (`#/postes/:id/etat`, `public/js/views/shiftStatus.js`; the router passes a third hash segment as `ctx.sub`) reads the shift detail and checks the meters through `POST /shifts/:id/checkpoints/preview`, which saves nothing;
  - checkpoints (`shift_checkpoints` + `checkpoint_readings`): `releve` (relief, money passed to the next), `fermeture` (19:00, sets `station_closed_at`, the shift stays open), `ouverture` (6:30). `src/checkpoints.js` builds the mini report of each period (litres, sales, credits, money expected vs handed); sales, payments and expenses fall in a period by `created_at`;
  - opening snapshots meter indexes and prices into `shift_readings` (prices are frozen for the shift);
  - closing reconciles litres from the indexes against cash: `expected = sold + subscriber surcharge − credit − combos + payments collected − cash expenses`.
  - not every sale is entered: the shift's sales come from the indexes, and entered sales only record credits, combos and subscriber prices;
  - `GET /shifts/:id/report.pdf` (closed shifts) is the end-of-shift report: cash, sales from the indexes, credits, expenses, payments. It is built by `src/shiftReport.js` on `src/pdf.js`, a dependency-free PDF writer (Helvetica, WinAnsi).
- Closing logic is `applyClosing()` in `src/routes/shifts.js`, used by `POST /shifts/:id/close` (the attendant, or the manager in their place) and `POST /shifts/:id/correct` (manager: undoes meters and tank stock, closes again, reason required). The manager's closing is final: there is no validation step (old `validated` shifts became `closed` in version 11). The cash count is in dollars and only the cash is typed: mobile money is entered as it is paid (`POST /shifts/:id/momo`, table `momo_sales`: litres of one product at the shift's price), and `momoTotal()` (`src/checkpoints.js`, these entries + payments by mobile money) gives `shifts.mobile_money`, recomputed by `reconcile()`. Checkpoints count the cash only: mobile money stays on the station's account, it is not passed on. No card, no bank, no francs congolais (`shifts.card` only holds old data).
- Debts from before the app (`old_debts`: the station's notebook) count in the balance (`balanceSql` in `src/loyalty.js`, used by every balance query) and are settled first by `creditAllocation` (items with `old: true`). The manager adds or removes them on the customer page; the attendant declares one with a payment (`oldDebt`) when the amount is more than the app knows, or keeps the surplus as an advance (negative balance, taken by the next credits). They never suspend a subscriber's credit.
- Cash book (`src/cashbook.js`, `src/routes/cashbook.js`, screen « Caisse »): two balances, cash and mobile money (mobile money reaches the till only through a `retrait_momo` transfer). Entries are derived from closed shifts (cash, mobile money), payments and expenses outside a shift, deliveries paid on the spot and supplier payments; `cash_movements` holds the manual ones, and the latest `opening` count restarts a balance. Deliveries are `payment` 'cash' (out of the book by `pay_method`) or 'credit' (a debt to the supplier, settled by `supplier_payments`).
- Paid sales are never entered: `POST /shifts/:id/sales` refuses `paid`, and customer requests are on credit (or combos while enabled).
- Forms from the attendant's phone send a `clientRef`: sending it again returns the first record (unique `client_ref` on sales, payments, expenses).
- Journal: `audit(db, req, {...})` in `src/audit.js` writes `audit_log` (category, summary, before/after JSON, reason). Call it for any change a manager should be able to trace; an accepted cancellation keeps the deleted row there.
- Scheduled prices (`products.next_price*`) are applied by `applyScheduledPrices()` (`src/prices.js`) at shift opening and when prices are listed.
- PDF reports are built on `src/pdfReport.js` (`Report`: section, line, table, paragraph, finish) over `src/pdf.js`: shift, period and customer statement.
- Cancelling an operation (sale, mobile money entry, payment, expense):
  - the attendant only asks: `POST /shifts/:id/:kind/:itemId/cancel`, which sets `cancel_requested_*`;
  - the manager decides: `DELETE` cancels it, `POST …/keep` keeps it;
  - `reconcile()` recomputes a closed shift after a cancellation;
- The manager's remark on a closed shift (`POST /shifts/:id/remark`) is read by the attendant: an unread remark shows on their home screen (`GET /shifts/remarks/unread`) and is marked read when they open the shift (`comment_seen_at`).
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
- Design: « Totem de nuit », the station's price totem at night (chosen by the user): black ground, gasoil green and essence red fields, condensed figures, white action slabs, a day mode for full sun.
  - Shell: side rail on wide screens; top bar + bottom tab bar (four tabs + Plus) below 1024px; forms open as a right drawer from 834px and as bottom sheets below.
  - Colour and shape: the main action is a yellow slab; every other button and every card header is lit sky, violet or orange, neighbours taking turns (`--sign-*` tokens, `:nth-child(… of …)` in `app.css`). One shape everywhere, the rounded rectangle: no circle, no pill.
  - Signatures: `priceTotem` and `shiftLine` in `ui.js`, count-up in `public/js/motion.js`, the brand film on the sign-in screen.
  - The tokens and rules are in `DESIGN.md`, the product facts in `PRODUCT.md`, and the direction in `.impeccable/surfaces/`. The Impeccable design skill is installed in `.claude/skills/impeccable`.
- CSS: tokens, components and both themes are in `public/css/app.css`; reuse its classes rather than inline styles. Fuel colours go through `productColor(id)` / `--gasoil`, `--essence`. Inter and Barlow Condensed are self-hosted in `public/fonts/`.
- Brand film: the HyperFrames source is `videos/mtg-totem-sting/`; the rendered WebM/MP4 and poster live in `public/media/`. Re-render and re-encode after changing it.
- Sheets are flex columns: `.sheet-body` scrolls (`min-height: 0`) so that `.sheet-footer` stays visible. Use `dvh` units, because iOS Safari's `vh` includes its toolbars.
- The attendant screen is used on a phone with a queue of customers waiting, so keep it to as few taps as possible.

## Deployment

`render.yaml` is a Render blueprint (`TZ=Africa/Lubumbashi`, `DB_FILE` on a persistent disk, health check `/api/health`). The SQLite file is the whole state; back it up with Réglages → Données (`GET /api/backup`, `VACUUM INTO`), never by copying `station.db` alone (WAL).
