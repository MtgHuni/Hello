---
version: 3
slug: "public-index-html"
primary_target: "public/index.html"
related_targets: ["public/css/app.css", "public/js/views/dashboard.js", "public/js/views/attendant.js"]
---

# Surface: application shell (all screens: gérant, pompiste, client)

Mode: Operate. World "Plan", version 3.0, chosen 2026-11-09: « partons avec Nano Build mais avec la couleur du logo de MTG, donc plus bleu ». The reference is the user's own site (MtgHuni/nano-build-site). User pins: more premium, every detail looked at; no glass, no blur; buttons and layouts all changed; night by default; only the MTG logo (monogram and its blue) must stay. Code-led, mock-ups first.

## Direction contract

THESIS: the app is an architect's drawing of the station: lines, frames and figures, nothing soft. It refuses glass, blur, gradients, rounded corners and coloured tiles.

OWN-WORLD: Jost; right angles everywhere; frames of 2px; the logo's double frame around the value and the prices, construction lines running past the corners; titles announced by a drawn line; labels in small spaced capitals; figures on a ruled grid; one colour, the MTG blue, for the main action, the frames and the current place; red only for what is owed. Night: blue-black ground, light lines. Light: a blue-grey sheet, white kept for buttons and fields.

STORY: everyone sees today's prices and where the shift stands; the attendant records a credit from one solid blue block; the manager reads the station's value in its double frame and the day on a ruled grid.

FIRST VIEWPORT: phones: flat top bar with the monogram, the small capitals and the title, the double frame, the framed strip of shortcuts or actions, the ruled grid, a flat tab band. Wide screens: the rail ruled off by one line, the frame beside the grid.

SIGNATURE: the double frame with its construction lines; the drawn line before each title; the second line that moves away from a button under the pointer.

FINISH: tokens and rules in DESIGN.md and `.impeccable/design.json`; the layer is the « version 3.0 « Plan » » block at the end of `public/css/app.css`.
