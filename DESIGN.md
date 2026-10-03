---
name: MTG Station
description: Fuel-station manager for MTG Station (Goma), a midnight-blue enamel board with porcelain type, one amber action ink and a day mode for full sun.
colors:
  midnight-ground: "#070e1b"
  enamel-panel: "#0f1b2f"
  enamel-well: "#0b1527"
  enamel-raised: "#1b2c49"
  porcelain: "#f4f1ea"
  porcelain-dim: "#aab5c8"
  porcelain-faint: "#8391ab"
  lacquer-line: "#2b3d5d"
  field-edge: "#5d6f8f"
  amber-ink: "#f2b134"
  amber-hover: "#ffc24d"
  amber-press: "#e09f1f"
  amber-text-on: "#1a1405"
  link-sky: "#8db6ff"
  gasoil-cobalt: "#5b9cff"
  essence-coral: "#ff6a7d"
  ok-green: "#3ddc97"
  ok-green-text: "#4be3a2"
  alert-red: "#ff5a52"
  alert-red-text: "#ff7d75"
  serious-orange: "#ff9a3d"
  caution-yellow: "#ffd24a"
  day-ground: "#eceff5"
  day-panel: "#ffffff"
  day-ink: "#0b1527"
  day-amber: "#b86a00"
  day-link: "#0b57d0"
typography:
  display:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "48px"
    fontWeight: 650
    lineHeight: 1.08
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.17
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.21
    letterSpacing: "-0.014em"
  figure:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "40px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.025em"
    fontFeature: "tabular-nums"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.47
    letterSpacing: "-0.022em"
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
rounded:
  sm: "7px"
  md: "11px"
  lg: "16px"
  xl: "24px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "20px"
  xl: "28px"
  section: "40px"
components:
  button-primary:
    backgroundColor: "{colors.amber-ink}"
    textColor: "{colors.amber-text-on}"
    rounded: "{rounded.pill}"
    padding: "10px 22px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.amber-hover}"
  button-primary-active:
    backgroundColor: "{colors.amber-press}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.link-sky}"
    rounded: "{rounded.pill}"
    padding: "10px 22px"
    height: "44px"
  button-destructive:
    backgroundColor: "{colors.alert-red}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "10px 22px"
  card:
    backgroundColor: "{colors.enamel-panel}"
    textColor: "{colors.porcelain}"
    rounded: "{rounded.lg}"
    padding: "28px"
  input:
    backgroundColor: "{colors.enamel-panel}"
    textColor: "{colors.porcelain}"
    rounded: "{rounded.md}"
    padding: "25px 16px 8px"
    height: "56px"
  choice-tile:
    backgroundColor: "{colors.enamel-panel}"
    textColor: "{colors.porcelain}"
    rounded: "{rounded.md}"
    height: "56px"
  badge:
    backgroundColor: "{colors.enamel-raised}"
    textColor: "{colors.porcelain}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  segmented:
    backgroundColor: "{colors.enamel-raised}"
    textColor: "{colors.porcelain-dim}"
    rounded: "{rounded.pill}"
    padding: "3px"
---

# Design System: MTG Station

## Overview

**Creative North Star: "Midnight Line"**

The product is a midnight-blue enamel board read under pump-island lights. The ground is a deep blue-black, panels are lacquered navy edged by a one-pixel porcelain hairline, type is warm porcelain, and a single amber ink marks every action. Gasoil and essence each own a line colour (cobalt and coral) that follows the product through gauges, bars and charts. Premium, calm and legible: the Gérant reads credit, combos and stock on one board, and the Pompiste records a sale in a few taps.

Dark is the default. A day mode (white enamel, darker amber, deeper link blue) is chosen from the account menu for full sun and swaps the same token names, so no component is restyled. Inter, served from the station itself, is the only face on every device. Density is generous on phones (44px minimum tap targets, 56px fields) and tidy on desktop (1068px page column).

Depth comes from hairlines and tonal steps, not shadows. Motion is short and answers the hand or explains a state; the one signature moment is the balanced till (drawn check, ripple, counted figure).

**Key Characteristics:**
- Midnight ground, lacquered navy panels, porcelain text, amber as the only action ink.
- One line colour per product, status colours always paired with a word.
- Inter throughout, tight negative tracking, tabular figures for every amount.
- Pill-shaped controls over softly rounded (16px) panels.
- Hairline-edged panels with no resting shadow.
- Signature: the shift line, a four-stop transit line for the Poste.

## Colors

A blue-black enamel palette with one warm accent; the day mode is the same roles re-lit.

### Primary
- **Amber Ink** (#f2b134): the action colour. Primary buttons, the focus ring, caret, checked boxes, selected choice-tile frame, completed stops of the shift line, the pulse on pending requests. Hover #ffc24d, press #e09f1f. Text on amber is **Amber Text-On** (#1a1405). In day mode it deepens to **Day Amber** (#b86a00) with white text.

### Secondary
- **Gasoil Cobalt** (#5b9cff): the series colour for gasoil (first chart series, gauges, horizontal bars). Day: #1f6fe0.
- **Essence Coral** (#ff6a7d): the series colour for essence. Day: #d6304a.
- Spare series: green #3ddc97 and amber #f2b134.

### Neutral
- **Midnight Ground** (#070e1b): page background. Day: #eceff5.
- **Enamel Panel** (#0f1b2f): cards, sheets, alerts, toasts, inputs. Day: #ffffff.
- **Enamel Well** (#0b1527): read-only fields. Day: #f4f6fa.
- **Enamel Raised** (#1b2c49): badges, segmented track, avatars, circle buttons. Day: #dde3ee.
- **Porcelain** (#f4f1ea): primary text. Day ink: #0b1527.
- **Porcelain Dim** (#aab5c8): secondary text and labels. Day: #4a566b.
- **Porcelain Faint** (#8391ab): tertiary text, placeholders, future shift-line stops. Day: #66738a.
- **Lacquer Line** (#2b3d5d): separators, switch track, shift-line track.
- **Field Edge** (#5d6f8f): input, choice-tile and pump-option borders, high enough to read as an edge.
- **Link Sky** (#8db6ff): links and secondary-button text. Day: #0b57d0.

### Status
Green #3ddc97 (text #4be3a2), red #ff5a52 (text #ff7d75), orange #ff9a3d, yellow #ffd24a. Fills colour dots, switches and icon discs; the lighter text variants colour figures such as variances. Day values are darkened (green #1f9e68 / text #0a7a4b, red #d92d20 / text #c4281c).

### Named Rules
**The One Ink Rule.** Amber is the only action colour. It marks what can be pressed or what has been done; it never decorates.

**The Line Per Product Rule.** Gasoil is cobalt, essence is coral, everywhere a product is drawn. Series colours never stand in for status.

**The Word Beside The Colour Rule.** Status is never colour alone: every dot, disc or variance carries a word or sign.

**The Two Modes Rule.** Every colour is a token with a day value. Components read tokens and never hard-code a mode.

## Typography

**Display Font:** Inter (with -apple-system, Segoe UI, Roboto fallbacks), self-hosted variable woff2.
**Body Font:** Inter, same stack.
**Label/Mono Font:** none; numerals use Inter with tabular figures.

**Character:** One family, one voice, on every device. Weight and tracking do the hierarchy: semibold headings pulled tight, regular body, figures large and tabular.

### Hierarchy
- **Display** (650, 48px, 1.08, -0.03em): page headline h1; 32px under 833px; 40px on the sign-in card.
- **Headline** (600, 24px, 1.17, -0.02em): card titles and h2; 28px in sheets and the phone menu; 21px on phones for card headers.
- **Title** (600, 19-21px, 1.21, -0.014em): h3, the local-nav page name.
- **Figure** (600, 40px, 1.1, -0.025em, tabular): KPI values (28px small, 24px in the three-up row), tank percentage 32px, queue amount 32px, till result 56px.
- **Body** (400, 17px, 1.47, -0.022em): default text, inputs, buttons. Subheads under the headline are 21px dim porcelain (17px on phones).
- **Label** (600, 13px, 1.2, -0.01em): column heads, badges, shift-line stop names, KPI labels in tiles. Sentence case, never uppercase.

### Named Rules
**The Tabular Rule.** Every amount, percentage and count is set with tabular figures so columns and counters hold still.

**The Tight Track Rule.** Headings and figures carry negative tracking that grows with size (-0.014em at 19px to -0.03em at 48px).

## Layout

A single centred column, 1068px maximum, with 22px side padding (16px under 833px) and 96px bottom room (72px on phones). Pages open with a header block (40px above, 32px below) and stack sections 40px apart (28px on phones). Grids are 2, 3 or 4 equal columns with 20px gaps (14px on phones); at 1068px 4 and 3 columns become 2, and at 833px everything becomes one column. Card interiors use 28px padding (22px 20px on phones); stacked content uses 20px gaps, form grids 14px.

The global bar is 48px and scrolls away; a 52px local bar with the page name and main action slides in once the headline has gone. Under 833px the link row folds into a full-screen menu opened by a two-bar button that turns into a cross. Sheets rise from the bottom on phones, with a grabber, and can be swiped down. Print drops chrome, makes panels flat and unpadded, and avoids breaking cards.

Breakpoints: 1068px, 833px, 420px.

## Elevation & Depth

Flat by default and tonal. A panel is one step lighter than the ground and edged by a 1px inset porcelain hairline (rgba(244,241,234,0.12), day rgba(11,21,39,0.1)). There is no resting shadow. Shadows appear only on things that float above the page or answer a hover.

### Shadow Vocabulary
- **Float** (`0 11px 34px rgba(0,0,0,0.55)`, day `0 11px 34px rgba(11,21,39,0.18)`): tooltips, toasts, action sheets, hovered quick actions, with the hairline stacked beneath.
- **Lift** (`0 4px 24px rgba(0,0,0,0.45)`): the pending-request card, paired with a 2px amber inset frame.
- **Glass** (`backdrop-filter: saturate(180%) blur(20px)` on 92%-opaque navy): global and local bars only.

### Named Rules
**The Quiet Panel Rule.** Panels sit on a hairline, not a shadow. A shadow means the element is above the page.

## Shapes

Pills for controls (buttons, badges, search, segmented control, switch), 16px for panels and sheets, 11px for fields, choice tiles, tooltips and toasts, 7px for small inset parts. Circles (999px) for avatars, round icon buttons, status discs and the round checkbox. Bar-chart columns round only their top corners (6px). Gauge and horizontal bar tracks are 8px-high capsules. Borders are 1px; selection is a 1px border plus a matching 1px inset ring.

## Components

### Buttons
- **Shape:** full pill, 44px minimum height (52px large, 32px small, 48px in the request queue).
- **Primary:** amber fill, dark text, 10px 22px padding, 17px regular. Hover brightens, press darkens and scales to 0.97.
- **Secondary:** transparent with an amber border and link-colour text; hover fills amber with dark text.
- **Ghost / Danger / Destructive:** ghost is link text that underlines on hover; danger is red text that tints on hover; destructive is solid red with white text.

### Cards / Containers
- **Corner Style:** 16px.
- **Background:** Enamel Panel with the hairline frame.
- **Shadow Strategy:** none at rest (see Elevation).
- **Internal Padding:** 28px (22px 20px on phones); `flush` cards hold tables edge to edge with a 26px 28px header.

### Inputs / Fields
- **Style:** panel fill, 1px Field Edge border, 11px radius, 56px tall with a floating label that rises and shrinks to 0.705 when filled or focused.
- **Focus:** border turns amber and a 4px translucent amber ring appears.
- **Error / Disabled:** error text is the light red with a short horizontal shake; read-only fields drop to the well tone and dim text.
- **Switch:** 51x31 pill, green when on, white thumb. **Checkbox:** 24px round, amber when checked, white drawn tick.

### Chips and segmented control
Badges are pills on Enamel Raised with a 7px status dot and a 13px semibold word. The segmented control is a pill track with a sliding thumb behind the active 14px option.

### Choice tiles
One-tap options 56px tall with a Field Edge border; selected state is an amber border, inset amber ring, soft amber wash and link-colour text. Pump options use the same selected treatment.

### Navigation
Thin glass bar: brand drop in amber, 15px semibold name, centred 13px links at 80% opacity (full and semibold when active), account button. Phone menu lists 28px semibold links that fade and slide in with a 25ms stagger; the active link takes the link colour.

### Tables
Tabular 15px figures, 13px dim semibold column heads, hairline row dividers, 14px 28px cell padding, clickable rows tint to the faint well on hover, totals in semibold above a separator.

### Tank gauge (Cuve)
Large percentage in Figure style over an 8px capsule track, filled in the product's line colour with a 2px mark for the threshold; the fill grows from the left once and a single sheen passes over it. A foot line gives litres or status in dim text.

### Shift line (signature)
A four-stop transit line built as an ordered list: Ouverture, Ventes, Clôture, Validation. Each stop is a 22px ring with a 4px connecting bar. Future stops are hollow rings on Lacquer Line with faint labels; past stops and their outgoing bar fill solid amber with dim labels; the current stop is a hollow ring with a 6px amber border, a porcelain label and a short glow (two pulses, then still). Under the open Poste the current stop is Ventes, once closed it is Validation, and when everything is past all four are filled. Bars draw in left to right on page entry. It sits directly under the page headline on the shift pages.

### Dialogs and toasts
Sheets (560px wide, 16px radius, hairline plus float shadow) centre on desktop and rise from the bottom on phones. Alerts are 320px centred with stacked full-width buttons, cancel last in reading order. Action sheets are grouped link-colour rows, 56px each. Toasts drop in from the top below the local bar with a green or red disc and a drawn tick.

### Motion
Standard easing is cubic-bezier(0.28, 0.11, 0.32, 1) with 0.2-0.45s durations; transform and opacity only. Pages push or pop with View Transitions; grid cards arrive staggered by 50ms (350ms maximum). The signature moment is the balanced till: pop-in disc, drawn tick, ripple, and the figure fading up. Reduced-motion collapses all animation to 1ms.

## Do's and Don'ts

### Do:
- **Do** colour every action in amber (#f2b134, day #b86a00) with dark text, and only actions or completed steps.
- **Do** reference tokens (`var(--surface)`, `var(--text-2)`, `var(--accent)`) so day mode follows automatically.
- **Do** colour products by their line (gasoil cobalt, essence coral) wherever they are charted.
- **Do** set amounts in tabular figures at 600 weight and tighten tracking as size grows.
- **Do** separate panels from the ground with the 1px hairline and the one-step tonal change.
- **Do** keep tap targets at 44px or more and fields at 56px on touch surfaces.
- **Do** pair status colour with a word or sign, and use the lighter `-text` status colours for text on navy.
- **Do** keep the French product terms (Gérant, Pompiste, Poste, Cuve) in the interface.

### Don't:
- **Don't** add a second accent colour or use amber for decoration.
- **Don't** put a resting shadow on a panel; reserve shadows for floating layers.
- **Don't** use pure black or pure white as the ground; the dark ground is #070e1b and the day ground #eceff5.
- **Don't** use neon-on-black dashboard colours or glow as ornament; the only glow is the current shift-line stop.
- **Don't** animate layout properties; use transform and opacity.
- **Don't** convey status by colour alone.
- **Don't** reintroduce a light-grey tile look or a second typeface.

*Not canonized (build drift)*: leftovers from the earlier world remain in the stylesheet (hard-coded #fff glyphs on discs, a dark #1d1d1f on the yellow alert disc, a chevron and search icon stroked in #86868b, a 0.25-alpha sheet shadow, Apple-era comments and a 980px pill value). They are defects to repair, not rules.
