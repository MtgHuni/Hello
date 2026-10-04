# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Pompiste** (attendant): works outside at the pump, often in full sun, often alone while a queue of customers waits. Uses a phone, often an entry-level Android, often one-handed. Job: record the credits (paid sales are not entered: the meter readings count them), confirm the purchases customers prepared from their phones, collect payments, note cash expenses, close the shift with the meter readings and the cash count (dollars, francs congolais, mobile money, card).
- **Client** (customer): a driver waiting in the queue, on their own phone. Jobs: sign up with their phone number, prepare a purchase on credit (fuel, amount or litres) so the attendant only has to confirm it, and follow their balance, combos and statement.
- **Gérant** (manager): runs the station. Validates shifts, follows tanks, deliveries and dips, manages customers (credit, payments, records to complete), expenses, reports and settings. Also mostly on a phone.

## Product Purpose

The app manages **MTG Station**, a fuel station in Goma (DRC) that sells gasoil and essence, with one pump of each to start. The number of pumps can change.

The app keeps every litre and every dollar accountable, from the pump meter to the cash count, without slowing down the queue.

Success means:
- a credit is recorded in a few taps;
- a shift reconciles with no unexplained gap;
- the manager sees credit, combos and stock at a glance.

## Positioning

The app is built around one station's real counter. Three things set it apart:
- one-tap confirmation of purchases prepared by customers;
- credit with limits per customer category (particulier or abonné), and the monthly settlement for abonnés;
- "combos" (loyalty points) that customers exchange for fuel; the programme can be switched off, and is off for now.

Everything is in US dollars and French, on the Africa/Lubumbashi timezone.

## Operating Context

- **Outdoors and devices**: the attendant uses the app outdoors in bright sunlight, on modest Android phones that are often slow, over mobile networks that can be weak. The customer uses it in the queue on their own phone.
- **Shift cycle**: open the shift (start meter readings are taken over from the previous shift and frozen) → credits, payments, expenses → close (end readings, cash count) → the manager validates, after correcting the closing if needed.
- **Customer purchases**: the attendant's screen checks for new customer requests every 4 seconds and vibrates when one arrives. Requests expire after 30 minutes.

## Capabilities and Constraints

- Stack: Node/Express 5 server with built-in SQLite; plain HTML/CSS/JS with no framework and no build step. Deployed on Render.
- Roles: gérant, pompiste, client.
- Customer categories:
  - **particulier**: one fixed credit limit, set in settings;
  - **abonné**: a higher price per product, a higher limit, and the whole month to pay by month end (after a grace period, credit is blocked).
  - New customers are particuliers. Only the manager makes a customer an abonné.
- Combos:
  - X combos per litre;
  - earned only once a credit sale is fully paid;
  - exchanged for **fuel only**, above a threshold, at a value per combo set in settings.
- Terminology to keep: Gérant, Pompiste, Client, Particulier, Abonné, Combos, Poste, Cuve, Jaugeage, Livraison, Règlement, Dépense.

## Brand Commitments

- Name: **MTG Station**. There is no logo or brand palette yet: the visual identity is to be created.
- The user wants an identity specific to the station, while keeping the quality and native gestures of Apple apps: sheets, fluid animations, iOS-level finish. This was previously stated as "exactement ce que fait Apple" and is now refined to "identité propre à la station".
- Standing visual preference, chosen by the user (2026-10-03, rebuilt 2026-10-04 at their request to "change everything"): **luxe sombre et premium**, built as "Totem de nuit". Black ground, porcelain type, the price totem as signature (Barlow Condensed figures on a colour field per fuel: gasoil green, essence red), white action slabs, side rail on wide screens and bottom tabs on phones, drawers for forms. A brand film rendered with HyperFrames plays on the sign-in screen. A day mode exists for full sun. No Apple logo, name or product imagery.
- Language: French.

## Evidence on Hand

There are no testimonials, figures, photos or logo. None must be invented.

## Product Principles

1. **The queue sets the pace.** Every attendant action fits in a few taps, one-handed, readable in the sun.
2. **Every dollar is accountable.** Amounts, gaps and credit are always explicit; nothing is hidden or rounded silently.
3. **Status before decoration.** Pending, late, over the limit, confirmed: states must read instantly.
4. **Light on the device.** The app must stay fast on modest phones and weak networks.

## Accessibility & Inclusion

- High contrast and large touch targets, for use outdoors in sunlight.
- Text readable without zooming on small screens.
- Respect the reduced-motion setting.
