# Décors de pêche — 23 octobre 2026

## Version 2 — eau dominante, décor simplifié

À la demande du créateur, la pêche utilise désormais environ 80 % d’eau visible, une rive lointaine discrète et des ondulations plus simples. Berges, pierres et végétation du premier plan supprimées. Les socles gardent leurs ancrages, avec des couleurs aquatiques.

Images éditées avec l’outil intégré **imagegen**, sans CLI, fond opaque. Conversion WebP qualité 0,91, sans recadrage. Versions 1 conservées pour l’historique.

- `vue-explorakit/src/assets/battle/lake-wide-v2.webp` — source `exec-a291cb5b-04c9-4223-8f2a-c995935d4017.png`, référence paysage v1.
- `vue-explorakit/src/assets/battle/lake-mobile-v2.webp` — source `exec-0bfced04-830f-48a2-a264-fc1910412a3b.png`, références portrait v1 et paysage v2.

Prompt paysage :

> Use case: style-transfer. Edit target: the supplied landscape lake battle background. Make a substantially simpler 16-bit pixel-art RPG combat background, landscape 16:9. The user's request is MUCH MORE WATER and FAR LESS DETAIL. Replace the busy shore and dense forest with calm open blue-teal lake water occupying about 85 percent of the picture, including the entire foreground and both battle positions. Thin distant softly silhouetted low green shore along the top 12 percent, with a narrow pale overcast sky above. Large clean pixel clusters and a restrained 12-color palette; broad quiet areas of water with only a few short sparse horizontal ripple marks. Simple classic handheld game background, not a detailed landscape painting. Remove all foreground banks, rocks, reeds, grass tufts and side vegetation. Keep the cool lake palette and gently receding perspective. No people, creatures, text, UI, circles or platforms: the engine draws its own platforms. Opaque image.

Prompt mobile :

> Use case: style-transfer. Edit target image 1: old portrait lake battle background. Reference image 2: newly simplified landscape version, match its palette and simplified pixel style. Produce a PORTRAIT 2:3 mobile battle background. User wants MUCH MORE WATER and FAR LESS DETAIL. About 85% of the entire height must be open blue-teal lake water, from y=15% all the way to the bottom edge. Above it only a thin distant soft low green shoreline and narrow cloudy pale blue sky. No foreground land at all. Remove all reeds, grass, rocks, sandy beach and close trees. Simple classic 16-bit handheld game pixel-art, large deliberate pixel clusters, broad quiet areas of teal water with sparse little horizontal ripple highlights, low contrast and limited palette. No detailed forest or individual leaf texture. Keep both combat positions empty water at 77% width/57% height and 19% width/100% height. No characters, creatures, text, UI, logos, circles or platforms; platforms are added separately by the game. Opaque full bleed portrait, no border.

## Version 1 — historique

Deux nouvelles images générées avec l’outil intégré **imagegen** (mode génération, fond opaque). Aucun asset de carte auteur modifié. Conversion PNG → WebP qualité0,91, sans recadrage ; socles dessinés séparément par le composant de combat et ancrés sur les mêmes coordonnées que les Pokémon.

- `vue-explorakit/src/assets/battle/lake-wide-v1.webp` : scène paysage16:9 ; source `exec-e72765c4-31af-4102-920f-e061ce2e56a4.png`.
- `vue-explorakit/src/assets/battle/lake-mobile-v1.webp` : scène portrait2:3 ; source `exec-f5b1f9d9-6182-42e1-a616-c37d874bb6e3.png`.

Prompt paysage :

> Create a 16:9 landscape pixel art battle background for a refined 16-bit handheld monster-catching RPG. A peaceful freshwater lake shore on an overcast day, teal blue water, forested green hills in the distance, soft cloudy pale blue-grey sky. Detailed but clean deliberate pixel clusters, game-ready image, coherent perspective. Composition for a combat scene: the opponent's feet will be at 76% width and 46% height, leave uncluttered wet sandy shore or a tiny shallow grassy bank at that location; player's feet at 22% width and 85% height, sandy grass bank in foreground bottom-left. The lake spans the middle of the scene with ripples and a few reeds at edges, no obstructive objects at these anchors. Leave plenty of empty space for combat. Do NOT draw platforms or circular discs, these will be overlaid by code precisely under the creatures. No creatures, people, text, UI, logos, frame, lettering, or watermarks. Polished videogame environment, not an illustration with brushwork.

Direction du prompt portrait : même lac forestier/berge en pixel art16bits et ciel couvert, format2:3, adversaire à77%/57%, joueur à19%/100%, tiers supérieur réservé au ciel/forêt/lac, berge dégagée au premier plan, sans personnages, texte, interface ni socles intégrés. Le fichier PNG original reste dans le dossier de génération de Codex ; seule la version WebP finale est référencée par le projet.

La canne, le fil, le bouchon, les petites rides d’eau et le « ! » sont dessinés en canvas par `fishingRenderer.js`. L’icône de boutique/sac est un SVG natif dans `BagItemIcon.vue`.
