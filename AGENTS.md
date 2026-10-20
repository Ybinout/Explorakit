# Contexte permanent — Explorakit

## Thèmes et ordre automatique — 20 octobre 2026

Options : palettes bleu/sauge/lavande/sable et clair/nocturne via `gamePreferences` (`themeColor`, `themeMode`). Le thème est appliqué avant montage dans `main.js`, puis immédiatement à chaque enregistrement, par attributs sur `html` et variables `field-journal.css`. Défaut bleu/clair pour préférences anciennes ; ne pas filtrer la carte ni recolorer types/PV/raretés. Les textes des boutons d’accent utilisent `--journal-on-accent`, contrastes vérifiés dans les huit combinaisons.

Menu Pokémon : les flèches déclenchent immédiatement la sauvegarde ; aucun bouton de confirmation. Sérialiser les mutations, indiquer le statut, garder la liste et réconcilier l’état réel en cas d’échec. Aventure utilise `reorderTeam` authentifié, protégé par `inventoryBusy`/hors combat : persister avant de modifier l’équipe vivante, afin que le prochain combat et `requestGameSave` conservent l’ordre. Ne pas revenir à une seule écriture HTTP qui laisserait l’équipe connectée inchangée. Rift/Colosseum utilisent `drift:reorder` existant et son checkpoint. Recettes : tests thèmes/handler/SQL, `validateThemeAndTeamUi` dans publication, menu Colosseum dans combat navigateur.

## Entrée en combat — 20 octobre 2026

`battletrigger` arme `BattleOverlay.prepareEntrance()` avant de rendre le combat. Deux volets CSS opaques masquent la scène jusqu’au décodage des images réellement sélectionnées (fond `<picture>`, deux sprites, socles), puis s’ouvrent ; la première `presentState` attend cette entrée dans la file existante. Ne pas remplacer par un simple délai aveugle ni autoriser une action pendant la couverture. Attente réseau bornée à 2,4 s, animation courte, aucune règle/horloge serveur modifiée. Réduction des mouvements système/jeu : attente des images sans animation ni délai décoratif. Reset/déconnexion/masquage/destruction libèrent attente, timers et écouteurs ; les anciennes images/messages ne doivent pas ressusciter au combat suivant. Recettes : `battle-entrance.test.js`, `validateBattleEntranceUi` dans combat navigateur (images lentes, rotation, délai maximal, reset, mouvement réduit, onglet masqué, quatre tailles), publication et contrôle HTTPS sur duel de comptes temporaires.

## Bilan de combat — identité retrouvée — 20 octobre 2026

Le créateur préfère finalement le caractère de l’ancien bilan : conserver bandeau sombre contrasté, emblème cerclé, titre Georgia et cadre à liseré doré. Cette demande remplace la consigne antérieure de sobriété/Arial pour ce seul panneau. Les surfaces et le bandeau suivent les quatre palettes et le mode nocturne ; ne pas réintroduire les phrases de remplissage ni un corps vide. Six issues explicites, détails réels, aucune fermeture automatique. Préserver focus/Tab/Échap, file combat/XP → bilan → évolution/apprentissage et récupération tardive. Recette : six issues × quatre tailles et huit thèmes avec contraste bandeau/bouton, contexte Rift/Colosseum conservé.

## Menus bleu très pâle — 20 octobre 2026

La palette commune `field-journal.css` remplace le papier blanc/sauge par un bleu très pâle (`paper #edf5fc`, `card #f4f9fe`, `soft #e2eef8`). Pokédex, badges, menus, sac, équipe, dialogues et carnets utilisant ces tokens restent cohérents ; surfaces neutres du Pokédex raccordées aux variables. Conserver les couleurs sémantiques des types, attaques, PV, emblèmes et récompenses. Aucun changement de géométrie, météo ni règle. Recette de publication : huit panneaux aux quatre tailles, comparaison des surfaces et captures ; garder des textes foncés lisibles.

## Météo commune et étui de badges — 20 octobre 2026

La météo et ses intensités viennent uniquement de `mapWeatherState.ambience` : village 3/3, routes 1/2 1/1. Ancien panneau, action et stockage de préférence météo supprimés ; ne pas réintroduire de choix joueur. Mouvement réduit système/jeu reste une adaptation d’animation, sans changement du climat/profil serveur. `BadgesPanel` a sa propre entrée Aventure, après Objectifs et quêtes ; les expéditions n’affichent pas les badges de la sauvegarde Aventure. `GameInfoPanels` ne montre plus les badges dans le panneau de quêtes. Étui avec six SVG natifs, états obtenus/grisés, lieux, compteur/barre ; données depuis le même endpoint de progression, sans mutation ni attribution. Conserver focus, Échap, Tab dans le panneau et défilement mobile. Recettes : météo (anciennes clés locales ignorées/menu absent) et publication navigateur (huit panneaux, badges aux quatre tailles, focus et données serveur).

## Impacts au sol et météo des routes 1/2 — 20 octobre 2026

`map_weather.json` définit la pluie réelle de `start`, `route1`, `route2` ; les routes annoncent aussi `ambience:{wind:1,rain:1}` dans l’événement compatible `mapWeatherState`. Les préférences du village restent propres à `start` ; `effectiveWorldWeather` utilise le profil serveur des routes. `worldRainGround.js` est dérivé en lecture seule des collisions/couches couvertes classiques via `scripts/generateWorldRainGround.js` : régénérer si ces trois cartes changent. Les impacts sont contenus dans les cases libres/non couvertes et dessinés avant PNJ/personnages/premier plan ; pluie/vent restent au-dessus. Une seule surface météo, cache partagé 30 Hz entre les deux passes, maximum 208 éléments, aucun impact en mouvement réduit. Lac et animation des deux couronnes restent strictement limités à `start` ; ne pas appliquer leurs masques aux routes. Recettes : `world-weather.test.js`, `map-weather.test.js`, `test:weather-browser` (deux profils légers, quatre tailles, pluie réelle en combat, absence d’effets spécifiques du village sur routes).

## Eau du lac de départ — 20 octobre 2026

`villageWater.js` anime uniquement les pixels intérieurs de la palette d’eau du lac de `start`, avec marge fixe autour des berges/rochers/reflets/plantes. Courant d’un pixel source et reflets très doux, source PNG inchangée. Composition du fond avant personnages/premier plan/météo, mêmes coordonnées caméra. Une surface 448×320 réutilisée à 15 Hz dans la boucle du monde ; indépendante de la météo, commune aux trois modes. Mouvement réduit système/jeu : image originale et buffers libérés. Hors carte, combat/résultat, chargement, masquage et destruction : suspension/libération. Recettes : `village-water.test.js` et `test:weather-browser` (pixels hors masque et alpha exacts, lac actif même à vent/pluie zéro, suspension/reprise).

## Décors pluvieux et lisibilité — 20 octobre 2026

Les variantes `grass-rain-*-v1.webp` et `colosseum-rain-*-v1.webp` remplacent les décors extérieurs uniquement quand le champ réel vaut `rain`, dans le composant commun aux trois modes. Conserver les variantes sèches originales, le cadrage et les ancres des socles ; les grottes gardent leur propre décor. Deux variantes adaptées au format sont préchargées à la création du composant. Prompts et provenance imagegen : `docs/battle-rain-assets.json`. Gouttes plus contrastées (6–11 px) et impacts visibles, sans accélération de chute ni dépassement des budgets. La recette météo couvre ciel pluie/sec, prairie/arène portrait/paysage et grotte conservée.

## Pluie fine et impacts en combat — 20 octobre 2026

`BattleRain.vue` remplace la pluie CSS à bandes de `BattleOverlay`. `battleRain.js` fait tomber des gouttes courtes jusqu’au terrain puis dessine de petits anneaux/apports d’eau au point d’arrivée ; aucun impact au-dessus du sol. Composant partagé par les trois modes, sous les sprites/cartes de PV et sans interception tactile. Conserver le plafond 128 particules, 30 Hz, DPR 1,5, taille liée à la scène, aucun impact animé en mouvement réduit. Onglet masqué : boucle annulée et canvas libéré ; changement de météo/fin de combat : composant, boucle et écouteurs détruits. Ne pas changer la météo réelle serveur pour un ajustement graphique. Recettes : `battle-rain.test.js`, `test:weather-browser` (impacts, resize/DPR, mouvement réduit, masquage, destruction au Zénith) et recette de publication mobile.

## Pluie de carte héritée en combat — 20 octobre 2026

`data/game/map_weather.json` est la météo réelle partagée, lue par `world/mapWeather.js`. `start` est pluvieux ; intérieurs et arène Colosseum sont secs. Les réglages locaux n’ajustent que l’affichage (pluie « Masquée »), jamais les règles ni les conditions de l’adversaire. `mapWeatherState` synchronise le climat au chargement/voyage ; le champ initial accompagne `battletrigger` pour être visible dès l’ouverture. Les quatre orchestrateurs initialisent `createBattleState({mapName,opponentMap})` depuis leurs positions serveur. La météo de carte porte `persistent:true, source:'map'`, ne décrémente pas ; capacités et talents la remplacent par leur durée habituelle, sans restauration automatique du climat à leur expiration. Ne jamais réinitialiser la météo à la reconnexion/checkpoint. Conserver l’affichage sec quand le serveur envoie `{kind:null}`. Recettes : `map-weather.test.js`, combats SQL sauvage/dresseur/PvP et `test:weather-browser` (pluie masquée, Zénith/reconnexion, intérieur).

## Essai météo du village — 20 octobre 2026

`foregroundWind.js` anime uniquement les pixels verts opaques des deux couronnes de `start` : masque suivant les feuilles, aucun découpage ni déplacement de rectangles, d’ombres ou de silhouettes. Le reste du premier plan doit être identique pixel par pixel, transparence comprise. Le motif des feuilles ondule dans son contour fixe, 30 Hz maximum, une surface native 448×320 et buffers libérés avec la météo. Vent nul/mouvement réduit : image originale exacte. Recettes : `foreground-wind.test.js` et `test:weather-browser` (tous les pixels hors feuilles et alpha fixes, pas seulement le toit).

`worldWeather.js` dessine une ambiance locale uniquement sur `start`, après le premier plan et avec la même transformation caméra. Vent/pluie indépendants 0–3, réglables via Menu → Météo du village et conservés localement ; défaut fort/averse (révision locale v2 demandée pour observer le maximum, puis choix de nouveau mémorisés). Le climat réel vient désormais du serveur (voir ci-dessus) ; ces niveaux restent uniquement visuels. Conserver le budget borné (210 éléments maximum), une surface 896×640 réutilisée à 30 Hz sans seconde boucle, la libération hors carte/chargement/combat/onglet masqué et à la destruction. Mouvement réduit système ou animations désactivées : image fixe. Le panneau suspend les déplacements, contient le focus et n’ajoute aucun HUD permanent. Recettes : `world-weather.test.js` et `test:weather-browser`. Les villes à pool sauvage vide et la falaise ouest (0,6) du JSON officiel Valpierre sont intentionnels ; ne pas altérer les cartes pour satisfaire les anciens tests génériques.

## JSON officiel de Valpierre — 20 octobre 2026

Le JSON déposé ensuite par le créateur dans `/home/ubuntu/dev/pourtoi/ville_safe1.json` remplace intégralement la carte déduite du dessin. Copie exacte (SHA-256 `da1241c5bcef04418d7ebac4eb38c542bd859e7ac816ca39da86ac49b1546e56`), dix couches conservées ; TMX miroir des mêmes données. Ne pas reconstruire les collisions ni effacer sa case `battle`. Les six portes et le raccord ouest existants conviennent. La case (0,6) porte aussi un marqueur change mais reste bloquée par la collision de la falaise ; conserver cette priorité, les passages utiles sont (0,3–5). Une zone sans pool sauvage ne doit pas ouvrir de combat vide : le serveur émet `battletrigger` seulement après création effective du sauvage. Recettes : `valpierre.test.js`, `test:valpierre-browser` (mur, passage libre, tirage sauvage forcé sur base isolée).

## Valpierre et combats en grotte — 20 octobre 2026

Le créateur a explicitement autorisé l’intégration des deux PNG de `/home/ubuntu/dev/pourtoi` : copies exactes `ville_safe1.png`/`_f.png`, nouvelle carte technique JSON/TMX et six intérieurs indépendants via alias. Ne pas retoucher son artwork ni les autres villes qu’il prépare. L’est de route4 mène à Valpierre ; la porte du Centre est exactement (22,3), pas toute la rangée 3. Les anciens retours de Centre (848,112) se normalisent vers son vrai parvis (720,144). Conserver l’échelle praticable devant la boutique, les six sorties et les PNJ à deux cases. Arène facultative niveau 35–37, Badge Cristal/récompense uniques ; ne pas modifier les six/quatre étapes des chapitres I/II. `BattleOverlay` capture la carte au début du combat : grotte avant/arrière dédiée, socles rocheux sur les mêmes ancres que les sprites, priorité au Colosseum. Recettes : `valpierre.test.js`, Centre, histoire Socket et `test:valpierre-browser`. Les suites SQL partagent une base et tournent séquentiellement.

## Noms du récit — 20 octobre 2026

Iris → Sofiane, Nora → Noz, Soren → Thibaut, Clara → Aspha dans les textes affichés. Conserver les identifiants historiques minuscules (`ch2_iris`, `chapter2_soren`, `clara_chapter2`, objets et drapeaux) pour les sauvegardes ; ne pas renommer les cartes en cours de création par le propriétaire.

## Présentation des évolutions — 20 octobre 2026

Les conditions restent côté serveur. `evolutionPresentation.js` observe les changements permanents d’espèce des seuls compagnons connus (UUID), via `applyTeamPokemons`. Le graphe client couvre exactement les règles automatiques et pierres ; le régénérer avec `node scripts/generateEvolutionPresentation.js` si elles changent. Premier chargement/capture/reconnexion ne doivent pas rejouer une évolution ; les formes temporaires et snapshots inverses ne sont pas des évolutions. Préserver la file combat/XP → résultat → évolutions successives/réserves → apprentissage, les gardes de déplacement, le focus et le mouvement réduit. Recettes : `evolution-presentation.test.js`, `test:evolution-browser`, `test:strategy-browser` et recettes publication/Colosseum/combat.

## Variété du circuit Colosseum — 20 octobre 2026

Les nouvelles tentatives sont v5 : `colosseumVariety.js` fixe les compositions et rôles, `colosseumTactics.js` évalue météo/protections/annulation des boosts. Même circuit pour tous, aucun tirage à la reconnexion ni contre-équipe calculée sur le joueur. Les v1–v4 conservent leurs compositions/sets/points (empreintes historiques dans `colosseum-variety.test.js`). Un seul spécialiste de soutien par équipe ; ses capacités restent légales et l’objet compatible. Préserver les aperçus de styles/capacités, les paliers de puissance, les points et le frein d’XP v4. Buée Noire remet à zéro les deux combattants ; les effets de terrain traversent un clone. Recettes : tests variété/IA/ordre et publication, Colosseum et combat navigateur.

## Ascension Colosseum et lisibilité — 19 octobre 2026

Lire la section correspondante en tête d’audit. Les nouveaux Colosseum sont v4 : gardiens +1 à +3 niveaux (plafond 100), 1 à 3 Drifts déterministes et annoncés ; points et v1/v2/v3 conservés. L’XP commune ajoute une pénalité de sur-niveau au-delà de max(5, 10 % du niveau adverse), calculée par receveur, y compris les réserves et Chasseur d’élite. Ne pas baser le partage sur le niveau du meneur. `DriftPassives` montre seulement les bonus équipés et leurs conditions/valeurs fusionnées. Les attaques du composant commun affichent type/couleur ; critique réel lié à l’identité ciblée, sans fuite au switch ni déplacement des actions mobiles. Recettes : `colosseum-ascension`, XP, Colosseum, publication et combat navigateur.

## Panthéon et effets de combat — 19 octobre 2026

Lire la section correspondante en tête d’audit. `recordTeam` conserve les UUID/ordre d’entrée mais utilise les derniers snapshots permanents, y compris les perdus : ne pas revenir au seul snapshot d’entrée ou aux survivants. L’adversaire final conserve son équipement initial et les K.O. finaux ; les lectures publiques restent en liste autorisée. Les 32 cadres PNJ sont irréguliers : utiliser `npcFrames.js` sur carte et portrait, sans redécouper en cellules 32×32. Les indicateurs/effets lisent les états réels à identité constante ; préserver la file visuelle, l’annulation et les contrôles mobiles fixes. Recettes : Colosseum/SQL, `battle-conditions`, publication mobile (inclut 32 cadres PNJ) et combat.

## Expéditions et combat mobile — 19 octobre 2026

Lire la section correspondante de l’audit. Le Colosseum neuf a des IV 10–31, les autres modes gardent 0–31 ; ne pas retirer les offres existantes au sort. Les pages de modes permettent reprendre/abandonner. Les annonces mobiles ont une ligne réservée et ne doivent pas déplacer les actions. Les plateformes mobiles partagent les ancres des sprites ; conserver la base du joueur au bas du terrain. Le dock participe aux gestes, le texte des dialogues avance comme A. Les attaques multiples exposent `hits`, Triple Pied et les secondaires se résolvent par coup, PP/Orbe Vie par capacité. Les priorités sont alignées Gen 7. Recettes : tests multi-hit, stratégie, publication mobile et combat.

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
