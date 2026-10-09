# Audit technique et mémoire du projet Explorakit

Dernière revue complète : 3 octobre 2026  
État observé : socle P0 corrigé, base réelle migrée jusqu'à la progression narrative, onboarding HTTP/Socket validé, Pokédex/quêtes/badges/sauvegarde/options raccordés, progression sans plafond, récupération après défaite, moteur des 612 capacités fiabilisé, catalogue officiel Gen 7 raccordé aux 809 Pokémon, validation complète des combats, boutique transactionnelle et activation du parcours généré avec 30 cartes, 23 nouveaux PNJ, cinq champions et une interface français/anglais ; la recette manuelle du nouveau parcours reste à faire  
Portée de cette étape : architecture, code, données, performances, sécurité, organisation et préparation du futur audit de contenu

## 1. Objet de ce document

Ce document sert à la fois de compte rendu d'audit et de mémoire durable pour les prochaines interventions. Il doit être mis à jour après chaque correction structurelle importante.

Le dépôt contenait déjà de nombreuses modifications non validées dans Git ; elles ont été préservées. Les chemins, correctifs et vérifications ci-dessous correspondent désormais à l'organisation refactorisée du 3 octobre 2026.

## 2. Vision synthétique du projet

Explorakit est un fan game web multijoueur privé composé de :

- un serveur Node.js avec Express et Socket.IO ;
- un client Vue 2 rendu principalement dans un canvas ;
- une base MySQL pour les comptes, équipes, Pokémon, positions et objets ;
- des cartes exportées depuis Tiled au format JSON ;
- des données JSON pour le Pokédex, les capacités, les rencontres, les dialogues, les objets et les équipes de PNJ ;
- trois modes de combat : sauvage, dresseur et joueur contre joueur ;
- des fonctions multijoueurs de présence, déplacement, apparence, chat et demande de combat.

Le cœur est déjà ambitieux : déplacements validés par le serveur, collisions, changement de carte, sauvegarde différée de position, inventaire, capture, états de combat, météo/terrain, animations et synchronisation PVP sont présents. Le problème principal n'est donc pas l'absence de fondations, mais leur concentration dans quelques gros fichiers et plusieurs chemins critiques encore non fiabilisés.

## 3. Cartographie actuelle

### Backend

| Zone | Fichiers principaux | Responsabilité actuelle |
| --- | --- | --- |
| Démarrage HTTP | `server/index.js` | Express, fichiers statiques, API, Socket.IO et configuration du port |
| API REST | `server/http/routes.js` | inscription, connexion, inventaire, équipe, Pokédex, progression et autorisations |
| Temps réel | `server/realtime/socketHandler.js` | joueurs connectés, déplacements, cartes, interactions, chat et lancement des combats |
| Combat | `server/game/battle/` | orchestration et moteur commun des trois types de combat |
| Modèle | `server/game/models/` | calcul des niveaux/statistiques et équipe de six |
| Persistance | `server/persistence/` | comptes, équipes, positions, sprites, objets, Pokédex et progression sur le pool partagé |
| Monde | `server/game/world/` | couches Tiled, PNJ, dialogues, rencontres et équipes adverses |

### Frontend

| Zone | Fichiers principaux | Responsabilité actuelle |
| --- | --- | --- |
| Application | `vue-explorakit/src/App.vue`, `main.js`, `router/index.js` | démarrage et navigation |
| Jeu | `components/UserMap.vue` | canvas, contrôles, Socket.IO, dialogues et coordination des panneaux |
| Menu | `components/menu/GameInfoPanels.vue` | Pokédex, quêtes, badges, sauvegarde et options |
| Authentification | `UserConnexion.vue`, `UserInscription.vue`, `HomeMenu.vue` | connexion, inscription et menu d'accueil |
| UI secondaire | `HealthBar.vue`, `TextWithImage.vue` | barre de vie et dialogues illustrés |

### Données et contenu

- `data/maps/` : 47 cartes JSON, dont 30 cartes générées désormais actives.
- `data/game/` : 809 entrées Pokédex, 612 capacités, rencontres/transitions, dialogues, objets et équipes de PNJ.
- `vue-explorakit/src/assets/` : 1 110 fichiers environ, dont 1 087 PNG, 8 MP3 et 3 MP4 ; environ 118 Mo de sources.
- `dist/` : build frontend d'environ 61 Mo et 590 fichiers.
- `database/schema.sql` : schéma InnoDB/utf8mb4 et données d'exemple ; `database/migrations/` contient les migrations des bases existantes.

## 4. Résultats des vérifications

| Vérification | Résultat |
| --- | --- |
| Syntaxe JavaScript | Tous les fichiers de `server/`, `scripts/` et `tests/` contrôlés, aucune erreur de syntaxe |
| Build frontend de production | Réussi après l'ajout des écrans de progression |
| Taille du build | bundle jeu 261,87 Kio, 112,81 Kio compressé après ajout des traductions ; bundle vendeur 115,67 Kio ; vidéo de connexion de 12,1 Mo absente du build |
| Lint frontend | Réussi sans erreur après suppression de l'import inutilisé dans `NewWorld.vue` |
| Tests automatisés | Suite standard : 78 tests, 67 réussis et 11 MySQL ignorés comme prévu ; suite MySQL dédiée précédente : 11/11 réussis ; le nouveau parcours, ses transitions, PNJ, équipes et traductions sont couverts par 5 tests dédiés |
| Audit npm en ligne | Non réalisé : accès registre bloqué et divulgation externe des métadonnées non autorisée |
| Validation JSON stricte | Tous les JSON principaux sont valides sauf `pnjs.jsonc`, lu à tort comme du JSON strict |
| Build et runtime complet | Build réussi ; MySQL 5.7.36 connecté et migré ; inscription, connexion, starter, inventaire, équipe, sauvegarde UUID et authentification Socket.IO validés sur `pokemon_game_test` ; rendu Chromium validé en 1440 × 900 et 390 × 844 |

Le build émet aussi des avertissements sur la taille des assets, un `caniuse-lite` ancien et des appels dépréciés provenant de la chaîne Vue CLI.

## 5. Constats prioritaires

### P0 — à corriger avant d'étendre le jeu

#### P0.1 — Authentification inexistante côté serveur

**État : corrigé le 3 octobre 2026 ; rotation du secret et test d'intégration réel encore requis.**

Constat :

- l'inscription stocke le mot de passe brut ;
- la connexion compare deux chaînes en clair ;
- `bcrypt`, `jsonwebtoken` et un secret JWT codé en dur sont importés mais inutilisés ;
- le garde du routeur vérifie uniquement la présence d'un identifiant dans `localStorage` ;
- la socket accepte directement `userId` et `username` depuis la query du navigateur ;
- toutes les routes de lecture, modification et suppression sont accessibles sans authentification ni contrôle de propriétaire ;
- `GET /users/:id` fait un `SELECT *` et peut renvoyer le mot de passe stocké.

Impact : n'importe quel joueur connaissant un identifiant peut usurper un compte, modifier une équipe, lire un profil ou supprimer des données. Le risque devient important dès que le serveur est exposé via ngrok, même pour un petit cercle privé.

Correction appliquée : mots de passe bcrypt, migration automatique des anciens mots de passe en clair à la prochaine connexion, JWT, middleware HTTP et Socket.IO, identité issue du jeton, contrôles de propriétaire et réponses filtrées. Le client centralise maintenant les appels API et transmet le jeton. Le secret se configure avec `JWT_SECRET` dans `.env`.

#### P0.2 — Sauvegarde d'équipe destructive et non atomique

**État : corrigé, migré et testé sur MySQL le 3 octobre 2026.**

Avant correction, `actionequipe.js` appelait l'API HTTP du même serveur sur `localhost:3000`. Une sauvegarde :

1. recharge ou crée l'équipe ;
2. supprime tous ses Pokémon ;
3. tente de relire chacun par son ancien UUID, ce qui retourne forcément 404 ;
4. les recrée avec de nouveaux UUID sans remettre ces UUID dans les objets en mémoire.

Une erreur après la suppression peut laisser l'équipe vide ou partielle. L'identité des Pokémon change à chaque sauvegarde. La fonction absorbe ses erreurs, donc les appelants peuvent croire que la sauvegarde a réussi. Le schéma MyISAM ne permet pas de transaction fiable.

Correction appliquée : `server/persistence/teamRepository.js` utilise directement le pool partagé et une transaction, conserve les UUID et propage les erreurs. La base réelle est maintenant en InnoDB et la sauvegarde atomique avec conservation d'UUID est couverte par un test MySQL réel.

#### P0.3 — Boucles client dupliquées et non nettoyées

**État : corrigé le 3 octobre 2026, à confirmer par un test manuel de navigation longue.**

Dans `UserMap.vue` :

- `animate()` se rappelle avec `requestAnimationFrame(this.animate.bind(this))` sans conserver l'identifiant ;
- `mounted()` lance `animate()`, puis le `onload` du sprite peut le lancer une deuxième fois ;
- `setInterval(this.updatePlayerPosition, 20)` n'est ni mémorisé ni annulé ;
- `beforeDestroy()` déconnecte la socket mais ne stoppe ni l'intervalle ni explicitement les animations.

Impact : travail de rendu doublé, intervalle fantôme après navigation, émissions réseau inutiles, erreurs après destruction et dégradation progressive lors des reconnexions.

Correction appliquée : un seul `animationFrameId`, un seul `movementIntervalId`, méthodes de démarrage/arrêt, garde si le canvas disparaît et annulation complète dans `beforeDestroy`. Le second démarrage depuis `spriteSheet.onload` a été remplacé par un simple redessin.

#### P0.4 — Fréquence réseau excessive pour le déplacement

**État : corrigé le 3 octobre 2026, mesure réseau en situation réelle encore à faire.**

Le client vérifie et émet une action toutes les 20 ms, soit jusqu'à 50 fois par seconde, alors que le serveur n'accepte qu'un mouvement toutes les 180 ms. La majorité des messages est ignorée.

Correction appliquée : l'intervalle client est passé de 20 ms à 180 ms, aligné sur le délai serveur. La méthode vérifie aussi que la socket et le joueur local existent avant toute émission.

#### P0.5 — Déconnexion pendant un combat sauvage

**État : corrigé le 3 octobre 2026 pour les combats sauvages et de dresseur.**

`wildBattle.js` attrape les erreurs de `playerTurn()` puis reprend sa boucle. Si la socket a disparu, `playerTurn()` rejette immédiatement et la boucle peut recommencer sans attente jusqu'à monopoliser le CPU.

Correction appliquée : les écouteurs de déconnexion et les timeouts produisent maintenant une action terminale, nettoient leurs listeners, quittent le combat et déclenchent la sauvegarde. La boucle sauvage ne peut plus repartir immédiatement sur une socket absente.

#### P0.6 — Équipes de PNJ partagées et définitivement endommagées

**État : corrigé et couvert par un test automatisé le 3 octobre 2026.**

`generatePnjTeams.js` met chaque équipe en cache puis renvoie la même instance mutable. Un combat modifie ses PV, son ordre et ses états. Le joueur suivant peut donc rencontrer une équipe déjà blessée ou entièrement K.O., voire gagner instantanément.

Correction appliquée : seules les définitions sont indexées ; `getPnjTeam()` construit une équipe et des Pokémon neufs pour chaque combat.

#### P0.7 — Configuration des PNJ jamais chargée

**État : corrigé et couvert par un test automatisé le 3 octobre 2026.**

Avant correction, `source_Json/pnjs.jsonc` contenait des commentaires alors que `pnjStore.js` utilisait `JSON.parse`. Le parse échouait et le store retournait silencieusement une liste vide. Le fichier est désormais dans `data/game/pnjs.jsonc` et contient du JSON strict.

Correction appliquée : le contenu est désormais du JSON strict et `moonpunch` est activé sur une tuile libre de `ville1`. Le renommage en `.json` et une validation globale au démarrage restent des améliorations souhaitables.

#### P0.8 — Assets de premier plan absents

**État : défaut bloquant corrigé le 3 octobre 2026 ; les assets restent optionnels.**

`UserMap.vue` exige systématiquement `<nom_de_carte>_f.png`. Ces fichiers manquent pour `cave2`, `centre`, `etage`, `etage2`, `maison` et `maison2`. Le build réussit grâce au contexte dynamique, mais le `require()` échouera à l'exécution sur ces cartes.

Correction appliquée : le client accepte maintenant une carte sans premier plan, remet proprement l'image à `null` et continue le rendu. Il protège aussi le chargement asynchrone contre un changement de carte intervenu entre-temps.

#### P0.9 — Nouveau joueur sans parcours de démarrage fiable

**État : corrigé le 3 octobre 2026 avec un parcours complet de création de partie.**

`GET /users/:id/team` crée une équipe vide lors de la première lecture et répond en 201. `loadEquipe()` n'accepte que le statut 200 et retourne alors `null`. La récupération des Pokémon répond aussi 404 pour une équipe vide. Aucun flux complet de choix du starter n'est implémenté.

Impact : un nouveau compte peut entrer dans le monde sans équipe exploitable et ne peut pas réellement progresser dans les combats.

Correction appliquée : un parcours en quatre étapes permet de choisir identité, apparence et starter parmi Bulbizarre, Salamèche et Carapuce. L'inscription crée dans une seule transaction le compte, l'équipe principale, l'inventaire initial et le starter niveau 5 avec quatre capacités, connecte le joueur puis introduit son départ. Une équipe existante vide est renvoyée avec un tableau vide et un statut 200.

#### P0.10 — Équipe entièrement K.O. après une défaite

**État : corrigé et couvert par des tests le 3 octobre 2026.**

Avant correction, les combats sauvage, dresseur et PVP sauvegardaient l'équipe avec tous ses Pokémon à 0 PV, sans soin ni déplacement. Le joueur restait donc bloqué dans le monde et pouvait se reconnecter avec une équipe inutilisable.

Correction appliquée : une défaite totale soigne tous les Pokémon, efface leurs états temporaires de combat et replace le joueur au dernier Centre Pokémon visité. L'entrée dans un centre enregistre maintenant un point de réapparition durable dans `users` via la migration `003_respawn_checkpoint.sql`. Si aucun centre n'a encore été visité, la maison de départ sert de repli. Le traitement est commun aux combats sauvage, dresseur et PVP, et s'exécute aussi à la connexion pour réparer les sauvegardes déjà bloquées.

### P1 — fiabilité, architecture et performances

#### P1.1 — Dépôt Git difficile à reproduire

Le dépôt racine suit 1 804 fichiers de `node_modules/` et 582 fichiers de `dist/`. Le frontend est lui-même un dépôt Git imbriqué enregistré comme gitlink, mais sans structure de sous-module visible dans le dépôt racine. Les deux dépôts ont actuellement des modifications non validées.

Correction recommandée, après sauvegarde/commit des travaux actuels :

- choisir un seul dépôt, de préférence un monorepo ;
- sortir `node_modules/` et `dist/` de Git ;
- enrichir `.gitignore` ;
- conserver les deux lockfiles si le frontend et le backend restent deux packages ;
- documenter installation, base, variables d'environnement et démarrage.

Cette opération doit être préparée avec soin : ne pas supprimer maintenant les fichiers suivis tant que les changements actuels ne sont pas sécurisés.

#### P1.2 — Fichiers centraux trop volumineux

- `UserMap.vue` : environ 3 600 lignes après enrichissement des interfaces ; les sessions, sockets et helpers purs sont maintenant extraits ;
- `server/game/battle/battleEngine.js` : environ 2 900 lignes physiques après raccordement des talents ; son découpage devient prioritaire ;
- `server/realtime/socketHandler.js` : environ 1 050 lignes après extraction de l'état joueur ;
- trois orchestrateurs de combat de 500 à 650 lignes, très similaires ;
- l'ancienne API monolithique a été remplacée par des routes minces et trois repositories, mais le découpage Socket/UI reste à faire.

Conséquences : effets de bord difficiles à suivre, duplication, tests coûteux et régressions probables.

Découpage recommandé :

- client : canvas, socket, contrôles, menus, dialogues et combat dans des modules/composants séparés ;
- serveur : handlers Socket.IO par domaine ;
- combat : moteur commun et adaptateurs sauvage/dresseur/PVP ;
- API : routes minces, services métier, repositories SQL et validation d'entrée.

#### P1.3 — Accès base de données incohérent

**État : corrigé, migré et couvert par des tests MySQL le 3 octobre 2026.**

Certaines parties utilisent des pools, mais les routes créent une nouvelle connexion à chaque requête. Les connexions ne sont pas garanties d'être fermées en cas d'exception. Les identifiants MySQL sont dupliqués et codés en dur.

Avant correction, le schéma utilisait MyISAM et `latin1`, sans clés étrangères. Il autorisait plusieurs équipes pour le même utilisateur et plusieurs positions identiques dans une équipe.

Correction appliquée : configuration unique par variables d'environnement, pool partagé, helper transactionnel avec libération garantie, schéma InnoDB/utf8mb4, clés étrangères, unicité équipe/utilisateur et position/équipe, première migration versionnée.

#### P1.4 — Cartes et transitions non validées

État observé :

- 17 cartes JSON existent ;
- 13 sont atteignables depuis `start` via la configuration actuelle ;
- `pk1`, `pk2`, `route5` et `route6` sont orphelines ;
- `pk1`, `route5` et `route6` ont des zones de combat mais aucune configuration de rencontres ;
- une entrée `pk3 896 * 640 la taille de la map` n'a aucun fichier de carte ;
- plusieurs tuiles de la couche `change` ne correspondent à aucune règle ;
- `route4` passe directement à des rencontres de niveau 100–110 après `cave2` niveau 34–44 ;
- la résolution d'une transition compare `valX` ou `valY`, jamais une coordonnée complète.

Correction recommandée : schéma de données pour les cartes, identifiant stable par portail, validation automatique des destinations, coordonnées, couches, images, niveaux et chemins aller-retour.

#### P1.5 — Lectures synchrones répétées des cartes

**État : corrigé le 3 octobre 2026.**

Chaque connexion et changement de carte relit et parse plusieurs fois le même JSON. `getNextMap()` relit aussi la configuration globale. Avec quelques joueurs ce n'est pas catastrophique, mais c'est inutile et bloque la boucle Node.

Correction appliquée : les cartes et la configuration de transitions sont mises en cache au premier accès par nom validé. La validation exhaustive au démarrage reste à ajouter.

#### P1.6 — Trop de données diffusées aux autres joueurs

**État : corrigé le 3 octobre 2026 et couvert par un test unitaire.**

`getPlayersInMap()` renvoie l'objet joueur complet, équipe comprise, pour les listes et mouvements. L'affichage du monde n'a besoin que de l'identifiant, du nom, de la carte, de la position, de la direction, du sprite et de quelques indicateurs.

Correction appliquée : toutes les listes, arrivées et notifications de mouvement utilisent un DTO public explicite qui exclut l'équipe et les données privées.

#### P1.7 — Bundle et assets trop lourds

Le build fait environ 61 Mo. Le bundle applicatif atteint 907 Ko parce que les `require()` dynamiques et `require.context()` embarquent de grands catalogues. Plusieurs images font 1 à 2,7 Mo et la vidéo de connexion fait 12,1 Mo. Les assets sources totalisent environ 118 Mo.

Correction recommandée :

- manifeste explicite des sprites réellement utilisés ;
- chargement à la demande des vues et données lourdes ;
- déplacer les grands médias statiques vers `public/` ou un pipeline adapté ;
- convertir/comprimer les images et vidéos ;
- séparer sources de travail (`.xcf`, dessins, vidéos brutes) et assets runtime ;
- mesurer temps de chargement, FPS, mémoire et trafic réseau avant/après.

#### P1.8 — Moteur de combat et couverture des capacités

**État : socle combat fiabilisé et audité le 3 octobre 2026 ; aucune capacité n'est encore classée partielle ou inconnue.**

Le moteur contient beaucoup de règles et d'aléatoire : 612 capacités enrichies, statuts, météo, terrain, protections, pièges, multi-coups, priorités et changements. Des tests déterministes couvrent maintenant les statuts, immunités, terrains, dégâts résiduels, dégâts spéciaux, capture, fins de combat et helpers d'équipe communs.

Un cas déjà identifiable : le groupe d'expérience `Parabolic` est assigné dans `pokemon.js`, mais n'est pas traité dans `getNextLevelExpForLevel()`. Douze espèces du Pokédex ont cette valeur et provoqueront une erreur si elles sont instanciées. Par ailleurs 317 entrées récentes du Pokédex n'ont pas de champ `exp` compatible avec le constructeur actuel.

Correction appliquée sur l'expérience : progression cubique sans plafond de gameplay, calcul direct du niveau sans boucle jusqu'à 100, difficulté modulée par le coefficient de l'espèce, fallback standard pour les 317 espèces incomplètes et récompense calculée depuis le niveau de l'adversaire. `k` suit une distribution documentée (k4 0,2 %, k3 1,8 %, k2 18 %, k1 80 %) et affecte maintenant aussi les PV. Six tests couvrent ces règles, y compris le niveau 1000.

Correction appliquée sur le combat : les statuts majeurs sont persistés par la migration `004_persistent_pokemon_status.sql`; leurs immunités de type, durées, blocages par terrain, vitesse sous paralysie et dégâts de fin de tour sont pris en compte. Les 35 capacités déclarées `special_case` possèdent désormais une résolution explicite au lieu de produire silencieusement zéro dégât. Les effets auparavant inconnus `add_type` et `swap_stats`, Toile Gluante, Anti-Soin, Poudre, Lien du Destin, Vœu Soin, Danse Lune, Prescience de type, les appels de capacités et plusieurs effets de terrain ont une conséquence réelle. Les fins de combat et changements d'équipe utilisent des helpers communs.

La commande reproductible `npm run audit:moves` contrôle les 612 capacités et 99 familles d'effets : aucun effet n'est inconnu, aucun cas spécial n'est sans résolution et aucune capacité n'est classée partielle. Les 24 capacités précédemment signalées disposent maintenant de leurs fondations : PP persistants et Lutte automatique, objets tenus équipables et consommables, talents passifs séparés, restauration des échanges temporaires, ordre d'action commun, redirection/ciblage allié, position double, économie et multiplicateur de récompense. Reflet Magik, Saisie, Possessif, Rancune, Dépit, Embargo, Tourmagik/Passe-Passe, Recyclage et les échanges de talents ont un comportement effectif.

Les changements forcés (Hurlement/Cyclone) et volontaires (Relais, Demi-Tour, Change Éclair, Dernier Mot) sont raccordés aux combats sauvage, dresseur et PVP, avec pièges d'entrée et transmission des bonus de Relais. Le cœur sait ordonner plusieurs actions, rediriger une cible et permuter deux alliés ; le jeu ne propose cependant pas encore de mode double sélectionnable dans l'interface. Cette absence de mode est une fonctionnalité de jeu restante, pas un effet silencieux du moteur.

La recette intégrale du 3 octobre 2026 a également révélé puis corrigé une table des types Gen 7 incomplète : Sol touchait Vol, Normal n'était pas résisté par Roche/Acier et plusieurs résistances Dragon manquaient. Des tests déterministes couvrent désormais physique/spécial/statut, critique, raté, immunité et efficacité. Le rapport reproductible est `docs/VALIDATION_COMBATS.md`.

Les migrations `005_battle_resources.sql` et `006_battle_economy.sql` persistent PP, talent, objet tenu et Pokédollars. Le Centre et la récupération après défaite restaurent aussi les PP. Le menu d'équipe permet d'équiper/déséquiper les objets tenus de façon transactionnelle.

Le catalogue de talents est maintenant verrouillé sur la génération 7 : les 809 espèces du Pokédex possèdent leurs vrais slots normaux et cachés, soit 223 talents distincts effectivement référencés. Les nouvelles captures tirent un talent normal de façon équiprobable ; lorsqu'un talent caché existe, sa probabilité est fixée à 5 %. Les trois slots spéciaux d'événement de Sachanobi, Zygarde et Rocabot restent documentés mais sont exclus du tirage aléatoire. Le talent reste indépendant du potentiel `k` et est persisté dans la colonne existante `passive_ability`. Un backfill déterministe a vérifié les 7 Pokémon de la base réelle après création d'une sauvegarde SQL et leur a attribué ou corrigé un talent valide sans migration de schéma.

Les quatre premières familles demandées sont isolées dans `server/game/abilities/abilityEngine.js` : immunités/absorptions, effets d'entrée et de sortie, modificateurs de dégâts/statistiques/priorités, puis météo/terrains. Elles couvrent 125 talents présents dans le jeu, notamment les absorptions élémentaires, Brise Moule, Intimidation, Calque, Imposteur, les climats et champs automatiques, les multiplicateurs offensifs/défensifs, les priorités et le recul. Les 98 talents restants appartiennent surtout aux réactions au contact, objets/PP, K.O./fin de tour, économie, doubles ou changements de forme et restent explicitement réservés aux lots suivants. Le mode double n'étant pas jouable, les effets purement doubles ne peuvent pas encore être considérés complets.

Les données reproductibles sont dans `abilities.gen7.json`, `pokemon_abilities.gen7.json` et `move_ability_flags.gen7.json`. `npm run audit:abilities` vérifie les 809 associations, le catalogue, les talents explicites des PNJ, l'exclusion des slots spéciaux et la couverture des quatre familles ; son dernier résultat est 809/809, 223 talents utilisés, 3 slots spéciaux exclus, 125 couverts et aucune erreur.

#### P1.9 — Validation métier insuffisante

**État : fins de dialogue critiques sécurisées le 3 octobre 2026 ; validation globale encore partielle.**

Les routes acceptent directement la majorité du corps client. Les types, bornes, appartenance à une équipe, capacité maximale et valeurs de statistiques ne sont pas centralement validés. `onEndDialogue` fait confiance au nom de dialogue renvoyé par le navigateur et peut déclencher soin/combat sans revalider la proximité.

Correction appliquée sur ce vecteur : le serveur émet une autorisation temporaire liée au dialogue, à la carte et à la tuile ; la fin n'est acceptée que si le joueur est encore adjacent, dans les deux minutes, puis l'autorisation est consommée. Les soins et combats ne peuvent plus être déclenchés en envoyant arbitrairement un nom. Deux tests couvrent proximité, identité, expiration et rejeu. Des schémas d'entrée partagés et une machine de quête restent nécessaires.

### Décision de game design — progression et potentiel `k`

- Aucun plafond de niveau n'est imposé par le gameplay.
- L'expérience totale nécessaire au niveau `L` suit `coefficient × (L - 1)³`. Le coût marginal augmente donc continuellement.
- Le coefficient provient de la valeur `exp` du Pokédex divisée par un million ; une espèce sans valeur utilise `1`.
- Les gains de combat dépendent du niveau et du `k` de l'adversaire, jamais de son expérience cumulée.
- `k` est inné et immuable : 1 commun (80 %), 2 prometteur (18 %), 3 rare (1,8 %), 4 exceptionnel (0,2 %).
- `k` amplifie la contribution des IV aux six statistiques, PV compris.
- Les starters ont tous `k=2` afin que la création répétée de comptes ne soit pas une stratégie de reroll.
- MySQL utilise désormais `BIGINT UNSIGNED` pour l'expérience via la migration `002_unbounded_experience.sql`. Il subsiste une limite technique de stockage, mais aucun plafond fonctionnel atteignable en jeu normal.

### P2 — qualité et simplification

- Les notes `nextMap.txt`, `textImageData.json` et `todo` sont archivées dans `docs/legacy/`, et l'ancienne route prototype a été supprimée. Confirmer puis retirer `NewWorld.vue`, `HelloWorld.vue`, `UserTest.vue`, les méthodes `toto` et commentaires obsolètes.
- Remplacer les noms temporaires (`toto`, `test`, `actionplayer`, etc.) par des termes métier.
- Retirer `/* eslint-disable */` de `UserMap.vue` après découpage.
- Remplacer les nombreux `console.log` de gameplay par un logger avec niveaux et contexte.
- Centraliser constantes, noms d'événements Socket.IO et URL de service.
- `body-parser` a été remplacé par `express.json()` et retiré des dépendances racine.
- Le secret JWT est maintenant configurable par environnement ; interdire le secret de développement en production reste souhaitable.
- Un README racine documente l'organisation, l'installation, la migration et les vérifications.

## 6. Organisation cible proposée

Première étape réalisée le 3 octobre 2026 : `server/{config,http,realtime,game,persistence}`, `data/{game,maps}`, `database/{migrations}`, `docs/{legacy}`, `scripts/` et `tests/`. Le frontend conserve son emplacement et son dépôt imbriqué pour ne pas casser son historique existant.

À plus long terme, si le frontend est réintégré proprement au dépôt racine, une structure cible raisonnable serait :

```text
Explorakit/
├─ apps/
│  ├─ server/
│  │  └─ src/
│  │     ├─ config/
│  │     ├─ http/
│  │     ├─ socket/
│  │     ├─ game/
│  │     │  ├─ battle/
│  │     │  ├─ world/
│  │     │  └─ interaction/
│  │     ├─ services/
│  │     └─ repositories/
│  └─ client/
│     └─ src/
│        ├─ views/
│        ├─ components/
│        │  ├─ battle/
│        │  ├─ world/
│        │  ├─ menu/
│        │  └─ dialogue/
│        ├─ services/
│        ├─ state/
│        └─ assets/
├─ packages/
│  └─ shared/
│     ├─ socket-events/
│     ├─ contracts/
│     └─ validation/
├─ data/
│  ├─ maps/
│  ├─ dialogues/
│  ├─ pnjs/
│  ├─ encounters/
│  └─ pokemon/
├─ database/
│  ├─ migrations/
│  └─ seeds/
├─ tools/
│  └─ validators/
├─ docs/
├─ tests/
└─ package.json
```

Avant ce déplacement final, commencer simplement par créer `server/`, `data/`, `database/`, `docs/` et `tests/`, tout en gardant des adaptateurs de compatibilité. Un grand déplacement unique produirait trop de conflits avec les changements actuels.

## 7. Feuille de route conseillée

### Lot 0 — sécuriser l'état actuel

1. Sauvegarder les modifications actuelles dans des commits cohérents dans les deux dépôts.
2. Documenter la version Node, la version MySQL et les commandes exactes de démarrage.
3. Exporter une sauvegarde de la base avant toute migration.
4. Décider si le frontend devient un dossier normal du dépôt racine.

### Lot 1 — correctifs bloquants et jouabilité

1. ~~Corriger les boucles/intervalle de `UserMap.vue`.~~ Terminé le 3 octobre 2026.
2. ~~Sortir proprement des combats sur timeout ou déconnexion.~~ Terminé pour sauvage et dresseur ; PVP possédait déjà ce nettoyage.
3. ~~Recréer une équipe de PNJ par combat.~~ Terminé et testé.
4. ~~Corriger `pnjs.jsonc` et les premiers plans manquants.~~ JSON corrigé ; premiers plans rendus optionnels.
5. ~~Corriger le parcours d'équipe vide/starter.~~ Terminé avec création du personnage et choix interactif parmi trois starters.
6. Étendre les tests minimaux aux boucles client et aux déconnexions.
7. ~~Soigner et rapatrier le joueur après un K.O. total.~~ Terminé avec dernier centre persistant, maison de repli et récupération à la connexion.
8. ~~Fiabiliser les statuts et les dégâts spéciaux silencieux.~~ Terminé avec migration 004 et tests déterministes.
9. ~~Finaliser les 24 capacités partielles et les changements forcés/relais.~~ Terminé avec PP, objets tenus, talents, ordre commun, économie, primitives doubles et migrations 005/006.

### Lot 2 — persistance et sécurité

1. ~~Introduire pool, repositories et transactions InnoDB.~~ Code, migration réelle et vérification terminés.
2. ~~Remplacer la sauvegarde HTTP destructive des équipes.~~ Terminé et sérialisation couverte par un test.
3. ~~Ajouter authentification et autorisation HTTP/Socket.IO.~~ Terminé ; tests d'intégration réels à ajouter.
4. Validation des routes sensibles et des fins de dialogue terminée ; poursuivre sur tous les événements de combat et de quête.
5. Migration initiale ajoutée ; remplacer encore l'utilisateur historique en clair du seed.

### Lot 3 — découpage sans changement fonctionnel

1. Extraire la boucle canvas et les contrôles du composant principal.
2. ~~Extraire la connexion Socket.IO dans un service unique.~~ Session, API et création de socket extraites ; listeners encore à découper.
3. Extraire l'interface de combat et les panneaux du menu.
4. Unifier les trois orchestrateurs autour d'un moteur commun.
5. Routes HTTP déjà réduites ; autorisation des dialogues et état public/position des joueurs extraits et testés, autres handlers Socket.IO à découper par domaine.

### Lot 4 — performances mesurées

1. Établir une mesure de référence : chargement, taille transférée, FPS, mémoire et messages/s.
2. Réduire la fréquence des mouvements.
3. ~~Mettre les cartes en cache serveur.~~ Terminé.
4. ~~Assainir les payloads joueurs.~~ Terminé et testé.
5. Optimiser les assets et le chargement à la demande.

### Lot 5 — audit de contenu complet

Après stabilisation technique, établir :

- synopsis, actes, quêtes principales et secondaires ;
- graphe réel de progression entre les cartes ;
- PNJ, dialogues, combats obligatoires et drapeaux de quête ;
- distribution des starters, objets, soins, captures et récompenses ;
- courbe de niveaux et difficulté par zone ;
- villes, routes, intérieurs, arènes et fin de jeu manquants ;
- checklist de complétude par carte ;
- critères de victoire, sauvegarde finale et rejouabilité.

## 8. Photographie actuelle du contenu

- 47 cartes physiques existent, 46 lieux sont actifs via deux alias d'intérieur et 45 sont atteignables depuis `start` ; seule `pk2` reste active mais isolée pour compatibilité avec les anciennes sauvegardes.
- Les 30 cartes générées sont actives : 8 routes, 5 villes, 5 arènes, 10 maisons et 2 boutiques.
- 24 PNJ sont placés, dont 8 voyageurs, 5 guides, 5 champions et 5 habitants/vendeuses sur le nouveau parcours.
- Huit équipes de dresseurs sont définies, dont les cinq champions qui accordent les badges de manière unique et transactionnelle.
- Le français couvre l'interface en jeu ainsi que les noms des 612 capacités et 223 talents ; l'anglais de l'interface est disponible mais les dialogues et messages serveur restent à traduire.
- Les boutiques vendent désormais les Balls et objets tenus dans une transaction serveur avec contrôle du solde ; la résolution de Clara/Aube Obscure, le combat final, l'épilogue et les crédits restent à écrire.
- L'état détaillé et les priorités sont maintenus dans `docs/AUDIT_CONTENU_JEU.md`.

## 9. Stratégie de tests minimale

### Tests unitaires prioritaires

- courbes d'expérience et niveaux 1, 50, 100 pour chaque groupe ;
- statistiques selon IV, nature, niveau et tier `k` ;
- table complète des efficacités de types ;
- dégâts physiques/spéciaux, immunités, critiques et précision ;
- états, pièges, terrains, météo et changements ;
- capture aux bornes de PV et multiplicateurs d'objets ;
- transitions et coordonnées de chaque carte ;
- sérialisation aller-retour d'une équipe sans changement d'UUID.

### Tests d'intégration prioritaires

- inscription, connexion, accès refusé sans jeton ;
- création d'un nouveau joueur avec équipe/inventaire valides ;
- sauvegarde concurrente d'équipe sans perte ;
- reconnexion à la dernière position ;
- déconnexion pendant chaque type de combat ;
- défaite avec équipe entièrement K.O., soin et réapparition au centre ou à la maison ;
- combat de deux joueurs et refus d'une action extérieure ;
- parcours `start` vers chaque carte atteignable.

### Test manuel de jouabilité

Préparer une checklist courte répétable : création de compte, starter, mouvement, toutes les sorties de carte, dialogue, soin, rencontre, capture, réorganisation d'équipe, déconnexion/reconnexion, PVP et partie mobile.

## 10. Définition de « jeu techniquement stable »

Le socle pourra être considéré stable lorsque :

- aucune boucle, minuterie ou écoute socket ne survit à son écran ;
- une déconnexion ne laisse aucun combat ou état joueur actif ;
- toute sauvegarde est atomique et testée ;
- toutes les routes et sockets utilisent une identité authentifiée ;
- les cartes et leurs assets passent un validateur automatique ;
- les trois types de combat partagent des règles testées ;
- un compte neuf peut commencer, obtenir un starter, sauvegarder et reprendre ;
- le lint, les tests et le build passent sans erreur ;
- `node_modules` et `dist` ne polluent plus l'historique source ;
- une session de 30 à 60 minutes ne montre ni fuite mémoire, ni hausse continue du trafic, ni baisse de FPS.

## 11. Journal de suivi

| Date | Intervention | Vérifications | État restant |
| --- | --- | --- | --- |
| 2026-10-03 | Audit initial, cartographie, analyse statique, validation des données et création de la mémoire projet | Syntaxe OK, build OK avec avertissements, lint en échec sur 1 erreur, aucun test existant | Lots 0 à 5 à planifier et exécuter |
| 2026-10-03 | Lot P0 stabilité : boucle canvas unique, timer mouvement nettoyé et ralenti, fin de combat sur déconnexion/timeout, équipes de PNJ isolées, JSON PNJ valide, premier plan optionnel, lint réparé | 2/2 tests Node, syntaxe ciblée OK, lint OK, build temporaire OK avec avertissements de taille | P0.1 authentification, P0.2 persistance atomique et P0.9 onboarding restent critiques |
| 2026-10-03 | Refactorisation des dossiers ; API réduite ; pool/config centralisés ; JWT HTTP/Socket ; sauvegarde d'équipe transactionnelle ; onboarding avec starter ; InnoDB/migration ; cache cartes ; DTO joueur public ; documentation racine | 6/6 tests Node, syntaxe complète OK, lint OK, build temporaire OK avec avertissements de taille | Appliquer la migration sur une sauvegarde MySQL, tester le parcours réel, puis traiter validation métier, progression et découpage UI/Socket |
| 2026-10-03 | Progression cubique sans plafond, rareté et effet de `k`, récompenses de combat rééquilibrées, trois starters, création de personnage en quatre étapes, refonte accueil/connexion, autorisation serveur des dialogues, extraction session/API/socket, état joueur et helpers d'affichage, migrations et tests MySQL protégés | 18 tests actifs réussis, 2 tests MySQL ignorés faute de service local, 35 fichiers de script valides, lint OK, build temporaire OK ; vidéo de connexion de 12,1 Mo retirée du build | Démarrer une base de test, appliquer les migrations 001 puis 002, lancer `npm run test:mysql`, tester visuellement le prologue et poursuivre le découpage des listeners et du canvas |
| 2026-10-03 | Ajout de la commande unique `npm run launch` et contrôle de la base WAMP | Connexion MySQL 5.7.36 réussie, quatre tables détectées | Les quatre tables utilisent encore MyISAM : sauvegarder puis appliquer les migrations avant de tester la persistance transactionnelle |
| 2026-10-03 | Précontrôle, sauvegarde vérifiée, migrations 001/002 appliquées à `pokemon_game`, création de `pokemon_game_test`, automatisation des contrôles et smoke test serveur | 4 tables InnoDB, 5 contraintes présentes, colonnes niveau/expérience conformes, 3/3 tests MySQL, inscription/login/Carapuce/inventaire/équipe/sauvegarde UUID/Socket.IO validés | Effectuer le parcours visuel dans le navigateur et tester un combat complet, une capture puis une reconnexion |
| 2026-10-03 | Récupération après défaite totale : soin complet, nettoyage des états, dernier Centre Pokémon persistant, maison de repli, synchronisation de carte et réparation à la connexion ; migration 003 appliquée | Sauvegarde SQL créée, migration vérifiée, 21/21 tests actifs, 3/3 tests MySQL, lint et build réussis ; smoke HTTP/Socket confirme soin et retour durable à la maison | Tester visuellement une défaite sauvage, dresseur et PVP, puis confirmer l'emplacement de réapparition dans le centre |
| 2026-10-03 | Socle combat : fins et équipes communes, statuts persistants et complets, immunités/terrains/résidus, 35 cas de dégâts spéciaux, nombreux effets et appels de capacités ; audit automatique des 612 capacités ; migration 004 appliquée | Sauvegarde SQL créée, migration vérifiée, 38/38 tests actifs, 3/3 tests MySQL, audit 99/99 effets reconnus, smoke HTTP/Socket et build réussis | Tester manuellement les trois combats ; raccorder changements forcés/relais ; concevoir PP, objets tenus, talents et doubles avant les 24 capacités partielles |
| 2026-10-03 | Passe combat complète : PP/Lutte, objets tenus équipables, baies/Restes, talents passifs, économie/Happy Hour, ordre/redirection/alliés, 24 effets finalisés, changements forcés et relais dans les trois orchestrateurs ; migrations 005/006 appliquées | Sauvegarde SQL créée, 48/48 tests actifs, 3/3 tests MySQL, audit des 612 capacités sans inconnu/cas spécial/partiel, smoke HTTP/Socket avec objet tenu, lint et build réussis | Tester manuellement les scénarios de combat ; ajouter un mode double jouable seulement si souhaité ; découper le moteur désormais proche de 2 800 lignes |
| 2026-10-03 | Talents officiels Gen 7 : 809 espèces et 223 talents catalogués, slots normaux/cachés, attribution persistante avec 5 % de talent caché, backfill déterministe, module mécanique séparé et quatre premières familles raccordées | Sauvegarde SQL créée ; 7/7 Pokémon réattribués ou corrigés ; audit talents 809/809 sans erreur, 125 talents couverts et 98 réservés ; 55/55 tests actifs, 3/3 MySQL, audit capacités et lint réussis | Tester manuellement les talents en sauvage/dresseur/PVP ; traiter ultérieurement les quatre familles restantes ; découper `battleEngine.js` proche de 2 900 lignes |
| 2026-10-03 | Audit et refonte des animations de combat : événement visuel commun aux trois orchestrateurs, capacités physiques/spéciales/statut, impacts et soins, barre de PV retardée, capture synchronisée, verrouillage du tour, équipe dynamique, responsive, réduction des animations et ancrage automatique des sprites d'après leurs pixels visibles | Syntaxe serveur OK, lint OK, build production réussi ; 55/55 tests actifs et 3 MySQL ignorés par la suite standard | Suivre `docs/AUDIT_ANIMATIONS_COMBAT.md` : test visuel sauvage/dresseur/PVP et mobile, puis extraction de `BattleOverlay.vue` |
| 2026-10-03 | Validation complète des combats : scénarios réels sauvage/dresseur/PVP, capture et objets, PP/XP, changements manuel/forcé/Hurlement/Demi-Tour/Relais, fins de combat, correction de la table des types Gen 7 et recette Chromium ordinateur/mobile | 59/59 tests actifs, 11/11 MySQL, smoke HTTP/Socket, audits 612 capacités et 809 Pokémon, lint, build et 2/2 viewports réussis ; captures dans `docs/validation/` | Système de combat techniquement stable ; poursuivre par `BattleOverlay.vue`, le découpage des gros fichiers et l'audit contenu histoire/cartes/quêtes |

| 2026-10-03 | Extraction complète de `BattleOverlay.vue` et de ses minuteries ; résultats visuels raté/immunité/critique/efficacité, météo, terrains et sons synthétiques ; gestionnaires Socket profil/inventaire et chat séparés ; table des types et catalogue de capacités sortis du moteur ; chargement différé des routes et sprites statiques | 62/62 tests actifs, 11/11 MySQL, lint et build réussis, 2/2 viewports validés ; `UserMap.vue` 4 305→2 789 lignes, bundle jeu 1 012→213 Kio, fond 2 168 859→171 704 octets | Continuer le découpage de `socketHandler.js` (993 lignes) et `battleEngine.js` (2 841 lignes) ; traiter d'abord la progression persistante avant de raccorder les 18 cartes générées |
| 2026-10-03 | Progression persistante et menu complet : Pokédex Gen I–IV vu/capturé, quêtes et badges, cinq tables dédiées, combats de PNJ uniques, récompenses transactionnelles côté serveur, synchronisation manuelle et automatique, options volume/texte/animations | Migration 007 sauvegardée puis appliquée et vérifiée sur WAMP ; 73 tests standards sans échec, 11/11 MySQL, smoke HTTP/Socket avec reprise et sauvegarde manuelle, lint, build et 2/2 viewports réussis | Construire la première tranche verticale `gen_route1` + `gen_ville1` + `gen_arene1`, avec champion, badge, boutique et dialogues conditionnels |
| 2026-10-03 | Ciblage dynamique des animations sur les pixels visibles des sprites ; dégâts et résultats repositionnés ; capture enrichie avec arc, impact, aspiration, chute, secousses et résultat | Lint et build réussis ; Chromium desktop/mobile vérifie mathématiquement projectile et Ball à moins de 3 px de leur cible ; captures dédiées dans `docs/validation/` | Étendre ultérieurement le même socle en familles visuelles rayon, sol, zone, soin et altération |
| 2026-10-03 | Activation déclarative des 8 routes, 5 villes et 5 arènes générées, ajout de 22 PNJ et de 5 champions avec badges ; option français/anglais et noms français des 612 capacités/223 talents | Tests standards, MySQL, audit talents, validateurs de cartes, lint et build production réussis | Recette manuelle du parcours ; dialogues conditionnels ; boutique transactionnelle ; conclusion Clara/Aube Obscure ; anglais des messages serveur et écrans d'authentification |
| 2026-10-03 | Frontière de responsabilité corrigée : restauration exacte de `route3.json` et de ses PNG, suppression du script qui modifiait les villes, raccord gameplay limité à `nextMap.json` ; intégration parallèle des 12 intérieurs livrés par l'agent cartes | Empreintes historiques restaurées pour `route3`, validateur `correctif_villes` réussi, audit à 47/44/43 cartes et tests de raccord adaptés | Toute création de porte ou retouche JSON/TMX/PNG reste réservée à l'agent cartes |
| 2026-10-03 | Création de 12 planches de PNJ en pixel art d'après les portraits existants, au format moteur 4×4 de 256×256 px ; remplacement des deux apparences génériques sur les 23 PNJ | PNG RGBA contrôlés, 16 cellules de 64×64 par planche, correspondances de sprites couvertes par `tests/world-content.test.js`, tests et build client | Vérifier visuellement en jeu la lisibilité des cheveux et manteaux sombres sur chaque décor ; ajouter ensuite des PNJ aux huit intérieurs encore vides |
| 2026-10-03 | Fluidité du monde et première ville : cadence client/serveur désynchronisée pour éviter les pas perdus, interpolation chevauchée et animation au temps réel ; cartouche de localisation bilingue ; arène et boutique de `ville1` raccordées par alias sans modifier les cartes ; Moonpunch placé dans l'arène ; catalogue et achats transactionnels côté serveur | 70/70 tests standards actifs, 11/11 tests MySQL dont débit/stock/refus sans fonds, lint et build réussis ; audit contenu à 47 cartes physiques, 46 lieux actifs, 45 atteignables et aucune destination inconnue | Redémarrer le serveur puis vérifier manuellement la sensation du déplacement, les deux seuils de `ville1`, le retour devant les bâtiments et l'ergonomie de la boutique sur mobile |

## 12. Notes pour les prochaines interventions

Avant de corriger un point :

1. vérifier l'état Git racine et celui de `vue-explorakit/` ;
2. cibler un lot réduit ;
3. ajouter d'abord le test qui expose le problème si possible ;
4. préserver la compatibilité des événements réseau ;
5. mettre à jour ce document et son journal ;
6. ne lancer l'audit narratif exhaustif qu'après le lot de stabilisation technique, tout en conservant la photographie de contenu ci-dessus comme base.
7. ne jamais modifier les JSON, TMX ou PNG de cartes hors du lot explicitement confié à l'agent cartes ; les autres agents ne raccordent que les transitions déjà livrées dans `nextMap.json`.


### Contenu généré — 3 octobre 2026

Ajout de huit cartes gen_route1 à gen_route8 dans data/maps (JSON/TMX) et de leurs 16 PNG dans vue-explorakit/src/assets. Paysages progressifs du hameau boisé au col pierreux. Calques coll/change/battle/foreground/int conservés ; deux passages par carte ; maisons décoratives. Configuration de raccords et rencontres séparée dans data/game/gen_nextMap.entries.json et gen_nextMap.proposition.json, sans activation des routes ni modification du nextMap.json existant. Proposition de raccord de route3 et aperçus dans docs/gen_routes. Contrôles reproductibles : `python docs/gen_routes/validate_generated_maps.py` ; huit cartes et seize règles vérifiées (accessibilité, collisions, destinations, images et équivalence TMX/JSON). Reste : fusionner les règles, appliquer le raccord voulu, choisir l’équilibrage de route4 (niveau 100–110 existant), reconstruire le client, redémarrer le serveur puis tester le parcours en jeu.


### Villes et arènes générées — 3 octobre 2026

**État actuel : activées le 3 octobre 2026.** Les paragraphes ci-dessous conservent l'historique de leur génération ; les cartes restent sous la responsabilité de l'agent cartes, tandis que leur raccord actif, les champions et les badges sont décrits dans `docs/AUDIT_CONTENU_JEU.md`.

Ajout de cinq villes gen_ville1 à gen_ville5 inspirées de ville1.tmx, avec cinq intérieurs gen_arene1 à gen_arene5, leurs dix JSON/TMX et vingt PNG de décor/foreground. Chaque ville a une arène accessible et deux passages extérieurs ; absence de combats sauvages en ville/arène. Champions, équipes, dialogues et badges à définir. Configuration séparée dans data/game/gen_villes_nextMap.entries.json et gen_villes_nextMap.proposition.json, proposant l’insertion des villes entre les huit routes générées sans modifier la configuration active ni ces routes. Aperçus et validateur dans docs/gen_villes. Vérification reproductible : `python docs/gen_villes/validate_generated_cities.py` (calques, images, tilesets, équivalence TMX/JSON, accessibilité et destinations sans boucle immédiate). Reste : fusion des règles, choix des champions et badges, reconstruction du client, redémarrage du serveur et test du parcours en jeu.


Revision des cinq villes : plans varies (village forestier aux sentiers de terre, bourg autour d’un lac, quartiers rocheux en terrasses, cite-jardin et village sableux avec place centrale). Batiments, masses vegetales, sols et parcours remanies ; les portes d’arene et les retours ont ete recalcules dans les propositions separees. Les interieurs d’arene sont conserves. Les fichiers installes de la precedente version sont controles par empreinte avant remplacement afin de preserver une eventuelle modification utilisateur. Verification : `python docs/gen_villes/validate_generated_cities.py`. Configuration active toujours inchangee ; test manuel apres integration requis.


Cinq facades distinctes pour les arenes : bois, dome bleu, hall metallique, toit rouge et colonnes turquoise, tous issus de teset2.tsx. Empreintes de batiments, foregrounds, collisions et portes adaptes a chaque variante ; retours recalcules dans les propositions de raccord. Le validateur verifie egalement cinq types de facades differents. Configuration active inchangee.


Correction des seuils visibles des cinq arenes : suppression des collisions dans le passage de porte et sous les ombres frontales, changement de carte place sur le seuil visible, retour place sur le parvis libre. Metadonnees arena_door et arena_approach pour verifier chaque case du passage depuis les rues. Controle reproductible : `python docs/gen_villes/validate_generated_cities.py` ; controle des cinq couloirs et des destinations aller-retour. Configuration active inchangee ; parcours manuel en jeu apres integration a effectuer.


Amenagement des cinq interieurs : parcours distincts en bosquet, bassins, carriere, jardin et terre. Tapis et obstacles adaptes a chaque salle, cour du champion accessible depuis entree et sortie. JSON/TMX et PNG actualises ; verification des trajets du tapis a la generation et du champion par le validateur docs/gen_villes/validate_generated_cities.py. Champions, equipes et dialogues a configurer ; test manuel en jeu apres integration restant.


### Audit de contenu jouable — 3 octobre 2026

L'état détaillé et la feuille de route sont conservés dans `docs/AUDIT_CONTENU_JEU.md`. Le contrôle `npm run audit:content` mesure 35 cartes installées, 15 actives, 13 atteignables depuis `start`, 18 cartes générées inactives, 4 dialogues, 1 PNJ placé, 3 équipes de dresseurs et 7 objets. Priorité retenue : persistance des quêtes, drapeaux narratifs et badges, puis intégration verticale de `gen_route1`, `gen_ville1` et `gen_arene1`. L'entrée factice `pk3 896 * 640 la taille de la map`, l'isolement de `pk2` et le saut de niveaux 34–44 vers 100–110 restent à arbitrer avant la fusion des cartes.


### Maisons et shop generes — 3 octobre 2026

Ajout initial de gen_maison1/2/3 et gen_shop1 : JSON/TMX, PNG et foregrounds transparents. Mobilier avec collisions, deux cases de sortie, aucun combat sauvage. Cette première livraison a ensuite été intégrée au lot complet de douze intérieurs décrit ci-dessous. Le commerce reste à implémenter. Contrôle reproductible : `python docs/gen_interieurs/validate_interieurs.py`.


### Acces complets aux maisons et shops — 3 octobre 2026

Les dix maisons et deux shops des cinq villes generees ont une porte active et un interieur avec retour au seuil correspondant. Les quatre raccords existants et leurs PNJ sont preserves ; huit interieurs supplementaires sont copies sans toucher aux originaux. Configuration active nextMap.json mise a jour. Toits des maisons, shops, centres et arenes traversables en arriere-plan avec dessin en foreground, murs conserves. Sols et eau copies avec les shops/centres retires. JSON/TMX et images PNG synchronises. Verification reproductible : `python docs/correctif_villes/validate_access.py` et `node --test tests/world-content.test.js`. Redemarrage serveur et reconstruction client necessaires pour recharger les fichiers ; verification manuelle en jeu restante.


### Publication Git — 9 octobre 2026

Travaux serveur, données, migrations, documentation et client sauvegardés dans leurs deux dépôts existants. Le client est déclaré dans .gitmodules pour permettre un clonage récursif reproductible. node_modules/ et dist/ sont retirés de l'index Git, sans supprimer les fichiers locaux ; .env et backups/ restent ignorés. Vérification : 70 tests réussis, 11 tests MySQL ignorés, lint client sans erreur. La recette manuelle et les tests MySQL ne sont pas relancés dans cette publication.

Build de production vérifié dans un dossier temporaire : réussi, avec avertissements de taille des assets et de chaîne Vue CLI ancienne.
