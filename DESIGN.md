---
name: MTG Station
description: Fuel-station manager for MTG Station (Goma), spoken in the apple.com web language and personalised for the station.
colors:
  action-blue: "#0071e3"
  action-blue-hover: "#0077ed"
  action-blue-press: "#006edb"
  link-blue: "#0066cc"
  ink: "#1d1d1f"
  graphite: "#6e6e73"
  pebble: "#86868b"
  ground: "#f5f5f7"
  tile: "#ffffff"
  mist: "#e8e8ed"
  hairline-grey: "#d2d2d7"
  chip-fill: "#ececf0"
  nav-frost: "#fafafc"
  pump-green: "#29a33f"
  ledger-green: "#008009"
  signal-red: "#e30000"
  flare-orange: "#f56300"
  caution-yellow: "#ffcc00"
  rust: "#bf4800"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro', 'Inter', 'Helvetica Neue', 'Segoe UI', Roboto, sans-serif"
    fontSize: "48px"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.022em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro', 'Inter', 'Helvetica Neue', 'Segoe UI', Roboto, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.14
    letterSpacing: "-0.017em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro', 'Inter', 'Helvetica Neue', 'Segoe UI', Roboto, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.17
    letterSpacing: "-0.017em"
  subhead:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro', 'Inter', 'Helvetica Neue', 'Segoe UI', Roboto, sans-serif"
    fontSize: "21px"
    fontWeight: 400
    lineHeight: 1.38
    letterSpacing: "-0.014em"
  figure:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro', 'Inter', 'Helvetica Neue', 'Segoe UI', Roboto, sans-serif"
    fontSize: "40px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.005em"
    fontFeature: "'tnum'"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro', 'Inter', 'Helvetica Neue', 'Segoe UI', Roboto, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.47
    letterSpacing: "-0.022em"
  body-small:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro', 'Inter', 'Helvetica Neue', 'Segoe UI', Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "-0.014em"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro', 'Inter', 'Helvetica Neue', 'Segoe UI', Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.38
    letterSpacing: "-0.01em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "28px"
  pill: "980px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "20px"
  gutter: "22px"
  tile: "28px"
  section: "40px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.tile}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "10px 22px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.action-blue-hover}"
  button-primary-active:
    backgroundColor: "{colors.action-blue-press}"
  button-primary-large:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.tile}"
    rounded: "{rounded.pill}"
    padding: "14px 28px"
    height: "52px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.link-blue}"
    rounded: "{rounded.pill}"
    padding: "10px 22px"
    height: "44px"
  button-small:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.tile}"
    rounded: "{rounded.pill}"
    padding: "5px 15px"
    height: "32px"
  button-destructive:
    backgroundColor: "{colors.signal-red}"
    textColor: "{colors.tile}"
    rounded: "{rounded.pill}"
    padding: "10px 22px"
    height: "44px"
  tile:
    backgroundColor: "{colors.tile}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "28px"
  field:
    backgroundColor: "{colors.tile}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "25px 16px 8px"
    height: "56px"
  choice-tile:
    backgroundColor: "{colors.tile}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
    height: "56px"
  choice-tile-selected:
    backgroundColor: "rgba(0, 113, 227, 0.1)"
    textColor: "{colors.link-blue}"
  badge:
    backgroundColor: "{colors.chip-fill}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  global-nav:
    backgroundColor: "rgba(250, 250, 252, 0.94)"
    textColor: "{colors.ink}"
    height: "48px"
  local-nav:
    backgroundColor: "rgba(250, 250, 252, 0.94)"
    textColor: "{colors.ink}"
    height: "52px"
  segmented:
    backgroundColor: "{colors.chip-fill}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.pill}"
    padding: "3px"
---

# Design System: MTG Station

## Overview

**Creative North Star: "The Showroom Forecourt"**

MTG Station is a fuel counter dressed as a product page. The ground is a calm light grey (#f5f5f7), every piece of content sits on a white rounded tile with no border, every screen opens with one big semibold headline saying where you are, and every action is the same blue pill. The language is apple.com's web idiom, played straight: thin translucent global nav, a sticky local nav that slides in carrying the page's one action, store-style floating-label fields and choice tiles. It is personalised by the station's own mark (a filled fuel drop in action blue), its French vocabulary and its numbers, never by Apple's logo, name or imagery.

Density is deliberately low for a business tool. The attendant works in sun, one-handed, on modest Android phones, so type starts at 17px, targets start at 44px, and states read as a word plus a colour dot (Payé, Crédit, Combos, En retard). The system refuses iOS app chrome (floating glass tab bars, glass cards) and dashboard-template density; depth comes from tile-on-ground contrast, not from borders or stacked shadows.

Motion follows the apple.com curve (cubic-bezier(0.28, 0.11, 0.32, 1)): fade-up reveals of 20px, staggered page entry, sheets that rise and can be swiped down, no bounce. Reduced motion collapses all of it to 1ms.

**Key Characteristics:**
- Light grey ground, white 18px tiles, no tile borders.
- One blue for every action; a second, deeper blue for every link.
- SF Pro on Apple devices, self-hosted Inter with optical sizing everywhere else, tight negative tracking.
- One headline per screen, grey subhead beneath it.
- Global nav scrolls away; local nav with its action pill slides in.
- Full-screen phone menu with large staggered links.
- Full dark theme (black ground, #1d1d1f tiles) driven by the same tokens.

## Colors

A near-monochrome Apple grey scale with one saturated action blue and a small, sun-legible status set.

### Primary
- **Action Blue** (action-blue): the fill of every primary pill, the checked checkbox, the selected choice-tile frame, the caret, the focus outline and the brand mark. Hover lightens to action-blue-hover, press deepens to action-blue-press. A 10% tint (rgba(0, 113, 227, 0.1)) fills selected choice tiles and quick-action icon discs.
- **Link Blue** (link-blue): text links, "more" links with a trailing chevron, ghost and secondary button labels, the active item in the phone menu, the selected choice-tile label. In dark theme it becomes #2997ff.

### Tertiary (data series)
- **Action Blue / Flare Orange / Pump Green / Rust** (series 1 to 4): products and chart series, assigned by product id in that order. Single-series charts use only series 1.

### Neutral
- **Ink** (ink): all primary text and headlines. Becomes the tile colour in dark theme.
- **Graphite** (graphite): subheads, secondary text, labels of KPIs, table headers, floating field labels.
- **Pebble** (pebble): tertiary text, focused placeholders, the 1px field and choice-tile stroke, select and search glyphs.
- **Ground** (ground): the page background; also read-only field fill.
- **Tile** (tile): every card, sheet, alert, toast, field and choice tile.
- **Mist** (mist): circle buttons, avatars, meter and bar tracks.
- **Hairline Grey** (hairline-grey): strong separators (table header rule, totals rule), switch off-state, sheet grabber. Row dividers use a softer rgba(0, 0, 0, 0.08) hairline.
- **Chip Fill** (chip-fill): badge and segmented-control wells.
- **Nav Frost** (nav-frost): the solid phone menu; navs use it at 94% opacity with saturate(180%) blur(20px).

### Status
- **Pump Green** (pump-green): success dots, switch on, success toast icon. Text that says "good" uses the darker **Ledger Green** (ledger-green) so it holds contrast in sun.
- **Signal Red** (signal-red): critical dots, destructive pill, error toast, negative variance text.
- **Flare Orange** (flare-orange): serious state, over-limit badge tint (16% mix), combos meter.
- **Caution Yellow** (caution-yellow): warning dots and warning alert icon, always with ink text on top, never white.

### Named Rules
**The One Blue Rule.** Action blue is the only fill that means "do this". There is one blue pill per screen region, and the local nav repeats the page's main action as a small pill. Nothing decorative is blue.

**The Word Plus Dot Rule.** A status is never colour alone: it is a badge with a 7px dot and a French word. Text that carries a value judgement uses ledger-green or signal-red, never the lighter fills.

## Typography

**Display Font:** SF Pro Display (with Inter, Helvetica Neue, Segoe UI, Roboto)
**Body Font:** SF Pro Text (with Inter, Helvetica Neue, Segoe UI, Roboto)

**Character:** One family in two optical cuts, semibold for anything that names or counts, regular for everything that explains. Inter is self-hosted with `font-optical-sizing: auto` so Android gets the same confident, tightly tracked voice without a third-party request on weak networks.

### Hierarchy
- **Display** (600, 48px, 1.08): the one page headline. Drops to 32px / 1.125 below 834px; 40px (32px on phones) on sign-in screens.
- **Headline** (600, 28px, 1.14): sheet and dialog titles, phone-menu links (24px for sheets on phones).
- **Title** (600, 24px, 1.17): tile headers (21px on phones); 21px in the local nav and alerts; 19px for h3.
- **Subhead** (400, 21px, 1.38): the grey line under the page headline (17px on phones) and sign-in lead (19px).
- **Figure** (600, 40px, 1.1, tabular): KPI values (32px on phones, 28px small); big results go to 56px, tank percentages and queued amounts to 32px.
- **Body** (400, 17px, 1.47): all running text, fields, buttons, summary lines.
- **Body small** (400, 15px, 1.4): tile header descriptions, tables, toasts, hints; 14px for meta lines and small pills.
- **Label** (600, 13px): badges, table headers, action-sheet titles, nav links (13px regular at 80% opacity).

Tracking is negative for Inter (h1 -0.022em, h2 -0.017em, h3 -0.012em, subhead -0.014em) and is reset to SF Pro's own values on Apple systems (h1 0, h2 +0.009em, h3 +0.012em, subhead +0.011em).

### Named Rules
**The One Headline Rule.** Every screen states where you are in one display headline, followed by a grey subhead. No kicker or eyebrow above it, no second headline at the same size.

**The Tabular Money Rule.** Every amount, litre count and meter reading is set with tabular figures, so columns of dollars align and nothing looks rounded.

## Layout

Content sits in a centred column of 1068px max (640px for narrow form pages) with a 22px side gutter, 16px below 834px. The global nav is 48px, the local nav 52px. The page headline sits 40px below the nav and 32px above content (28px / 24px on phones). Tiles sit in grids with a 20px gap (14px on phones); sections are separated by 40px (28px on phones). Stacks use 20px, form grids 14px.

Breakpoints: at 1068px four- and three-column grids fall to two; at 833px nav links fold into the menu button, all grids and form grids become one column, tile padding goes from 28px to 22px 20px, and sheets dock to the bottom edge; at 420px the attendant's quick actions and KPI row tighten to 8px gaps and queue actions wrap.

**The Phone First Rule.** Layout is designed at phone width and widened, not the reverse: one column, full-width pills, sheets from the bottom.

## Elevation & Depth

Flat by default. Depth is tonal: white tiles on a grey ground, with no border and no shadow at rest. Shadows are reserved for things that float above the page (sheets, alerts, toasts, action sheets, tooltips) and for one hover response (quick actions lift). Navs use frosted translucency instead of shadow, with a single inset hairline under the local nav.

### Shadow Vocabulary
- **Ambient** (`box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08)`): under the customer-request queue card, alongside its 2px blue inset ring.
- **Lift** (`box-shadow: 0 11px 34px rgba(0, 0, 0, 0.16)`): toasts, tooltips, action-sheet groups, quick-action hover.
- **Modal** (`box-shadow: 0 30px 90px rgba(0, 0, 0, 0.25)`): sheets and alerts over a rgba(0, 0, 0, 0.36) backdrop.
- **Focus ring** (`box-shadow: 0 0 0 4px rgba(0, 125, 250, 0.6)`): focused fields and choice tiles, with the stroke turned action blue.

### Named Rules
**The No Border Tile Rule.** Tiles never carry a border. A tile that needs emphasis gets a 2px inset ring (action blue for a live request, signal red for a late account), never an outline and never a heavier shadow.

## Shapes

Generously rounded, never sharp. Tiles, sheets, alerts and action groups use 18px; fields, choice tiles, pump options, tooltips and toasts use 12px; every button, badge, segmented control, search field and meter is a full pill (980px / 999px). Circles are reserved for icon discs, avatars, circle buttons, round checkboxes and status dots. On phones, sheets keep only their top corners rounded and show a 36 by 5px grabber. Icons are 24px-grid strokes at 2px with round caps and joins, drawn in currentColor; the brand mark is the one filled glyph.

## Components

### Buttons
Calm, confident apple.com pills.
- **Shape:** full pill (980px), 44px minimum height.
- **Primary:** action blue fill, white 17px regular label, 10px 22px padding. Large: 52px, 14px 28px. Small: 32px, 5px 15px, 14px label (used in the local nav).
- **Hover / Press:** fill shifts to action-blue-hover / action-blue-press over 0.2s on the apple ease; disabled drops to 42% opacity.
- **Secondary:** transparent with a 1px action-blue stroke and link-blue label; fills blue on hover.
- **Ghost:** link-blue text only, underline on hover. **Danger:** red text, 10% red wash on hover. **Destructive:** solid signal red.
- **More link:** link-blue text with a trailing chevron, the apple.com "Voir" idiom.

### Chips / Badges
- **Style:** chip-fill pill, 3px 10px, 13px semibold ink label preceded by a 7px status dot.
- **State:** dot colour carries good / warning / serious / critical / info; over-limit gets a 16% orange wash.

### Cards / Containers (Tiles)
- **Corner Style:** 18px.
- **Background:** tile white on ground grey (#1d1d1f on black in dark).
- **Shadow Strategy:** none at rest (see Elevation & Depth).
- **Border:** none.
- **Internal Padding:** 28px (22px 20px on phones); flush tiles hold full-bleed tables with 28px cell insets.

### Inputs / Fields
apple.com store fields with floating labels.
- **Style:** 56px tall, white, 1px pebble stroke, 12px radius, 17px text; the grey label sits inside at 17px and floats up to 70.5% scale on focus or when filled (0.125s).
- **Focus:** stroke turns action blue plus a 4px translucent blue ring.
- **Read-only:** ground fill, graphite text. **Error:** 15px red message with a short horizontal shake.
- **Search:** pill-shaped 40px field with an inline magnifier glyph.

### Choice Tiles
The apple.com store selector, used for product, payment and unit.
- **Style:** equal-width 56px tiles, 12px radius, 1px pebble stroke, 17px semibold centred label.
- **Selected:** action-blue stroke doubled by a 1px inset ring (2px visual frame), 10% blue tint, link-blue label. Hover darkens the stroke to graphite.

### Switches, Checkboxes, Segmented Control
- **Switch:** 51 by 31px pill, hairline-grey off, pump-green on, white 27px knob.
- **Checkbox:** 24px circle, blue fill with a white tick when checked.
- **Segmented:** chip-fill pill well with a white sliding thumb (0.4s apple ease).

### Navigation
- **Global nav:** 48px, translucent nav-frost with saturate(180%) blur(20px), scrolls away with the page. Drop mark and station name (15px semibold) left; 13px links centred at 80% opacity, active link full opacity and semibold; account icon right.
- **Phone menu:** below 834px links fold into a two-bar button that crosses on open; the full-screen menu fades in and its 28px semibold links cascade down 8px with a 25ms stagger.
- **Local nav:** 52px, same frost plus an inset hairline; slides down when the headline leaves, page name left (21px semibold) and the page's primary action as a small pill right.

### Sheets, Alerts, Toasts
- **Sheet:** 560px white panel, 18px radius, modal shadow, rises 24px on open; on phones it docks to the bottom, rises from below and can be dragged down. Header 28px title with a circle close button, footer separated by a hairline.
- **Alert:** 320px centred, 21px title, stacked full-width pills.
- **Action sheet:** grouped 56px rows in link blue, destructive in red, cancel semibold.
- **Toast:** white banner with lift shadow under the local nav, green (or red) circle icon, 15px semibold text, slides in from above.

### Quick Actions and Request Queue (signature, attendant)
- **Quick action:** 104px white tile with a 40px tinted icon disc and 15px semibold label, three across; the primary one is solid action blue with a white disc. Lifts on hover.
- **Queue card:** a customer's prepared purchase, white tile with a 2px action-blue inset ring and ambient shadow, 32px tabular amount, actions in a 1:1:2 grid with the confirm pill widest; a pulsing blue dot heads the queue.

## Do's and Don'ts

### Do:
- **Do** open every screen with one display headline (48px, 32px on phones) and a graphite subhead.
- **Do** put the screen's one job in an action-blue pill, and mirror it in the local nav.
- **Do** keep tiles white, borderless and 18px-rounded on the #f5f5f7 ground.
- **Do** write states as a badge with a dot and a French word (Payé, Crédit, Combos, En retard).
- **Do** set every amount and reading with tabular figures.
- **Do** use the apple ease cubic-bezier(0.28, 0.11, 0.32, 1) for reveals and sheets, and honour reduced motion.
- **Do** keep touch targets at 44px or more and body text at 17px.

### Don't:
- **Don't** show an Apple logo, the Apple name or Apple product imagery; the station's drop mark is the only brand glyph.
- **Don't** add iOS app chrome: no floating glass tab bar, no glass cards.
- **Don't** put a border or a resting shadow on a tile.
- **Don't** introduce a second action colour or use blue decoratively.
- **Don't** put white text on caution yellow, or carry a status by colour alone.
- **Don't** add kickers or eyebrows above headlines.
- **Don't** add bounce or overshoot to motion.
