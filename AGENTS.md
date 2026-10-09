# Contexte permanent — Explorakit

Avant toute modification du projet, lire `docs/AUDIT_PROJET.md`. Ce fichier est la référence technique et fonctionnelle du dépôt.

## Règles de travail

- Préserver les modifications utilisateur déjà présentes : le dépôt racine et le dépôt imbriqué `vue-explorakit/` peuvent être sales.
- Ne pas modifier `dist/` directement. Il s'agit d'un résultat de compilation.
- Ne pas déplacer massivement les fichiers en une seule opération. Suivre la feuille de route progressive de l'audit.
- Toute personne ou IA qui modifie le projet doit mettre à jour `docs/AUDIT_PROJET.md`. Pour tout correctif important, ajouter une vérification reproductible et compléter sa section « Journal de suivi ».
- Les événements Socket.IO et les structures envoyées entre client et serveur doivent rester compatibles pendant les migrations.
- Les données de cartes Tiled, les transitions, les dialogues, les équipes de PNJ et les assets associés doivent être validés ensemble.
- Les fichiers `data/maps/*.json`, `data/maps/*.tmx` et les PNG de cartes dans `vue-explorakit/src/assets/` appartiennent exclusivement au lot de l'agent chargé des cartes. Aucun autre agent ne doit les modifier, les régénérer ni les remplacer.
- Hors lot cartes, raccorder une carte signifie uniquement modifier `data/game/nextMap.json`, et seulement pour une case `change` déjà livrée et validée par l'agent cartes. Si la porte ou le passage manque, documenter la dépendance au lieu de créer la case technique.
- En travail parallèle, relire l'état des fichiers juste avant toute écriture et préserver les livraisons apparues depuis la dernière lecture.

## Résumé du projet

Explorakit est un fan game web multijoueur privé : frontend Vue 2/canvas, backend Node.js/Express/Socket.IO, persistance MySQL, cartes Tiled et combats inspirés de Pokémon. Le serveur est autoritaire pour les déplacements et les combats, mais l'authentification et plusieurs validations restent à sécuriser.

## Commandes de vérification actuelles

- Backend : `npm start`
- Syntaxe JS : exécuter `node --check` sur les fichiers JavaScript hors `node_modules` et `dist`
- Frontend : `npm --prefix vue-explorakit run lint`
- Build : `npm run build:client` (écrit dans `dist/`; préférer une destination temporaire lors d'une simple revue)
- Tests : `npm test`
- Audit des capacités : `npm run audit:moves`
- Audit des talents : `npm run audit:abilities`
- Intégration MySQL locale : `npm run db:test:setup`, puis `npm run test:mysql`

## Priorité actuelle

Les correctifs P0, la création de partie, la progression sans plafond, la récupération après défaite totale et la passe combat complète sont appliqués. L'audit automatique couvre 612 capacités et les talents Gen 7 des 809 Pokémon. Les quatre premières familles de talents (immunités/absorptions, entrée-sortie, dégâts/statistiques, météo/terrains) sont raccordées ; les familles réactives, objets/PP, K.O./fin de tour et doubles/formes restent volontairement ultérieures. Le moteur possède les primitives doubles mais aucun mode double n'est encore exposé. La priorité est le test manuel du prologue et des trois combats, puis le découpage de `battleEngine.js`, `UserMap.vue` et `socketHandler.js`, avant l'audit complet du contenu.
