---
name: MTG Station
description: Version 3.0 « Plan ». An architect's drawing of the station, in the look of the owner's NANO Build site and the blue of the MTG logo. Jost, right angles everywhere, frames of 2px, the logo's double frame with construction lines, titles announced by a drawn line, small spaced capitals, figures on a ruled grid. Night by default, light optional.
colors:
  night-ground: "#070b10"
  night-ink: "#f2f5f8"
  night-ink-secondary: "#ccd4dd"
  night-line: "#f2f5f861"
  night-grid: "#f2f5f82b"
  night-blue: "#1e9bf0"
  night-on-blue: "#04101c"
  night-owed: "#ff7b6e"
  sheet: "#e6e9ed"
  paper: "#ffffff"
  ink: "#0d1117"
  ink-secondary: "#2b333d"
  line: "#0d11175c"
  grid: "#0d111729"
  mtg-blue: "#0b6fc4"
  mtg-blue-ink: "#0a5fa8"
  owed-red: "#b3261e"
  gasoil-green: "#12895a"
  essence-orange: "#cf6a1c"
  tab-band: "#0a1622"
typography:
  display:
    fontFamily: "Jost, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "36px"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.01em"
  section:
    fontFamily: "Jost, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "21px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.005em"
  hero-figure:
    fontFamily: "Jost, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "54px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "'tnum'"
  figure:
    fontFamily: "Jost, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.01em"
    fontFeature: "'tnum'"
  body:
    fontFamily: "Jost, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.47
  capitals:
    fontFamily: "Jost, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.14em"
rounded:
  none: "0px"
spacing:
  cell: "13px"
  md: "16px"
  lg: "22px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.night-blue}"
    textColor: "{colors.night-on-blue}"
    rounded: "{rounded.none}"
    padding: "10px 22px"
    height: "46px"
  button-secondary:
    backgroundColor: "{colors.night-ground}"
    textColor: "{colors.night-ink}"
    rounded: "{rounded.none}"
    padding: "10px 22px"
    height: "46px"
  hero:
    backgroundColor: "{colors.night-ground}"
    textColor: "{colors.night-ink}"
    rounded: "{rounded.none}"
    padding: "20px 20px 18px"
  card:
    backgroundColor: "{colors.night-ground}"
    rounded: "{rounded.none}"
    padding: "22px"
  input:
    backgroundColor: "{colors.night-ground}"
    textColor: "{colors.night-ink}"
    rounded: "{rounded.none}"
    height: "56px"
---

# Design System: MTG Station

## Overview

**Creative North Star: "Plan", version 3.0 (2026-11-09, the user's choice)**

The app is an architect's drawing of the station. The user asked for the look of their own site, NANO Build (`MtgHuni/nano-build-site`), « mais avec la couleur du logo de MTG, donc plus bleu », after rejecting the glass of version 2.0 (« le verre et le flou », « l'organisation », « les détails »), three black-and-gold mock-ups and a soft frosted one. Everything is drawn with lines: frames, rules, a grid. Nothing is soft: no glass, no blur, no gradient, no rounded corner, no shadow except under a sheet.

**Key Characteristics:**
- Jost, one family: 600 for titles and figures, 400 for text, small spaced capitals for labels.
- Right angles everywhere (`border-radius: 0 !important` on every element).
- Frames of 2px; the logo's double frame (a 2px border and a 1px line 6px away) around what matters most: the station's value, today's prices, the attendant's « Crédit ».
- Construction lines running past the corners of the double frame, like a drawing.
- Section and card titles announced by a drawn line.
- Figures on a ruled grid, two columns, never in tiles.
- One colour, the MTG blue; red only for what is owed or lost; the fuels as 9px squares.
- Night by default, light optional (the sun key).

## Colors

### Primary
- **MTG Blue** (night-blue `#1e9bf0` at night with dark text on it, mtg-blue `#0b6fc4` in the light with white text): the main action, the double frame, the line before a title, the current place (rail and tab), focus, a level's last bar.

### Secondary
- **Gasoil Green** and **Essence Orange**: only as 9px squares before a fuel's or a tank's name, and as the fill of a tank's level bar, through `productColor(id)` / `--gasoil`, `--essence`.

### Tertiary
- **Owed Red** (night-owed at night, owed-red in the light): what is owed, a loss, a gap, a destructive button's text and frame. Nothing else is red.

### Neutral
- **Night** (default): a blue-black ground (night-ground), light ink, lines in the ink at 0.38 (`--line`) and 0.17 (`--grid`).
- **Light**: a blue-grey sheet (sheet), never white; white (paper) is kept for buttons and fields; ink text; lines in the ink at 0.36 and 0.16. The phone's tab band is blue-black (tab-band) with white labels.
- No grey text for content: secondary text stays close to the ink (ink-secondary) and is told apart by size, weight or capitals.

### Named Rules
**The One Blue Rule.** Blue is the only colour of the interface; one solid blue button per region.

**The Red Rule.** Red means owed, lost or destructive.

## Typography

**Font:** Jost (self-hosted variable `public/fonts/jost-latin.woff2`), with the system sans fallback. Manrope, Inter and Barlow Condensed stay in `public/fonts/` unloaded.

### Hierarchy
- **Display** (600, 36px; 30px on phones): the page title.
- **Section** (600, 21px; 19px in a card header): preceded by a drawn 28px line in blue.
- **Hero figure** (600, 54px; 46px on phones, tabular): the station's value.
- **Figure** (600, 26px, tabular): a cell of the ruled grid; prices 34px.
- **Body** (400, 17px).
- **Capitals** (400, 11.5px to 12.5px, 0.14em to 0.16em, uppercase): labels above figures, table heads, the line above a page title (the page's subtitle), badges, tabs, the top bar's title.

## Layout

Wide screens: the rail on the ground itself, ruled off by one line, the current page marked by a 3px blue bar on its left; the page at up to 1180px. Phones: a flat top bar (monogram, the page's name in capitals, the sun, the account) and a flat tab band at the bottom, low (`env(safe-area-inset-bottom) − 14px`), the current tab under a blue line.

A page opens with its small capitals, its title and one line under. The manager's home: the double frame (value), the framed strip of four shortcuts, « Aujourd'hui » on the ruled grid, then Alertes; two columns from 1024px. The attendant's shift: the prices in the double frame, « Crédit » as one solid blue block in its double frame, the three other actions in one ruled strip, « Test de pompe », « Ce poste » on the ruled grid, the operations.

Grouped buttons have equal width and are centred on mobile.

## Elevation & Depth

Flat. Depth is lines. Only sheets, dialogs, menus and toasts cast a shadow (`--shadow-lift`), and a sheet carries a 2px blue line on top.

## Shapes

The rectangle, and nothing else. Marks are squares (fuel, status dot). The only ornaments are the double frame, the construction lines, the drawn line before a title, and the double rule that closes a total.

## Components

### Buttons
- **Primary:** solid MTG blue, a 2px blue border, 600, 0.03em, at least 46px (56px large).
- **Secondary / Annuler / Retour:** the ground (white in the light) framed by 2px of ink.
- **Danger:** framed in red, red text. **Ghost:** underlined text. **Small:** 1px frame, 36px.
- **Hover:** a second 1px line moves 4px away from the button, like the double frame; the colours do not change.

### The double frame (signature)
`border: 2px solid var(--frame); outline: 1px solid var(--frame); outline-offset: 6px`, with `::before` (two horizontal lines) and `::after` (two vertical lines) in `--line` running past the corners; `.shell-main` clips what leaves the screen. Used by `.hero` and `.totem`; the attendant's « Crédit » has the frame without the lines.

### The ruled grid
`.tiles`: two columns, a line on top, each cell ruled under, even cells ruled on their left; a lone last cell takes the row. A cell (`tile()` in `ui.js`): the label in capitals (a fuel's square before it, a note on the right), the figure with its unit small, an optional note, bars (the last in blue) or a tank's level bar (7px, framed in ink).

### Strips
The manager's shortcuts (`.acts`) and the attendant's three other actions: one frame of 2px, cells ruled between, the glyph above the label.

### Panels, sheets, fields
A panel is a frame of one line; its header is ruled off, its title preceded by the drawn line. A sheet is the ground, framed, a blue line on top. Fields are framed in ink (white in the light), 56px with a floating label; focus is a blue frame. A segmented control is framed, the choice made filled in ink.

### Status
Badges are framed labels in capitals with a square mark; alert icons are framed squares in their colour.

## Motion

- **Draw:** on entry the line before each title and the horizontal construction lines are drawn (`draw-x`, 0.9s to 1s, `cubic-bezier(0.7, 0, 0.3, 1)`).
- **Arrive:** frames, strips, cells and panels rise 14px (`plan-in`, 0.7s, `cubic-bezier(0.16, 1, 0.3, 1)`), cells one after the other.
- **Count and fill:** figures count up (`motion.js`), bars and level bars grow.
- Everything gives way to `prefers-reduced-motion`.

## Do's and Don'ts

### Do:
- **Do** draw with lines: a frame, a rule, the grid; reuse `.tiles`, the strips and the double frame.
- **Do** keep one solid blue button per region; the others framed in ink.
- **Do** write labels in small spaced capitals and figures in Jost 600, tabular.
- **Do** keep night and light in step: a new detail follows its siblings in both.
- **Do** give grouped buttons equal width and centre them on mobile.
- **Do** write all UI text in French.
- **Do** use icons only from the existing set; a new icon is a PNG found on pngegg.com, never drawn.
- **Do** respect reduced motion.

### Don't:
- **Don't** add explanatory text outside Réglages: no form intro, field hint, descriptive subtitle or explanation sentence in a confirmation; only data, statuses, empty states and error messages.
- **Don't** bring back glass, blur, gradients, rounded corners, coloured tiles or soft shadows: the user rejected them.
- **Don't** add a second colour: no gold, no coloured buttons; blue only, red for what is owed.
- **Don't** put the double frame on more than what matters most on a screen.
- **Don't** use grey for content text.
- **Don't** use Apple's logo, name or product imagery.
