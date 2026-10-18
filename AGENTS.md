# Contexte permanent — Explorakit

## Commandes tactiles et starters — 18 octobre 2026

Lire la section correspondante en tête d’audit. Le glissement sur carte suit une origine mobile bornée ; conserver le doigt lors d’un changement de hauteur du navigateur ou du décodage d’une carte, mais l’annuler sur menu, dialogue, combat, déconnexion ou masquage. Un seul bouton A reste dans le dock ; les dialogues partagent le contexte de superposition du `game-stage`. Les nouveaux starters des trois modes tirent IV/nature/K, avec les probabilités K existantes, une seule fois ; ne pas retirer la base calibrée des PNJ (`factory.create(..., true)`). Les annonces de combat sont dans le flux du panneau de messages ; dégâts/critique partagent une pile mesurée à côté des cartes de PV. Le menu indique les contrats terminés à récupérer, uniquement en exploration. Recettes : `test:release-browser`, `test:contracts-browser`, `test:colosseum-browser`, `test:combat-browser`.

## Ligues et remise à zéro Colosseum — 18 octobre 2026

Lire la section correspondante en tête d’audit. Les cinq ligues ont quatre divisions IV→I et 0–100 PL, calculés à partir de l’Elo Rift existant ou du meilleur score Colosseum par format. Les nouveaux seuils Colosseum correspondent aux défis 5/10/15/20 ; les seuils et règlements Elo restent inchangés. La route `/classements` expose Rift/30/60, rang personnel et équipes des records. La remise à zéro autorisée ne supprime que `colosseum_bests` : conserver les reçus `colosseum_runs` pour empêcher un ancien résultat de recréer un record au rejeu. Ne pas réinitialiser les cotes Rift. Recettes : `tests/ranks.test.js`, `tests/colosseum-mysql.test.js`, `test:community-browser`.

## Ordre des combats — 18 octobre 2026

Lire la section correspondante en tête d’audit. Les promesses de capture et d’XP doivent être attendues par la file ; régler les PV avant le K.O. et publier l’entrant avant ses effets. Ne pas envoyer le Pokémon du joueur comme adversaire après un pivot. Un changement volontaire de dresseur consomme son action. Conserver les gardes d’identité qui empêchent un remplaçant de reprendre l’action du mort. Recettes : `tests/battle-order.test.js`, tests SQL de pivots et `test:combat-browser` (inclut `validateBattleTimeline.js`).

## Lisibilité et préparation — 18 octobre 2026

Lire la section correspondante en tête d’audit. Le combattant Colosseum reçoit 80 % du gain précédent (environ ×3,456 Aventure), réserves toujours basées sur ×4,8. Les primes de combat Aventure augmentent de 50 %. Les Drifts d’une même définition/élément fusionnent toutes raretés confondues via des essences ; le bonus interpolé vient de `driftStrength.js`, plafonné au Mythique, et le surplus conserve sa valeur de vente. Préserver les UUID équipés et la consolidation hors combat. `presentationState.js` distingue rappel/K.O. ; `driftSignals.js` ne collecte que les effets réellement résolus. La file visuelle précède le résultat, la piste de musique ne redémarre pas sur chaque état. Recette dédiée : `test:combat-browser`.

## Progression des expéditions — 17 octobre 2026

Lire la section correspondante en tête de l’audit. Le combattant Colosseum gagne 90 % de l’ancienne base ×4,8 ; les réserves conservent leur gain basé sur ×4,8. Les Drifts identiques fusionnent par deux via `fusion.js`, après détachement des effets de combat, en conservant le slot équipé. Les contrats se renouvellent après récompense et progressent en palier ; préserver leur identifiant pour l’anti-rejeu et les récompenses en attente. Recettes : tests de fusion/contrats/XP et `test:contracts-browser`.

## Colosseum v3 — 16 octobre 2026

Les nouvelles tentatives ont quatre paliers tactiques aux défis 1/6/11/16, un gardien/récompense tous les cinq combats et des objets adaptés dès le premier défi (`colosseumSets.js`). Les tentatives v1/v2 restent versionnées, y compris IA, équipements et récompenses. L’aperçu expose les objets réels ; ne pas réintroduire de base aléatoire ni de seuil 10/51 dans les règles actuelles. Lire la section correspondante en tête d’audit.

## Contrats et début d’expédition — 16 octobre 2026

Les nouvelles parties Rift/Colosseum ont trois contrats facultatifs privés (`contracts.js`), quatre PNJ propres aux expéditions et un filtre d’attaques sauvages de début de partie (`openingBalance.js`). Les Drifts s’équipent directement ; `drift:replace` remplace un emplacement de façon atomique. Lire la section correspondante en tête d’audit. Recettes : `test:contracts-browser`, `tests/expedition-contracts.test.js` et `scripts/auditExpeditionOpening.js`. Ne pas réintroduire la navigation sélection/fiche/retour ni d’objectif permanent sur la carte.

## Mise à jour du 16 octobre 2026

Les évolutions par espèce et adaptations solo sont livrées dans les trois modes (migration 017, conditions/choix dans la fiche). Le correctif des talents complète le moteur partagé : 213 talents avec règles en 1v1, huit effets réservés aux doubles, deux effets hors combat encore indisponibles. Les formes temporaires et réactions sont séparées dans `abilityForms.js` et `abilityReactions.js`. Lire les sections correspondantes en tête de l’audit ; les chiffres 125/98 ci-dessous sont historiques. Recettes supplémentaires : `test:evolution-browser` et `test:abilities-browser` sur base dédiée. Le sprite mobile du joueur est désormais aligné sur le bas du terrain ; ne pas réintroduire la marge sous sa base opaque.

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

Explorakit est un fan game web multijoueur privé : frontend Vue 2/canvas, backend Node.js/Express/Socket.IO, persistance MySQL, cartes Tiled et combats inspirés de Pokémon. Le serveur est autoritaire pour les déplacements et les combats. L'authentification JWT HTTP/Socket et les contrôles de propriétaire sont livrés ; la validation métier globale reste à compléter.

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

État réconcilié le 11 octobre 2026 : les P0, l'onboarding, les trois orchestrateurs de combat, la sauvegarde transactionnelle, les boutiques, les quêtes/badges persistants, les 30 cartes générées et le Pokédex responsive sont livrés. `BattleOverlay.vue` est déjà extrait. Les audits reconnaissent 612 capacités et les talents des 809 Pokémon ; 125 talents sont pris en charge, 98 restent pour les familles ultérieures, et aucun mode double n'est exposé.

Le chargement des huit décors d’intérieurs exclus du build est corrigé. Le chapitre I est désormais intégré : Mounir → Hoze (Ocreville) → Raphael (Floraville) → Ana (Rochebourg) → Wanda (Rivazur) → lettre aux archives de Clairbois, avec 12 dresseurs facultatifs en ville. Les prérequis et récompenses sont persistants ; l’ancien défaut d’achèvement/réouverture de quête est corrigé. Les zones sauvages suivent maintenant des paliers 5–60 ; XP sauvage ×1, dresseur ×1,5, arène ×2, ajustée au niveau du receveur ; dernier K.O. de dresseur corrigé (`npm run audit:balance`). Priorité : recette humaine du chapitre, ajustements fins d’équilibrage et validation sur téléphone physique, puis découpage de `UserMap.vue`, `socketHandler.js` et `battleEngine.js`. Suivre la section 7 de `docs/AUDIT_PROJET.md` et `docs/AUDIT_CONTENU_JEU.md` ; ne pas refaire les lots livrés.

## Mise à jour du 14 octobre 2026

Les six axes de l’audit ont une livraison : checkpoints SQL RiftMon (mono-instance), guide/objectifs, chapitre II et huit intérieurs peuplés, quatre médicaments hors combat, boutique de six cosmétiques et vingt rapports serveur, modules séparés et CI. Lire en priorité la section « Livraison des six axes » de l’audit. Ne pas refaire ces lots. Vérifier avec `npm run verify:release -- --mysql` puis `npm run test:release-browser` sur base de test ; préparer un build `/explorakit/` pour ce dernier. Le prochain travail humain est la recette longue et sur téléphone physique ; les bots et Chromium ne la remplacent pas.
