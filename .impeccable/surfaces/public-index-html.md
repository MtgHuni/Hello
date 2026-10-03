---
version: 1
slug: "public-index-html"
primary_target: "public/index.html"
related_targets: []
---

# Surface: application shell (all screens: pompiste, gérant, client)

Scope: the whole web app, mode Operate. Audience: attendant outdoors in sun on modest Android phones; customers in the queue; manager mostly on phone.
Chosen direction: the standing exit (canon), pinned by the user in words: "Site apple.com". Execute apple.com's web language at full fidelity, played straight, personalised as MTG Station. No Apple logo, name or product imagery.

## Direction contract

THESIS: MTG Station feels like apple.com: calm light-grey ground, white rounded tiles, big confident SF headlines, one blue for every action. It refuses the iOS app chrome (floating glass tab bar, glass cards) and dashboard-template density.

OWN-WORLD: #f5f5f7 ground, #ffffff tiles at 18px radius with no borders, #1d1d1f text, #6e6e73 secondary, #0071e3 pill buttons, #0066cc links with chevron, #d2d2d7 hairlines. SF Pro Display/Text (Inter with optical sizing as Android fallback), tight tracking. Thin translucent global nav; apple.com store idioms: 56px floating-label fields, choice tiles with a 2px blue selected border.

STORY: every screen states where you are in one big headline. The one job of that screen is always a blue pill away. States read as words plus colour (Payé, Crédit, Combos, En retard).

FIRST VIEWPORT: global nav 48px (MTG Station mark left; links centred on desktop; menu button on phone opening a full-screen menu with large staggered links), then a 32–40px semibold headline with a grey subhead, then content tiles. On scroll the global nav leaves and a sticky local nav slides in: page name left, primary action pill right.

FORM: canon (apple.com), user-pinned; seed key f4410311 (degraded roll, overridden by the user's choice).

SIGNATURE: the sticky local nav with its action pill (the apple.com "Acheter" bar), and the full-screen menu with large staggered links. Motion: apple.com ease cubic-bezier(0.28,0.11,0.32,1); fade-up reveals; no bounce.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
