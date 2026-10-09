# Audit du contenu du jeu

Dernière mise à jour : 3 octobre 2026.

Ce document distingue le contenu installé, le contenu raccordé dans la configuration et le contenu réellement jouable. Les chiffres se reproduisent avec `npm run audit:content`.

## Règle de propriété des cartes

Les fichiers de cartes sous `data/maps` et leurs images sous `vue-explorakit/src/assets` sont produits et maintenus par l’agent chargé des cartes.

Les autres interventions doivent uniquement :

- déclarer les raccords dans `data/game/nextMap.json` quand une case `change` existe déjà dans la carte ;
- ajouter les PNJ, dialogues, équipes et règles de progression dans les fichiers de données dédiés ;
- ne pas modifier les JSON, TMX ou PNG de cartes pour créer une porte ou un passage ;
- laisser inactif tout raccord dont la case de transition n’a pas encore été préparée par l’agent cartes.

Le test `tests/world-content.test.js` vérifie les raccords déclaratifs à partir des portes effectivement livrées par l’agent cartes.

## Verdict actuel

Les huit routes générées, les cinq villes, les cinq arènes et les douze intérieurs livrés par l’agent cartes sont actifs. Ils sont atteignables depuis `start` en passant par `route4`, puis en parcourant la boucle générée dans le sens inverse jusqu’à `gen_route1` et `route3`.

Les raccords vers les dix maisons et deux boutiques générées sont déclarés dans `nextMap.json` à partir des coordonnées produites et validées par l’agent cartes. `ville1` utilise en plus deux portes existantes pour une arène et une boutique indépendantes, via des alias de rendu qui ne modifient aucun JSON/TMX/PNG de carte.

Les cinq champions sont placés, combattables une seule fois et donnent chacun leur badge et une récompense transactionnelle. La boucle d’exploration reste incomplète narrativement : les indices sur Clara et l’Aube Obscure n’ont pas encore leurs scènes, et il n’existe ni combat final, ni épilogue, ni crédits.

## État mesuré

| Domaine | État réel | Limite restante |
|---|---:|---|
| Cartes JSON installées | 47 | `pk1`, `route5` et `route6` restent installées mais inactives |
| Lieux actifs | 46 | 44 cartes actives et 2 alias d'intérieur ; `pk2` reste active uniquement pour compatibilité |
| Lieux atteignables depuis `start` | 45 | tous les lieux actifs sauf `pk2` |
| Parcours généré actif | 30/30 | 8 routes, 5 villes, 5 arènes, 10 maisons et 2 boutiques |
| PNJ placés | 24 | Moonpunch est dans l'arène de `ville1` et une vendeuse occupe sa boutique ; huit nouveaux intérieurs restent sans PNJ dédié |
| Équipes de dresseurs | 8 | 5 champions, plus Timmy, Garry et Moonpunch |
| Combats narratifs persistants | 7 | tous couverts par une récompense idempotente |
| Quêtes / badges | 2 / 5 | les cinq badges sont attribuables ; la conclusion scénaristique manque |
| Objets | 7 | 3 Balls et 4 objets tenus ; soins, rappels et objets clés manquent |

## Parcours des cartes

Le raccord actif s’appuie uniquement sur les passages déjà présents :

`route4` → `gen_route8` → Ocreville → `gen_route7` → Floraville → `gen_route6` → `gen_route5` → Rochebourg → `gen_route4` → Rivazur → `gen_route3` → `gen_route2` → Clairbois → `gen_route1` → `route3`.

Chaque ville possède une entrée d’arène et les portes d’intérieur livrées par l’agent cartes. Leurs destinations et retours sont seulement raccordés dans `nextMap.json` par le présent lot.

Le raccord direct `route3` → `gen_route1` a été retiré : il nécessitait de modifier `route3.json` et ses PNG. Le retour `gen_route1` → `route3` reste valide car il utilise un passage déjà généré.

## Intérieurs raccordés

L’agent cartes a livré et validé douze portes, leurs intérieurs et leurs retours. Le rapport reproductible est dans `docs/correctif_villes/verification.json` et le contrôle se lance avec `python docs/correctif_villes/validate_access.py`.

Les évolutions de gameplay doivent désormais se limiter à la configuration, aux PNJ, aux dialogues et à l’économie. Toute nouvelle porte ou modification visuelle reste réservée à l’agent cartes.

## PNJ, champions et progression

Le parcours actif contient huit voyageurs, cinq guides et cinq champions. Les champions Sylve, Marée, Minerai, Floraison et Dune donnent les cinq badges existants. Chaque victoire est enregistrée dans `user_npc_battles`, ne peut récompenser le joueur qu’une fois et fait progresser les indices de la quête principale.

Trois habitants et deux vendeuses sont déjà décrits dans les données. Les huit intérieurs supplémentaires livrés par l’agent cartes n’ont pas encore de PNJ ni de contenu propre.

Les 24 PNJ ne réutilisent plus deux personnages génériques. Douze planches transparentes distinctes, dérivées des portraits de dialogue, sont installées dans `vue-explorakit/src/assets/pnj`. Chaque planche mesure 256×256 px et suit le format du moteur : quatre colonnes d’animation et quatre directions (`bas`, `gauche`, `droite`, `haut`) composées de cellules de 64×64 px.

## Langues

Les options proposent Français et English. Le choix persiste sur l’appareil et couvre le menu en jeu, les écrans Pokédex/quêtes/sauvegarde/options, les commandes de combat, les résultats visuels et la capture.

Les 612 capacités du moteur et les 223 talents Gen 7 du catalogue disposent d’un nom français. Les tables sont générées avec `npm run generate:i18n` et leur couverture est testée.

Les dialogues narratifs et les messages produits par le serveur restent principalement en français. Les écrans d’authentification et certaines erreurs techniques ne sont pas encore entièrement bilingues.

## Histoire et économie

Le début existant reste la source du scénario : la mère envoie le personnage chercher sa sœur Clara, puis Moonpunch ouvre une première piste. Les cinq champions font progresser les drapeaux `sister_clue_2` à `sister_clue_5`, mais ces indices n’ont pas encore de scènes dédiées.

Les boutiques accessibles vendent les trois Balls et les quatre objets tenus. Le serveur contrôle la présence du joueur dans une boutique et effectue débit du solde et ajout au sac dans une transaction MySQL. La revente, les objets de soin utilisables et les objets clés restent à construire.

## Vérifications

- `npm run audit:content` : 47 cartes installées, 46 lieux actifs avec les alias, 45 atteignables, aucune carte générée inactive ni destination inconnue ;
- `python docs/correctif_villes/validate_access.py` : 12 portes, retours, foregrounds et synchronisation TMX/JSON validés par l’agent cartes ;
- `tests/world-content.test.js` : passages actifs, destinations, raccords d’intérieur, PNJ et traductions ;
- contrôle PNG des 12 sprites de PNJ : dimensions 256×256, transparence RGBA et correspondance exhaustive avec `pnjs.jsonc` ;
- les validateurs dans `docs/gen_routes`, `docs/gen_villes` et `docs/gen_interieurs` restent les contrôles propres aux cartes générées ;
- le raccord gameplay ne contient plus de script modifiant les JSON/TMX des villes.

## Priorités suivantes

1. Recette manuelle du parcours actif : routes, villes, arènes, douze intérieurs et cinq combats de champion.
2. Ajouter des PNJ et du contenu aux huit intérieurs encore vides, sans modifier leurs cartes.
3. Ajouter les dialogues conditionnels et les scènes de Clara/Aube Obscure.
4. Ajouter les soins utilisables, les objets clés et éventuellement la revente en boutique.
5. Finaliser l’anglais côté serveur et sur les écrans d’authentification.
6. Créer la condition de victoire, le combat final et l’épilogue.
