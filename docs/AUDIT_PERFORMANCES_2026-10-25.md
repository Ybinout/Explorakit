# Audit global des performances de RiftMon — 25 octobre 2026

Le patch est publié sur https://riftmon.binout.fr. Il réduit les transferts, les allocations répétées, les calculs de l’IA et les écritures SQL inutiles. Les images, les sons, les fréquences et densités d’effets, les réglages de résolution et les règles de jeu restent identiques. Aucune migration ni suppression de données ; les réglages de durabilité de MariaDB sont conservés.

Les mesures et contrôles détaillés sont dans [PERFORMANCE_AUDIT_2026-10-25.json](PERFORMANCE_AUDIT_2026-10-25.json). Référence avant patch : serveur `a746f03`, client `4edfefb`, build `70590aa20a62ad9c`. Nouveau client `2a15969`, build `b462ef09166a7869`.

## Corrections livrées

| Point | Avant | Après | Portée |
|---|---|---|---|
| JavaScript du jeu en HTTPS | ~935 Ko sans compression | ~305 Ko en gzip, soit −67 % | Chargement et rechargement |
| Feuille de style du jeu | ~272 Ko sans compression | ~56 Ko en gzip, soit −79 % | Chargement, aspect identique |
| Cache des fichiers à empreinte | Revalidation à chaque visite | Un an avec `immutable` | JS/CSS/images/sons portant une empreinte |
| État renvoyé à chaque déplacement en expédition | ~11,2 Ko pour l’équipe synthétique de six Pokémon | 60 octets de métadonnées, en plus du mouvement existant | Rift et Colosseum, clients récents |
| Couches de cartes | Reconstruction des matrices à chaque lecture | Matrices immuables réutilisées | Trois modes ; surtout marche Rift/Colosseum |
| Recherche de terrain sûr | Recalcul des composantes à chaque récupération/arrivée | Cache du terrain fixe ; obstacles dynamiques encore vérifiés | Connexion, transitions, déblocage |
| Sauvegarde quand aucun salon ni run n’existe | Une réécriture SQL par seconde | Une sauvegarde de l’état vide puis aucune répétition | Serveur au repos |
| Compression des checkpoints | `gzipSync` sur la boucle JavaScript | Compression asynchrone, écritures toujours ordonnées | Sauvegardes Rift/Colosseum |
| IA forte, huit situations identiques | Moyenne ~40,8 ms | ~32,4 ms, soit −20 % | Calcul tactique partagé des dresseurs |
| Lecture des records/profils | Même JSON analysé deux fois par ligne | Une analyse réutilisée | Classement et profils |

### Réseau et chargements

La compression est limitée au vhost RiftMon. Les octets reçus en HTTPS ont été décompressés et comparés aux fichiers locaux : égalité intégrale. Un même ancien bundle passe aussi de 934 891 à 304 364 octets transférés, avec contenu décompressé identique. Aucun réencodage d’image ou de son.

Le cache long concerne uniquement les noms à empreinte de contenu. HTML, manifeste, worker et sprites non versionnés continuent à être revalidés. Les anciens bundles sont conservés pour les fenêtres déjà ouvertes. Ni les données privées ni les réponses de combat ne reçoivent cette politique de cache.

Le client récent annonce `movementPatches:1` à son entrée en expédition. Une marche ordinaire reçoit `drift:movementState`, limité à l’identifiant de run et au Repousse restant. Les coordonnées autoritaires restent dans `playerMoved`. Changement de carte, combat, phase, état de survie et autres commandes conservent les instantanés complets, ainsi que la publication périodique existante. Les anciens clients gardent le protocole complet ; un nouveau client fonctionne également avec l’ancien serveur. Cela évite de reconstruire le sac et l’équipe Vue à chaque pas, sans réduire le contenu disponible.

### Cartes, logique et IA

Les empreintes des quatre couches dérivées restent identiques pour les 88 cartes logiques du catalogue. Les portes propres à un alias ne sont pas partagées avec un autre alias. Les grilles sont gelées pour empêcher qu’un joueur modifie le terrain d’un autre. Les composantes de récupération ne sont mises en cache que pour ces grilles immuables ; les grilles synthétiques mutables gardent le calcul normal. Les PNJ, barrières et trous restent des obstacles vérifiés au moment de l’action.

Le banc synthétique de 1 000 lots de quinze lectures passe d’environ 0,091 à 0,0022 ms par lot. Ce chiffre décrit la fonction de lecture, pas le temps total d’un déplacement ni la latence réseau.

L’IA réutilise la vitesse d’un même instantané dans son évaluation privée. Les caches sont liés à cette copie du terrain et aux identités des Pokémon ; un nouveau tour ou une météo hypothétique obtient de nouvelles clés. Aucune réduction du nombre de scénarios ni connaissance supplémentaire de l’action du joueur. Scores, prévisions et choix sont exactement identiques sur les huit jeux d’essai avant/après. Les tests de confidentialité et de tactique passent. Certaines décisions restent coûteuses : ce patch ne garantit pas une limite universelle de temps de calcul.

### Sauvegardes et base

La cadence des sauvegardes actives reste d’une seconde et les actions durables attendent toujours leur écriture. Seule la répétition d’un état totalement vide est supprimée ; la disparition du dernier run est bien enregistrée. Le contrôle après publication confirme aussi que le timestamp du checkpoint vide reste inchangé entre deux lectures espacées de 2,2 s. L’ordre des écritures, la reprise après échec et la suspension des délais pendant l’indisponibilité sont préservés.

La compression asynchrone conserve le format/version, l’empreinte d’intégrité et les références partagées des anciennes sauvegardes. Le graphe est capturé avant toute attente de compression. La sérialisation du graphe reste synchrone : sur le banc de huit joueurs avec six Pokémon chacun, l’encodage synchrone de référence coûte encore environ 6–7 ms. Le déplacement de gzip ne supprime donc pas tout le coût de sauvegarde ; il évite de le faire entièrement sur la boucle JavaScript.

Au début de l’audit, la machine dispose d’environ 5,6 Gio de RAM disponible sur 7,6 Gio et la charge globale est faible. Le processus du jeu n’indique pas de saturation persistante. MariaDB utilise un buffer de 128 Mio, largement suffisant pour le petit volume courant ; 452 lectures physiques pour ~60 millions de demandes depuis le démarrage. Les nombres de lignes d’`information_schema` sont des estimations. Les accès principaux équipe/progression/PC utilisent leurs index dans les `EXPLAIN` relevés. Aucun nouvel index n’a de gain critique démontré à ce volume.

`Slow_queries=0` n’est pas une preuve d’absence de lenteurs courtes : le seuil est de 10 secondes, le journal lent et `performance_schema` sont désactivés. L’audit conserve cette limite d’observation. Aucun paramètre global de mémoire, de synchronisation disque ou de durabilité n’a été modifié.

## Points encore améliorables

1. **Profiler la sérialisation et l’IA avec davantage de joueurs actifs.** Les gros graphes sont encore parcourus sur la boucle JavaScript. Une isolation en worker peut devenir utile ; elle demande de préserver les prototypes, références, délais et instantanés privés. Le cache actuel ne remplace pas ce travail.
2. **Réduire les instantanés complets périodiques quand rien n’a changé.** La marche est déjà légère. Des révisions explicites de l’équipe, du sac et des contrats permettraient ensuite d’éviter les mises à jour identiques restantes, avec resynchronisation complète à la reconnexion. Il faut un mécanisme fiable d’invalidation avant d’enlever ces messages.
3. **Séparer les réconciliations de progression des lectures ordinaires.** `loadProgressState` vérifie plusieurs récompenses historiques et exécute plusieurs lectures/écritures. Regrouper ces opérations après une mutation réelle peut économiser des requêtes, mais doit préserver les récompenses rétroactives, les resets admin et les autres onglets.
4. **Alléger le démarrage JavaScript par chargement différé.** Le module du jeu reste proche de 935 Ko minifié avant gzip. Les gros panneaux Pokédex/PC/encyclopédies peuvent être séparés, avec préchargement discret et les loaders déjà existants. Les références d’assets et l’usage hors ligne doivent être vérifiés ; aucune texture n’est réduite dans ce patch.
5. **Compléter l’observation en charge.** Mesurer délais de boucle, p95 des requêtes et temps par famille d’action sur une durée représentative avant tout réglage SQL ou activation d’un worker. Ne pas conclure à partir du seul nombre de requêtes ou d’un benchmark court.
6. **Entretenir les recettes historiques et les anciennes publications.** Plusieurs assertions de contenu et sélecteurs de test ont vieilli avec les nouvelles cartes, objets et menus. Les anciens bundles ne sont pas chargés par une page neuve, mais prennent de l’espace ; prévoir une politique de rotation qui respecte les fenêtres et versions encore utilisées.

## Vérifications et limites

- **87 contrôles ciblés finaux réussis** : runtime Rift/Colosseum, checkpoints, sockets anciens/récents, reprise de position, cartes, cache HTTP et IA.
- **Parcours navigateur actuels réussis** : vraie connexion/reconnexion et sauvegarde Aventure, entrée Rift/Colosseum, quatre formats, six véritables combats d’arène et retours, reset de Hoze, chargement différé et glissement carte/footer. Comptes jetables dans `explorakit_test` ; aucun compte réel modifié.
- **Suite SQL : 124 réussites sur 126.** Les deux échecs, classification de la clé de Gwenn dans les fixtures et ancien parcours de dialogue Aspha, sont reproduits sur le code précédent dans une copie isolée.
- **La suite historique globale n’est pas entièrement verte.** Passes initiale et finale : 1 046 réussites, 134 ignorés, 12 échecs sur 1 192 tests. Onze échecs sont reproduits dans les fichiers concernés sur la référence précédente ; le douzième est une assertion imposant Danse Pluie, intermittente aussi sur la référence (deux échecs sur cinq exécutions isolées). Ces points restent à examiner séparément. Ils ne sont pas masqués en modifiant les règles du jeu.
- L’ancienne longue recette Colosseum suppose encore `/explorakit/` puis un ancien sélecteur de sac. La relance avec le build au bon préfixe atteint ce sélecteur obsolète ; les parcours actuels à la racine et les six combats/retours passent.
- Lint, builds racine/préfixe, syntaxe et différences Git contrôlés. Pas de test sur téléphone physique ni de test de charge sur des comptes de production. Les gains de fonctions ne sont pas des promesses d’images/s pour tout appareil.

## Publication et reproduction

Publication serveur/client le 2026-10-25T16:55:22Z ; vérification HTTPS finale le 2026-10-25T16:56:59Z. Un seul redémarrage prévu du jeu, PID 1639340 → 1671877, aucun redémarrage automatique. Le checkpoint était vide, aucun Rift/Colosseum actif. Nginx rechargé gracieusement après validation ; les services voisins n’ont pas été redémarrés et leurs URL répondent HTTP200.

Sauvegarde privée : `/home/ubuntu/dev/backups/riftmon-global-performance-2026-10-25T16-55-20-132Z` sur le volume additionnel : code précédent, index, configuration Nginx, checkpoint et export SQL cohérent. Ne pas restaurer aveuglément la base sur des données arrivées depuis. Le premier contrôle de compression avait réutilisé une connexion maintenue par l’ancien worker Nginx ; les vérifications finales utilisent des connexions HTTPS neuves, sans second redémarrage du jeu.

Commandes principales :

```sh
node scripts/measureServerPerformance.js
node scripts/measureTrainerAi.js
node --env-file=.env scripts/auditDatabasePerformance.js
node --test tests/performance-regressions.test.js tests/movement-patches-socket.test.js
node --env-file=.env scripts/runMysqlTests.js
```

`PERF_REPORT_OUT` sauvegarde le banc serveur. `PERF_AI_FIXTURE` conserve les mêmes équipes entre comparaisons ; `PERF_AI_MODULE` permet d’évaluer une copie du module précédent avec ces mêmes équipes. Journaux, fixtures et captures de la session : `/tmp/riftmon-global-*`, `/tmp/riftmon-ai-*`. Les scripts de diagnostic SQL n’exécutent que des lectures de métadonnées et des `EXPLAIN`, sans publier d’identités ni de secrets.
