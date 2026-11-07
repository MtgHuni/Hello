---
name: MTG Station
description: Registre, the station's account book kept impeccably. Cool register paper, white leaves ruled by one hairline, blue-black ink, the MTG blue for the main action and the money that comes in, one red for what is owed, every total closing on a double rule. A night mode keeps the same roles.
colors:
  register-paper: "#f3f5f7"
  leaf-white: "#ffffff"
  leaf-shade: "#f8f9fb"
  leaf-well: "#eef1f5"
  blue-black-ink: "#111827"
  ink-secondary: "#4b5565"
  ink-faint: "#6b7480"
  hairline: "#e3e7ec"
  rule: "#d5dbe2"
  field-edge: "#b9c1cb"
  fill: "#cfd5dd"
  fill-quiet: "#f1f4f7"
  track: "#e6eaef"
  mtg-blue: "#0b6fc4"
  mtg-blue-ink: "#0a5fa8"
  mtg-blue-hover: "#0a63af"
  mtg-blue-press: "#08548f"
  mtg-blue-soft: "#e8f1fb"
  gasoil-green: "#12895a"
  essence-amber: "#d9822b"
  owed-red: "#c8322a"
  owed-red-text: "#b42318"
  good-text: "#0d7a4e"
  serious-orange: "#c26a12"
  warning-yellow: "#b98900"
  night-paper: "#0f1318"
  night-leaf: "#171c23"
  night-ink: "#e8ecf1"
  night-hairline: "#262e38"
  night-blue: "#3d9be9"
typography:
  display:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "17px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.018em"
  figure:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.05
    letterSpacing: "-0.03em"
    fontFeature: "'tnum'"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.47
    letterSpacing: "-0.011em"
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  group-label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    letterSpacing: "0.04em"
rounded:
  tab: "3px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
spacing:
  row: "11px"
  sm: "12px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.mtg-blue}"
    textColor: "{colors.leaf-white}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.mtg-blue-hover}"
  button-primary-active:
    backgroundColor: "{colors.mtg-blue-press}"
  button-secondary:
    backgroundColor: "{colors.leaf-white}"
    textColor: "{colors.blue-black-ink}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.fill-quiet}"
  button-return:
    backgroundColor: "{colors.leaf-white}"
    textColor: "{colors.mtg-blue-ink}"
    rounded: "{rounded.md}"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.leaf-white}"
    textColor: "{colors.owed-red-text}"
    rounded: "{rounded.md}"
    height: "44px"
  card:
    backgroundColor: "{colors.leaf-white}"
    rounded: "{rounded.lg}"
    padding: "24px"
  input:
    backgroundColor: "{colors.leaf-white}"
    textColor: "{colors.blue-black-ink}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    height: "44px"
  segment-option:
    backgroundColor: "{colors.leaf-white}"
    textColor: "{colors.blue-black-ink}"
    rounded: "{rounded.md}"
    height: "56px"
  segment-option-selected:
    backgroundColor: "{colors.mtg-blue-soft}"
    textColor: "{colors.mtg-blue-ink}"
  badge:
    backgroundColor: "{colors.leaf-well}"
    textColor: "{colors.blue-black-ink}"
    rounded: "{rounded.sm}"
    padding: "3px 10px"
  nav-item-active:
    backgroundColor: "{colors.mtg-blue-soft}"
    textColor: "{colors.mtg-blue-ink}"
    rounded: "{rounded.md}"
  fuel-tab:
    backgroundColor: "{colors.gasoil-green}"
    rounded: "{rounded.tab}"
    size: "10px"
---

# Design System: MTG Station

## Overview

**Creative North Star: "The Station's Credit Register"**

The app is the station's account book kept impeccably. Every screen reads like a clean column of figures that adds up: labels on the left in ink, figures on the right, tabular and aligned, rows ruled by one hairline, and the total closing the column on a double rule. The world replaces « Totem de nuit » entirely: no black ground by default, no coloured fields, no condensed display face, no lit coloured headers.

Density is a ledger's, calm and even: white leaves (panels) laid on a cool register paper, flat, separated by hairlines rather than shadows. Colour is information, never decoration. The MTG blue marks the one main action of a region, links, the current place, and money coming in; one red marks what is owed and gaps; the two fuels are small tabs of ink beside their names. A night mode (the sun key beside the account) keeps every role under a lamp. Light is the default, chosen for outdoor phones in full sun.

The surfaces still behave like native iOS: sheets, a right drawer for forms on wide screens, bottom sheets on phones, short fade-up entrances, and every motion respects reduced-motion.

**Key Characteristics:**
- Cool paper ground, white leaves, one hairline; never cream, never black by default.
- One family, Inter, figures tabular, right-aligned, one figure scale for every glanced number.
- The addition column with its double rule is the signature.
- Blue for the main action and money in, red only for what is owed and gaps, fuel as 10px ink tabs.
- Flat at rest; shadows only on overlays (sheets, dialogs, toasts).
- One shape: the rounded rectangle; no circle, no pill.

## Colors

A cool, nearly monochrome ink-on-paper palette with one blue voice, one red, and two small fuel inks.

### Primary
- **MTG Blue** (mtg-blue): the main action slab of a region (Confirmer, Enregistrer, État du poste), the active nav item's icon, the current stop of the shift line, focus rings and the field focus edge, the selected segment. Hover and press step darker (mtg-blue-hover, mtg-blue-press). Its soft tint (mtg-blue-soft) is the active nav item's ground, the quick-action icon square and the selected segment's ground.
- **MTG Blue Ink** (mtg-blue-ink): links, the Retour button's text, the active nav label, text set on the soft tint.

### Secondary
- **Gasoil Green** (gasoil-green) and **Essence Amber** (essence-amber): the fuels, only as small tabs (10px squares, 3px corners) before a fuel's name, a tank's name or a segment option, and as the fill of a tank's level bar and the chart series. Always through `productColor(id)` / the fuel tokens.

### Tertiary
- **Owed Red** (owed-red; text in owed-red-text): what is owed, negative balances and gaps, destructive buttons' text and edge, critical status. Nothing else is red.

### Neutral
- **Register Paper** (register-paper): the page ground, and the paper behind the rail on phones.
- **Leaf White** (leaf-white): panels, the side rail, fields, secondary buttons, sheets. Leaf Shade (leaf-shade) is the table head; Leaf Well (leaf-well) is the badge ground.
- **Blue-Black Ink** (blue-black-ink): all primary text, figures, the double rule. Ink Secondary (ink-secondary) for nav labels and table heads; Ink Faint (ink-faint) for notes under a label, units and group labels.
- **Hairline** (hairline): the one rule between rows, around panels, under card headers and beside the rail. Rule (rule) is the heavier separator; Field Edge (field-edge) outlines inputs, secondary buttons and segment options; Fill Quiet (fill-quiet) is the hover ground of quiet controls and rows; Track (track) is the empty part of a level bar.
- **Night set** (night-paper, night-leaf, night-ink, night-hairline, night-blue): the same roles in the night theme; the remaining night values live in `:root[data-theme='dark']`.
- Status: good-text (green) for « Niveau correct »-type states, serious-orange and warning-yellow for alert squares and badge dots.

### Named Rules
**The One Red Rule.** Red means owed or a gap. A negative cash balance is red; a neutral « 0,00 $ » is ink. Never use red for emphasis or decoration.

**The Blue Slab Rule.** One blue slab per region. Every other button is a white leaf with an ink edge.

**The Fuel Tab Rule.** A fuel is a 10px ink tab beside its name, never a coloured field, panel or header.

## Typography

**Display Font:** Inter (self-hosted variable, with the system sans fallback)
**Body Font:** Inter
**Label Font:** Inter

**Character:** One family carries everything, like a well-kept book in one hand. Hierarchy comes from weight (400 to 700, with 650 for figures and titles) and tight negative tracking, not from a second face.

### Hierarchy
- **Display** (700, 34px, 1.15; 26px below 834px): the page title (« Bonjour, Gérant », Clients), the sign-in title.
- **Headline** (700, 22px, 1.25): sheet and dialog titles.
- **Title** (650, 17px, 1.25): card header titles; the topbar title on phones; h2 elsewhere 19px.
- **Figure** (650, 28px, 1.05, -0.03em, tabular): every glanced figure: prices, KPI values, tank percentages, facts, and the net value total. One scale, one baseline for every figure band. Row figures are 17px 650; the big result of a closing is 48px (40px on phones).
- **Body** (400, 16px, 1.47): rows, labels, fields (fields 17px to stop iOS zoom).
- **Label** (500, 13px): notes under a row label, units, badge text (600), table heads (12px).
- **Group label** (700, 13px, 0.04em, uppercase, ink-faint): a group of lines inside a column or form (« Ce qu’elle possède », « Ce qu’elle doit »). It heads lines; it never sits above a page or card title.

### Named Rules
**The Tabular Rule.** Every figure is tabular and right-aligned, so columns add up by eye.

**The One Scale Rule.** Figures glanced at together share one size (28px). No hero number outgrows its siblings, except the closing's single result.

## Layout

Wide screens (1024px and up): a white side rail (248px) ruled off from the paper by one hairline, holding the monogram and name, the navigation, and the account with the sun key at its foot; the page sits on the paper at up to 1180px. Below 1024px: a top bar (56px), the paper all across, and a bottom tab bar (62px, four tabs + Plus). Forms open as a right drawer from 834px and as bottom sheets below.

A page opens with its title and date (or a data line), the page actions on the right (a blue slab, then white leaves), and a hairline under the header. Panels sit in grids with 16px gaps (12px on phones); card padding is 24px, with the header ruled off across the full width (18px 24px 14px).

The dashboard's register: the « Valeur de la station » addition column (about 1.25 parts) beside a side column (1 part) holding today's prices, the current shift and the alerts; one column below 834px. Register rows are 11px tall-padded, label left, figure right.

Grouped buttons have equal width and are centred on mobile.

## Elevation & Depth

Flat. Panels carry no shadow at rest: they are white leaves with a 1px hairline edge on the paper, and depth comes from that tonal step (paper to leaf). Panels inside a board or KPI grid drop their own edge so the board reads as one sheet. Shadows appear only on things that float above the page.

### Shadow Vocabulary
- **Overlay lift** (`box-shadow: 0 0 0 1px var(--hairline), 0 12px 32px rgba(17, 24, 39, 0.14)`): sheets, alert dialogs, toasts. Night: `0 14px 36px rgba(0, 0, 0, 0.5)`.
- **Field focus** (`box-shadow: 0 0 0 3px color-mix(in srgb, var(--mtg-blue) 18%, transparent)`): an input with focus, together with a blue edge.

### Named Rules
**The Flat Leaf Rule.** Nothing on the page casts a shadow; only overlays do.

## Shapes

One shape everywhere: the rounded rectangle. Controls (buttons, fields, segments, nav items) take 8px corners; panels and boards 10px; the largest containers 12px; badges and small squares 6px; fuel tabs and level bars 3px. No circle, no pill: status dots, avatars, stops of the shift line and alert icons are rounded squares too.

The double rule (3px double, ink) is the system's one ornament: it closes every total (addition columns, table footers) and underlines the station name on the sign-in brand page. The line just above a total gives way to it.

## Components

### Buttons
Quiet and certain: one blue slab, the rest white leaves.
- **Shape:** gently rounded (8px), at least 44px tall (52px for large), 15px 600 text, an icon may lead.
- **Primary:** MTG blue, white text; hover and press step darker.
- **Secondary / Annuler / Fermer:** white leaf, ink text, field-edge outline; hover fill-quiet.
- **Retour:** the same white leaf with blue ink text (and the ‹ link above a detail page).
- **Ghost:** transparent, link-blue text.
- **Danger / destructive:** white leaf, red text, a red-tinted edge; set apart from the others. A row's cancel square stays faint until the finger is on it, then turns red.

### Cards / Containers
- **Corner Style:** 10px.
- **Background:** leaf white on register paper.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1px hairline; the header is ink text on no band, ruled off by a hairline.
- **Internal Padding:** 24px.

### Addition column (signature)
The register's grammar: lines of label + figure, ruled by hairlines, optional group labels, closing on a double rule with the total in bold (on the dashboard the total figure is 28px 650 and the label stays 16px 700). Used for the station value, the closing, the shift report and a customer balance. A line may carry a faint note under its label.

### Register rows
One line of a side column: an optional fuel tab, the label (600) with a faint note, the figure right (17px 650). A row that links hovers with a fill-quiet ground across the row.

### Today's prices
A white leaf per fuel (or register rows on the dashboard): the fuel tab and name in ink-secondary, the price as a figure (28px) with its unit small and faint, the subscriber price as a note.

### Inputs / Fields
- **Style:** white, 1px field-edge, 8px corners, 44px tall, 17px text.
- **Focus:** blue edge plus a soft 3px blue halo.
- **Segments:** option tiles (56px tall, field-edge outline); the selected one takes a blue edge, a blue tint and blue ink; a fuel option carries its tab.

### Chips / Badges
Rounded squares of the well tone (6px), 13px 600, with a 7px status dot (good, warning, serious, critical, blue for info). Alert icons are tinted squares of their status colour, never loud fills.

### Navigation
The rail: 15px labels in ink-secondary with line icons; hover fill-quiet; the active item a blue-soft ground, blue-ink 600 label and blue icon. Phones: top bar title 17px 650, bottom tabs with the active tab in blue.

### Tank gauge
The tank's name with its fuel tab, the percentage as a figure, an 8px level bar in the fuel's colour on the track, the alert threshold as a dark tick on the track, litres and a status badge below.

### Shift line
Stops as rounded squares along a rule; done stops and the rule in blue, the current stop a blue ring that glows twice, labels 13px in ink.

### Sign-in brand page
A white leaf beside the form: the MTG monogram large, the station's name under a double rule. On phones it stacks above the form, ruled off by a hairline.

## Do's and Don'ts

### Do:
- **Do** close every total on a 3px double ink rule, label left, figure right, bold.
- **Do** set every figure in Inter, tabular, right-aligned; glanced figures share the 28px figure scale.
- **Do** keep one blue slab per region; every other button is a white leaf with an ink edge.
- **Do** show a fuel as its 10px ink tab beside its name, through `productColor(id)` / the fuel tokens.
- **Do** keep panels flat: white leaf, 1px hairline, 10px corners; shadows only on sheets, dialogs and toasts.
- **Do** keep both themes in step: a new detail follows its siblings in the light and the night theme.
- **Do** give grouped buttons equal width and centre them on mobile.
- **Do** write all UI text in French.
- **Do** use icons only from the existing set; a new icon is a PNG found on pngegg.com, never drawn.
- **Do** respect reduced-motion for every entrance, count-up and glow.

### Don't:
- **Don't** add explanatory text outside Réglages: no form intro, field hint, descriptive subtitle or explanation sentence in a confirmation; only data, statuses, empty states and error messages.
- **Don't** use red for anything but what is owed, gaps, destructive actions and critical status.
- **Don't** bring back the totem: no black default ground, no coloured fuel fields, no lit coloured card headers, no condensed display face.
- **Don't** use circles or pills; every shape is a rounded rectangle.
- **Don't** use a cream or warm ground; the paper is cool.
- **Don't** put a small uppercase label above a page or card title; the uppercase group label only heads a group of lines.
- **Don't** label a figure twice.
- **Don't** add shadows to panels, rows or buttons at rest.
