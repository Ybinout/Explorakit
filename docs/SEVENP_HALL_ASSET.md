# Intérieur de 7p — 24 octobre 2026

Décor créé avec l’outil intégré **imagegen**, livré sans redimensionnement ni retouche du bitmap : `vue-explorakit/src/assets/ville5_arene.png` (1484×1060). Carte Tiled dédiée `data/maps/ville5_arene.{json,tmx}` : 28×20 cases, tuiles source 53 px, projection du moteur à 32 px par case / 896×640. Les collisions restent fondées sur les indices des cases.

La salle remplace uniquement l’ancien alias de Blanchecime vers `gen_arene2`. Wanda conserve sa carte. 7p se tient en (13,4), dialogue depuis (13,5), arrivée en (13,16), sortie en (13,17) ou (14,17). Piliers et murs bloqués, allée centrale libre. Équipe, difficulté, musique, récompenses et décor du combat inchangés. Éclairage local et poussières discrètes, compatibles mouvement réduit.

## Prompt de création

Create a finished, production-ready 2D top-down pixel-art interior map for the FINAL champion arena in a handheld-style monster-catching RPG. This is the actual WALKABLE OVERWORLD MAP, not a battle background, not concept art, not isometric, not a perspective room. A magnificent mountain summit sanctuary for champion 7p: blue-black slate, silver inlaid stone, pale ice crystals, restrained warm brass lanterns, icy stained-glass windows, majestic architectural symmetry. Crisp hand-placed-looking pixels, coherent low-resolution tile art, strong silhouettes, beautiful material detail without photographic textures, no blur, no vector gradients. Visible top faces and short south-facing vertical wall faces as in classic Nintendo DS top-down town interiors. Landscape canvas, 7:5 aspect ratio, intended logical map size 448 x 320 pixels (28 columns x 20 rows of 16-pixel tiles); the rendered output may be larger but preserve that pixel-art scale and this exact composition.

Precise gameplay layout (coordinates refer to a 448x320 logical canvas):
- North wall occupies y=12..65, monumental glowing ice stained-glass window behind the champion centered x=216. Ancient silver geometric crest, no readable lettering, no words, no UI.
- Champion standing spot is EMPTY at x=216,y=88 (48.2% width,27.5% height). This is a luxurious raised-looking but WALKABLE dais; broad shallow stairs below it. No throne, statue, altar, crystal or furniture at that spot. No characters anywhere.
- Preserve a broad uninterrupted walkable hall from x=96..352, y=80..272. It must read as FLAT traversable floor, with an elegant large inlaid eight-point compass/star motif around x=224,y=176. Embossed designs are inlays, not obstacles.
- A deep midnight-blue runner with subtle silver borders leads straight north from the southern entrance at x=216,y=280 to the dais at x=216,y=88. Keep this entire central route completely clear, no obstacles.
- Put impressive paired pillars, small blue crystal clusters, hanging indigo/silver banners and warm wall lanterns only in the SIDE architectural bands x=24..88 and x=360..424. Two pairs of pillars roughly y=110 and y=210, matching left/right. They do not intrude on the central walkable hall.
- South doorway at x=208..240,y=272..288: clearly open passage in the near wall, with a short visible threshold at x=216,y=280. Outside the room is a deep dark blue void, including the bottom strip y=296..320.
- Clear outer enclosing walls; no exterior landscape, no rooms beyond, no incidental doors, no giant empty black margins.
- The composition must feel like the climactic final arena: powerful entrance axis, intricate silver mosaic floor, excellent ice and warm light contrast, detailed wall arches. Rich but readable at mobile size.
No Pokemon, no people, no sprites, no text, no labels, no grids overlaid, no watermark, no perspective vanishing point, no camera tilt. Fully opaque background.
