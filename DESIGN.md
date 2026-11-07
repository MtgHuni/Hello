---
name: MTG Station
description: Version 2.0 « Verre ». A soft world of colour, blurred, behind everything; panels, bars, sheets and buttons in clear liquid glass that lets it through, light caught on the rim; the station's value on MTG-blue glass; Manrope; arrivals rise out of a blur. Night by default (2026-11-07), light optional with the same roles.
colors:
  page: "#eef1f6"
  glass-leaf: "#ffffff8c"
  glass-shade: "#ffffff59"
  glass-strong: "#f6f8fcc7"
  field: "#ffffffb3"
  ink: "#0b0d12"
  ink-secondary: "#4a5160"
  ink-faint: "#646b79"
  hairline: "#0f192d14"
  rule: "#0f192d1f"
  field-edge: "#0f192d29"
  mtg-blue: "#0b6fc4"
  mtg-blue-ink: "#0a5fa8"
  blue-glass-top: "#126cc8e6"
  blue-glass-bottom: "#084080f0"
  gasoil-green: "#0f8f5c"
  essence-amber: "#db7d1f"
  owed-red: "#e0393e"
  owed-red-text: "#b42318"
  gold: "#b8860b"
  good-text: "#0d7a4e"
  blob-blue: "#4aa3ff"
  blob-cyan: "#7ae0ff"
  blob-amber: "#ffb36b"
  night-page: "#070a10"
  night-leaf: "#1e2430"
  night-strong: "#161b25"
  night-ink: "#eef2f8"
  night-blob-blue: "#1d4f9a"
  night-blob-teal: "#0e6a8a"
  night-blob-amber: "#7a4a1c"
typography:
  display:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "36px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.035em"
  section:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "22px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "18px"
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  hero-figure:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "44px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.045em"
    fontFeature: "'tnum'"
  figure:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "30px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.04em"
    fontFeature: "'tnum'"
  body:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.47
    letterSpacing: "-0.012em"
  label:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.005em"
rounded:
  sm: "8px"
  md: "12px"
  squircle: "18px"
  lg: "20px"
  xl: "24px"
spacing:
  sm: "10px"
  md: "12px"
  lg: "18px"
  xl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.blue-glass-top}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "10px 18px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.glass-shade}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
    height: "44px"
  button-return:
    backgroundColor: "{colors.glass-shade}"
    textColor: "{colors.mtg-blue-ink}"
    rounded: "{rounded.md}"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.glass-shade}"
    textColor: "{colors.owed-red-text}"
    rounded: "{rounded.md}"
    height: "44px"
  quick-action:
    backgroundColor: "{colors.glass-shade}"
    textColor: "{colors.ink}"
    rounded: "{rounded.squircle}"
    size: "56px"
  card:
    backgroundColor: "{colors.glass-leaf}"
    rounded: "{rounded.lg}"
    padding: "24px"
  tile:
    backgroundColor: "{colors.glass-leaf}"
    rounded: "{rounded.lg}"
    padding: "15px 16px 16px"
  hero:
    backgroundColor: "{colors.blue-glass-top}"
    textColor: "#ffffff"
    rounded: "{rounded.xl}"
    padding: "22px 22px 24px"
  sheet:
    backgroundColor: "{colors.glass-strong}"
    rounded: "{rounded.xl}"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    height: "44px"
---

# Design System: MTG Station

## Overview

**Creative North Star: "Verre", version 2.0 (2026-11-07, the user's choice)**

The app is a pane of clear glass laid over a soft world of colour. Behind every screen three wide fields of colour (blue, cyan, a little amber) sit blurred and drift slowly; panels, the rail, the bars, sheets and buttons are clear liquid glass that lets them through, the light caught on their top edge. The reference the user gave is Apple Wallet / Santé and iOS liquid glass: sober, premium, few buttons, nothing coloured that does not mean something.

The user rejected « Registre » as « juste changé les couleurs », then five mock-ups, and chose « un peu E » with Manrope, a blurred background, beautiful animations and buttons « comme le liquid glass, comme un verre », « plus transparent ». Only the MTG logo (monogram and its blue) is pinned.

**Key Characteristics:**
- A blurred world of colour behind everything (`.ambient`); the page colour sits on `html` only so it shows through.
- Thin clear glass everywhere (2026-11-07: « les verres ont l'air gros, je veux que ça soit fin »): a white-to-clear gradient, `blur(14px) saturate(1.6)`, one 0.5px light edge all round, a faint top light, a short soft shadow.
- One family, Manrope, heavy (700–800) for titles and figures, figures tabular.
- The station's value on MTG-blue glass (`.hero`), the one blue surface of the manager's home.
- Glass squircles (56px, 18px corners) for the quick actions, the glyph inside and the label beneath.
- Arrivals rise out of a blur, figures count up, rings fill; all of it gives way to reduced motion.
- Night by default (the user's choice, 2026-11-07); light optional, through the sun key, remembered on the device.

## Colors

### Primary
- **MTG Blue** (mtg-blue; links and text on glass mtg-blue-ink): the active nav label, links, the Retour button's text, focus. As glass (`--blue-btn`, blue-glass-top → blue-glass-bottom, about 0.9 alpha so white text holds in the sun) it is the main button and the attendant's main quick action; as lighter glass (`--blue-glass`) it is the hero.

### Secondary
- **Gasoil Green** and **Essence Amber**: the fuels, through `productColor(id)` / `--gasoil`, `--essence`: the swatch beside a fuel or tank name, a tank's ring and level bar, the colour of a segment option, chart series.

### Tertiary
- **Owed Red** (owed-red on tiles; text owed-red-text): what is owed, a loss, gaps, destructive buttons' text. **Gold** (gold) marks combos. Tiles take their colour by meaning (`.c-blue`, `.c-green`, `.c-amber`, `.c-red`, `.c-gold`).

### Neutral
- **Page** (page): the colour on `html`, under the blurred world.
- **Glass** (glass-leaf / glass-shade, as `--glass` and `--glass-btn` gradients): panels, tiles, rail, bars, secondary buttons, quick actions. **Glass Strong** (glass-strong): sheets, dialogs, menus, toasts and the drawer, denser (`blur(30px)`), so forms read over anything.
- **Ink** (ink, ink-secondary, ink-faint): text, figures, units, notes.
- **Hairline / Rule / Field Edge**: translucent ink, so they sit on any glass.
- **The world** (blob-blue, blob-cyan, blob-amber at 0.8 opacity; the night set darker at 0.7): the three fields behind the glass, `blur(70px)`.

### Named Rules
**The Meaning Rule.** Colour is meaning: blue the main action and the value, fuel colours the fuels, red what is owed or lost, gold combos. A neutral figure is ink.

**The One Blue Rule.** One blue glass button per region; every other button is clear glass with ink text.

## Typography

**Font:** Manrope (self-hosted `public/fonts/manrope-latin.woff2`, 400–800), with the system sans fallback. Inter and Barlow Condensed stay in `public/fonts/` unloaded.

**Character:** round, open and modern, set heavy and tight (body tracking -0.012em, titles down to -0.035em) like Apple's large titles.

### Hierarchy
- **Display** (800, 36px): the page title.
- **Section** (800, 22px): a section title (« Aujourd’hui »), sheet titles.
- **Title** (800, 18px): card header titles.
- **Hero figure** (800, 44px, 40px on phones, tabular): the station's value.
- **Figure** (800, 30px, tabular): a tile's value, with its unit small (15px 700, faint); prices, KPI values and tank percentages share the 800 weight and -0.04em.
- **Body** (16px): rows and fields (fields 17px to stop iOS zoom).
- **Label** (700, 13px): the label under a quick action, a tile's side note, the hero's label and sub line (600, white at 0.82).

## Layout

Wide screens (1024px and up): the rail floats as a glass panel (12px from the edges, full height) with the monogram, the navigation and the account; the page beside it at up to 1180px. Below 1024px: the top bar and the tab bar float as glass bars (10px from the sides, 18px and 22px corners).

The manager's home (`dashboard.js`): a page header (« Bonjour », the date), then `.dash`, two columns (up to 380px, then the rest; one column below 1024px): on the left the hero and the four glass shortcuts (État du poste, Livraison, Caisse, Clients); on the right « Aujourd’hui », tiles two by two (one column below 560px): ventes 7 jours with bars, crédits clients, each tank with its ring, caisse, fournisseurs, combos, fiches à compléter. Then « Demander à l'appli » and Alertes.

Gaps are 12px between tiles and boards, 28px between the columns and the sections. Grouped buttons have equal width and are centred on mobile.

## Elevation & Depth

Depth is thin glass, not shadow: every panel carries the rim (`--glass-rim`: a 0.5px light edge all round plus a 0.5px top light; night at 0.14 / 0.22) and a short drop (`--glass-drop`, `0 2px 10px rgba(20, 40, 80, 0.06)`, night `0 2px 12px rgba(0, 0, 0, 0.28)`). Sheets, dialogs and toasts lift a little more (`0 12px 36px rgba(10, 20, 40, 0.2)`); the hero `0 8px 24px rgba(10, 40, 90, 0.2)`; the main button `0 2px 8px rgba(11, 111, 196, 0.18)`. Never a thick rim, a light-catch blob or a deep shadow: the glass must look thin.

Where `backdrop-filter` is missing the glass turns solid (white at 0.92, night `rgba(23, 28, 38, 0.95)`); with `prefers-reduced-transparency` it takes the denser `--glass-strong`.

Frosted (2026-11-07, « le verre moins transparent, un peu blanc »): `--glass` white 0.62 → 0.4 (night 0.2 → 0.12), `--glass-btn` 0.55 → 0.3 (night 0.2 → 0.11), `blur(20px) saturate(1.5)`; the phone's top bar and tab bar are frosted (white 0.72; night a white veil over `rgba(18, 23, 33, 0.6)`, `blur(30px)`), and the tab bar sits low, `max(4px, env(safe-area-inset-bottom) − 18px)` from the bottom.

## Shapes

Soft, continuous corners: controls and fields 12px, cards and tiles 20px, the rail and the phone bars 18–22px, the hero and sheets 24px, quick-action squircles 18px, badges and small marks 8px; a tile's icon square 7px. Rings are circles (54px, 7px stroke, round caps).

## Components

### Buttons
- **Primary:** MTG-blue glass (`--blue-btn`), white 700 text, 12px corners, at least 44px, a thin light edge and a faint blue shadow; hover a little brighter, press a little deeper.
- **Secondary / Annuler / Fermer:** clear glass (`--glass-btn`) with the rim, ink text.
- **Retour:** clear glass, blue ink text. **Danger:** clear glass, red text; a row's cancel square stays faint until touched.
- **Ghost:** no glass, link-blue text.

### Quick actions
A 56px glass squircle (18px corners, `blur(10px) saturate(1.6)`, the thin rim) holding the 24px glyph (stroke 1.9), the label beneath in 13px 700. The attendant's main one is MTG-blue glass. Pressed, it shrinks to 0.94. Four in a row.

### Hero (the station's value)
A button of blue glass (24px corners): the monogram in white at the top right, the label, the value in 44px 800 (pink-white `#ffd2cf` when negative), a sub line. Touched, it opens the `valueDetail()` sheet with the addition column (`valueColumn()`), which closes on one fine line (the old double rule is gone, 2026-11-07).

### Tiles
Glass, 20px corners: a head with a 22px coloured icon square, the title in the tile's colour and a faint side note; the value (30px 800) with its unit and a sub line; on the right bars (7px, the last one full) or a ring filled to the tank's level. A tile that links brightens on hover; `.wide` spans both columns.

### The attendant's shift
The prices, the four glass squircles (Crédit in blue glass), Test de pompe, then the shift's figures as tiles two by two (25px figures on a phone), then « Opérations du poste »: rows without a bin, touched to ask for a cancellation; a badge only where the row differs from a plain credit. The shift line (elsewhere) has round glass stops on a 2px track, done in MTG blue.

### Cards, sheets, fields
Cards are glass panels (20px). Sheets, dialogs, menus and toasts are glass strong (24px for sheets), their footer transparent over a hairline. Fields are white at 0.7 with a translucent edge and 12px corners.

### Navigation
The rail's active item is brighter glass with the rim and a blue-ink label; hover a faint white wash. Phones: floating glass top bar and tab bar.

### Sign-in
The brand panel is glass over the world, the MTG monogram large; the form beside it (stacked on phones).

## Motion

- **Rise:** a screen's hero, tiles, cards and price panels arrive from 16px below, slightly small and blurred (`blur(6px)`), 0.8s on `--ease` (`cubic-bezier(0.22, 1, 0.36, 1)`), tiles one after the other (0.05s apart); the quick actions 0.1s after.
- **Count-up:** `.hero-value`, `.tile-value` and the other figures in `motion.js` count up to their value.
- **Fill:** bars grow from the bottom (0.9s), rings fill (1.4s, after 0.3s).
- **Drift:** the world's fields drift (18–26s, alternate), only where `hover: hover`.
- Everything respects `prefers-reduced-motion`.

## Do's and Don'ts

### Do:
- **Do** put new panels on the glass tokens (`--glass`, `--glass-blur`, `--glass-rim`, `--glass-drop`), sheets on `--glass-strong`, and keep the solid fallback working.
- **Do** keep one blue glass button per region; the rest clear glass with ink text.
- **Do** give colour by meaning only (fuel, owed, combos, the value).
- **Do** set titles and figures in Manrope 800, figures tabular.
- **Do** keep both themes in step: a new detail follows its siblings in light and night.
- **Do** give grouped buttons equal width and centre them on mobile.
- **Do** write all UI text in French.
- **Do** use icons only from the existing set; a new icon is a PNG found on pngegg.com, never drawn.
- **Do** respect reduced motion and reduced transparency.

### Don't:
- **Don't** add explanatory text outside Réglages: no form intro, field hint, descriptive subtitle or explanation sentence in a confirmation; only data, statuses, empty states and error messages.
- **Don't** put a solid page colour on `body` or a full-screen opaque layer: it hides the world behind the glass.
- **Don't** colour buttons beyond the one blue: the user found coloured glass « trop coloré ».
- **Don't** make glass less transparent than it is now (« plus transparent ») or thicker (« fin »): no thick rim, no light-catch blob, no deep shadow.
- **Don't** bring back « Registre » (paper, white leaves, flat panels) or the « Totem de nuit » (black ground, coloured fuel fields, condensed face).
- **Don't** build SVG with `h('svg')`: it lands in the HTML namespace; use `innerHTML` (as the rings do).
- **Don't** use Apple's logo, name or product imagery.
