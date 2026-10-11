# Personnages ordinaires — 11 octobre 2026

32 identités nouvelles, distinctes des cinq champions. Création par l’outil intégré du skill [imagegen](/home/binout/.codex/skills/.system/imagegen/SKILL.md), puis copie des PNG dans le dépôt. Aucun décor de carte n’a été modifié.

- Sprites : `vue-explorakit/src/assets/pnj/townspeople.png`.
- Portraits : `vue-explorakit/src/assets/image/townspeople.png`.
- Configuration et correspondance des identités : `data/game/pnjs.jsonc`, champ `spriteFrame` ; même indice dans `interact.json`, champ `portraitFrame`.
- Deux atlas RGBA de 1 774 × 887 px : 8 colonnes et 4 lignes, cases carrées de 221,75 px. Le client échantillonne les coordonnées proportionnelles, sans imposer une division entière des dimensions.
- Les sprites ont une pose de face. Les promenades sont interpolées avec un léger mouvement vertical de marche ; il ne s’agit pas encore de planches de marche à quatre orientations. L’option de réduction des animations supprime interpolation et rebond.
- Marchands et archiviste restent à leur poste. Les autres civils se déplacent dans un rayon de 1 à 2 cases, sous contrôle serveur. Ils s’arrêtent à l’approche du joueur. Les portes, leurs abords, les interactions Tiled et les passages étroits sont exclus.
- Les cinq champions conservent leurs illustrations et sprites propres. Timmy et les interactions de centre Pokémon intégrées aux cartes conservent leurs ressources existantes.

Les prompts complets de création sont conservés dans `docs/PNJ_VISUELS_PROMPTS.json` ; le deuxième atlas prend le premier comme référence d’identité.

Contrôles : `npm test` (unicité, correspondance portraits/sprites, alpha, géométrie, collisions et déplacement), puis `node --env-file-if-exists=.env scripts/validateAdventureViewports.js` (mouvement reçu par Socket et portrait rendu).
