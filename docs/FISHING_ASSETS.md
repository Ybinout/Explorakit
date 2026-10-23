# Décors de pêche — 23 octobre 2026

Deux nouvelles images générées avec l’outil intégré **imagegen** (mode génération, fond opaque). Aucun asset de carte auteur modifié. Conversion PNG → WebP qualité0,91, sans recadrage ; socles dessinés séparément par le composant de combat et ancrés sur les mêmes coordonnées que les Pokémon.

- `vue-explorakit/src/assets/battle/lake-wide-v1.webp` : scène paysage16:9 ; source `exec-e72765c4-31af-4102-920f-e061ce2e56a4.png`.
- `vue-explorakit/src/assets/battle/lake-mobile-v1.webp` : scène portrait2:3 ; source `exec-f5b1f9d9-6182-42e1-a616-c37d874bb6e3.png`.

Prompt paysage :

> Create a 16:9 landscape pixel art battle background for a refined 16-bit handheld monster-catching RPG. A peaceful freshwater lake shore on an overcast day, teal blue water, forested green hills in the distance, soft cloudy pale blue-grey sky. Detailed but clean deliberate pixel clusters, game-ready image, coherent perspective. Composition for a combat scene: the opponent's feet will be at 76% width and 46% height, leave uncluttered wet sandy shore or a tiny shallow grassy bank at that location; player's feet at 22% width and 85% height, sandy grass bank in foreground bottom-left. The lake spans the middle of the scene with ripples and a few reeds at edges, no obstructive objects at these anchors. Leave plenty of empty space for combat. Do NOT draw platforms or circular discs, these will be overlaid by code precisely under the creatures. No creatures, people, text, UI, logos, frame, lettering, or watermarks. Polished videogame environment, not an illustration with brushwork.

Direction du prompt portrait : même lac forestier/berge en pixel art16bits et ciel couvert, format2:3, adversaire à77%/57%, joueur à19%/100%, tiers supérieur réservé au ciel/forêt/lac, berge dégagée au premier plan, sans personnages, texte, interface ni socles intégrés. Le fichier PNG original reste dans le dossier de génération de Codex ; seule la version WebP finale est référencée par le projet.

La canne, le fil, le bouchon, les petites rides d’eau et le « ! » sont dessinés en canvas par `fishingRenderer.js`. L’icône de boutique/sac est un SVG natif dans `BagItemIcon.vue`.
