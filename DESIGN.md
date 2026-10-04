---
name: MTG Station
description: Totem de nuit, the station's price totem at night. Black ground, porcelain type, one colour field per fuel, figures in condensed bold, white action slabs, and a day mode with the same roles for full sun.
colors:
  night-ground: "#0a0a0b"
  night-panel: "#141416"
  night-well: "#0f0f11"
  night-raised: "#1f1f22"
  porcelain: "#f5f4ef"
  porcelain-dim: "#aaa9a3"
  porcelain-faint: "#85847e"
  porcelain-hairline: "rgba(245, 244, 239, 0.09)"
  night-rule: "#2e2e33"
  night-field-edge: "#48484f"
  night-fill: "#34343a"
  night-track: "#242428"
  slab-white: "#ffffff"
  slab-press: "#d9d8d2"
  gasoil-green: "#23c46b"
  essence-red: "#f0313a"
  brand-yellow: "#ffc414"
  series-sky: "#7fb2ff"
  series-orange: "#ff8a1f"
  status-green: "#2fd27a"
  status-red: "#ff4d4f"
  good-text: "#4ade8a"
  bad-text: "#ff6b6b"
  day-ground: "#f1f1ed"
  day-panel: "#ffffff"
  day-well: "#f7f7f4"
  day-raised: "#e6e6e1"
  day-ink: "#0a0a0b"
  day-ink-dim: "#4d4d52"
  day-ink-faint: "#6a6a70"
  day-hairline: "rgba(10, 10, 11, 0.1)"
  day-rule: "#d4d4cf"
  day-field-edge: "#8a8a90"
  day-slab-hover: "#26262a"
  day-gasoil-green: "#1fb862"
  day-essence-red: "#e4303a"
  day-brand-yellow: "#e0a800"
  day-focus: "#a87300"
  day-series-blue: "#2f6fd6"
  day-series-orange: "#d9650a"
  day-status-green: "#17a35a"
  day-status-red: "#d92d20"
  day-good-text: "#0b7a40"
  day-bad-text: "#c4281c"
typography:
  display:
    fontFamily: "'Barlow Condensed', 'Inter', 'Arial Narrow', sans-serif"
    fontSize: "64px"
    fontWeight: 700
    lineHeight: 0.95
    letterSpacing: "0"
  totem-price:
    fontFamily: "'Barlow Condensed', 'Inter', 'Arial Narrow', sans-serif"
    fontSize: "84px"
    fontWeight: 700
    lineHeight: 0.8
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
  figure:
    fontFamily: "'Barlow Condensed', 'Inter', 'Arial Narrow', sans-serif"
    fontSize: "46px"
    fontWeight: 700
    lineHeight: 0.95
    letterSpacing: "0"
    fontFeature: "tnum"
  headline:
    fontFamily: "'Barlow Condensed', 'Inter', 'Arial Narrow', sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.17
    letterSpacing: "0.005em"
  name:
    fontFamily: "'Barlow Condensed', 'Inter', 'Arial Narrow', sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.04em"
  title:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.21
    letterSpacing: "-0.012em"
  body:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.47
    letterSpacing: "-0.022em"
  small:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: "-0.016em"
  label:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.005em"
  column-head:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.01em"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  xl: "20px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  base: "16px"
  lg: "24px"
  xl: "28px"
  2xl: "32px"
  page-x: "44px"
  page-top: "48px"
components:
  button-primary:
    backgroundColor: "{colors.porcelain}"
    textColor: "{colors.night-ground}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
    height: "46px"
  button-primary-hover:
    backgroundColor: "{colors.slab-white}"
    textColor: "{colors.night-ground}"
  button-primary-active:
    backgroundColor: "{colors.slab-press}"
  button-primary-day:
    backgroundColor: "{colors.day-ink}"
    textColor: "{colors.day-panel}"
    rounded: "{rounded.md}"
  button-primary-day-hover:
    backgroundColor: "{colors.day-slab-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.porcelain}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
    height: "46px"
  button-large:
    rounded: "{rounded.md}"
    padding: "14px 26px"
    height: "54px"
  input:
    backgroundColor: "{colors.night-well}"
    textColor: "{colors.porcelain}"
    rounded: "{rounded.md}"
    padding: "25px 16px 8px"
    height: "56px"
  card:
    backgroundColor: "{colors.night-panel}"
    textColor: "{colors.porcelain}"
    rounded: "{rounded.lg}"
    padding: "24px"
  totem-panel-gasoil:
    backgroundColor: "{colors.gasoil-green}"
    textColor: "{colors.night-ground}"
    rounded: "{rounded.lg}"
    padding: "18px 22px 20px"
    height: "168px"
  totem-panel-essence:
    backgroundColor: "{colors.essence-red}"
    textColor: "{colors.night-ground}"
    rounded: "{rounded.lg}"
    padding: "18px 22px 20px"
    height: "168px"
  side-nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.porcelain-dim}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "44px"
  side-nav-item-active:
    backgroundColor: "{colors.night-raised}"
    textColor: "{colors.porcelain}"
  side-rail:
    backgroundColor: "{colors.night-well}"
    width: "252px"
  tab-bar:
    backgroundColor: "{colors.night-well}"
    textColor: "{colors.porcelain-faint}"
    height: "62px"
  badge:
    backgroundColor: "{colors.night-raised}"
    textColor: "{colors.porcelain}"
    rounded: "{rounded.sm}"
    padding: "3px 10px"
---

# Design System: MTG Station

## Overview

**Creative North Star: "Totem de nuit"**

The app is the station's price totem at night, seen from the forecourt: a black ground, porcelain type, and the day's prices lit in one colour field per fuel. Gasoil is green, essence is red, and each fuel owns its colour everywhere it appears (totem field, tank gauge, product swatch). Names and figures speak in Barlow Condensed, set big and bold like the numerals on a pylon; everything that is read rather than glanced at is in Inter. Actions and headers are lit like the forecourt's signs (user's request, 2026-10-05: "chaque en-tête ou bouton doit avoir une couleur différente du reste"): the main action is a solid yellow slab, every other action and every panel header is a sign of its own colour (sky, violet, orange) that neighbours never share. The brand is a single lit yellow drop.

Density is that of an operating tool: a wide-screen side rail with an icon nav, a condensed headline ruled off from its content, the totem, then figures on one ruled board. On phones the rail folds into a top bar with the page name and a bottom tab bar, and the totem drops to two columns. The attendant uses the app on a phone with customers queuing, so the figures are large and the actions are few. A day mode keeps every role and swaps the values, for the pump in full sun.

This world replaces the apple.com tile grid and centred top nav that came before it (and the "Midnight Line" recolour of that layout). Panels are ruled by hairlines, never floated on resting shadows.

**Key Characteristics:**
- Black ground (night) or bone ground (day), porcelain or ink text, no tinted neutrals.
- Green and red belong to the fuels; yellow, sky, violet and orange are the signs of actions and headers.
- Barlow Condensed for names and figures, Inter for reading.
- Ruled boards: panels share one surface divided by 1px hairlines.
- One shape everywhere: the rounded rectangle (14px panels, 10px controls, 6px small marks); no circle, no pill, and an inner radius follows its container.
- Motion fills, counts and sweeps once per arrival, then stays still.

## Colors

A near-neutral black and porcelain world with two saturated fuel fields and one lit yellow; every value has a day twin with the same role.

### Primary
- **Sign Yellow** (`--sign-yellow` #ffc414; day #f5b800): the main action. Primary buttons, the main quick action, the segmented thumb, the selected choice tile and pump option, the checked box, the remark card. Text on it is always night-ground black. Hover #ffd34f, press #e8ac00.
- **Signs Sky, Violet, Orange** (`--sign-sky` #7fb2ff, `--sign-violet` #b69cff, `--sign-orange` #ff9a3d; day #2f6fd6, #6a4bd1, #d9650a, with darker `-ink` twins for text on bone): every other action and every panel header. A secondary button is a tint of its sign (15% night, 12% day) with a 55% edge and its text in the sign's ink; side by side, buttons take turns sky → violet → orange (`:nth-child(… of .btn.secondary)`). Panel headers are a band tinted the same way with the title in the sign's ink, panels taking turns in the same order; table heads carry a faint (6%) wash of their panel's sign. Quick actions: the first is solid yellow, then sky, violet, orange tiles with a solid icon square.
- **Porcelain** (porcelain; day: day-ink): links and the caret.

### Secondary
- **Gasoil Green** (gasoil-green; day: day-gasoil-green): the gasoil product colour. Its totem field, tank fill, swatch and series 1 in product data. Text on it is always night-ground black.
- **Essence Red** (essence-red; day: day-essence-red): the essence product colour, same roles as gasoil, series 2. Text on it is always night-ground black.
- **Series Sky** and **Series Orange** (series-sky, series-orange; day: day-series-blue, day-series-orange): products 3 and 4 if a station adds them. Product colour follows the product id, never its rank in a list.

### Tertiary
- **Brand Yellow** (brand-yellow; day: day-brand-yellow): the lit drop of the brand mark, the active nav icon (rail and tab bar), the done and current stops of the shift line, and the focus ring (day uses the deeper day-focus for contrast on bone).

### Neutral
- **Night Ground** (night-ground; day: day-ground): page background, the `theme-color`, and the text colour on fuel fields and on the porcelain slab.
- **Night Panel** (night-panel; day: day-panel): cards, sheets, drawers, toasts.
- **Night Well** (night-well; day: day-well): the side rail, the tab bar, table column heads and form fields; one step darker than the panel.
- **Night Raised** (night-raised; day: day-raised): the active nav item, hovered board facts, avatars and circle buttons, badges.
- **Porcelain / Porcelain Dim / Porcelain Faint** (porcelain, porcelain-dim, porcelain-faint; day: day-ink, day-ink-dim, day-ink-faint): primary text, secondary text (subtitles, labels), tertiary text (column heads, meta, inactive tabs).
- **Porcelain Hairline** (porcelain-hairline; day: day-hairline): the 1px rule that edges every panel, divides the board and the figure band, separates rows and rules off headers.
- **Night Rule** (night-rule; day: day-rule): stronger rule under table heads, above totals and as the resting edge of fields.
- **Field Edge** (night-field-edge; day: day-field-edge): secondary button outline, choice tiles, pump options.
- **Night Fill / Night Track** (night-fill, night-track): switch off state, unreached shift-line track, sheet grabber; gauge and bar tracks.

### Status
- **Status Green / Status Red** (status-green, status-red; day twins) fill dots, switches, toast icons and alert icons. Orange (#ff8a1f) is "serious", and the warning status shares the brand yellow hex as a dot or icon fill only.
- **Good Text / Bad Text** (good-text, bad-text; day twins) are the readable text versions for variances and errors.

### Named Rules
**The Colour Belongs to the Fuel Rule.** Green and red appear only where a fuel is meant: its totem field, its tank, its swatch, its series. Totals, revenue bars and every non-product figure are porcelain (night) or ink (day).

**The Lit Sign Rule.** Every button and every header is lit in a colour that sets it apart from what surrounds it: yellow for the one main action, sky, violet or orange for the rest, never the same colour as its neighbour. Yellow also keeps its signal roles (the brand drop, the active nav item, the shift line, focus).

**The Black Text on Fuel Rule.** Text on a fuel field is always night-ground black, in both modes, at solid weight; never white, never translucent.

## Typography

**Display Font:** Barlow Condensed 600/700 (with Inter, Arial Narrow), self-hosted
**Body Font:** Inter variable (with -apple-system, Segoe UI, Roboto), self-hosted

**Character:** Barlow Condensed is the pylon's numerals: narrow, heavy, set near zero tracking with tabular figures. Inter does the reading at an apple-tight body tracking (-0.022em).

### Hierarchy
- **Totem price** (700, 84px, 0.8; 56px on phones, 48px under 420px): the price on each fuel field, with a 22px 600 "$/L" unit.
- **Display** (700, 64px, 0.95; 40px under 834px): page h1 and the sign-in heading ("Connexion"), ruled off from the content below.
- **Figure** (700, 46px, 0.95; 60px for the lead figure of a band; 36px under 834px): KPI values, board facts (44px), tank percentages (40px), the till result (72px).
- **Headline** (600, 24-26px, 1.17): h2 and card header titles; 28-36px in sheet and drawer headers.
- **Name** (700, 24px, 0.04em, uppercase): fuel names on the totem, the station name in the rail (27px) and the phone top bar title; the shift-line stop names (600, 17px, 0.03em, uppercase).
- **Title** (Inter 600, 17px): h3, inside panels.
- **Body** (Inter 400, 17px, 1.47): default text, inputs, buttons (16px 600).
- **Small / Label** (Inter 14px; 13px 600): subtitles, KPI labels, hints, badges.
- **Column head** (Inter 600, 12px, 0.01em, sentence case): table heads on the well colour.

### Named Rules
**The Condensed Speaks Names and Figures Rule.** Barlow Condensed is for headings, product and station names, and numbers that are glanced at. Sentences, labels, form text and buttons stay in Inter.

**The Tabular Figures Rule.** Every money, litre and percentage figure uses tabular numerals so counts and columns stay aligned.

## Layout

Wide screens (1024px and up): a two-column grid, a 252px side rail in the well colour ruled from the page by a hairline, then the main column padded 44px (32px under 1180px) with content capped at 1180px (720px for narrow pages). Each page opens with a header 48px from the top, the 64px headline and its subtitle on the left and actions on the right, ruled off by a hairline 24px below.

Under 1024px the rail disappears: a 56px sticky top bar (brand drop, page name in condensed uppercase, account button) with a blurred translucent ground, and a fixed 62px bottom tab bar (four tabs plus "Plus") on a solid well. Main padding drops to 16px. Under 834px every multi-column grid and form collapses to one column, the totem keeps two columns, and the board stacks.

The spacing rhythm is 4/8/12/16/24/28/32: 16px grid gaps (12px on phones), 24px card padding (20/18 on phones), 32px between sections, 12px between totem fields. Touch targets are at least 44px; primary buttons 46px, large 54px.

### Named Rules
**The Ruled Board Rule.** Related panels share one surface: a grid with a 1px gap over the hairline colour, an outer hairline border, a 14px outer radius and square inner cells. The manager's dashboard board (six columns: chart 4, alerts 2, facts 3+3) and every band of figures are built this way, not as separate floating tiles.

## Elevation & Depth

Flat at rest. Depth is tonal (well, panel, raised) and edges are hairlines drawn as a 1px inset box-shadow. Shadows appear only on things that float above the page: drawers and sheets, alerts, action sheets, toasts, tooltips, and a hovered quick action.

### Shadow Vocabulary
- **Panel hairline** (`box-shadow: inset 0 0 0 1px var(--hairline)`): the resting edge of every card.
- **Float** (`--shadow-lift: 0 18px 44px rgba(0, 0, 0, 0.6)`; day `rgba(10, 10, 11, 0.18)`): drawers (paired with an inset left hairline), action sheets, toasts, tooltips, quick-action hover.
- **Modal** (`0 30px 90px rgba(0, 0, 0, 0.25)`): centred alerts and phone sheets.
- **Focus** (`outline: 2px solid var(--focus); outline-offset: 2px`; fields use `box-shadow: 0 0 0 2px var(--focus)` with the border going to text colour).

### Named Rules
**The Ruled, Not Floated Rule.** A panel at rest never carries a drop shadow; it is edged by a hairline or shares a ruled board.

## Shapes

One shape: the rounded rectangle, everywhere (user's request, 2026-10-05: "si c'est oblong c'est oblong partout"). Panels, totem fields, the board and status icons are 14px; buttons, fields, nav items, choice tiles, segmented controls, the search field, icon buttons and quick-action icons 10px; avatars, alert icons and the switch track 8px; badges, checkboxes, shift-line stops, the switch knob, toast icons and the focus outline 6px; status dots, gauge and bar tracks 2-3px; drawers and phone sheets 20px on their open edge only. Nothing is a circle or a pill. A shape inside another keeps the same family and a concentric radius (the segmented thumb is 7px inside a 10px track with 3px of padding).

## Components

### Buttons
Lit signs: the main action is the yellow slab, every other one is tinted in its own colour.
- **Shape:** 10px radius, 46px minimum height (34px small, 54px large).
- **Primary:** sign-yellow slab with night-ground text in both modes, Inter 16px 600, 10px 20px padding. Hover sign-yellow-hover, press sign-yellow-press, and a 0.97 press scale.
- **Secondary:** a tint of its sign (sky, then violet, then orange among its siblings) with a 1px edge of the sign at 55% and the text in the sign's ink; hover deepens the tint and the edge goes solid.
- **Ghost:** a sky tint without an edge, sky ink text (light actions such as Modifier, + Ajouter). **Danger:** a red tint with a red edge and bad-text; **Destructive:** status red with white text.
- **Focus:** the global 2px brand-yellow outline at 2px offset.

### Cards / Containers
- **Corner Style:** 14px.
- **Background:** night panel (day: white).
- **Shadow Strategy:** inset hairline only (see Elevation).
- **Header:** a strip across the top, 18px 24px 16px, ruled off by a hairline; title in condensed 26px.
- **Internal Padding:** 24px (20px 18px on phones). Flush cards carry tables edge to edge.

### Inputs / Fields
- **Style:** floating-label fields, 56px tall, well background, night-rule border, 10px radius, Inter 17px; the label shrinks to 0.705 scale on focus or fill.
- **Focus:** border goes to text colour plus a 2px brand-yellow ring.
- **Error:** bad-text message with a short shake. Read-only fields sit on the well in dim text.
- **Choice tiles** (segment fields): 56px tiles with a field-edge border; selected adds a 1px inset porcelain frame over the soft accent fill.

### Navigation
- **Side rail:** well background, station name in condensed uppercase 27px beside the yellow drop, 44px items with 20px stroke icons in dim text; hover raises to the faintest fill, active is the raised colour with porcelain text at 600 and the icon lit brand yellow. The account sits at the foot above a hairline.
- **Phone:** top bar with the page name in condensed uppercase 24px; bottom tab bar with 23px icons and 11px 600 labels in faint text, active in porcelain with a brand-yellow icon nudged up 1px.

### Badges
Small 6px-radius chips on the raised fill, 13px 600 text, led by a 7px status dot (good, warning, serious, critical, info).

### Price Totem (signature)
One field per fuel, auto-fit at 220px minimum (two columns on phones), 168px tall, filled with the product colour, black text: the uppercase name at the top, the 84px price with its "$/L" unit at the foot, and a solid 14px 600 "Abonnés …" line when the subscriber price differs. On each arrival the fields fill from the bottom like a tank (0.9s, staggered 80ms), the prices count up, and one white sheen crosses them once.

### Shift Line (signature)
A four-stop line ("Ouverture", "Ventes", "Clôture", "Validation"): 20px round stops on a 4px track, done segments and stops filled brand yellow, the current stop a thick yellow ring that glows twice, labels in condensed uppercase 17px (faint, dim when done, porcelain when current). The track draws in left to right on arrival.

### Figure Band and Board
KPIs in one ruled band: 13px 600 label, 46px condensed figure (60px for the first), 13px faint sub-line. The dashboard board puts the chart, alerts and two linked facts (15px label, 44px figure, hover raised) on one ruled surface. Revenue bars are porcelain with 6px top corners; hovering dims the others to 0.4.

### Sheets and Drawers
Forms open as a 500px drawer from the right on wide screens (20px radius on the left edge, hairline on its inner edge, float shadow) and as a bottom sheet with a grabber on phones. The body scrolls and the footer stays pinned behind a hairline.

### Sign-in
A split screen: the HyperFrames brand film (`mtg-totem` webm/mp4 over a 1440px poster, fading in when playing) fills the left 1.05fr, the form sits on the right in a 420px column under a 64px condensed heading. On phones the film becomes a 40dvh band above the form.

### Motion
Arrivals only: the page fades up 20px (0.7s, staggered 60ms), bands and boards arrive as one piece, figures count up over 750ms (ease-out quartic, at most 12 per screen), tank meters grow and take one sheen, and route changes push, pop or fade with View Transitions (0.45s). The default ease is `cubic-bezier(0.22, 1, 0.36, 1)`. Under `prefers-reduced-motion`, everything settles instantly and figures are not counted.

## Do's and Don'ts

### Do:
- **Do** give each fuel its colour field and keep the text on it night-ground black and solid.
- **Do** build related panels as one ruled board: 1px hairline gaps, a 14px outer radius, square inner cells.
- **Do** set names and glanced-at figures in Barlow Condensed with tabular numerals, and everything read in Inter.
- **Do** keep one porcelain (day: ink) slab button per region; secondary actions are outlined.
- **Do** define every new colour twice, in `:root` and `:root[data-theme='light']`, with the same role.
- **Do** keep focus visible as the 2px brand-yellow ring.

### Don't:
- **Don't** use gasoil green or essence red for anything that is not that fuel (totals, revenue, success, buttons).
- **Don't** spread the brand yellow beyond the drop, the active nav icon, the shift line and focus.
- **Don't** float resting panels on drop shadows or return to separate apple.com-style tiles and a centred top nav.
- **Don't** put white or translucent text on a fuel field.
- **Don't** set sentences, form labels or buttons in Barlow Condensed.
