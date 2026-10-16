# Audit technique et mémoire du projet Explorakit

## Contrats facultatifs, Drifts directs et début d’expédition — 16 octobre 2026

Les nouvelles expéditions **Rift et Colosseum 30/60** reçoivent trois contrats privés, suivis automatiquement pendant l’exploration : gagner avec deux combattants différents ayant infligé des dégâts (au moins deux victoires sauvages), capturer deux espèces différentes et battre un dresseur. Les progressions viennent uniquement des fins de vrais combats : une fuite, une défaite, une interruption ou un combat d’arène après exploration ne compte pas. L’UUID du combattant permet de conserver son crédit après évolution. Une victoire ne crédite qu’un nouveau combattant. Les captures répétées d’une même espèce ne remplissent pas le second objectif.

Dans **Menu → Contrats facultatifs** ou l’onglet Contrats du carnet, chaque carte montre la consigne, la progression et un bouton « Choisir ma récompense » lorsqu’elle est terminée. Pas d’objectif imposé sur la carte ni d’acceptation préalable. Un seul choix par contrat : **un niveau pour chaque réserviste vivant** (le premier Pokémon de l’équipe est exclu), **3 Poké Balls et 2 Potions**, ou un objet tenu propre au contrat (**Grelot Coque / Évoluroc / Ceinture Pro**). L’entraînement passe par le modèle commun, avec évolutions/apprentissages ; K.O. protégés compris, les compagnons à 0 PV sont exclus. Il ne multiplie pas le gain par le bonus XP de mode. Les trois contrats ne donnent aucun point de classement. Le choix doit être fait avant la fin de l’exploration ; le serveur vérifie identité, état, échéance, complétion et unicité puis sauvegarde le checkpoint avant l’acquittement. La reconnexion conserve progrès, choix et récompenses. Une partie déjà engagée avant le patch ne reçoit pas de contrats rétroactifs ; son état reste intact. La récompense est journalisée dans le rapport.

`DriftInventory.vue` remplace la navigation sélection/fiche/retour par des cartes portant directement l’effet et **Équiper / Retirer**. Les cinq bonus actifs restent résumés en haut ; recherche et détails facultatifs restent disponibles. À pleine capacité, choisir le Drift à remplacer se fait sur la même carte. Une nouvelle rareté d’une famille déjà équipée peut remplacer directement la version active. `drift:replace` valide la propriété, la capacité et l’unicité de famille puis remplace l’emplacement en une seule mutation ; aucun état intermédiaire avec quatre bonus ni sixième emplacement. Une modification annule toujours le statut prêt. Vente en boutique et suppression confirmée sont repliées dans « Détails et gestion ». Boutons de 44 px minimum, onglets repliables sur plusieurs lignes, erreurs visibles et commandes désactivées pendant l’acquittement. Le carnet est conservé pendant un apprentissage déclenché par un contrat, pour revenir au même onglet.

Quatre **PNJ d’expédition supplémentaires**, définis dans `expedition_trainers.json`, sont ajoutés à un magasin de PNJ propre aux expéditions : Lina au village (Fouinette N.5), Noé Route 1 (Hoothoot/Wattouat N.8), Inès Route 2 (Nénupiot/Machoc N.12), Malo Ville du Lac (Lixy/Balignon N.15). L’Aventure conserve ses PNJ existants. Aucun Tiled, PNG de carte, transition ni dialogue d’histoire n’est modifié. Cases de pied et de tête libres, non transitoires, sans nouveau cloisonnement des chemins. Un repère « Défi · N. … » distingue ces rivaux. Parler ouvre une fenêtre avec l’équipe exacte, le niveau, la règle de K.O. et **Défier / Plus tard** ; fermer n’engage aucun combat. La confirmation conserve l’autorisation de proximité du serveur et expire comme un dialogue. Chaque dresseur donne les récompenses ordinaires une seule fois par joueur et expédition ; l’adversaire est recréé avec les mêmes espèces et niveaux après une fuite, sans répétition de la prime d’un défi déjà gagné. Le carnet indique où les trouver.

L’analyse du départ révèle le cumul de sauvages N.5–7 contre un starter N.5 et d’attaques multiples choisies selon leur seule puissance par coup. `openingBalance.js` ajuste **les nouveaux sauvages d’expédition seulement** : village N.3–5, Route 1 N.6–9 ; autres niveaux de carte conservés. Jusqu’au N.14, le choix d’attaques offensives exclut les multi-coups, attaques de série et quelques mouvements inutilisables au premier tour ; puissance plafonnée à 40 jusqu’au N.6, 45 jusqu’au N.10 puis 55. Les nouveaux novices utilisent le même filtre. Les starters, Pokémon déjà possédés, génération des adversaires Colosseum, talents, formule partagée de dégâts et duel PVP restent inchangés. Les critiques et faiblesses de type peuvent toujours être dangereux ; aucune invulnérabilité ni survie artificielle ajoutée.

Mesure reproductible : `node scripts/auditExpeditionOpening.js` compare chaque espèce du village aux 49 starters N.5, en testant ses attaques initiales avec un tirage fixe sans critique. Sur **588 paires**, le nombre de configurations pouvant mettre K.O. en une attaque passe de **85 à 1** ; part moyenne des PV retirée par le coup le plus dangereux de chaque paire : **55,7 % → 35,9 %**. Ce sont des confrontations contrôlées au niveau maximum du village (7 avant, 5 après), pas une probabilité de rencontre ni une preuve d’équilibre de toutes les parties.

Vérifications : `node --test tests/expedition-contracts.test.js tests/encounter-variety.test.js` couvre gains réels, doublons, espèces/combattants distincts, K.O., récompenses, propriété, échéance, checkpoint, remplacement atomique, PNJ et accessibilité. `test:contracts-browser` réalise les trois contrats, leurs choix, un défi PNJ confirmé, l’équipement/remplacement de Drifts et la reconnexion via les vrais événements Socket, sur quatre formats dont 320 px et paysage. Cette recette rejoint la CI ; `validateDriftRun.js` est adapté aux actions directes. Publication après `verify:release -- --mysql`, les recettes de publication/stratégie/Colosseum et une vérification HTTPS. Aucun changement SQL, de format de classement ou de service voisin.

Publication le 16 octobre à 20 h 33 UTC : **370 tests applicatifs actifs et 38 SQL réussis**, audits, HTTP/reprise, lint et build ; recettes navigateur contrats, publication, stratégie et Colosseum réussies. Build `/tmp/explorakit-contracts-dist`, hash `749185d5f30ee143`. Sauvegardes sources/client/dist/SQL/checkpoint dans `/home/ubuntu/dev/backups/explorakit-contracts-2026-10-16T20-30-39-005Z`, checkpoint rafraîchi avant publication ; aucune partie active aux deux précontrôles. Seul `explorakit.service` redémarré, HTTP 200, service actif sans redémarrage en boucle. Recette HTTPS sur compte temporaire : trois contrats à 320/393 px, identifiants conservés après rechargement, déplacement réel jusqu’à Lina, aperçu de son équipe et refus sans combat ; aucune erreur navigateur, compte supprimé ensuite. Réponses et empreintes HTML de Know et api-test inchangées. Captures et logs sous `/tmp/explorakit-contracts-*`. La CI exécute désormais huit recettes navigateur ; leur résultat distant reste à consulter sur le commit publié.

Contrôle distant : les deux premières tentatives GitHub échouent sur une sauvegarde Socket Aventure/Centre, alors que les 38 tests SQL passent à nouveau localement. Les recettes conservent désormais le message serveur et ses erreurs dans le diagnostic de refus ; aucune assertion n’est retirée et aucun échec n’est ignoré. Investigation de la différence MySQL CI/MariaDB locale en cours.

## Colosseum : rééquilibrage de l’XP et prix des Balls — 16 octobre 2026

Le gain du combattant en **Colosseum 30/60**, en exploration comme dans l’arène, baisse de **20 %** : ×6 → **×4,8** du gain Aventure équivalent. Les bonus de Drifts et l’ajustement au niveau sont calculés comme auparavant ; le résultat est arrondi à l’entier inférieur. L’XP déjà acquise n’est pas retirée. Chaque réserviste vivant reçoit désormais **40 % du nouveau gain du combattant**, au lieu de 30 %, sans division entre équipiers et sans prélèvement au combattant. Le « +10 % » est interprété comme **+10 points de partage**, choix explicitement confirmé par l’utilisateur ; ce n’est pas une hausse relative de 10 % du montant précédent. Exemple sans Drift : ancien gain principal 1 000/réserve 300 → nouveau gain principal 800/réserve 320. Entraînement collectif ajoute toujours son pourcentage à cette part ; les K.O., y compris protégés par talisman, ne gagnent pas d’XP. Rift ×2 et Aventure restent inchangés. Le client explique les taux actuels et le bilan garde les gains individuels.

Les trois Balls coûtent **25 % de moins dans le catalogue commun** (Aventure, Rift et Colosseum) : Poké Ball **200 → 150 ₽**, Super Ball **600 → 450 ₽**, Hyper Ball **1 200 → 900 ₽**. L’achat est débité au tarif affiché par le serveur ; probabilités de capture, stock initial, revenus sauvages, prix des soins/objets et revente des Drifts restent identiques. À niveau 5, une victoire/capture sauvage rapporte 30 ₽ hors bonus : la Poké Ball demande maintenant cinq récompenses au lieu de sept environ. Aucun changement de carte, de schéma SQL ou de classement ; les parties existantes utilisent les nouveaux taux aux prochains gains/achats.

Pistes examinées dans le code, **non implémentées dans ce correctif** : les six premières équipes du Colosseum sont fixes (`OPENING_TEAMS`), le premier choix de récompense arrive au défi 10, et l’exploration reprend les mêmes rencontres par carte. La progression favorise donc encore un combattant très entraîné et des équipiers passifs. Priorités proposées : (1) donner dès le départ un choix de trois Drifts de force comparable pour orienter la composition ; (2) offrir deux ou trois contrats facultatifs pendant la préparation, par exemple gagner avec deux combattants distincts, avec récompense choisie entre entraînement de réserve, objet stratégique ou rencontre ciblée, sans bonus de score ; (3) varier les premières équipes par rotation commune du jour, en conservant l’annonce du prochain gardien déjà disponible pendant la préparation ; (4) proposer entre des paliers un choix risque/récompense, avec adversaire annoncé, pour décider du parcours au lieu de seulement enchaîner. Conserver une opposition indépendante de l’équipe du joueur, des offres sauvegardées non relançables par reconnexion, et vérifier l’équité des classements avant toute mise en œuvre. Une option de départ anticipé vers l’arène est aussi à tester pour les équipes prêtes, sans XP ni points gratuits pour le temps abandonné. Mesurer en parties humaines le délai du premier choix, la diversité des Pokémon réellement utilisés et les abandons avant l’arène ; les tests automatisés ne mesurent pas le plaisir de jeu.

Vérification reproductible : `node --test tests/rift-experience.test.js tests/expedition-strategy.test.js` couvre gains exacts pour trois sources de combat, deux formats, Drifts, réserves multiples/K.O., doublons et achats au nouveau prix avec reprise de checkpoint. Le test SQL d’achat Aventure vérifie le débit réel et le refus sans solde. Exécuter `VUE_APP_PUBLIC_PATH=/explorakit/ RELEASE_DIST_DIR=BUILD_OUTPUT npm run verify:release -- --mysql`, puis `test:release-browser`, `test:colosseum-browser` (règles, XP réelle/bilan/reconnexion) et `test:strategy-browser` (achat des trois Balls par les commandes de la boutique).

Publication le 16 octobre à 20 h UTC : **362 tests applicatifs actifs et 38 SQL réussis**, audits, HTTP/reprise, lint et build ; recettes navigateur de publication, stratégie et Colosseum réussies. Build `/tmp/explorakit-team-balance-dist`, hash `2f678edd281bc2c3`. Sauvegardes sources/client/dist/SQL/checkpoint dans `/home/ubuntu/dev/backups/explorakit-team-balance-2026-10-16T19-56-31-856Z`, checkpoint rafraîchi avant redémarrage ; aucune partie active au précontrôle. Seul `explorakit.service` redémarré, HTTP 200, aucun redémarrage en boucle. Recette HTTPS sur compte temporaire : règles des deux formats, pas de débordement à 320 px, achat réel des trois Balls, solde SQL et rechargement corrects, aucune erreur navigateur ; compte supprimé ensuite. Les réponses et empreintes HTML de Know et api-test restent identiques. Captures et logs sous `/tmp/explorakit-team-balance-*`.

## Talents de combat et sprite mobile — 16 octobre 2026

L’audit précédent ne validait que les noms et les quatre premières familles (125 talents) ; il ne prouvait pas le fonctionnement des 223 talents référencés. Le moteur partagé Aventure/Rift/Colosseum reçoit les réactions au contact, aux dégâts et aux K.O., les effets de fin de tour, PP/objets, contraintes d’action et formes temporaires. `abilityReactions.js`, `abilityForms.js` et `abilityCoverage.js` séparent ces responsabilités. La classification actuelle est **213 talents avec règles de combat simple**, **8 effets réservés aux doubles** (Batterie, Garde Amie, Cœur Soin, Minus, Plus, Receveur, Symbiose, Télépathe) et **2 effets hors combat non livrés** (Cherche Miel, Lumiattirance). Aucun mode double n’est ajouté. Les limites sont signalées dans la fiche ; Multitype et Système Alpha nécessitent des Plaques/ROM qui ne sont pas encore proposés dans l’inventaire. Cette classification décrit les déclencheurs pris en charge, pas une certification de parité exhaustive avec un simulateur officiel.

Les principaux raccordements comprennent Statik/Corps Ardent/Point Poison/Pose Spore, Peau Dure/Épine de Fer/Boom Final/Expuls’Organes, Momie, Armurouillée/Endurance/Cran/Colérique/Boost Chimère/Impudence/Animacœur, Pression, Absentéisme, Turbo, Soin Poison, Mue, Mauvais Rêve, Lunatique, Récolte et Ramassage. Les variations de statistiques, Synchronise, Corrosion, Miroir Magik, Aroma-Voile, Sérénité, Écran Poudre, Multi-Coups, Infiltration, Querelleur et les pièges de talents ont désormais des conséquences dans le moteur et ses orchestrateurs. Les objets transférés gardent leur propriétaire et leur état de consommation ; un objet récupéré ne peut pas être recyclé deux fois. Les conditions de sexe, contact, santé, météo, type de coup et protection sont prises en compte. Les règles existantes de mort définitive/talisman restent utilisées par les pertes de PV.

Corrections des familles existantes : Brise Moule traverse les multiplicateurs défensifs et les immunités concernées sans supprimer la protection du terrain ; Calque déclenche aussi le talent d’entrée copié ; Imposteur copie temporairement le talent ; météo supprimée par Ciel Gris/Air Lock, Garde Magik sur dégâts indirects, Fermeté limitée aux coups directs, soins refusés sur un K.O. ou sous Anti-Soin, ralentissement de paralysie annulé par Pied Véloce. Les boosts d’une première entrée ne sont pas confondus avec un remplacement pour Filature/Turbo. Les tableaux de PP n’avancent pas pendant le tour d’Absentéisme. Les talents permanents, objets et formes sont restaurés à la sortie du combat.

Les effets secondaires nécessaires à Sérénité/Écran Poudre/Sans Limite, les drainages nécessaires à Suintement, les indicateurs de réflexion/danse, multi-coups et masses sont exportés hors ligne dans `ability_move_traits.gen7.json`. Régénération : installer **`@pkmn/dex@0.10.11` dans un dossier séparé**, puis `ABILITY_DEX_PATH=/chemin/node_modules/@pkmn/dex node scripts/generateAbilityTraits.js`. Le serveur n’ajoute aucune dépendance au simulateur. Référence des règles : [Pokémon Showdown, talents](https://github.com/smogon/pokemon-showdown/blob/master/data/abilities.ts) et [ajustements génération 7](https://github.com/smogon/pokemon-showdown/blob/master/data/mods/gen7/abilities.ts), via la version épinglée du paquet. **23 attaques Vol enregistrées par erreur comme Combat** sont corrigées dans `moves.json`, ce qui rétablit notamment leur STAB et Ailes Bourrasque. Les secondaires sont résolus après un vrai coup, sans les appliquer à travers un clone, une immunité ou un talent qui les bloque.

Fantômasque, Déclic Tactique, Banc, Bouclier-Carcan, Mode Transe, Rassemblement et Synergie ont un état de combat temporaire, conservé au checkpoint ; les espèces, XP et sauvegardes d’évolution ne sont pas réécrites. Les formes utilisent leurs statistiques et types propres ; les 14 sprites avant/arrière ajoutés ont leur provenance dans `ability-form-sprite-sources.json`. Une forme Fantômasque brisée ne se réarme pas lors d’un simple changement. Illusion affiche le dernier équipier vivant et se dissipe après un coup direct ; l’estimation de l’IA Colosseum utilise l’apparence visible. Les formes de Rassemblement retrouvent leurs PV max de base en fin de combat, sans ressusciter un K.O. Aucun fichier de carte/Tiled modifié, aucune migration SQL.

Sur mobile, la **base opaque** du sprite du joueur est alignée sur le bas du terrain, dans les trois modes et les deux orientations. La taille augmente d’environ 20 % (portrait : 32 vw, borné à 96–132 px ; paysage : 106 px). Le cadrage utilise toujours les pixels opaques, sans modifier les PNG. Cela élimine la bande de décor visible sous la coupe droite des sprites de dos, notamment Fantominus, tout en gardant les fiches et commandes dégagées. La recette mesure la base à moins de 1 px du bord et tolère seulement 0,05 px d’arrondi entre les rectangles adjacents de Chromium ; elle ne masque aucun chevauchement réel.

Vérifications reproductibles : `node --test tests/ability-reactions.test.js tests/ability-system.test.js`, `npm run audit:abilities`, puis `VUE_APP_PUBLIC_PATH=/explorakit/ RELEASE_DIST_DIR=BUILD_OUTPUT npm run verify:release -- --mysql`. `test:abilities-browser` utilise de vrais combats Socket sur base de test : Fantominus/Lévitation contre Séisme, Peau Dure au contact, forme d’Exagide et reconnexion/checkpoint. Le scénario est intégré à la CI. `test:release-browser` et `test:colosseum-browser` contrôlent sept formats tactiles, plusieurs silhouettes dont Fantominus, les effets, les cibles de capture et les commandes. Les règles de talents ont un impact sur l’équilibrage ; les parties existantes sont conservées et les classements ne sont pas recalculés.

Publication le 16 octobre à 16 h 49 UTC : **359 tests applicatifs actifs et 38 SQL réussis**, audits, HTTP/reprise, lint et build ; sept recettes navigateur réussies (publication, talents, évolutions, stratégie, Colosseum, communauté, PWA). Build temporaire `/tmp/explorakit-talents-dist`, hash `5a037715e6adba80`. Sauvegardes sources/client/dist/SQL/checkpoint dans `/home/ubuntu/dev/backups/explorakit-talents-2026-10-16T16-46-46-066Z`, checkpoint rafraîchi avant redémarrage ; aucune partie active au précontrôle. Client publié depuis le build, seul `explorakit.service` redémarré, HTTP 200 et aucun redémarrage en boucle. Recette HTTPS sur compte jetable : fiche avertissant de Cherche Miel indisponible, cadrage Fantominus à 393 et 320 px, 14 sprites de formes servis, aucune erreur navigateur. Compte ensuite supprimé, réponses et empreintes HTML de Know et api-test inchangées. Les captures sont dans `/tmp/explorakit-talents-*` ; une recette humaine sur téléphone physique reste utile.

## Évolutions par espèce dans les trois modes — 16 octobre 2026

Les évolutions hors pierres ne tirent plus une chance commune de 8 % au niveau 30 ou 4 % au niveau 55. `evolutions.json` décrit **342 branches** entre formes de base des espèces 1–809, générées depuis les CSV PokeAPI épinglés à la révision du catalogue de pierres. `python3 scripts/generateEvolutions.py [dossier_csv]` les régénère. Les niveaux propres aux espèces, le sexe, les capacités connues, le type de capacité et la comparaison des statistiques permanentes sont pris en compte. Exemples : Salamèche 16 → Reptincel 36 → Dracaufeu, Chenipan 7 → Chrysacier 10 → Papilusion, Magicarpe 20 → Léviator. Le moteur est commun à **Aventure, Rift et Colosseum 30/60**, y compris les réservistes recevant de l’XP.

L’utilisateur a choisi explicitement des **adaptations accessibles en solo** pour les conditions spéciales. Un échange devient un seuil de niveau : au moins 36, ou 40 avec objet/partenaire particulier, et au moins dix niveaux au-dessus du seuil d’obtention de la forme précédente quand celui-ci existe. Bonheur/affection : niveau 20 par défaut ; adaptations Azurill → Marill 12, Golbat → Nostenfer 32, Leveinard → Leuphorie 30, Couverdure → Manternel 30, Type:0 → Silvallié 40. Beauté de Barpau : 30. Objets tenus d’évolution : 40, sauf Ptiravi → Leveinard 20. Conditions d’équipe : niveau 32 ; jour/nuit, pluie et retournement du téléphone ne sont pas exigés. Les capacités connues restent nécessaires (dont Pouvoir Antique, Mimique et une capacité Fée pour Nymphali). Meltan → Melmetal : 40. Ningale offre un **choix entre Ninjask et Munja** au niveau 20, sans créer de doublon. Mistigrix utilise la forme visuelle disponible pour les deux sexes. Ces adaptations sont indiquées dans chaque fiche ; elles ne prétendent pas reproduire toutes les mécaniques des jeux officiels.

Une branche unique évolue automatiquement avec un gain d’XP, dès que ses conditions sont remplies. Les niveaux traversés sont traités dans l’ordre, avec apprentissages de chaque forme intermédiaire ; plusieurs seuils franchis ne sautent pas les étapes. Les Pokémon déjà au-dessus du seuil peuvent rattraper leur évolution avec le prochain gain positif d’XP ou via **Équipe → fiche → Évolution**. Aucune transformation lors d’une simple lecture de sauvegarde. Pour une espèce à plusieurs branches, y compris une alternative par pierre, le joueur choisit dans la fiche ; il peut conserver sa forme actuelle en attendant une autre possibilité. Chenipotte garde une branche fixée par son UUID, Debugant par ses statistiques, Cheniti par son sexe. Les 45 branches par pierre restent séparées : ni gain d’XP ni commande d’évolution ordinaire ne les contournent.

La fiche affiche conditions, règles adaptées et boutons autorisés, avec contrôle serveur de l’espèce de départ, de la cible, de la propriété et des conditions. Un K.O., un combat actif ou une phase de jeu incompatible interdit la commande. Les demandes répétées ne déclenchent pas une autre étape. En Aventure, verrou utilisateur/Pokémon et écriture SQL atomique ; synchronisation du Pokédex pour le choix manuel. En expédition, checkpoint avant acquittement et rapport actualisé. Les choix ne nécessitent pas de colonne supplémentaire : ils sont dérivés de l’état sauvegardé. Les surnoms, UUID, IV/EV, attaques/PP, objets et altérations sont conservés ; les blessures aussi, avec au moins 1 PV pour un Pokémon vivant si sa nouvelle forme a moins de PV max. Les K.O. restent K.O. Le talent de la nouvelle espèce reste correct après restauration d’un effet temporaire de combat.

Migration additive **017_evolution_experience.sql** : `pokemons.experience_rate`, nullable pour les anciennes lignes. Une évolution conserve la courbe d’XP déjà suivie par le Pokémon, son XP et son niveau, puis la persiste. Cela corrige notamment les incohérences de catalogue des familles Marill, Gloupti et Carvanha qui pouvaient changer de niveau à la relecture après évolution. Les lignes antérieures sans valeur gardent leur courbe actuelle ; aucune XP ni espèce existante n’est convertie en masse. Sauvegarder la base, appliquer cette migration puis recharger le serveur avant publication du client. Les bonus d’XP Rift ×2 et Colosseum ×6/partage 30 % ne changent pas.

Le catalogue contenait deux Pikachu au lieu de Sabelette n°27 : l’entrée manquante est restaurée à partir des CSV PokeAPI `pokemon_species_names.csv` et `pokemon_stats.csv` à la même révision, sans toucher au vrai Pikachu ni aux sauvegardes. **260 sprites avant/arrière manquants** des cibles sont ajoutés, avec URLs et révision dans `src/assets/evolution-sprite-sources.json`. Aucun fichier de carte/Tiled modifié, aucune nouvelle forme régionale ou évolution au-delà du n°809.

Vérifications : `node --test tests/evolution.test.js tests/consumable-socket.test.js` couvre seuils, anciens compagnons, sauts de niveaux, apprentissages, branches, pierres exclues, conditions spéciales, K.O., données/sprites, conservation des ressources et commandes Socket des trois formats. Les tests SQL de `release-features-mysql.test.js` couvrent concurrence, propriété, Pokédex, ancien schéma logique, courbes d’XP et reconnexion. Exécuter `VUE_APP_PUBLIC_PATH=/explorakit/ RELEASE_DIST_DIR=BUILD_OUTPUT npm run verify:release -- --mysql`, puis la nouvelle recette `test:evolution-browser` (choix Aventure, rattrapage, quatre écrans, SQL/rechargement, évolution réelle du combattant et de sa réserve en Colosseum, checkpoint et isolement Aventure), et les autres recettes navigateur de publication. Le scénario est intégré à la CI. La recette Colosseum diffère explicitement l’apprentissage proposé après reconnexion, via le bouton « Plus tard », avant de poursuivre le parcours. Les seuils adaptés et la progression plus prévisible restent à éprouver en parties humaines ; les classements historiques ne sont pas recalculés.

Publication du 16 octobre, 16 h 08 UTC : validation complète réussie (**328 tests applicatifs actifs, 38 SQL**, audits, HTTP/recovery, lint et build), puis six recettes navigateur réussies (publication, évolutions, stratégie, Colosseum, communauté, PWA). Build temporaire `/tmp/explorakit-evolution-dist`, hash `4d98b47c0d5dc3ca`. Sauvegardes sources, client, dist, SQL et checkpoint dans `/home/ubuntu/dev/backups/explorakit-evolution-2026-10-16T16-01-28-804Z`, SQL rafraîchi avant migration. Migration 017 appliquée et `db:verify` validé ; redémarrage contrôlé d’`explorakit.service`, partie active conservée au checkpoint. Recette publique sur compte jetable : Évoli → Noctali, Carvanha → Sharpedo, conservation des blessures/objet/XP/niveau/courbe après rechargement, sprites disponibles, aucun débordement à 320 px ni erreur navigateur. Compte supprimé après contrôle. Pages Know et api-test vérifiées inchangées ; aucun fichier de carte modifié.

## Rift et Colosseum : préparation stratégique — 16 octobre 2026

Les nouvelles expéditions Rift et Colosseum 30/60 commencent par **trois Pokémon de base distincts**, hors légendaires, tirés par le serveur dans le vivier de starters existant. Chaque joueur choisit son compagnon de niveau 5 ; son offre est privée et conservée au checkpoint. Après 45 secondes, le premier choix est retenu pour les absents. Le chrono complet d’exploration commence lorsque tout le monde a choisi, ou à cette échéance. Un abandon pendant la sélection ne crée ni temps d’exploration ni pièces. Les expéditions existantes ne repassent pas par cette sélection.

Les boutiques existantes proposent quatre onglets, sans nouveau bâtiment ni changement de carte : fournitures, objets tenus, **lapidaire** et **marchand de Drifts**. Dix pierres couvrent 45 branches d’évolution des formes de base parmi les espèces 1–809, avec les conditions de sexe pour Kirlia et Stalgamin. Le sac montre les compagnons compatibles et l’espèce obtenue. L’évolution conserve identité, niveau, XP, IV, capacités, PP, objet et blessures ; elle consomme une pierre, hors combat. Les branches par pierre ne se déclenchent plus par montée de niveau pour les Pokémon créés dans ces modes. Les autres méthodes d’évolution ne sont pas refondues. Données hors ligne reproductibles : `python3 scripts/generateStoneEvolutions.py [dossier_csv]`, révision PokeAPI inscrite au catalogue. Les sprites manquants des cibles sont fournis avec leur provenance dans `src/assets/stone-evolution-sprite-sources.json` du client.

**Talisman de sauvegarde**, 1 200 ₽ : tenu, consommé lors du K.O., il évite la suppression définitive du compagnon. Celui-ci reste à 0 PV, ne combat plus et ne reçoit plus d’XP. Un soin hors combat (y compris potion), ou le soin entre deux rounds, le remet en état. Cette interprétation a été annoncée pendant le développement ; aucune résurrection immédiate. Si tout le groupe est K.O. protégé pendant l’exploration, il faut rejoindre un soin ou utiliser le sac avant de combattre. Perdre un défi du Colosseum ou un match du tournoi termine toujours la tentative. Le talisman ne peut pas être échangé en combat ni recyclé ; Embargo, Zone Magique et Maladresse désactivent les objets tenus.

Les Restes et baies existants sont rejoints par Orbe Vie, Bandeau/Lunettes/Mouchoir Choix, Ceinture Force, Veste de Combat, Évoluroc, Ceinture Pro, Grelot Coque et Casque Brut. Les effets sont appliqués dans le moteur partagé : modificateurs de statistiques/dégâts, verrou d’attaque, restrictions de statut, survie à 1 PV, recul/soin et contact. Une consommation après échange d’objet reste consommée pour son propriétaire initial à la fin du combat ; Recyclage conserve la provenance et les checkpoints sérialisent cette relation sans référence circulaire dans les événements publics. Une victoire sauvage a **12 %** de chances de donner un objet tenu classique (baies/Restes inclus), augmenté par le Drift de butin ; captures, fuites et défaites n’ajoutent pas ce tirage. Le talisman reste un achat. Ces nouveaux achats et butins sont réservés aux expéditions ; la boutique Aventure garde son catalogue.

Le marchand tire **six Drifts distincts par session** : un commun, deux rares, deux épiques, un légendaire. Tous les participants voient la même sélection, chacun possède un stock indépendant d’un exemplaire par offre. Prix : 200 / 480 / 1 200 / 3 200 ₽ selon rareté. Achat, vente et échange nécessitent d’être dans une boutique, hors combat, pendant l’exploration. Trois Drifts non équipés peuvent être échangés contre un aléatoire, au moins de la rareté la plus faible du trio, avec 20 % de chances de gagner un cran (plafond mythique). La vente conserve les tarifs existants et le bonus du Drift Marchand. Offre, stock consommé, portefeuille et inventaire sont sauvegardés ensemble ; prix, identités, phase, propriété et répétitions sont vérifiés côté serveur.

La présentation des combats met en file les attaques, retours de dégâts, états de PV et XP avant le bilan. Les actions du joueur attendent la fin de cette présentation ; arrière-plan, mouvement réduit, déconnexion et nouveau combat interrompent correctement les temporisations. Le même composant dessert Aventure, Rift et Colosseum. Les échanges Socket restent additifs ; le serveur Rift publie désormais les PV après chaque action et les indices de capacités autorisées pour les objets Choix/Veste. Les règles de vitesse/priorité et les délais serveur ne sont pas remplacés par les animations.

Vérifications reproductibles : `node --test tests/expedition-strategy.test.js tests/battle-presentation.test.js`, puis `VUE_APP_PUBLIC_PATH=/explorakit/ RELEASE_DIST_DIR=BUILD_OUTPUT npm run verify:release -- --mysql`. La nouvelle recette `test:strategy-browser`, ajoutée à la CI, utilise une base dédiée : quatre dimensions, choix/reconnexion, achat/épuisement, échange/vente, évolution effective de Pikachu, équipement du talisman, ordre réel des animations, K.O. protégé puis potion et checkpoint. Les fixtures accélérées historiques choisissent explicitement leur ancienne préparation immédiate ; les tests de publication en processus réel sélectionnent désormais un starter par Socket. Compléter avec les recettes publication, Colosseum, communauté et PWA. Aucune migration SQL, changement de carte ou remise à zéro des classements. L’économie (prix, chance de butin, échange) reste à affiner sur des parties humaines.

Validation et livraison : **319 tests applicatifs actifs, 37 tests SQL**, audits, HTTP, reprise après arrêt, lint et compilation réussis. Les cinq recettes navigateur (publication, stratégie, Colosseum, communauté, PWA) passent. Sources précédentes, build et checkpoint sauvegardés dans un dossier privé ; aucun Rift actif au précontrôle. Build publié sous `/explorakit/`, anciennes ressources conservées, service rechargé. Recette HTTPS sur compte temporaire : trois choix, offre stable après rechargement, compagnon choisi et chrono complet persistants, sprites disponibles, abandon puis suppression du compte. Les autres projets conservent leurs réponses et empreintes HTML. Client publié avant le dépôt serveur qui le référence.

## Colosseum : XP augmentée de 200 % et partage de réserve — 15 octobre 2026

Les formats **30 et 60 minutes** accordent **+200 % par rapport au gain Colosseum précédent**, soit trois fois ce gain : le multiplicateur de mode passe de ×2 à **×6**. La règle vaut pour les prochaines récompenses de combat, en exploration et dans l’arène, y compris dans les expéditions déjà engagées. Le type de combat, l’ajustement au niveau et les bonus d’XP des Drifts restent appliqués avant ce multiplicateur. Le Rift conserve ×2 et l’Aventure son gain ordinaire ; aucune XP rétroactive ni changement du score/classement.

Chaque Pokémon **vivant en réserve** reçoit **30 % du gain du combattant**, arrondi à l’entier inférieur, sans retrancher d’XP à celui-ci et sans division par le nombre de réservistes. Le pourcentage du Drift **Entraînement collectif** s’ajoute aux 30 % (exemple : rare +10 % = 40 % par réserviste). Un K.O. est récompensé une seule fois, les compagnons perdus sont exclus, et les montées de niveau/apprentissages de la réserve passent par la progression existante. Les gains et offres d’apprentissage restent dans le checkpoint. La page Colosseum explique les nouveaux taux ; le bilan existant affiche les gains individuels. Les captures gardent leurs récompenses actuelles.

Vérifications reproductibles : `node --test tests/rift-experience.test.js tests/colosseum.test.js` couvre les trois types de combat, les deux formats avec/sans Drifts, plusieurs réservistes, K.O., doublons, progression/apprentissages et reprise de checkpoint. Les fixtures utilisent le vrai mode `colosseum` et une durée séparée, au lieu d’anciens noms fictifs `colosseum-30/60`. Exécuter ensuite `VUE_APP_PUBLIC_PATH=/explorakit/ RELEASE_DIST_DIR=BUILD_OUTPUT npm run verify:release -- --mysql`, puis `test:release-browser` et `test:colosseum-browser` avec ce build. La recette Colosseum vérifie aussi les deux gains affichés et leur conservation à la reconnexion. Pas de migration SQL ni modification des cartes.

Validation locale : **300 tests applicatifs actifs, 37 tests SQL**, audits, reprise, lint et build réussis. Les recettes navigateur de publication et Colosseum passent ; le bilan montre les gains individuels exacts et la reconnexion les conserve. Sources, build précédent et checkpoint sauvegardés avant publication ; aucun Rift actif au précontrôle.

## Colosseum : gardiens, choix de palier et arène mobile — 15 octobre 2026

Les nouvelles expéditions utilisent les règles Colosseum **version 2**. Les formats 30/60 minutes, starters, XP, K.O. définitifs, soins des survivants, niveaux, potentiel, six paliers d’IA et formule de points sont conservés. Six gardiens reviennent aux défis 10/20/30/40/50/60 puis cyclent : Rempart (Roche/Sol/Acier), Canopée (Plante/Poison), Courant (Eau/Électrik), Fournaise (Feu/Vol), Mirage (Psy/Spectre), Couronne (Dragon/Acier). Leurs espèces sont fixes, sans adaptation à l’équipe du joueur ; pas de météo ni de bonus caché ajouté. À partir du défi 25, les défis ordinaires tournent sur 18 espèces d’élite au lieu des mêmes six. Les six premières équipes restent inchangées.

Une victoire sur un gardien propose **un Drift parmi trois**, épique aux paliers 10/20, légendaire ensuite. Il rejoint l’inventaire, sans équipement automatique ni résurrection. Les cinq emplacements et l’interdiction d’équiper deux exemplaires d’une même famille restent appliqués. Le serveur fixe l’offre et sa rareté, exige son identifiant et un choix autorisé, puis consomme l’offre. `colosseum:reward` passe par le garde d’identité et la sauvegarde de checkpoint avant acquittement. Pas de nouveau défi tant que le choix reste en attente. Offre, choix et butin survivent aux reconnexions ; répétition, faux identifiant, autre rareté ou score envoyés par le client n’accordent aucun bonus supplémentaire.

Les anciennes expéditions sans version restent en version 1 : équipes et règles initiales jusqu’à leur fin. Aucune migration SQL ni remise à zéro des records ; les classements restent séparés par format. Les nouveaux choix et équipes modifient les possibilités tactiques : l’équilibrage de cette évolution devra être confirmé par des parcours humains, les records historiques ne sont pas recalculés.

Le carnet montre une piste de dix victoires, le prochain gardien, l’équipe adverse exacte, les conseils de spécialité, les points annoncés et des accès Équipe/Drifts. Les explications détaillées de l’IA sont repliables. Le choix de récompense remplace temporairement le bouton du combat suivant. Le résultat garde l’équipe finale, avec les pertes visibles.

Deux fonds originaux générés par l’outil intégré `image_gen`, optimisés en WebP portrait 960×1440 (~155 Kio) et paysage 1280×853 (~149 Kio), avec leurs prompts conservés dans `vue-explorakit/src/assets/battle/colosseum-mobile-v2.prompt.txt`. Ils sont réservés aux combats du Colosseum ; un élément `picture` choisit le décor selon l’orientation, sans étirement. Les sprites sont repositionnés sur le terrain ; le cadrage alpha est réinitialisé lors d’un changement de Pokémon/espèce, et l’arène attend sa calibration avant de montrer le sprite. Les faces haute résolution sont lissées ; les dos d’origine restent en pixel art. Le numéro du défi et le gardien restent affichés pendant le combat sans changer durant l’animation de fin. Aucune carte ni asset Tiled modifié.

Vérifications reproductibles : `node --test tests/colosseum.test.js tests/colosseum-ai.test.js tests/encounter-variety.test.js`, puis `VUE_APP_PUBLIC_PATH=/explorakit/ RELEASE_DIST_DIR=BUILD_OUTPUT npm run verify:release -- --mysql`. `test:colosseum-browser` couvre formats, aperçu et vrai combat de gardien, récompense unique via les boutons, reconnexion avant/après choix, classement et sauvegarde Aventure inchangée. Sa recette de combat mesure les silhouettes alpha, collisions avec les fiches/commandes, effets, cibles de capture et sons sur sept formats tactiles et bureau, ainsi que quatre paires de silhouettes larges/hautes avec le menu des attaques ouvert. Le harnais réactive explicitement l’émulation tactile Chromium à chaque changement de dimensions ; il diffère les offres d’apprentissage par le vrai bouton « Plus tard » avant de poursuivre le choix de récompense. Compléter par les recettes de publication, communauté et PWA. Le navigateur ne remplace pas une vérification sur téléphone physique.

Validation de livraison : 289 tests applicatifs actifs, 37 tests SQL, audits, reprise après arrêt, lint et compilation réussis. Les quatre recettes navigateur (publication, Colosseum, communauté, PWA) passent, avec des captures sous `/tmp/explorakit-colosseum-*`. Sources précédentes, build et checkpoint sauvegardés dans un dossier privé sous `backups/` avant publication. Le sous-module client est publié avant le commit serveur qui le référence. Les tentatives déjà engagées restent en version 1 lors du rechargement durable ; aucune migration ni modification des autres applications hébergées.

## Retours de combat et déplacements tactiles — 15 octobre 2026

Les messages **Critique, Super efficace, Résisté, Raté et Immunisé** sont désormais dessinés au-dessus des sprites, fiches et dégâts. Ils sont ancrés au-dessus de la silhouette visée quand l’espace le permet et restent bornés au terrain, y compris sur les petits écrans ; les deux messages d’un même coup restent lisibles ensemble. Le placement est partagé avec le bureau.

`battleAudio.js` synthétise des impacts et souffles courts selon la catégorie et le type de capacité, sans fichier à télécharger en combat. Le contexte audio est activé par les gestes utilisateur, dont le relâchement tactile, avant ou pendant le combat. Les sons de soutien, critique, soin et capture restent disponibles. Volume général, bouton muet, arrière-plan et destruction de l’écran coupent les voix actives ; aucune attaque ancienne n’est rejouée au déblocage. La musique est légèrement baissée pour laisser entendre les impacts. Le Rift/Colosseum transmet maintenant `damageClass` dans `battleMoveAnimation`, comme les orchestrateurs Aventure/PvP : cette information manquante faisait classer toutes ses animations comme des capacités de soutien. Champ additif compatible avec les anciens clients, règles de combat inchangées.

Les transitions du monde attendent le décodage du fond et de son premier plan avant leur publication ensemble. Pendant le chargement, le dernier cadre complet est conservé ; la caméra attend le joueur et sa position reçue du serveur. Les chargements dépassés ne remplacent pas une destination plus récente, les mouvements/PNJ d’une autre carte sont ignorés. Cache borné à six décors, échec réessayable depuis l’écran, aucune création ou modification des cartes et passages. L’écran initial n’affiche plus le village par défaut avant de connaître la sauvegarde réelle.

Sur mobile, glisser sur la carte déplace le personnage dans la direction du geste ; maintenir le doigt poursuit la marche et changer de direction ne nécessite pas de le lever. Le pavé accepte également un glissement continu entre ses flèches. Zone neutre de 12 px et stabilisation près des diagonales, un seul doigt pilote. Relâchement, annulation, perte de capture, menu/dialogue/combat, changement de carte, redimensionnement et arrière-plan arrêtent le mouvement. Boutons, clavier et collisions serveur sont conservés. Aucun défilement tactile du canvas pendant un déplacement ; les menus gardent leurs gestes habituels.

Vérifications reproductibles : `node --test tests/mobile-interactions.test.js tests/world-camera.test.js tests/drift-connection.test.js tests/drift-runtime.test.js`, puis `VUE_APP_PUBLIC_PATH=/explorakit/ RELEASE_DIST_DIR=BUILD_OUTPUT npm run verify:release -- --mysql`. `test:release-browser` inclut désormais des vrais événements tactiles de glissement, l’arrêt au menu, une image retardée et une arrivée hors ordre, les libellés de combat sur sept formats mobiles et bureau, ainsi qu’une mesure du signal du véritable AudioContext pour cinq familles de sons et le silence au volume zéro/muet. Les scénarios Colosseum, communauté et PWA complètent la vérification. L’émulation et la mesure de signal ne remplacent pas l’écoute et le ressenti sur un téléphone physique, notamment Safari.

Livraison : **285 tests actifs**, **37 tests SQL**, audits, HTTP, reprise, lint et compilation réussis ; recettes navigateur de publication et Colosseum réussies. Sources serveur/client, build précédent et checkpoint sauvegardés ; aucun Rift actif au précontrôle. Build publié sous `/explorakit/` en conservant les anciennes ressources, service rechargé pour le champ de catégorie, sans migration. Sur le site HTTPS, glissement réel vers la deuxième maison, chargement volontairement ralenti sans cadre blanc, sortie vers la position attendue et reconnexion vérifiés. Les libellés et le signal audio ont aussi été contrôlés sur la version publique ; compte temporaire supprimé. Les autres projets conservent leurs réponses et empreintes HTML. Client publié dans son dépôt, puis référencé par le dépôt serveur.

## Récompenses sauvages, capture et progression — 15 octobre 2026

Un Pokémon sauvage vaincu ou effectivement capturé rapporte maintenant **20 + 2 × son niveau**, plafonné à **120 Pokédollars hors bonus** : 30 au niveau 5, 50 au niveau 15. La règle commune est dans `wildReward.js`, appliquée en Aventure, Rift et exploration Colosseum 30/60. Le bilan montre la somme réellement créditée ; les rapports Rift la comptabilisent. Les bonus de récompense existants restent applicables, dont Fortune. Fuite, défaite, interruption, capture ratée ou relâchée faute de place ne rapportent rien. Les dresseurs gardent leur récompense de victoire ; les duels PvP et les pièces du compte restent indépendants.

En Aventure, le crédit SQL atomique du portefeuille est attendu avant l’émission du bilan, puis l’équipe est sauvegardée comme auparavant. En Rift, la garde de fin de combat évite un second crédit et le portefeuille fait partie du checkpoint existant. Pas de migration SQL ni de modification des équipes possédées.

La **Poké Ball** passe de 1 à **1,15** dans le catalogue partagé des objets : +15 % de chances relatives, pas +15 points garantis. Exemple sans bonus : 16 % → 18,4 % sur une cible de même niveau à pleine vie ; 48 % → 55,2 % à mi-vie. Super/Hyper Ball et plafond de 95 % inchangés.

Les niveaux configurés dans `nextMap.json` et `pnj_teams.json` suivent désormais `arrondi(5 + (niveau − 5) × 0,9)` au-dessus du niveau 5. Départ 5–7, Route 1 8–10, Route 2 11–15, dernière route 52–55 ; la progression sauvage totale passe de 5–60 à 5–55. Les dresseurs des cartes suivent la même réduction pour conserver leur cohérence avec les zones. Les vagues et paliers d’intelligence du Colosseum restent indépendants. Les Pokémon déjà possédés ou engagés dans un combat sauvegardé gardent leur niveau. Une comparaison structurée confirme que seules les valeurs de niveau changent : espèces, transitions, dialogues, capacités et cartes Tiled conservés.

Vérifications reproductibles : `node --test tests/exploration-balance.test.js tests/experience-balance.test.js tests/encounter-variety.test.js tests/drift-runtime.test.js tests/drift-report.test.js` (62 tests), puis `VUE_APP_PUBLIC_PATH=/explorakit/ RELEASE_DIST_DIR=BUILD_OUTPUT npm run verify:release -- --mysql` (281 tests actifs, 37 SQL, audits, HTTP, reprise, lint et build). Les captures effectives, le seuil amélioré, les gains persistés, échecs et équipe pleine sont couverts en SQL ; Rift/Colosseum couvrent victoire, capture, répétition et reprise de checkpoint sans double crédit. `test:colosseum-browser` utilise les vrais boutons mobiles pour capturer et vérifie la récompense affichée, le portefeuille et la reconnexion. Le scénario historique `validateDriftRun.js` attend maintenant la somme des gains de capture et de dresseur dans le rapport.

Livraison : les recettes navigateur de publication et Colosseum passent, dont la capture mobile affichant 30 Pokédollars. Sources précédentes, SQL et checkpoint sauvegardés ; aucun Rift actif au précontrôle. Serveur rechargé sans migration ni changement du client. Sur le site HTTPS, un compte temporaire a capturé un sauvage niveau 15 (+50) puis vaincu un niveau 14 (+48) sur la Route 2 ; total de 98 conservé après reconnexion, équipe capturée persistée, compte ensuite supprimé. Les autres projets conservent leurs réponses et empreintes HTML. Les choix d’équilibrage restent à éprouver sur des parties humaines.

## XP accélérée et apprentissage des attaques — 15 octobre 2026

Les gains d’XP du Rift et des deux formats Colosseum sont **doublés** après application du type de combat, de l’ajustement de niveau et des bonus de Drifts. Le partage d’expérience reçoit le même bonus ; un K.O. ne crédite toujours qu’une seule récompense et les Pokémon perdus ne reçoivent rien. L’Aventure conserve son multiplicateur ; les duels PvP ne créent pas de nouvelle source d’XP.

Le bilan de combat attend désormais la présentation de l’XP côté client. La barre bleue remplit les niveaux franchis puis affiche le reste ; le niveau et le gain sont lisibles pendant l’animation. Les actions sont suspendues pendant cette présentation. Les gains successifs sont mis en file, les passages très nombreux sont résumés pour limiter le délai, et les préférences de mouvement réduit sont respectées. Déconnexion, nouveau combat et destruction de l’écran annulent une ancienne présentation. Le serveur reste autoritaire et le chrono Rift continue.

Les trois modes proposent maintenant les nouvelles capacités aux niveaux d’apprentissage. Le catalogue hors ligne `level_up_moves.json` est généré depuis les CSV publics PokeAPI à la révision indiquée dans le fichier : Ultra-Soleil/Ultra-Lune, puis Let’s Go pour Meltan/Melmetal, uniquement les capacités présentes dans le moteur. `python3 scripts/generateLevelUpMoves.py` régénère ce catalogue et les données de comparaison du client ; un dossier de CSV local peut être passé en argument. Aucune requête externe pendant une partie. Les tables actuelles du jeu ne contenaient auparavant que des listes de capacités possibles, sans niveaux.

Après le bilan, le carnet propose d’apprendre une capacité dans une place libre, de remplacer une des quatre connues ou de refuser. **Plus tard** conserve le choix dans **Menu → Attaques à apprendre**. Les types, catégories, puissance, précision et PP permettent la comparaison. Les offres sont émises par le serveur, conservées dans l’ordre, sans doublons ni rattrapage automatique de tous les anciens niveaux. Une évolution peut proposer sa capacité d’évolution. L’apprentissage attend la fin du combat ; aucune cinquième capacité ni remplacement arbitraire par nom fourni par le client. Les PP des autres capacités sont conservés. Les Pokémon perdus en Rift perdent aussi leurs choix.

Migration additive **016_move_learning.sql** : colonne JSON nullable `pokemons.pending_moves`. Les anciens Pokémon commencent sans choix en attente. En Aventure, verrouillage du propriétaire et du Pokémon, résolution du premier identifiant d’offre et mise à jour atomique des quatre capacités, PP et choix restants ; en Rift, checkpoint avant acquittement. Remplacement, refus et reconnexion sont persistants. Le choix de différer est seulement une préférence de l’écran : les offres réapparaissent après reconnexion. Sauvegarder puis migrer avant de recharger le serveur.

Vérifications reproductibles : `node --test tests/move-learning.test.js tests/rift-experience.test.js tests/experience-playback.test.js tests/consumable-socket.test.js`, puis `VUE_APP_PUBLIC_PATH=/explorakit/ RELEASE_DIST_DIR=BUILD_OUTPUT npm run verify:release -- --mysql`. La recette `test:release-browser` observe réellement la barre avant le bilan, plusieurs remplissages et l’annulation d’un ancien bilan ; elle remplace/refuse/reprend les offres via Socket.IO et SQL, et vérifie le carnet sur trois formats mobiles. Les tests SQL couvrent les requêtes concurrentes, doublons et propriétaires. Les recettes Colosseum, communauté et PWA complètent la non-régression.

Livraison : 269 tests actifs et 36 tests SQL réussis, audits, HTTP, reprise après arrêt brutal, lint et build. Les quatre recettes navigateur passent. La première recette a révélé que l’Aventure ne rechargeait pas l’équipe à la connexion avant l’ouverture d’un menu ; le chargement au retour de session est désormais assuré et le parcours rejoué avec succès. Sources, build, SQL et checkpoint sauvegardés ; aucun Rift actif au précontrôle. Migration 016 appliquée et schéma vérifié, serveur rechargé puis build validé publié sous `/explorakit/`. La recette HTTPS publique a remplacé/refusé des attaques, rechargé la page et observé l’XP avant le bilan sur un compte temporaire, supprimé après contrôle. Les autres projets conservent leurs réponses et empreintes HTML. Client publié puis référencé dans le dépôt serveur. Équilibrage humain du gain doublé et rendu sur téléphone physique à confirmer.

## Rangs Rift et carnet social — 14 octobre 2026

Le **Carnet des dresseurs**, accessible depuis l’accueil et les salons, regroupe le profil, les amis, la recherche par début de pseudo et les classements. La DA papier/sauge et les badges Bronze, Argent, Or, Platine et Diamant s’adaptent au mobile. Les liens vers les profils des records Colosseum et le lien partagé vers `/profil/:id` fonctionnent après connexion. Depuis un salon actif, les liens sociaux ouvrent un autre onglet pour conserver sa connexion au jeu.

Le Rift multijoueur dispose d’un Elo indépendant des pièces et statistiques historiques. Départ à **1 000**, rang révélé après une première nouvelle expédition terminée : Bronze sous 1 200, Argent dès 1 200, Or 1 400, Platine 1 600, Diamant 1 800. Chaque résultat compare les places deux à deux avec la probabilité Elo classique (diviseur 400), puis moyenne les ajustements avec K=48. À Elo égal, un duel gagné rapporte 24 points. Les derniers tours atteints déterminent les places partagées ; les éliminés pendant l’exploration sont ex æquo derrière les participants du tournoi. Les abandons et déconnexions conservent leur résultat. L’ordre des éliminations et le temps passé à se cacher ne départagent pas les joueurs. Arrondi par plus grands restes ; plancher zéro, seul cas pouvant empêcher une somme strictement nulle. Toutes les expéditions multijoueur, publiques ou privées et quelle que soit leur durée, utilisent ce classement commun.

Les transactions de règlement enregistrent Elo, delta, place, historique et récompenses ensemble. Les participants proviennent du registre SQL du départ ; aucun client ne choisit sa cote. Verrouillage des cotes dans l’ordre des identifiants, tentatives après interblocage et reçu unique par partie/joueur empêchent les doubles crédits. Relecture après crash et rapport d’expédition exposent le delta final. Les parties déjà terminées ne sont pas recalculées et aucun ancien résultat n’est inventé pour initialiser les cotes.

Le Colosseum conserve ses classements et reçoit des rangs dérivés du meilleur score de chaque format : Bronze après une victoire, Argent 12 680, Or 56 600, Platine 132 200, Diamant 227 700 points (respectivement les scores cumulés des défis 10, 20, 30 et 40). Les rangs 30/60 et les équipes de record apparaissent sur le profil. Une moins bonne tentative ne fait pas perdre ce rang. Le classement Rift affiche les 50 premiers plus la position personnelle.

Les amitiés suivent une demande explicite : accepter/refuser côté destinataire, annuler côté émetteur, retirer une amitié côté membre. Deux demandes croisées n’acceptent pas silencieusement la relation. Une paire SQL canonique et le verrouillage des deux comptes empêchent les doublons concurrents. Limites : 50 demandes en attente, 200 contacts et demandes au total, mutations HTTP limitées à 20/minute par compte. La liste des amis et demandes est privée ; seuls les profils, rangs, statistiques de jeu, cosmétiques équipés et équipes de record sont consultables par les comptes authentifiés. Aucun e-mail, hachage, monnaie, inventaire, position, IV ou UUID Pokémon n’est exposé. Pas de présence en ligne, messagerie, matchmaking ou saison dans cette livraison.

Migration additive **015_ranks_friends.sql** : `rift_ratings`, `rift_rating_results`, `trainer_friendships`. Aucun écrasement de données ni migration destructive ; sauvegarder avant `db:migrate`. Le schéma neuf et `db:verify` sont adaptés aux 21 tables et 14 contraintes vérifiées. Les anciens clients tolèrent les champs ajoutés ; installer la migration avant de recharger le serveur, puis publier le build client.

Vérifications reproductibles : `VUE_APP_PUBLIC_PATH=/explorakit/ RELEASE_DIST_DIR=BUILD_OUTPUT npm run verify:release -- --mysql` (252 tests actifs, 35 SQL, audits, HTTP, reprise, lint/build). `tests/ranks.test.js` contrôle seuils, Elo, égalités, plancher et groupes de 2 à 16 ; `tests/trainers-mysql.test.js` couvre règlements concurrents/rejoués, reçu de reprise, isolement Aventure, consentement et permissions, demandes croisées, recherche échappée, suppression et DTO privés. `test:community-browser` vérifie quatre dimensions, trois classements, recherche, demande/acceptation sur deux sessions, retrait persistant et lien de profil après connexion. La CI exécute ce nouveau parcours. `test:release-browser` vérifie aussi le delta Elo et le rang après une expédition réellement terminée par Socket.IO.

Limites : les seuils et K sont des choix initiaux à évaluer sur des parties humaines ; le système ne prétend pas détecter la collusion ou les comptes secondaires. Le navigateur vérifie l’ergonomie tactile, pas un téléphone physique. Le harnais Colosseum attend désormais la connexion effective du joueur avant d’avancer son horloge artificielle d’une heure ; l’ancienne course pouvait simuler une absence de 90 secondes pendant le changement de page.

Livraison : sources, client, base SQL et checkpoint sauvegardés. Migration 015 appliquée et vérification des 21 tables/14 contraintes réussie ; aucun Rift actif avant le rechargement du serveur. Build validé installé sous `/explorakit/`, anciennes ressources conservées. Recette HTTPS publique sur mobile : recherche, profil, trois rangs, demande/acceptation/retrait d’ami et classement ; comptes temporaires supprimés. Les autres projets conservent leurs réponses et empreintes HTML. Client publié puis référencé dans le dépôt serveur.

## Intelligence progressive du Colosseum — 14 octobre 2026

L’IA gagne un palier tous les dix combats, dans les deux formats : Novice (1–10), Initié (11–20 : types et immunités), Tacticien (21–30 : dégâts estimés, précision et priorité), Stratège (31–40 : changements de Pokémon), Maître (41–50 : préparation, soins et altérations), Expert (51+ : projection bornée sur deux tours). Le palier, son comportement et le prochain seuil apparaissent avant le défi. Après le combat 51, l’intelligence reste au maximum implémenté ; le potentiel adverse continue de monter à chaque défi suivant la règle existante.

`server/game/drift/colosseumAI.js` isole les décisions et prépare les attaques légales des espèces à partir du combat 21, puis les capacités de soutien et objets tenus à partir du combat 41. Talents ordinaires et choix de capacités sont reproductibles par défi. Les niveaux, effectifs, premières espèces, points et records existants sont conservés. Aucun changement de carte ni de schéma SQL.

L’IA choisit son action avant de recevoir celle du joueur. Elle estime les statistiques à partir de l’espèce, du niveau et des PV visibles ; elle ne lit ni les IV/EV, ni les réserves, attaques non révélées, PP, objets, talents ou actions à venir du joueur. Elle mémorise les attaques montrées et immunités constatées. Changements, pièges, dégâts d’entrée, PP et contraintes d’attaque sont pris en compte. La mémoire et la décision en attente survivent au checkpoint ; une reprise ne retire pas au sort l’action. Les autres combats conservent leur politique existante.

L’estimation de dégâts réutilise le moteur sur des copies, sans critique, consommation d’objet, mutation du combat ni tirage aléatoire. L’anticipation est une heuristique limitée aux attaques observées, avec des estimations de type avant observation : elle ne garantit pas un jeu mathématiquement optimal. Les métadonnées du catalogue existant restent la référence ; leurs limites, notamment certaines priorités offensives et classifications de type, ne sont pas corrigées par ce lot.

Vérifications : 249 tests actifs et 32 tests SQL réussis, audits, HTTP, reprise réelle après arrêt brutal, lint et compilation. Le premier passage SQL a rencontré un interblocage dans un test d’XP existant ; la suite SQL relancée sans modification est passée 32/32. Les 11 tests `tests/colosseum-ai.test.js` couvrent les seuils, décisions, contraintes, informations cachées, coût CPU et reprise. Ils jouent 91 combats réels ; sur 40 affrontements identiques par politique, l’Expert gagne 22 fois contre 7 pour le Novice. Cette mesure contrôlée ne remplace pas l’équilibrage sur des parties humaines. `test:colosseum-browser` vérifie les deux formats, les états Novice/Expert sur mobile et une action du défi 51 réellement préparée côté serveur. `test:release-browser` confirme les parcours Aventure/Rift et les sept formats tactiles.

Livraison : sources, build et checkpoint précédents sauvegardés ; aucun Rift actif au précontrôle. Serveur rechargé et build validé installé sous `/explorakit/`, anciennes ressources conservées pour les onglets ouverts. La recette HTTPS publique confirme les nouvelles règles, le palier Novice et son prochain seuil, la reconnexion et l’absence de débordement à 320 px. Compte temporaire supprimé ; réponses et empreintes HTML des autres projets inchangées. Publication du client puis référence de son commit dans le dépôt serveur.

## Rencontres variées et soins depuis le sac — 14 octobre 2026

Les 16 zones comportant des rencontres sauvages disposent chacune de 12 espèces, soit 187 espèces distinctes. `nextMap.json` conserve ses niveaux et transitions ; seules les listes `wildpokemon` changent. Les premières zones proposent des espèces modestes, puis des évolutions adaptées au niveau et des groupes propres aux routes, berges et grottes. Aucun légendaire n’est ajouté. Aventure, Rift et Colosseum utilisent ces mêmes listes ; `drift_encounters.json` garde des poids rares explicites et le bonus Recherche rare. Les sprites avant/arrière et les attaques générées sont vérifiés.

Les six premiers défis du Colosseum présentent 14 espèces distinctes et huit types, avec des équipes fixes identiques pour tous les joueurs. Niveaux, effectifs, potentiel, points, formats 30/60 et progression après ces défis sont conservés. Les Pokémon déjà engagés dans un combat sont préservés lors d’une reprise. Cette variété ne prétend pas remplacer une recette humaine de l’équilibrage.

Le sac propose un choix de Pokémon puis un bouton **Utiliser**, avec PV/statut, confirmation et explication quand le soin est inutile. Les potions Rift, les médicaments de boutique et les baies Oran/Sitrus/Prine fonctionnent hors combat. Le sac avait masqué les soins en Rift/Colosseum et le serveur de ces modes ne reconnaissait que les deux potions propres au Rift ; les médicaments achetés dans la boutique commune sont maintenant pris en charge. Les descriptions et effets publics sont transmis par l’inventaire Aventure. Les baies restent également équipables ; consommer un exemplaire du sac ne retire pas une baie déjà tenue.

Les effets communs sont dans `server/game/items/medicineEffects.js` ; Aventure conserve sa transaction SQL, Rift son inventaire isolé et son checkpoint avant acquittement. Aucun objet n’est dépensé sans effet, sur une cible étrangère, pendant un combat ou sur un Pokémon perdu. Les Rappels restent réservés à l’Aventure et ne sont plus vendus en Rift/Colosseum. Les soins automatiques entre défis et les effets des Drifts de soin sont conservés.

Vérifications reproductibles : `VUE_APP_PUBLIC_PATH=/explorakit/ RELEASE_DIST_DIR=BUILD_OUTPUT npm run verify:release -- --mysql` (238 tests actifs, 32 tests SQL, audits, HTTP/reprise, lint et compilation). `test:colosseum-browser` inclut désormais les soins réels depuis le sac sur les formats 320/393/844 px : ciblage, potions des deux catalogues, baie, antidote à PV complets, quantité, état et cibles tactiles de 44 px. `test:release-browser` vérifie le bouton Utiliser en Aventure et sa persistance SQL. `tests/consumable-socket.test.js` couvre les trois formats de jeu, les doublons, les refus, le checkpoint et la reconnexion ; `tests/encounter-variety.test.js` couvre diversité, ressources, plafonds de puissance et progression des premiers défis.

Livraison : sources et build précédents sauvegardés, aucun Rift actif au précontrôle. Serveur rechargé et build validé installé sous `/explorakit/`, en conservant les anciennes ressources des onglets ouverts. La recette HTTPS publique a confirmé consommation d’une baie et d’une potion, antidote à PV complets, persistance SQL, commandes du sac Colosseum et absence de débordement à 320 px. Compte temporaire supprimé ; autres projets inchangés. Aucun changement de schéma SQL. Client publié dans son dépôt puis référencé par le serveur.

## Sortie de la deuxième maison du village de départ — 14 octobre 2026

Dans `maison2`, les deux cases de sortie `(8,15)` et `(9,15)` avaient une collision de mur malgré leur transition existante vers `start`. Le serveur refusait donc le déplacement avant de traiter le changement de carte. Ces deux collisions passent à zéro ; les murs voisins, les transitions, les décors et les données des joueurs sont conservés.

Vérification reproductible : `node --test tests/house-exits.test.js tests/world-content.test.js` (13 tests). Le nouveau contrôle parcourt toutes les portes configurées et détecte une case de transition bloquée. Les parcours Rift et Colosseum 30/60 min empruntent réellement les deux côtés de la porte, sortent, rentrent et vérifient le mur adjacent. Les quatre nouveaux tests échouaient avant correction. `npm test` : 231 tests réussis, 32 tests MySQL réservés à leur commande dédiée ; `npm run audit:content` réussi.

Livraison : carte sauvegardée puis serveur rechargé pour renouveler son cache. La partie Colosseum active a été conservée par checkpoint. Sur le site public, un compte temporaire Aventure a vérifié les deux sorties, une reconnexion depuis l’intérieur et la sauvegarde de sa position extérieure ; compte supprimé ensuite. Les deux autres projets conservent leurs HTTP 200 et leurs empreintes HTML. Aucun build client ni migration SQL nécessaire.

## PWA, DA Rift multijoueur et Colosseum 30 min — 14 octobre 2026

L’accueil propose **Installer le jeu** : invitation native lorsqu’elle est disponible, instructions Safari/iOS et menu du navigateur sinon. Le manifeste relatif, les icônes PNG 192/512 (maskable) et Apple 180, les métadonnées et le service worker sont limités à `/explorakit/`. Le mode `standalone` retire la barre d’adresse quand le jeu est lancé depuis son icône installée. Un onglet normal conserve les contrôles du navigateur ; le code ne force ni plein écran ni orientation. Les écrans d’accueil respectent les zones sûres. L’installation ne supprime pas le besoin de connexion du jeu.

Le service worker conserve uniquement `offline.html`, dans un cache propre au chemin de cette application. Les navigations utilisent le réseau ; une coupure affiche un bouton de reconnexion et rappelle que le chrono Rift continue. API, authentification, Socket.IO, données de compte et ressources du jeu ne sont jamais mis en cache par le worker. Le remplacement du worker attend la fermeture des fenêtres existantes, sans rechargement forcé pendant un combat. Les caches d’autres applications sont préservés. Fichiers : `public/manifest.webmanifest`, `public/service-worker.js`, `src/services/pwa.js` et `PwaInstall.vue` dans le sous-module.

Le salon Rift multijoueur reprend les variables papier/sauge du Pokédex : un panneau Rejoindre ou Créer à la fois, champs tactiles, invitations et groupe lisibles, collections/palmarès/historique repliables. L’ancien empilement de surcharges CSS est remplacé par une feuille unique. Panneau de partie, rapports, boutique et spectateur partagent aussi les surfaces claires. Les cosmétiques conservent leurs couleurs et les boutons de copie restent disponibles. Le menu des trois modes et le lien Aventure du salon sont conservés.

Le Colosseum accepte **30 ou 60 minutes** : choix au départ validé par le serveur, format et échéance immuables à la reconnexion. Sans paramètre, un ancien client démarre toujours 60 minutes. Les autres durées sont rejetées. Le niveau des dresseurs et les règles de score/K.O./soin ne changent pas. Chaque format garde son meilleur score par joueur et son classement séparé ; le classement HTTP sans filtre reste celui de 60 minutes. La sélection du classement ignore les réponses réseau devenues obsolètes.

Migration **014_colosseum_formats.sql** : `duration_minutes` sur tentatives/records, valeurs historiques à 60, clé des records `(user_id,duration_minutes)`. Elle peut être relancée après une interruption entre les deux tables. Le règlement utilise le format stocké au lancement, pas celui d’un rapport fourni ; transactions, idempotence et isolation Aventure/Rift restent assurées. `db:verify` vérifie 18 tables, la migration 014, les colonnes et la nouvelle clé. Sauvegarder puis migrer avant de publier le client ; ne pas appliquer le schéma neuf en production.

Vérifications reproductibles : `VUE_APP_PUBLIC_PATH=/explorakit/ RELEASE_DIST_DIR=BUILD_OUTPUT npm run verify:release -- --mysql` (227 tests actifs, 32 tests SQL, audits, HTTP/reprise, lint/build), puis les trois commandes `test:release-browser`, `test:colosseum-browser`, `test:pwa-browser` avec la même destination. La CI exécute les trois. La recette Rift vérifie Rejoindre/Créer sur quatre formats et un salon de 16 places, puis cosmétiques, historique, monde/combats tactiles sur sept formats. La recette Colosseum joue le format 30 min avec horloge de test, reconnexion, arène, K.O., soin et score ; elle vérifie l’autre classement et un nouveau départ de 60 min. La recette PWA vérifie l’absence d’erreur d’installabilité Chromium, la portée, les icônes, l’invitation sur clic, le retour hors ligne, l’absence de cache API et la neutralité vis-à-vis d’un autre projet. Captures sous `BUILD_OUTPUT`.

Livraison : sauvegarde SQL privée, migration 014 et vérification des 18 tables réussies. Build final `BUILD_OUTPUT` installé sous `/explorakit/` ; sauvegarde privée du précédent build. Service redémarré avec checkpoints, aucun Rift actif au précontrôle. Recette HTTPS réussie : installabilité et portée du worker, nouvelle DA, départ 30 min, reconnexion, abandon enregistré et classements 30/60. Compte temporaire supprimé ; les deux autres projets gardent leurs HTTP 200 et empreintes HTML. Client publié puis référencé par le dépôt serveur.

Le contrôle automatique de publication a détecté sept instructions de données historiques dans le schéma neuf, déjà présentes avant cette livraison. Elles sont retirées du fichier courant, avec les compteurs d’auto-incrément hérités. `db:test:setup` crée désormais une base vide et réinitialise aussi les deux tables Colosseum ; les tests fabriquent leurs comptes temporaires. Cette correction ne touche aucune donnée de production et ne réécrit pas l’historique Git. Le journal public retire également les chemins absolus, les adresses locales, les détails de services propres à l’hébergement et une ancienne intervention sur un compte ; une copie complète demeure dans la sauvegarde privée de livraison.

Limites : installation sur écran d’accueil, barres système et rendu Safari/iPhone restent à confirmer sur appareil physique. L’équilibrage humain doit être éprouvé séparément sur les deux durées.




### Sélection tactile désactivée — 14 octobre 2026

La racine du client applique `user-select: none`, son préfixe WebKit et `-webkit-touch-callout: none` aux interfaces de jeu : menus, exploration, combats et salons. Les champs `input`, `textarea` et les zones éditables rétablissent la sélection de texte et le menu de copier/coller. Le code de salon ne force plus la sélection ; son bouton de copie reste disponible. Le défilement, les gestes tactiles et le zoom ne sont pas bloqués par cette règle.

Vérification reproductible : build production temporaire, puis contrôle Chromium tactile des styles calculés et d’une sélection par glissement dans l’interface ; saisie et sélection dans un champ restent possibles. Lint et build du client requis. Contrôle également réussi sur le site HTTPS public. Client déployé avec sauvegarde du précédent build, sans redémarrage du serveur ni migration SQL.

## Rift Colosseum et accueil à trois modes — 14 octobre 2026

L’accueil propose désormais trois entrées distinctes : **Jouer une aventure solo**, **Rift multijoueur** et **Rift Colosseum**, dans les couleurs papier/sauge du Pokédex. Les routes existantes `/game` et `/drift` restent disponibles ; `/colosseum` contient les règles et le classement, `/colosseum/game` réutilise le monde et les combats mobiles. L’authentification conserve la destination choisie.

Le Colosseum est une expédition solo privée : starter aléatoire parmi les 49 Pokémon de base non légendaires du Rift, niveau 5, mêmes cartes/captures/boutiques/Drifts et cinq emplacements. Depuis la livraison « PWA, DA Rift multijoueur et Colosseum 30 min », le serveur impose **1 800 000 ou 3 600 000 ms** selon le format choisi ; le client ne peut changer la durée en cours de partie, le nombre de joueurs ou le score. À l’échéance, le combat en cours est interrompu sans victoire ni score et les survivants rejoignent l’arène existante `ville1_arene`, affichée « Colosseum ». Aucune carte ni transition n’a été modifiée. Les K.O. sont supprimés avant tout soin, pendant les deux phases.

Dans l’arène, un bouton lance chaque défi après réorganisation de l’équipe et des Drifts. Les survivants récupèrent PV, PP et statuts entre deux combats. Les dresseurs commencent avec deux Pokémon niveau 10 ; leur niveau augmente de 3 par défi jusqu’à 100, leur effectif de un tous les quatre défis jusqu’à six, et les espèces évoluent par paliers. Après le défi 31, leur potentiel augmente à chaque défi. Chaque victoire rapporte `100 × numéro du défi + 10 × niveau adverse × effectif adverse`. La perte du dernier Pokémon, la fuite dans l’arène ou l’abandon termine la tentative ; aucun score n’est accordé pour une défaite, un double K.O. ou l’exploration. La fermeture du navigateur ne suspend pas le temps : reconnexion dans les 90 secondes, selon la règle Rift existante. Seuls les arrêts serveur et incidents de stockage suspendent les horloges ; checkpoints et reprise des combats sont partagés avec Rift.

Le classement garde **le meilleur score par joueur**, dès une victoire, avec les Pokémon du dernier combat de ce record (K.O. signalés). Les 50 premiers et le record personnel sont retournés ; les égalités sont ordonnées par ancienneté du résultat. Le dépôt SQL séparé rend les règlements immuables et idempotents, y compris après un crash entre écriture SQL et checkpoint. Les données publiques n’incluent ni UUID, ni IV, ni inventaire. Aucune prime, défaite ou partie Colosseum n’altère le palmarès/monnaie Rift multijoueur ou la sauvegarde Aventure.

Migration additive **013_colosseum.sql** : `colosseum_runs` et `colosseum_bests`, clés étrangères avec suppression des données d’un compte supprimé. `db:verify` attend maintenant 18 tables et 13 migrations. Sauvegarder la base avant `db:migrate` ; ne jamais appliquer `schema.sql` à la production. Un serveur doit être migré avant de publier ce client.

Vérifications reproductibles :

- `node --test tests/colosseum.test.js` : règles fixes, starter/reprise sans nouveau tirage, isolation des salons, heure exacte en combat, butin, soins sans résurrection, victoire unique, fuite, double K.O., déconnexion, checkpoint d’un combat et commandes Socket falsifiées.
- `npm run test:mysql` inclut `colosseum-mysql.test.js` : règlements concurrents/rejoués, meilleur score et égalités, propriétaire, données publiques, neutralité Aventure/Rift et récupération d’un résultat SQL plus récent que le checkpoint.
- `VUE_APP_PUBLIC_PATH=/explorakit/ RELEASE_DIST_DIR=BUILD_OUTPUT npm run verify:release -- --mysql`, puis `RELEASE_DIST_DIR=BUILD_OUTPUT npm run test:release-browser` et `npm run test:colosseum-browser` avec la même variable. Le dernier scénario utilise des comptes SQL temporaires et une horloge injectée au serveur de test, sans endpoint de triche en production : quatre formats, trois modes, lancement réel, reconnexion, arène, perte, soin, score, bilan et relecture du classement. Les captures sont enregistrées sous `/tmp` et les comptes nettoyés. La CI exécute les deux recettes navigateur.

Livraison : migration 013 appliquée après sauvegarde SQL et précontrôle compatible ; 18 tables InnoDB et 13 migrations vérifiées. Build production installé sous `/explorakit/`, service de jeu redémarré avec checkpoints, ancien build et sources conservés en sauvegarde privée. La recette HTTPS réelle confirme les trois modes, le départ solo d’une heure, la reconnexion au même défi, le règlement d’un abandon et l’accès au classement, sans erreur JavaScript ni ressource manquante. Le client est publié dans son dépôt puis référencé par le dépôt serveur.

Limites : l’équilibrage de cette première courbe reste à éprouver sur des parties humaines d’une heure ; les tests accélèrent le chronomètre. Chromium tactile couvre la mise en page, pas un téléphone physique. L’exploitation reste mono-instance comme Rift. Les records sont persistés en fin de tentative ; le score en cours est conservé dans le checkpoint.

Dernière confrontation audit/code/tests : **14 octobre 2026** (audit initial : 3 octobre).
État actuel : socle technique, progression, combats et RiftMon livrés. Mise à jour du **14 octobre** : checkpoints SQL avec reprise, objectifs guidés, chapitre II, huit intérieurs peuplés, médicaments, boutique cosmétique et rapports synchronisés. Contrôles de publication locaux et workflow GitHub ajoutés. La section suivante détaille les six axes, leurs preuves et leurs limites.
Portée : revue des fonctionnalités livrées, des preuves automatisées et des priorités restantes ; ce n'est pas une nouvelle recette humaine exhaustive ni un audit de sécurité complet.

### Cadrage du combat mobile — 14 octobre 2026

Le combat tactile utilise une grille occupant la hauteur disponible du navigateur, avec les zones sûres de l’appareil. Terrain et commandes se partagent cette grille : aucune hauteur de terrain calculée séparément ne peut recouvrir le bas des Pokémon. Le Pokémon du joueur garde une marge sous son sprite ; l’adversaire garde une place au-dessus de la fiche du joueur. L’indicateur de tour et le bouton son sont dans une rangée des commandes, au lieu de flotter sur le Pokémon. Les commandes passent à droite en paysage. Sur un portrait court, le message occupe moins de hauteur ; les choix d’attaque disposent de deux rangées de 44 px et les six Pokémon restent accessibles par défilement. Le bureau et les règles serveur ne changent pas.

Vérification reproductible : compiler le client en production avec `VUE_APP_PUBLIC_PATH=/explorakit/` dans un dossier temporaire, puis `RELEASE_DIST_DIR=<dossier> npm run test:release-browser`. Le nouveau module `scripts/validateMobileBattle.js`, inclus dans la recette tactile, injecte uniquement une scène visuelle Bulbizarre/Reptincel sans envoyer d’action de combat au serveur. Il mesure les pixels opaques des sprites, leur visibilité complète et l’absence de recouvrement par les fiches/commandes sur sept formats, dont 320×480 et 740×320. Il contrôle les cibles tactiles de 44 px, les menus Attaque/Sac/Pokémon et le sixième équipier, une réduction de hauteur avec zones sûres simulées, ainsi que la destination réelle d’une attaque et d’une Ball. Les captures sont sous `BUILD_OUTPUT`. Cette recette Chromium ne remplace pas un téléphone physique.

Livraison : lint, build temporaire de production et recette navigateur complète réussis. Le build a été installé sous `/explorakit/` après sauvegarde, sans redémarrage du serveur de jeu ; les anciens fichiers hachés restent disponibles aux onglets ouverts. La recette tactile du monde et du combat a également réussi sur le site HTTPS public, sans erreur JavaScript ou ressource manquante, puis le compte temporaire a été supprimé. Les deux autres projets conservent leurs réponses HTTP 200 et leurs empreintes HTML.

La mesure des boutons conserve un minimum de 44 px de mise en page, avec 0,01 px de tolérance sur le rectangle transformé : Chromium peut renvoyer 43,999984 px pendant la translation de survol. Ce cas a été reproduit isolément ; aucun bouton n’a été réduit et aucune animation n’a été désactivée pour faire passer le contrôle.

### Vue mobile et objectif à la demande — 14 octobre 2026

Le monde mobile occupe désormais la hauteur disponible du navigateur (`100dvh`, zones sûres comprises). La barre Menu/lieu reste compacte ; les commandes de 44 px minimum occupent un bandeau de 160 px sous la carte en portrait et une colonne de 168 px en paysage. Une caméra suit le joueur et se bloque aux limites de la carte, avec une échelle uniforme qui conserve des sprites lisibles. Le canvas s’adapte aux changements de taille et d’orientation via `ResizeObserver`, avec une densité plafonnée à 2. Le bureau conserve la carte complète. Les coordonnées serveur, collisions, PNG/Tiled et règles de déplacement sont inchangés.

L’objectif n’est plus rendu sur la carte, même sous forme d’aperçu. Il est disponible uniquement dans **Menu → Objectif et quêtes**, avec destination et aide repliable. Sa fermeture et le rechargement rendent la vue de jeu dégagée. Le panneau reprend les couleurs du Pokédex.

Vérification reproductible : `node --test tests/world-camera.test.js` contrôle le cadrage bureau, le suivi mobile et les bords de carte. Après un build production `/explorakit/` temporaire, `RELEASE_DIST_DIR=<dossier> npm run test:release-browser` inclut maintenant `scripts/validateMobileWorld.js` : émulation tactile Chromium à densité 3, sept formats (393×852, 360×740, 320×568, 844×390, 740×320, 393×700 et tablette 1024×768), occupation de l’espace, absence de défilement, rendu sans déformation, joueur visible, menus, objectif masqué par défaut et déplacement tactile confirmé par Socket.IO. L’annulation du toucher relâche la direction. Le scénario de menus existant vérifie aussi les dialogues et boutiques ; la barre et les commandes Rift sont contrôlées jusqu’à 740×320. Captures dans `BUILD_OUTPUT`. Ces contrôles ne remplacent pas une recette sur téléphone physique.

Livraison : lint, build de production, trois tests caméra et scénario navigateur complet réussis. Build installé sous `/explorakit/` avec sauvegarde du précédent, sans redémarrer le serveur de jeu. Le même parcours tactile sur sept formats a réussi sur le site HTTPS public, sans erreur JavaScript ni ressource manquante ; compte temporaire supprimé. Les deux autres projets conservent leurs HTTP 200 et empreintes HTML. Un onglet qui a déjà chargé l’ancien client doit être rechargé pour recevoir cette version ; les anciennes ressources hachées sont conservées pour ces onglets.

Le harnais du test de reconnexion camp → solo exécute le hook Vue hors navigateur : il importe désormais les dimensions du monde et simule `ResizeObserver`/`$nextTick`, introduits par le canvas adaptatif. Le test conserve sa vraie connexion Socket.IO et toutes ses assertions d’authentification/reconnexion ; le rendu reste couvert par les tests navigateur.

### Direction artistique partagée avec le Pokédex — 14 octobre 2026

Le Pokédex devient la référence des interfaces du monde : fond papier clair, vert sauge, texte sombre, bordures fines, angles arrondis et police Arial. Les variables communes sont définies dans `vue-explorakit/src/styles/field-journal.css`, importées au démarrage et réutilisées par le Pokédex. `adventure.css` remplace l’ancien habillage des menus ; les composants conservent leur logique de jeu.

La barre du monde regroupe Menu et localisation. Les menus, sac, équipe/fiches, apparence, objectifs, quêtes/badges, sauvegarde, options, boutique, dialogues et interactions sociales reprennent cette base ; les icônes de menu sont des SVG locaux. La barre d’expédition Rift utilise les mêmes couleurs. Le camp RiftMon et les couleurs fonctionnelles des commandes de combat ne font pas partie de cette refonte. Aucune carte, règle serveur ou migration SQL n’est modifiée.

Les commandes tactiles se masquent lorsqu’un panneau est ouvert ; le clavier ne déplace plus le joueur derrière le menu, le sac ou l’apparence. Les panneaux Sac et Apparence ont une fermeture visible et les commandes principales gardent des cibles d’au moins 44 px. Les noms de lieux longs peuvent revenir à la ligne sur petit écran.

Vérification reproductible : compiler en production avec `VUE_APP_PUBLIC_PATH=/explorakit/` dans un dossier temporaire, puis `RELEASE_DIST_DIR=<dossier> npm run test:release-browser`. Ce scénario inclut `scripts/validateJournalUi.js` : sept entrées du menu, recherche Pokédex, fiches/onglets, langue, fermetures, défilement, cohérence des couleurs/polices et noms longs aux formats 1365×900, 390×844, 320×568 et 844×390. Boutique et dialogue utilisent des données visuelles injectées uniquement dans le navigateur de test ; ils ne certifient pas un achat ou un parcours narratif. La barre Rift est vérifiée dans une vraie expédition à deux comptes temporaires. Les achats cosmétiques et le soin SQL restent couverts par le scénario existant. Captures sous `BUILD_OUTPUT` lors de cette livraison ; navigateur Chromium, pas de téléphone physique.

Mise en ligne : build validé installé dans `/explorakit/`, anciens fichiers hachés conservés pour les onglets ouverts et copie du build précédent dans le dossier privé de sauvegarde. Service de jeu conservé sans redémarrage. Contrôle HTTPS sur quatre formats : connexion, accès solo, nouveau menu et recherche Pokédex ; aucune erreur de ressource ou JavaScript. Les deux autres projets répondent toujours HTTP 200 avec un HTML strictement identique.

### Soin par la mère — 14 octobre 2026

Le dialogue `dia0`, utilisé par `mere_clara` dans le village de départ, conserve l’introduction de Clara et annonce désormais un soin complet. Son action finale `heal` réutilise le circuit serveur du Centre : restauration de tous les PV/PP et des statuts, puis sauvegarde SQL et événement `teamStateChanged`. Le soin est gratuit et répétable ; une conversation réelle et proche reste obligatoire. `savePokemonCenterCheckpoint` ignore déjà les cartes autres que `centre` : le dernier point de retour est préservé.

Le même dialogue soigne l’équipe restante en Rift, sans recréer de Pokémon définitivement perdu. Le rapport nomme Maman et ne l’assimile pas au compteur des soins au Centre. Aucune modification client, carte ou migration SQL.

Vérifications : deux tests en échec avant modification puis réussis ; `npm test` : 212 réussis, 28 MySQL réservés ; `npm run test:mysql` : 28/28, dont une conversation Socket réelle avec deux Pokémon blessés/K.O., PP épuisés et statuts, répétition, refus des fins de dialogue falsifiées ou rejouées, sauvegarde/reconnexion et point de retour intact. Le test de chapitre continue ensuite les deux arcs jusqu’à leur conclusion. `audit:content`, syntaxe et diff valides. Déployé après sauvegarde des sources et vérification qu’aucune expédition Rift n’était active. Parcours HTTPS réel réussi : conversation avec la mère, soin complet et SQL relu ; compte de recette supprimé. Les autres projets conservent leurs réponses HTTP/HTML.

## Livraison des six axes — 14 octobre 2026

Cette section remplace les limites du 11 octobre concernant les parties en RAM, la boutique « bientôt », les huit intérieurs vides et l’absence de suite à la lettre. Les entrées datées du journal conservent leur contexte historique.

| Axe demandé | Livraison | Vérification / limite |
| --- | --- | --- |
| Reprise RiftMon | Checkpoint SQL compressé chaque seconde et avant acquittement des commandes majeures ; salons, Pokémon, combats, effets à usage unique, règlement et rapports restaurés. Attente des joueurs jusqu’à cinq minutes après redémarrage ; horloges suspendues. Pause automatique en cas d’échec du stockage. | `test:recovery` tue réellement le processus par SIGKILL puis redémarre deux fois. Test unitaire de reprise d’un combat jusqu’à son résultat. Derniers déplacements ou progression automatique depuis le dernier checkpoint (normalement ≤ 1 s) peuvent être rejoués. Un seul processus de jeu écrit ce checkpoint ; aucun déploiement multi-instance. |
| Orientation Aventure | Composant `AdventureGuide` avec objectif courant, destination des deux chapitres et aide clavier/tactile repliable ; accès solo proéminent conservé. | Objectif dérivé des drapeaux persistants, jamais du client. Contrôle navigateur des formats 1365×900, 390×844, 320×568 et 844×390. |
| Contenu solo | Chapitre II Iris → Nora → Soren (56–58) → Clara, deux visites de refuge, huit intérieurs peuplés et deux objets clés. Potions, Super Potions, Antidotes et Rappels achetables et utilisables hors combat. | Parcours Socket réel des deux chapitres, prérequis et récompenses uniques ; achats/soins transactionnels et propriétaires contrôlés. Cartes JSON/TMX, PNG et transitions inchangés. Conclusion de cet arc de Clara ; aucun épilogue global ni nouveau monde annoncé. |
| Recette et mesures | Mesure reproductible de 360 combats via le moteur, tests de crash, parcours SQL/Socket et recette navigateur avec quatre formats. | Bots avec attaques légales aléatoires, IV fixes, sans objets/Drifts : duels miroirs 14–16 victoires par côté sur 30 ; forte influence attendue des types. Aucune modification arbitraire des coefficients sur ces seuls résultats. Partie humaine longue, deux humains en PVP et Safari/iPhone physique restent à réaliser. |
| Compte RiftMon | Six cosmétiques (trois titres, trois cadres), achat en pièces Rift avec débit unique, équipement lié au compte. Vingt derniers rapports serveur privés aux participants, fusion avec les archives locales. | Deux achats concurrents ne débitent qu’une fois ; refus de solde insuffisant et d’équipement non possédé. Relecture dans un navigateur vierge. Anciennes archives locales non téléversées automatiquement. |
| Maintenabilité / publication | Modules dédiés au codec, au dépôt de checkpoint, à la collection, aux médicaments et à leurs handlers, au contrôle de débit HTTP/Socket ; résolution des décors extraite de `UserMap`. Commande `verify:release` et workflow GitHub avec sous-module récursif, MySQL, lint, build et recette navigateur. | Découpage progressif, pas de réécriture globale du moteur. 98 talents et doubles toujours hors de cette livraison. Le workflow vérifie ; il ne déploie pas automatiquement le VPS. |

### Validation et exploitation

- `npm run verify:release -- --mysql` vérifie la syntaxe, les tests unitaires, MySQL, HTTP, la reprise, les catalogues, les mesures, le lint et un build temporaire. La base `DB_TEST_NAME` doit déjà être préparée et porter un nom contenant `test`. Cette commande ne réinitialise aucune base.
- `npm run test:release-browser` utilise Playwright Chromium, une base de test et deux ports locaux 31491/31492. Compiler avec `VUE_APP_PUBLIC_PATH=/explorakit/` et définir `RELEASE_DIST_DIR` vers le build temporaire. `npx playwright install chromium` prépare le navigateur si nécessaire. Capture et logs vont dans `/tmp` ; les comptes temporaires sont nettoyés.
- La migration additive `012_rift_durability_cosmetics.sql` ajoute quatre tables ; `db:verify` contrôle désormais 16 tables et 12 migrations. Sauvegarder avant `db:migrate`. Le schéma neuf sert uniquement à `db:test:setup`, jamais à une base de production existante.
- Démarrage refusé si le checkpoint est corrompu ; aucune remise à zéro silencieuse. Conserver une copie de la ligne SQL, restaurer une sauvegarde connue et investiguer. Le format est versionné ; une future modification incompatible du moteur exige une migration du codec.
- Les checkpoints en base assurent la reprise du processus, pas la survie à la perte du disque. Le service est mono-instance. Les sauvegardes SQL locales existantes restent nécessaires ; sauvegarde externe et exercice de restauration complet à planifier séparément.
- Déploiement VPS dans `/explorakit/` uniquement, services existants préservés. Les détails des services et des installations historiques sont conservés dans la documentation privée d’exploitation.

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

Le cœur est déjà en place : déplacements validés par le serveur, collisions, changement de carte, sauvegarde différée de position, inventaire, capture, états de combat, météo/terrain, animations et synchronisation PVP sont présents. Les travaux restants portent surtout sur la cohérence du parcours narratif, la recette de bout en bout et le découpage des gros fichiers.

### État historique de référence au 11 octobre 2026

Ce tableau conserve la référence du 11 octobre. La livraison des six axes du 14 octobre et la section 7 définissent désormais les priorités ; le journal explique les corrections.

| Domaine | État vérifié | Preuve / limite |
| --- | --- | --- |
| Inscription, trois starters, connexion, JWT | Livré et testé | `userRepository.js`, middleware HTTP/Socket, `test:http` ; ne pas refaire l'onboarding |
| Équipe, inventaire, PP, objets tenus, sauvegarde | Livré et testé | 16 tests MySQL ; réorganisation, équipement et EV persistants |
| Habillage, fiche Pokémon et PNJ vivants | Livré le 11 octobre | Cadres ivoire/bleu nuit/dorés, fiche radar stats/IV/EV, 32 identités de civils, promenades locales, musique et XP en combat ; recette humaine mobile restante |
| Combat sauvage/dresseur/PVP, capture, défaite | Livré sur les scénarios couverts | Moteur, orchestrateurs et tests MySQL ; PVP humain à deux navigateurs encore à valider |
| Bilan de combat Aventure/Drift | Livré le 11 octobre | Issue explicite, confirmation Continuer, XP/niveaux/argent/capture et butin/pertes Drift ; résumé enrichi au prochain redémarrage du serveur personnel |
| Capacités | 612 capacités / 99 effets reconnus par l'audit | Un inventaire sans effet inconnu ne prouve pas toutes les combinaisons de combat |
| Talents | 809 espèces renseignées ; 125 talents pris en charge | 98 talents réservés aux familles suivantes ; aucun mode double jouable |
| Pokédex | Interface mobile livrée et testée | `PokedexPanel.vue`, 4 formats Chromium ; 493 espèces exposées dans l'interface sur 809 dans les données |
| Quêtes, badges, récompenses uniques | Progression du chapitre I corrigée et testée | Prérequis ordonnés, lettre finale, doublons concurrents, reprise des anciens statuts ; aucune réouverture après victoire annexe |
| Boutiques | Catalogue et achats transactionnels livrés | Aventure : 3 Balls et 4 objets tenus. Drift uniquement : Potions hors combat et revente de Drifts en monnaie éphémère |
| Monde | 47 cartes physiques, 46 lieux actifs, 45 accessibles dans le graphe | 30 cartes générées actives ; graphe accessible ≠ parcours joué intégralement |
| Décors client | 8 exclusions corrigées le 11 octobre | Contrôle croisé configuration serveur/contexte Webpack ; chargement réel des 46 lieux dans Chromium |
| Histoire | Chapitre I jouable, suite globale à écrire | 63 dialogues, 37 PNJ, 18 équipes actives ; Hoze/Raphael/Ana/Wanda, 12 duels de ville et lettre à Clairbois |
| Mode Drift | Expéditions et tournoi jouables | Même monde, chrono serveur, captures/XP, mort permanente, 59 effets, cinq emplacements, loot/revente et duels de 2 à 16 joueurs ; sessions en mémoire, équilibrage humain restant |
| Souvenirs Drift | Bilan complet et carnet local livrés | Équipes de tous les joueurs, pertes, Drifts, statistiques, parcours, export JSON et dix archives par compte/appareil ; collecte des nouvelles parties après redémarrage du serveur personnel |
| RiftMon et compte | Accueil bleu, salons publics/privés, 2–16 joueurs et jusqu’à 5 h | Survivants, tirage à chaque round et spectateur ; statistiques SQL et prime du vainqueur selon effectif initial/exploration réelle ; activation au prochain redémarrage du serveur personnel |
| Architecture | Extraction partielle livrée | `BattleOverlay`, Pokédex, panneaux, handlers profil/chat/boutique, modules de combat déjà extraits |
| Git et environnement | Sous-module déclaré, artefacts ignorés, MySQL local opérationnel | Aucun fichier de `node_modules/` ou `dist/` suivi ; livraison du 11 octobre conservée dans les deux dépôts, client référencé par sous-module |

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
| Drift | `server/game/drift/`, `server/realtime/driftLobbyHandler.js` | salons, sessions temporaires, monde isolé, effets/économie, orchestration combat et tournoi |

### Frontend

| Zone | Fichiers principaux | Responsabilité actuelle |
| --- | --- | --- |
| Application | `vue-explorakit/src/App.vue`, `main.js`, `router/index.js` | démarrage et navigation |
| Jeu | `components/UserMap.vue` | canvas, contrôles, Socket.IO, dialogues et coordination des panneaux |
| Menu | `components/menu/GameInfoPanels.vue`, `PokedexPanel.vue` | Pokédex isolé, quêtes, badges, sauvegarde et options |
| Combat client | `components/battle/BattleOverlay.vue` | Affichage, animations, sons et commandes de combat |
| Drift client | `components/drift/DriftLobby.vue`, `DriftRunPanel.vue`, `RiftParticipants.vue`, `RiftSpectatorPanel.vue` | accueil RiftMon, profil, salons, catalogue, cinq emplacements, soins, survivants, arbre et spectateur ; monde réutilisé via `/drift/game` et `UserMap.vue` |
| Authentification | `UserConnexion.vue`, `UserInscription.vue`, `HomeMenu.vue` | connexion, inscription et menu d'accueil |
| UI secondaire | `HealthBar.vue`, `TextWithImage.vue` | barre de vie et dialogues illustrés |

### Données et contenu

- `data/maps/` : 47 cartes JSON, dont 30 cartes générées désormais actives.
- `data/game/` : 809 entrées Pokédex, 612 capacités, rencontres/transitions, dialogues, objets et équipes de PNJ.
- `vue-explorakit/src/assets/` : 1 184 fichiers, environ 126,35 Mo de sources (mesure du 11 octobre).
- `dist/` : sortie de compilation ignorée par Git ; le build du 11 octobre produit un chunk jeu de 295,00 Kio (123,02 Kio compressé).
- `database/schema.sql` : schéma InnoDB/utf8mb4 et données d'exemple ; `database/migrations/` contient les migrations des bases existantes.

## 4. Résultats des vérifications — 11 octobre 2026

| Vérification | Résultat et portée |
| --- | --- |
| `npm test` | 229 tests : 204 réussis, 25 MySQL ignorés par cette commande, aucun échec ; inclut RiftMon, les 105 combinaisons effectif/durée, le spectateur, le cycle SQL, le butin des captures et la prime variable jusqu’à cinq heures d’exploration |
| `npm run test:mysql` | 25/25 réussis sur `pokemon_game_test`, sans réinitialisation ; inclut transactions concurrentes, chapitre, retours de centre et neuf tests du compte RiftMon (prime variable, ancien crédit conservé, registre, rollback, JWT) |
| `npm run test:http` | Inscription, connexion, starter, inventaire, objet tenu, Socket.IO, progression, sauvegarde et récupération après défaite réussis |
| `npm run check:db`, `npm run db:verify` | MySQL 8.0.46 local ; 12 tables métier InnoDB et 11 migrations conformes, dont EV, retour du centre, les trois tables RiftMon et la durée rémunérée |
| Lint client | `npm --prefix vue-explorakit run lint -- --no-fix` réussi |
| Syntaxe | 115 fichiers JS de configuration/serveur/scripts/tests valides avec `node --check` ; sources Vue vérifiées par lint/build |
| Build | `npm run build:client` réussi ; avertissements de taille, Browserslist et dépréciations de la chaîne Vue CLI |
| `npm run audit:moves` | 612 capacités, 99 familles d'effets, aucun effet inconnu, cas spécial non reconnu ou capacité déclarée partielle |
| `npm run audit:balance` | Parcours sauvage 5–60, primes ×1/×1,5/×2, facteurs de niveau et totaux théoriques des arènes inspectés |
| `npm run audit:abilities` | 809 espèces, 223 talents, 125 pris en charge, 98 réservés, aucune erreur de catalogue |
| `npm run audit:content` | 47 cartes physiques / 46 lieux actifs / 45 atteignables ; 63 dialogues, 37 PNJ, 24 équipes (18 actives), 2 quêtes et 5 distinctions |
| `python3 docs/correctif_villes/validate_access.py` | 12 portes, retours, 519 cases de foreground et cohérence TMX/JSON validés sans modification des cartes |
| JSON strict | 69 fichiers JSON/JSONC de `data/game` et `data/maps` lisibles, y compris `pnjs.jsonc` |
| Navigateur | `node --env-file-if-exists=.env scripts/validatePokedexViewports.js` : 4 viewports, recherche/filtres/focus/clavier ; chargement et décodage des décors et premiers plans des 46 lieux actifs |
| Dialogues du chapitre I | `node --env-file-if-exists=.env scripts/validateStoryViewports.js` : 4 formats, portrait, texte sans débordement, bouton tactile A, PNJ d’Ocreville ; captures inspectées |
| Combat visuel | Rejoué le 11 octobre : actions, capture et ciblage des effets sur desktop/mobile ; nouveau HUD et XP dans 4 formats, dont paysage 844×390 |
| Bilans de combat | `validateBattleResults.js` : six issues et anciens événements, capture Aventure réelle, quatre formats et fermeture manuelle ; `validateDriftRun.js` : fuite, victoire PNJ et finale avec bilan, gains et retour à l’expédition |
| Fiche Pokémon et PNJ | `validateAdventureViewports.js` : 4 formats, stats/EV, focus, atlas, mouvement Socket, lecture des 4 musiques, sourdine et arrêt |
| Mode Drift | `validateDriftRun.js` : deux comptes, lancement, timer, cinq slots, victoire PNJ/drop, téléportation, duel réel, résultats/purge et retour au salon en quatre formats. Les neuf tables Aventure sont identiques avant/après. Tests serveur des arbres complets pour tous les effectifs de 2 à 16, exemptions, double K.O., pertes entre rounds, PNJ isolés et reconnexion |
| RiftMon | `validateRiftMon.js` : trois comptes, sept choix de durée et création 3 joueurs/300 min, public/privé/recherche, survivants 3→2, exemption, vrai duel en spectateur, finale et crédit unique de 2 250 pièces (3 × 300 × 2,5), calcul archivé, profil après rechargement et retour Aventure connecté ; 56 captures sur quatre formats. `validateDriftViewports.js` : 20 captures, catalogue/16 places et commandes tactiles ≥44 px |
| Audit npm de vulnérabilités | Non relancé dans cette revue ; aucune conclusion actuelle sur les vulnérabilités de dépendances |

Les scripts navigateur et HTTP utilisent des comptes temporaires dans la base dédiée. La validation du Pokédex injecte des événements clavier ; elle ne remplace pas la confirmation sur le clavier physique du joueur. Aucun parcours humain complet ni mesure longue de performances n'est déclaré réussi par cette passe.

## 5. Constats initiaux et état des corrections

Les descriptions de défauts ci-dessous relatent l'audit initial ; lire leur état et la synthèse du 11 octobre avant d'en déduire un travail à refaire.

### P0 historiques — correctifs livrés

#### P0.1 — Authentification inexistante côté serveur

**État : corrigé ; parcours authentifié HTTP/Socket rejoué avec succès le 11 octobre 2026.** La rotation opérationnelle du secret et les scénarios négatifs d'autorisation ne sont pas certifiés par ce seul smoke test.

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

Correction initiale : intervalle client ramené de 20 ms à 180 ms. État actuel : émission toutes les 150 ms, garde serveur de 130 ms, interpolation de 175 ms pour éviter des pas perdus par cadence identique. La méthode vérifie aussi que la socket et le joueur local existent avant toute émission.

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

Correction appliquée : le contenu est désormais du JSON strict ; Moonpunch a depuis été déplacé dans `ville1_arene`. Le renommage en `.json` et une validation globale au démarrage restent des améliorations souhaitables.

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

#### Retour à la bonne entrée du Centre Pokémon — 11 octobre 2026

L’intérieur `centre` est partagé par les entrées de `ville1` et `route4`. La sortie statique de `nextMap.json` pointait toujours vers `ville1` ; le checkpoint de réapparition existant mémorisait l’intérieur, mais pas sa provenance. `pokemonCenterTravel.js` valide désormais le parvis utilisé à l’entrée et renvoie chaque joueur sur cette case, hors tuile de transition. Les trois colonnes `users.center_return_*` (migration `009_pokemon_center_return.sql`) sont sauvegardées atomiquement avec la position ; le retour survit aux reconnexions et aux redémarrages. Il reste conservé à l’extérieur pour la sortie du dernier centre après un K.O., puis est remplacé lors d’une nouvelle visite.

La sauvegarde différée termine les nouvelles écritures arrivées pendant une requête MySQL. Un déplacement bloqué ne déclenche plus de transition ; une transition en cours empêche un deuxième déplacement pendant l’enregistrement du checkpoint. Aucun contrat Socket ni fichier de carte/transition n’a été modifié pour ce correctif.

Vérification reproductible : `node --test tests/pokemon-center-travel.test.js` (trois entrées physiques, cases de retour sûres, données invalides, détection des changements de provenance), puis `npm run test:mysql` (deux joueurs, allers-retours, déconnexion dans le centre, redémarrage, défaite ailleurs et remplacement par une nouvelle entrée). Migration appliquée aux bases locales de jeu et de test sans réinitialisation, après sauvegarde privée des positions dans `backups/` ; `npm run db:verify` valide les neuf migrations de la base de jeu. Sur une autre installation existante, exécuter `npm run db:migrate` avant le redémarrage.

Limite des anciennes sauvegardes : un joueur déjà dans `centre` sans provenance enregistrée sort une première fois sur le parvis de `ville1`, l’origine passée étant inconnue. Entrer à nouveau dans un centre enregistre ensuite le bon retour. Le serveur personnel déjà lancé sur le port 3000 est laissé en place : redémarrage manuel nécessaire pour charger le correctif.

### P1 — fiabilité, architecture et performances

#### P1.1 — Reproductibilité Git — socle corrigé

Depuis la publication du 9 octobre, `node_modules/` et `dist/` ne sont plus suivis. Les deux lockfiles existent et `.gitmodules` déclare `vue-explorakit/`. L'installation par `npm ci` des deux packages et MySQL local ont été validés. Conserver cette organisation ; une conversion en monorepo n'est pas une condition préalable à la suite. Les modifications courantes des deux dépôts doivent être préservées puis sauvegardées dans une publication distincte.

#### P1.2 — Gros fichiers — extraction partielle, travail restant

Mesures physiques du 11 octobre : `UserMap.vue` 3 162 lignes, `battleEngine.js` 2 841, `socketHandler.js` 1 092 ; orchestrateurs sauvage/dresseur/PVP : 701/692/683 lignes. `BattleOverlay.vue` existe déjà (2 087 lignes), ainsi que `GameInfoPanels.vue`, `PokedexPanel.vue`, `ShopPanel.vue`, les services session/API/socket et les handlers profil/chat/boutique.

Les prochaines extractions utiles sont les contrôles/rendu du monde, puis les handlers déplacement/dialogue et les familles de résolution du moteur. La table des types, le catalogue de capacités, les ressources, les événements et les fins de combat sont déjà séparés. Préserver les contrats Socket.IO et procéder par lot réduit, avec les tests existants comme garde-fou.

#### P1.3 — Accès base de données incohérent

**État : corrigé, migré et couvert par des tests MySQL le 3 octobre 2026.**

Certaines parties utilisent des pools, mais les routes créent une nouvelle connexion à chaque requête. Les connexions ne sont pas garanties d'être fermées en cas d'exception. Les identifiants MySQL sont dupliqués et codés en dur.

Avant correction, le schéma utilisait MyISAM et `latin1`, sans clés étrangères. Il autorisait plusieurs équipes pour le même utilisateur et plusieurs positions identiques dans une équipe.

Correction appliquée : configuration unique par variables d'environnement, pool partagé, helper transactionnel avec libération garantie, schéma InnoDB/utf8mb4, clés étrangères, unicité équipe/utilisateur et position/équipe, première migration versionnée.

#### P1.4 — Monde — raccords livrés, recette encore partielle

Les anciennes mesures de 17 cartes / 13 atteignables sont dépassées : 47 cartes physiques, 46 lieux actifs et 45 atteignables dans le graphe. `pk2` reste isolée ; `pk1`, `route5`, `route6` sont installées mais inactives. L'entrée factice `pk3…` a disparu. `getNextMap()` compare maintenant les deux coordonnées lorsqu'elles sont fournies ; les raccords anciens à un seul axe restent compatibles.

Le saut historique vers des rencontres de niveau 100–110 sur `route4` est déjà corrigé : niveaux 42–48 aujourd'hui. En revanche, l'accès à la région générée passe par `gen_route8` (38–44), puis descend vers `gen_route1` (24–28) : ordre réel des champions et progression narrative à remettre en cohérence.

Défaut découvert et corrigé le 11 octobre : les huit noms d'intérieurs `gen_maison_ville…` / `gen_shop_ville…` n'étaient pas inclus dans le contexte Webpack, malgré leurs PNG livrés. Le test croisé des 46 lieux échouait avant correction et passe maintenant ; le navigateur décode aussi les images. Aucun JSON/TMX/PNG de carte n'a été modifié. Les validateurs de données ne remplacent pas la recette humaine des passages et dialogues.

#### P1.5 — Lectures synchrones répétées des cartes

**État : corrigé le 3 octobre 2026.**

Chaque connexion et changement de carte relit et parse plusieurs fois le même JSON. `getNextMap()` relit aussi la configuration globale. Avec quelques joueurs ce n'est pas catastrophique, mais c'est inutile et bloque la boucle Node.

Correction appliquée : les cartes et la configuration de transitions sont mises en cache au premier accès par nom validé. La validation exhaustive au démarrage reste à ajouter.

#### P1.6 — Trop de données diffusées aux autres joueurs

**État : corrigé le 3 octobre 2026 et couvert par un test unitaire.**

`getPlayersInMap()` renvoie l'objet joueur complet, équipe comprise, pour les listes et mouvements. L'affichage du monde n'a besoin que de l'identifiant, du nom, de la carte, de la position, de la direction, du sprite et de quelques indicateurs.

Correction appliquée : toutes les listes, arrivées et notifications de mouvement utilisent un DTO public explicite qui exclut l'équipe et les données privées.

#### P1.7 — Performances — optimisations livrées, mesures réelles restantes

Le découpage des routes, les sprites Pokémon statiques et le fond de combat WebP sont livrés ; la vidéo de connexion de 12,1 Mo n'est plus embarquée. Le chunk jeu est de 295,00 Kio (123,02 Kio compressé) après le correctif des huit décors. Le constat initial de bundle applicatif à 907 Ko n'est plus l'état courant.

Restent les grands portraits de dialogue et la mesure sur téléphone du chargement, des FPS, de la mémoire et du trafic pendant une session longue. Ne pas déplacer/réencoder les assets de cartes dans ce lot.

#### P1.8 — Moteur de combat et couverture des capacités

**État : socle combat fiabilisé et audité le 3 octobre 2026 ; aucune capacité n'est encore classée partielle ou inconnue.**

Le moteur contient beaucoup de règles et d'aléatoire : 612 capacités enrichies, statuts, météo, terrain, protections, pièges, multi-coups, priorités et changements. Des tests déterministes couvrent maintenant les statuts, immunités, terrains, dégâts résiduels, dégâts spéciaux, capture, fins de combat et helpers d'équipe communs.

Constat historique corrigé par le module de progression : le groupe d'expérience `Parabolic` est assigné dans `pokemon.js`, mais n'est pas traité dans `getNextLevelExpForLevel()`. Douze espèces du Pokédex ont cette valeur et provoqueront une erreur si elles sont instanciées. Par ailleurs 317 entrées récentes du Pokédex n'ont pas de champ `exp` compatible avec le constructeur actuel.

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

Correction appliquée sur ce vecteur : le serveur émet une autorisation temporaire liée au dialogue, à la carte et à la tuile ; la fin n'est acceptée que si le joueur est encore adjacent, dans les deux minutes, puis l'autorisation est consommée. Les soins et combats ne peuvent plus être déclenchés en envoyant arbitrairement un nom. Deux tests couvrent proximité, identité, expiration et rejeu. Des validations complémentaires restent utiles, mais la progression persistante existe déjà dans `progressionRepository.js`. Son ordre narratif est désormais contrôlé selon les étapes du chapitre I (section 7).

### Décision de game design — progression et potentiel `k`

- Aucun plafond de niveau n'est imposé par le gameplay.
- L'expérience totale nécessaire au niveau `L` suit `coefficient × (L - 1)³`. Le coût marginal augmente donc continuellement.
- Le coefficient provient de la valeur `exp` du Pokédex divisée par un million ; une espèce sans valeur utilise `1`.
- Les gains de combat dépendent du niveau et du `k` de l’adversaire, du type de combat et du niveau du receveur, jamais de l’expérience cumulée adverse.
- `k` est inné et immuable : 1 commun (80 %), 2 prometteur (18 %), 3 rare (1,8 %), 4 exceptionnel (0,2 %).
- `k` amplifie la contribution des IV aux six statistiques, PV compris.
- Affichage du potentiel : une seule étoile SVG, grise (16 px), pâle (20 px), jaune (24 px), puis brillante (28 px, halo et scintillement). Le composant partagé `PotentialStar.vue` remplace K1–K4 dans les deux HUD de combat et la rangée d’étoiles de la fiche Pokémon ; infobulle/libellé accessible Commun, Prometteur, Rare ou Exceptionnel. Les préférences de réduction des animations désactivent le scintillement.
- Les starters ont tous `k=2` afin que la création répétée de comptes ne soit pas une stratégie de reroll.
- MySQL utilise désormais `BIGINT UNSIGNED` pour l'expérience via la migration `002_unbounded_experience.sql`. Il subsiste une limite technique de stockage, mais aucun plafond fonctionnel atteignable en jeu normal.

### Habillage, compagnons et monde vivant — 11 octobre 2026

- Direction validée par l’utilisateur : aventure sur console portable, ivoire/bleu nuit et accents dorés. `adventure.css` harmonise menus, sac, équipe, quêtes, badges, boutique, dialogues et combat. L’ancienne police globale forcée sur tous les éléments est supprimée. Le combat en paysage à faible hauteur dispose d’une colonne de commandes à droite.
- `PokemonDetails.vue` ouvre une fiche depuis l’image ou le nom dans l’équipe : six statistiques et radar, onglets Stats/Potentiel/Entraînement, nature et effets, talent, potentiel K, PV et XP. Échelle commune aux statistiques, IV sur 31, EV sur 252 ; chiffres explicites pour éviter une lecture trompeuse du radar. Fermeture Échap, focus conservé, onglets accessibles et défilement mobile. `PokemonPortrait.vue` centre le contenu visible des sprites sans toucher aux PNG.
- Les IV, les 25 natures et le potentiel K existaient. Correction des cinq natures neutres qui appliquaient accidentellement +10 %. Les Pokémon sauvages ont désormais une nature tirée parmi les 25, au lieu de tous être Timides. Les natures et IV déjà sauvegardés sont conservés.
- Ajout d’EV : `floor(EV / 4)` dans les formules de stats, plafonds 252/stat et 510/total, données des 809 espèces dans `effort_yields.json`, importées de [PokeAPI](https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_stats.csv). Le partenaire actif conscient reçoit les EV de l’adversaire vaincu en sauvage/dresseur/arène ; pas d’EV en PVP, sur fuite ou capture. Pas de partage d’EV, vitamines, baies de réduction ou multiplicateurs d’objets ajoutés dans ce lot.
- Migration `008_effort_values.sql` et schéma neuf : six colonnes à zéro par défaut, aucune attribution rétroactive. Base locale sauvegardée avant migration dans `backups/before-effort-values-1791708726019.json` (privé, ignoré Git). Migration appliquée à la base de jeu et colonnes ajoutées sans réinitialiser la base de test. `mysqldump` n’étant pas installé, la sauvegarde contient schémas SQL et lignes dans un snapshot JSON transactionnel.
- La montée de niveau/l’entraînement préservent les blessures et le K.O. au lieu de soigner complètement. L’évolution conserve UUID, EV, capacités/PP, état et objet tenu. Les statistiques permanentes sont reconstruites à la lecture de l’équipe ; les overrides de combat ne remplacent plus les gains permanents après transformation/fin de combat. Les colonnes et événements historiques restent disponibles.
- Nouvel événement additif `battleExperience` envoyé au propriétaire après récompense ; la jauge bleue est visible en combat et dans l’équipe, avec annonce du gain/niveau. Musiques existantes : sauvage `msc/wild.mp3`, dresseur `extended.mp3`, arène `msc/arene.mp3`, PVP `msc/cyntia.mp3`. Volume commun, sourdine, pause quand l’onglet est masqué, arrêt à la fin, déconnexion et destruction du composant.
- 32 civils utilisent leur propre case dans deux atlas RGBA (sprite + portrait), sans réutiliser l’apparence d’un champion. Les cinq champions conservent leurs visuels. Voir `docs/PNJ_VISUELS.md` et les prompts associés. Les sprites civils sont actuellement des poses de face animées par translation/rebond, pas des planches directionnelles complètes.
- `pnjMovement.js` déplace les civils à 1–2 cases de leur ancrage seulement sur les cartes occupées, évite collisions, portes/abords, interactions et passages étroits, gèle les PNJ à l’approche d’un joueur. Les marchands, l’archiviste et les champions restent à leur poste. L’index serveur de collision/interaction suit chaque déplacement et le client interpole les positions. Aucun fichier Tiled/PNG de carte modifié.
- Vérification reproductible : `npm test`, `npm run test:mysql`, `npm run db:verify`, `npm run audit:content`, lint/build, puis `node --env-file-if-exists=.env scripts/validateAdventureViewports.js`. Les scripts utilisent des comptes temporaires sur la base de test. Captures complémentaires : `validateStoryViewports.js`, `validatePokedexViewports.js` et `BROWSER_PATH=/opt/google/chrome/chrome BATTLE_SCREENSHOT_DIR=BUILD_OUTPUT node --env-file-if-exists=.env scripts/validateBattleViewports.js`.

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

Les dossiers `server/`, `data/`, `database/`, `docs/` et `tests/` existent déjà. La structure ci-dessus est une possibilité ultérieure, pas une migration à lancer maintenant.

## 7. Plan d'action retenu — réconcilié le 14 octobre 2026

### Lot A — état réel et blocage de rendu — terminé

Revue des sources, mise à jour de cet audit et des documents associés, commandes de validation rejouées ; correction du chargement des huit intérieurs existants avec test échouant avant le correctif puis passant après. Le build courant sert les décors corrigés.

### Lot B — progression et premier chapitre — livré

Le défaut Dune → quête terminée avec un seul badge → Sylve qui la réactive a été reproduit, puis remplacé par un parcours narratif ordonné. À la demande du créateur, les champions retrouvés dans `phrase.txt` sont intégrés dans l’ordre explicitement approuvé : **Mounir → Hoze à Ocreville → Raphael à Floraville → Ana à Rochebourg → Wanda à Rivazur → Éloi et la lettre de Clara à Clairbois**.

`main_sister_search` désigne maintenant clairement le chapitre I « les premières traces », avec six étapes ; la disparition de Clara n’est pas résolue par quatre badges. Les drapeaux persistants déterminent le prochain objectif et les variantes des dialogues. Les prérequis sont vérifiés côté serveur lors du lancement et dans la transaction de récompense. La lecture autorisée de la lettre termine le chapitre et accorde le Sceau Sylve. Les clés de badges et anciennes récompenses restent conservées ; les nouveaux champions ont des clés de victoire distinctes des anciens champions générés. Les anciens statuts de quête incorrects sont recalculés à la lecture, puis persistés lors de la prochaine récompense ; aucune migration destructive.

Les nouveaux dialogues annoncent les niveaux, reprennent les indices du scénario d’origine et affichent une scène après victoire. Douze habitants combattants (deux par ville) ajoutent conseils et témoignages. La mère est accessible au village de départ. Timmy combat avec un Rattata niveau 5 ; Mounir a une équipe 18–20 ; les quatre champions progressent de 40 à 54. Les équipes sont configurables par `level`, avec talents déjà pris en charge, IV fixes et objets du catalogue. Les anciennes équipes restent archivées sans placement actif.

Preuves : `tests/story-content.test.js` contrôle liens de contenu, équipes, portraits, niveaux, talents et accès depuis chaque arrivée, avec les deux cases occupées par les PNJ. `tests/mysql-integration.test.js` couvre ordre, refus, doublons concurrents, anciennes sauvegardes et non-réouverture. `tests/story-socket-integration.test.js` joue réellement les combats et les dialogues sur serveur isolé, puis vérifie la reprise après reconnexion. La fixture de combat est volontairement renforcée : ce test ne mesure pas la difficulté humaine.

`TextWithImage.vue` s’adapte maintenant à la hauteur disponible, y compris à vitesse instantanée et en paysage. Le test Chromium du chapitre contrôle les quatre formats et la commande tactile réelle. Aucun fichier de carte, PNG de carte ou raccord n’a été modifié par ce lot. Build client reconstruit ; service local relancé le 11 octobre à 10 h 13, serveur et MySQL actifs, accueil `http://localhost:3000` vérifié HTTP 200.

### Lot B bis — niveaux et XP — livré

À la demande du créateur, la difficulté sauvage suit maintenant le parcours réel : village 5–7, routes initiales 8–25, grottes 26–35, route 4 35–38, routes générées 38–41 jusqu’à 57–60. Seuls les champs de niveau de `nextMap.json` changent ; aucun raccord ni fichier de carte n’est modifié. Les arènes 18–20, 40–43, 44–46, 48–50 et 52–54 prolongent les routes qui les précèdent. Les dresseurs de Clairbois passent à 54–55 et 56 ; leur dialogue annonce ces nouveaux niveaux.

`experience_balance.json` distingue sauvage ×1, dresseur ×1,5 et arène ×2. Le gain tient compte du niveau du receveur, avec facteur borné 0,25–1,5 ; courbe cubique, niveaux sauvegardés, potentiel et absence de plafond inchangés. Le moteur de dresseur omettait l’XP du dernier adversaire : défaut reproduit par test MySQL puis corrigé avec comptabilisation unique des K.O. Le bonus d’arène est transmis uniquement par la configuration serveur. `npm run audit:balance` et `tests/experience-balance.test.js` rendent l’équilibrage reproductible ; les tests MySQL/Socket vérifient les montants effectivement sauvegardés.

La cible théorique reste environ 3–4 victoires sauvages de même niveau par niveau de croissance standard, avec un bonus pour les combats de progression. Une recette humaine de plusieurs Pokémon reste nécessaire ; cette passe ne prétend pas mesurer le temps de parcours réel.

### Lot C — recette d'une partie et ergonomie mobile

Parcourir réellement nouveau compte → starter → prologue → premier combat → centre/boutique → région générée ; vérifier capture, défaite et reprise. Compléter par un PVP à deux navigateurs et le clavier physique ZQSD. Les tests techniques déjà réussis restent acquis, mais ne valent pas un parcours humain complet.

Sur téléphone : vérifier les contrôles tactiles, dialogues et menus Équipe/Sac/boutique. Leur harmonisation console portable est livrée, ainsi que la fiche Pokémon à onglets et une disposition de combat en paysage. La lecture audio est testée dans Chromium ; la politique de lecture automatique Safari/iOS reste à vérifier sur appareil réel (nouvelle tentative au toucher/clavier).

### Lot D — découpage et contenu manquant

Les premiers modules du lot du 14 octobre sont livrés (guide, décors, soins, collection, reprise). Continuer à extraire progressivement contrôles/canvas de `UserMap.vue`, handlers monde de `socketHandler.js`, puis familles du moteur de combat. Le chapitre II, les huit intérieurs peuplés et les soins/objets clés sont maintenant livrés. Restent les traductions, les futurs chapitres et la conclusion globale. Les 98 talents des familles ultérieures et le mode double restent des extensions distinctes.

Ne pas rouvrir comme travaux neufs : authentification, onboarding, persistance des badges, boutiques transactionnelles, extraction `BattleOverlay`, activation des 30 cartes générées, suppression des artefacts Git ou correction des niveaux de `route4`.

## 7 bis. Mode Drift — livraison jouable du 11 octobre 2026

### Règles retenues et lancement

La demande de continuation remplace le périmètre initial « conception + menu/lobbies ». Le mode est maintenant lançable depuis l’accueil **RiftMon** : salon public trouvé dans la liste ou privé par code, **2 à 16 participants (tous les effectifs entiers)**, **20/30/40/60/90/120/300 minutes**, nombre exact de joueurs connectés et tous prêts, puis lancement par l’hôte. Un changement de règles/composition annule les prêts ; après lancement, configuration verrouillée et aucune arrivée tardive. Le catalogue peut toujours être consulté avant de jouer.

Décisions explicites : **cinq emplacements**, **mort permanente partout**, **tournoi à élimination simple**. Aucun loser bracket ni résurrection pour permettre un match supplémentaire. L’exploration réutilise les cartes et niveaux du monde existant, conformément à la dernière demande ; aucune nouvelle carte, porte, transition, équipe de champion ou migration SQL dans ce lot.

Le compagnon initial est tiré parmi **49 espèces de premier stade**, sans légendaire/fabuleux/Ultra-Chimère, avec sprites avant/arrière déjà livrés. La liste blanche est dans `pokemonFactory.js`, contrôlée avec les assets par test. Niveau 5, IV 15 partout, nature neutre et potentiel 2 pour tous ; 10 Poké Balls, 3 Potions et 500 unités locales. Les attaques viennent du pool d’espèce avec puissance bornée et préférence STAB, au moins une offensive ; ce n’est pas un apprentissage officiel par niveau. Le modèle existant fournit XP, EV, statistiques et évolution.

### Monde et données isolées

`runManager.js` gère `exploration → transition → preparation → tournament → results`. Le namespace JWT `/drift` et le salon de préparation sont distincts du monde Aventure. Chaque joueur possède équipe, sac, monnaie, Drifts, position/retour de centre, victoires et combat propres à son expédition. Seule l’identité du compte est utilisée ; l’apparence initiale est générique. Les commandes ne chargent ni ne sauvegardent ces données dans les repositories Aventure.

`UserMap.vue` réutilise les cartes/canvas, déplacements autoritaires, dialogues, centres, boutiques et combats. Le menu Drift masque sauvegarde Aventure, quêtes, Pokédex et apparence ; l’équipe/les fiches, les objets tenus et les achats passent par les commandes de session. Les prérequis narratifs Aventure ne bloquent pas la course. Les équipes de PNJ conservent les niveaux du monde ; chaque dresseur/champion ne donne sa récompense qu’une fois par expédition. Fuir permet de retenter mais ne donne aucun butin.

Les cartes sont des ressources en lecture seule. `createPnjStore()` fournit un état de PNJ indépendant par expédition ; `tickRoaming` accepte ce store tout en conservant son comportement Aventure par défaut. Promenades, collisions et interactions sont synchronisées dans la partie concernée, sans mutation du store Aventure ou d’un autre lobby. Les PNJ restent immobiles à l’approche d’un joueur. Les positions des participants et leurs équipes privées ne sont envoyées qu’aux destinataires de leur partie.

**Stockage actuel : RAM du processus Node.** Recharger/reconnecter reprend le même compagnon et chrono tant que le serveur fonctionne ; un redémarrage perd tous les salons et expéditions, sans récupération. Un seul onglet contrôle un participant ; une nouvelle entrée remplace l’ancien contrôle. Grâce de reconnexion de 90 secondes, chrono non suspendu, puis forfait. Combat : jeton de tour anti-rejeu, 30 secondes pour agir puis choix automatique d’une capacité disponible. Un salon d’attente sans activité expire après deux heures ; une expédition lancée n’est pas concernée par cette purge ; les résultats restent deux minutes, puis leur appartenance est purgée. Le nettoyage d’une ancienne partie ne peut pas effacer un nouveau salon du même compte.

### Mort permanente et tournoi

Un Pokémon à zéro PV est marqué mort avant les soins et retiré après l’action : attaques, résidus, recul, pièges, reflets et coûts. Il ne peut pas être ressuscité par une régénération tardive. Sans compagnon vivant, le joueur est éliminé, disparaît du monde et perd équipe, objets, monnaie, Drifts et position de session. Pas de blackout Aventure. L’abandon est confirmé côté interface puis irréversible. Un seul survivant gagne immédiatement ; aucun survivant donne un résultat sans vainqueur.

À l’échéance, le serveur refuse les nouveaux gains/actions d’exploration, ferme les combats en attente sans victoire artificielle, conserve les pertes déjà résolues et soigne PV/PP/statuts des seuls survivants. Le timer affiché en haut utilise l’horloge serveur. Les commandes vérifient elles aussi la date limite, indépendamment du rafraîchissement visuel.

Les survivants sont téléportés dans **l’arène existante `ville1_arene`**, sur des places validées contre murs, passages et PNJ. Aucune nouvelle salle Tiled n’a été créée. Les paires sont tirées au sort à chaque round. Pour un nombre impair, un seul joueur est exempt : tirage parmi ceux ayant reçu le moins d’exemptions, puis mélange des autres survivants. Une exemption ne rapporte aucun gain. Les joueurs réorganisent leur équipe/Drifts dans le panneau, puis **« Prendre ma place et lancer mon duel »** confirme leur emplacement attribué et leur préparation. Les déplacements libres sont bloqués au tournoi ; il s’agit d’un placement automatique confirmé par bouton, pas d’une nouvelle mécanique de marche vers un socle.

Chaque paire démarre lorsque les deux participants sont prêts. Modifier l’équipe, un objet tenu ou les Drifts annule son prêt ; une fois en combat, composition verrouillée. Préparation limitée à 90 secondes : absent/non-prêt forfait. Les duels sont des combats serveur 1v1 utilisant toute l’équipe vivante, sans normalisation de niveau. Les douze Drifts de progression, captures, loot, XP, monnaie et consommables de sac sont inactifs au tournoi. Les effets de combat et objets tenus restent actifs.

Après tous les matchs d’un round, les seuls compagnons survivants sont soignés pour le suivant. Les morts ne reviennent jamais. Un double K.O. total élimine les deux ; le round suivant est recomposé à partir des vrais survivants. Les participants sans duel en cours et non prêts peuvent consulter le tableau ou regarder un duel de leur tournoi en direct, y compris après leur élimination. À la fin, même l’équipe du vainqueur est purgée. Un bilan séparé conserve désormais des copies consultables des équipes et du parcours, sans permettre de rejouer ces Pokémon ou objets. Aucun transfert permanent vers l’Aventure.

### Catalogue, cinq emplacements et économie

Référence : `vue-explorakit/catalogue_drifts_pokemon.xlsx`. `python3 scripts/importDriftCatalogue.py --check` vérifie exactement `data/game/drifts.json` et son empreinte. **59 effets, 280 variantes** : 12 offensifs, 10 défensifs, 10 contre/perturbation, 10 tactiques, 12 progression, 5 spéciaux. Les spéciaux n’existent qu’en Légendaire/Mythique ; les cellules vides sont indisponibles, jamais tirées comme valeur nulle. Le classeur reste inchangé.

Les instances ont un UUID serveur, définition, rareté et type éventuel fixé à l’obtention. Les cinq slots appartiennent au dresseur et concernent son équipe ; pas de doublon de définition équipé, même entre raretés différentes. Équiper/retirer est possible hors combat ; propriété, limites et phase sont vérifiées côté serveur. Supprimer demande une confirmation ; vendre/détruire un Drift équipé est refusé. Le panneau fournit descriptions, valeurs, recherche, soins et accès aux fiches/réorganisation. Aucun plafond d’inventaire ni suppression automatique n’est activé dans cette version.

Réglages initiaux de loot, ajustables après playtest :

| Issue du combat | Chance de Drift | Commun / Rare / Épique / Légendaire / Mythique, conditionnel au drop |
| --- | --- | --- |
| Sauvage vaincu ou capturé | 15 % | 55 / 27 / 12 / 5 / 1 % |
| Dresseur | 50 % | 35 / 33 / 20 / 10 / 2 % |
| Champion | 100 % | 15 / 30 / 30 / 20 / 5 % |

Après le tirage de rareté, la définition est tirée uniformément parmi les variantes disponibles. Chance du collectionneur augmente relativement la probabilité de drop, sans changer la rareté ; 15 % avec +40 % donne 21 %, pas 55 %. Les dresseurs/champions ont une meilleure distribution propre, conformément à la demande. Une capture réussie tire désormais un Drift avec la même chance et les mêmes raretés qu’une victoire sauvage ; le bonus Chance du collectionneur s’applique aussi. Une tentative ratée/refusée, une fuite, une défaite ou la répétition d’un PNJ vaincu ne donnent aucun Drift. Après une victoire uniquement, un loot supplémentaire de Ball/Potion a une chance de base de 20 %, modifiée par Chasseur de trésors.

**Butin de capture — ajustement demandé le 11 octobre.** `DriftBattle.finish()` accorde ce tirage une seule fois, après capture réussie et avant émission du bilan. `economy.drop()` reconnaît la source `capture` : aucun gain additionnel d’XP, argent, Ball/Potion ou soin de victoire. Le Drift rejoint l’inventaire et `endbattle.summary.loot` ; `runReport` conserve le compteur et la provenance `capture` dans le souvenir. Les modes Aventure et tournoi ne reçoivent pas cette récompense. Le conseil du sac vide mentionne maintenant les captures. Vérifications reproductibles : `node --test tests/drift-runtime.test.js tests/drift-report.test.js tests/drift-effects.test.js` (seuil 15 %, bonus relatif, rareté, échecs/refus, pas de double butin, archives) puis `npm test` : **217 tests, 195 réussis, 22 MySQL ignorés**. Syntaxe des cinq JS modifiés, lint et build client réussis ; recettes SQL précédentes non relancées pour ce changement sans persistance Aventure. `VISUAL_TEST_SERVER_PORT=31635 VISUAL_TEST_DEBUG_PORT=31636 node --env-file-if-exists=.env scripts/validateDriftRun.js` réussi : vraie capture, un Drift au bilan, Balls 10→9→8 sans bonus, deux trouvailles capture/champion dans l’archive, tournoi et quatre formats ; neuf tables Aventure identiques, aucune exception navigateur. Capture mobile inspectée : `docs/validation/drift-capture-loot-mobile.png`.

Revente depuis le panneau Drifts **dans une boutique existante**, contrôlée par la carte serveur comme les achats classiques. Pas besoin d’un nouveau vendeur/case. Prix 50/120/300/800/2000, augmentés par Œil du marchand ; suppression et crédit synchrones, deuxième vente du même UUID refusée. Les boutiques proposent aussi Potion (100, 20 PV) et Super Potion (300, 60 PV), utilisables hors combat via l’onglet Équipe ; jamais sur un mort. Économie de soins et Symbiose fonctionnent avec ces soins. Les économies Aventure et Drift restent séparées.

`data/game/drift_encounters.json` définit explicitement les espèces rares et leurs poids (25 contre 100 pour les communes), uniquement dans les pools de cartes déjà présents. Recherche rare augmente leur poids relatif ; aucune rareté n’est déduite de la somme des statistiques. Les légendaires sont exclus. Cartes, espèces disponibles et niveaux restent ceux du monde, mais ces poids sont propres à Drift. Cette configuration est une convention de balance locale, pas une rareté officielle Pokémon.

### Habillage des menus Drift — seconde passe du 11 octobre

Refonte demandée après retour visuel du créateur : `DriftLobby.vue`, `DriftRunPanel.vue` et le cartouche Drift de `UserMap.vue` reprennent la direction console portable des fiches Pokémon. Bleu nuit, ivoire, or discret et menthe ; cadres fins à double liseré, boutons tactiles, titres plus légers. `DriftGlyph.vue` fournit des pictogrammes SVG communs aux familles d’effets et aux commandes, avec couleurs de rareté. Aucun asset de carte ni règle de jeu n’est modifié.

Le salon présente une illustration composée de sprites Pokémon locaux, des choix taille/durée compacts, des places de dresseurs illustrées et un parcours en trois étapes. Les sièges reflètent le salon réel (tous les effectifs de 2 à 16 depuis la passe RiftMon). Le catalogue garde sa recherche, ses valeurs et sa sélection de rareté ; les proportions de loot ne sont plus affichées comme si elles étaient universelles à toutes les sources.

Le carnet en jeu utilise un en-tête, des onglets et un pied de panneau fixes, avec défilement intérieur. Les cinq emplacements, l’inventaire à icônes et le détail du Drift sélectionné remplacent les longues cartes répétées. Ordinateur : détail à droite, combinaison/sac à gauche. Téléphone : sélection → fiche → retour au sac, les emplacements reviennent avec le sac. Les commandes restent Équiper/Retirer, Vendre en boutique et Supprimer avec confirmation ; limite de cinq et doublon signalés avant envoi. Les refus serveur restent affichés dans le pied du carnet.

L’onglet Équipe utilise les portraits existants recadrés, PV graphiques et potions ; le tournoi dispose de cartes de duels, repères de round/finale, état prêt et vainqueur. Le chrono devient un cartouche compact à droite, sans recouvrir le menu monde. Navigation clavier : flèches/Début/Fin entre les onglets, focus contenu dans les dialogues, Échap annule une confirmation puis ferme/revient, focus rendu à la commande d’ouverture. Aucune nouvelle animation imposée.

Vérification reproductible : build puis `node --env-file-if-exists=.env scripts/validateDriftViewports.js` et `node --env-file-if-exists=.env scripts/validateDriftRun.js`. Le premier contrôle salon réel, 16 places, sprites et catalogue ; le second clique réellement sur cinq équipements, recherche/inspecte un Drift, vérifie le sixième refusé, annule une suppression au clavier, inspecte l’équipe et joue le tournoi. Chaque écran est capturé en 1440×900, 390×844, 320×568 et 844×390. Les scripts comparent aussi les données Aventure et utilisent les comptes/serveurs de test habituels. Captures dans `BUILD_OUTPUT` et `BUILD_OUTPUT` ; preuves visuelles mises à jour sous `docs/validation/drift-*.png`.

Cette passe est exclusivement visuelle et ergonomique : lint sans correction automatique, build, syntaxe des deux scripts et parcours navigateur constituent ses vérifications. Les résultats des tests métier/MySQL du lot précédent restent conservés dans l’audit, sans prétendre les avoir rejoués pour ces styles. Le client compilé se charge après rafraîchissement de la page.

### Accès au camp Drift — correctif du 11 octobre

Le message « Le camp est inaccessible » venait de l’ancienne instance Node sur le port 3000 : sa réponse Socket.IO était `Invalid namespace`, car elle avait démarré avant l’ajout de `/drift`. Le compte connecté n’était pas en cause. Après contrôle de l’absence de connexions sur cette instance, elle a été arrêtée puis remplacée par `npm start` avec le code actuel.

`services/realtime.js` distingue maintenant les refus d’authentification existants, le namespace absent et une panne de transport. `DriftLobby.vue` propose la reconnexion au compte uniquement pour une session refusée ; les autres erreurs proposent de réessayer en conservant le compte. Cette action relit le jeton courant et rappelle `connect()`, nécessaire après un refus de namespace que Socket.IO ne retente pas automatiquement. Le bootstrap est invalidé à chaque déconnexion ou tentative.

Vérification reproductible : `node --test tests/drift-connection.test.js tests/drift-socket.test.js`. Le nouveau test utilise de vraies sockets : refus du namespace puis activation et reconnexion avec la même session, jeton absent/invalide, serveur arrêté. `npm test` : 157 réussis, 16 MySQL ignorés ; lint sans correction et build réussis. Une vérification Chromium du client compilé sur le port 3000 a confirmé la connexion, les 59 définitions, la création d’un salon, le bouton Prêt et le départ. Identité de diagnostic temporaire, salon supprimé ensuite, aucune écriture SQL. Les tests MySQL et les parcours de combat n’ont pas été relancés pour ce correctif de connexion.

### HUD, sac et impression de blocage — correctifs du 11 octobre

Le chrono Drift était positionné en absolu sur le nom du lieu. `UserMap.vue` place maintenant Menu, chrono et bouton Drifts dans un même en-tête, avec le lieu sur une seconde rangée. Le bouton du carnet ferme les panneaux précédents et relâche les touches de déplacement. La structure Aventure garde sa disposition existante.

L’ouverture du sac Drift recopiait un ancien `driftState.items` et pouvait écraser les quantités les plus récentes de `bagUpdated` ou d’un achat. Les états de session, captures, boutiques et objets tenus passent maintenant par `applyBagItems` ; ouvrir le sac conserve ce dernier état. Avant réception de l’expédition, le sac affiche un chargement. Après élimination/fin, il explique la suppression de ses objets temporaires au lieu d’afficher seulement « Sac vide ». Le fond noir hérité des lignes du sac est remplacé par de l’ivoire, avec noms/quantités en 13 px et contraste lisible dans les deux modes.

La capture fournie affichait réellement `phase: results` : les déplacements bloqués et le sac purgé sont alors la règle de fin de partie. Aucun crash serveur ou navigateur reproduit sur l’aller-retour `start → maison → start`, avec rechargement du navigateur dans la maison. Cette preuve ne certifie pas toutes les transitions : le lieu exact du blocage signalé n’a pas encore été précisé. Une expédition à deux se termine aussi si le second joueur dépasse les 90 secondes de reconnexion ; ce scénario a été reproduit. `runManager.js` distingue désormais `disconnected` de `forfeit` et expose la raison publique par participant. `DriftRunPanel.vue` présente un vrai bilan lorsque la partie finit avant le tournoi, explique les pertes temporaires et affiche la cause du forfait.

Vérifications reproductibles :

- `node --test tests/drift-socket.test.js tests/drift-runtime.test.js` : relève salon → socket monde, vraie porte aller/retour, même compagnon/sac/échéance, reprise avant 90 secondes puis forfait après expiration ; aucune modification de cartes.
- `npm test` : 174 tests, 158 réussis et 16 MySQL ignorés. Lint sans correction automatique et build client réussis.
- `node --env-file-if-exists=.env scripts/validateDriftRun.js` après build : avant les fixtures de combat, contrôle de l’entrée normale, des 10 Balls/3 Potions et des intersections du HUD dans quatre formats. Traversée au clavier, reconnexion dans la maison et retour avec équipe/échéance intactes ; une Ball consommée réellement puis sac de combat et sac monde rouverts à neuf. Tournoi complet puis seconde expédition terminée par déconnexion adverse : bilan, raisons et purge vérifiés. Aucune exception JavaScript ; neuf tables Aventure identiques avant/après.
- `VISUAL_TEST_SERVER_PORT=31245 VISUAL_TEST_DEBUG_PORT=31246 node --env-file-if-exists=.env scripts/validateAdventureViewports.js` : fiche, PNJ, musique et XP toujours valides dans quatre formats. Tests MySQL complets non relancés pour ce lot.

Les captures du HUD, du sac, de l’intérieur et du bilan sont générées sous `BUILD_OUTPUT` ; cinq preuves inspectées sont archivées dans `docs/validation/drift-run-{world-desktop,world-small-mobile,bag-mobile,travel-mobile,early-results-mobile}.png`. La durée des combats et les délais sont accélérés uniquement dans le processus de test ; pas d’endpoint de manipulation ajouté au serveur de jeu.

### Exécution des effets et limites de recette

`driftEffects.js` contient les effets de combat ; `economy.js`, `pokemonFactory.js` et `driftBattle.js` raccordent progression, rencontres, capture et récompenses. Le moteur commun expose des points d’entrée optionnels ; le contexte est un `WeakMap` enregistré uniquement pour les Pokémon d’un combat Drift. Sans contexte, pas de bonus ni règle de mort supplémentaire en Aventure. L’orchestrateur Drift réutilise le moteur sans appeler les orchestrateurs persistants Aventure.

Conventions de départ : bonus offensifs additionnés et plafonnés à +200 %, réductions combinées à 60 %, précision/probabilités bornées. Les multiplicateurs offensifs s’appliquent aux dégâts calculés ordinaires, pas aux valeurs fixes/K.O. direct ; bouclier et survie s’appliquent aux coups directs via le point de dégâts. Immunités et protections du moteur restent prioritaires. Les PV/soins sont arrondis à l’entier inférieur ; un très petit pourcentage peut donc donner zéro à bas niveau, à mesurer en playtest.

Double impact applique 30 % des dégâts directs effectifs supplémentaires, sans déclencher d’autres Drifts ; reflets et vampirisme ne récursent pas sur les résidus. Une action impossible n’est pas un raté. Premier sang/Distorsion partagent un état d’équipe par combat ; survie et bouclier ont un verrou par Pokémon conservé malgré les switches. Seconde chance et Phénix partagent le verrou de survie, Phénix prioritaire. Pacte peut tuer avant la régénération. Esprit de meute compte les alliés perdus dans le combat (max. 3), Réaction en chaîne garde ses cumuls d’exploration (max. 5), remis à zéro au tournoi et lors d’une mort alliée. Diversité utilise les types des vivants (max. 6). Symbiose répartit le soin effectif, une seule fois, hors morts.

Les scénarios automatisés couvrent les familles d’effets, récompenses, immunités, propriété et combinaisons sensibles ; ils ne prouvent pas les 280 variantes dans toutes les combinaisons de capacités/talents. Restent à jouer humainement : parties de 20/30/60 minutes, rythme réel de collecte/XP, avantage des Drifts rares, équilibre des soins faibles, audio/tactile sur appareils physiques et combats PVP prolongés. Les limites de talents déjà documentées pour le moteur commun restent applicables. Aucun stockage durable/reprise après crash, matchmaking public, chat Drift ou spectateur de duel dans ce lot.

### Vérifications reproductibles

- `npm test` : salons, runtime, effets et Socket Drift, plus régressions existantes. Arbres réellement résolus pour tous les effectifs de 2 à 16, exemptions, K.O. permanent et double K.O., soins entre rounds, déconnexions, ordre d’équipe, propriété des instances, gains uniques et PNJ isolés.
- `npm run test:mysql` : 16 tests Aventure réussis après raccord du moteur commun.
- `python3 scripts/importDriftCatalogue.py --check` : 59 définitions et 280 variantes conformes au classeur.
- `npm --prefix vue-explorakit run lint` puis `npm run build:client` ; audits capacités/talents/contenu réussis.
- `node --env-file-if-exists=.env scripts/validateDriftRun.js` après build : lance son serveur de test/Chromium et deux comptes temporaires, salon → monde/chrono → équipement de cinq Drifts/refus du sixième → victoire PNJ et drop → échéance → téléportation → duel → vainqueur/purge → retour au salon. Fixtures fortes et horloge accélérée via **IPC du processus de test seulement**, aucun endpoint de triche en production.
- Le script compare avant/après les neuf tables Aventure pour les deux comptes. Captures 1440×900, 390×844, 320×568 et 844×390, sans débordement ; vérification du retour au défilement normal en quittant le jeu. Captures sous `BUILD_OUTPUT`, exemples archivés dans `docs/validation/drift-run-*.png`.

Activation locale : client compilé dans `dist/` ; recharger la page pour le nouvel affichage. Le serveur sur 3000 a été relancé le 11 octobre après diagnostic du refus d’accès au camp. Les ajouts ultérieurs des raisons `disconnected` par participant, des résumés détaillés de combat et des souvenirs complets d’expédition, puis de RiftMon (salons ouverts, nouveaux effectifs/durées, spectateur et compte SQL) nécessitent son prochain redémarrage. Des connexions restent présentes : cette instance est conservée pour ne pas effacer une expédition en mémoire. Les vérifications du nouveau backend utilisent des serveurs séparés. Démarrer une deuxième instance sur 3000 produirait `EADDRINUSE`.

### Souvenirs d’expédition — équipes et parcours de tous les joueurs

`runReport.js` suit les événements autoritaires Drift et prend des copies avant les retraits définitifs et la purge : compagnon initial, Pokémon capturés/perdus, dernière équipe conservée, composition à l’entrée du tournoi, niveaux, nature, potentiel, statistiques, IV/EV et capacités. Il conserve aussi la combinaison de cinq Drifts, le butin vendu/supprimé, les objets et l’argent restants, les lieux visités, les matchs et un journal horodaté. Les compteurs portent sur les combats et leur issue, les Balls réellement lancées, captures, pertes, XP/niveaux, argent gagné/dépensé, soins et pas acceptés par le serveur.

Le champ **additif `drift:state.report`** n’est transmis qu’en phase `results`. Aucun adversaire n’obtient la composition des autres pendant l’exploration ou la préparation. Le rapport JSON version 1 est détaché des modèles de jeu puis figé une seule fois ; les équipes actives restent purgées, y compris celle du vainqueur. Aucun repository Aventure ni schéma SQL n’est modifié. Limites par joueur : 500 événements récents et 1 000 entrées par collection Pokémon/Drifts, avec compteurs d’omission ; les totaux statistiques restent conservés.

`DriftRunReport.vue` présente les équipes de tous les joueurs, des faits marquants avec égalités, puis les fiches, Drifts, statistiques et journal du dresseur sélectionné. Les longues rubriques se déplient ; le journal se lit par groupes de 40. L’arbre final reste disponible sous le bilan. Les anciens serveurs, sans `report`, gardent leur écran de résultats compatible.

`UserMap.vue` enregistre automatiquement le bilan complet reçu dans `driftReportHistory.js` : **jusqu’à dix souvenirs par compte sur cet appareil**, accessibles depuis le camp via `DriftLobby.vue`, avec export JSON complet. Clé locale `explorakit:drift-reports:v1:<id>`, budget de deux millions de caractères ; en cas de quota les anciens souvenirs cèdent la place. Un stockage bloqué ou un bilan trop volumineux ne ferme pas le jeu et propose l’export. Les archives ne restaurent jamais une équipe jouable. Elles ne sont ni synchronisées entre appareils, ni récupérables après effacement du stockage du navigateur ; un participant parti avant de recevoir le résultat final n’a pas d’archive automatique de cette partie.

Vérifications reproductibles :

- `node --test tests/drift-report.test.js tests/drift-report-history.test.js` : dix tests, dont snapshots avant purge, absence de fuite d’équipes, rapport figé, capture, récompenses réelles, pertes partielles/totales, double K.O., abandon, timer, déconnexion, noms de PNJ, collections bornées, ordre des cinq slots et historique par compte avec quotas/corruption.
- `npm test` : 189 tests, 173 réussis, 16 MySQL ignorés. Lint client sans correction et `npm run build:client` réussis ; syntaxe des quatre modules Drift et du validateur contrôlée. Les tests MySQL complets du lot précédent ne sont pas revendiqués comme relancés ici.
- `node --env-file-if-exists=.env scripts/validateDriftRun.js` : serveur de test isolé, vraie capture avec Ball, victoire PNJ/drop, duel final et purge. Comparaison des bilans reçus par les deux joueurs, XP/monnaie du bilan de combat, équipes finale/tournoi et pertes. Quatre formats (1440×900, 390×844, 320×568, 844×390), lecture des fiches et du journal, export téléchargé puis parsé et comparé au payload complet, souvenir rouvert depuis le camp après rechargement. Neuf tables Aventure identiques avant/après, aucune exception JavaScript. Les fixtures de puissance et d’horloge restent limitées à l’IPC du serveur de test.

Captures sous `BUILD_OUTPUT,results-opponent,report-pokemon,report-journal,report-archive}-*.png` ; preuves inspectées archivées sous `docs/validation/drift-report-*.png`. Recette tactile sur appareil physique et longues parties humaines encore à confirmer. Le serveur personnel avec connexions actives est conservé ; les parties déjà lancées avant cette collecte ne peuvent pas produire rétroactivement ce bilan.

### RiftMon — accueil, groupes impairs, spectateur et compte persistant

Demande du 11 octobre : identité **RiftMon en bleu**, recherche de salons ouverts, effectifs impairs, deux heures d’exploration et suivi du compte. Les noms techniques `/drift`, événements `drift:*` et objets « Drifts » restent compatibles. L’utilisateur a confirmé **cinq emplacements** et **Aventure habituelle pour le bouton solo**. La prime fixe initiale a été remplacée, à sa demande, par un montant dépendant de l’effectif au départ et du temps d’exploration réellement joué, tournoi exclu (barème ci-dessous). La boutique du compte est volontairement désactivée avec la mention « Bientôt ».

Après connexion/inscription, l’accueil affiche le camp RiftMon : victoires, défaites, parties commencées, pièces, salons publics cherchables par hôte/code, création publique/privée et entrée par code. Les liens d’authentification avec destination explicite continuent de fonctionner. Le bouton solo en bas quitte d’abord le salon d’attente éventuel puis ouvre `/game`. La recette a exposé une connexion Aventure inactive après le camp : le manager Socket.IO partagé conservait `autoConnect: false`. `UserMap.vue` appelle désormais `connect()` explicitement dans les deux modes, après pose des listeners ; couvert par le vrai `mounted()` avec serveur Socket et par le navigateur. Un profil indisponible affiche un état d’erreur et des tirets, jamais de faux zéros. Le catalogue et les dix souvenirs locaux restent consultables.

`lobbyStore.js` accepte tous les effectifs de **2 à 16** et les durées **20, 30, 40, 60, 90, 120, 300 minutes**. Un salon n’est listé que s’il est public, non lancé, non complet et avec hôte connecté. Une ancienne création sans `visibility` reste privée ; le nouveau client propose explicitement le choix. `drift:list` et `drift:lobbies` sont additifs, sans changer les commandes existantes.

Le menu en jeu ajoute l’onglet **Survivants** : identité, présence/reconnexion, exploration/combat/préparation, puis liste repliable des éliminés et raisons. Aucune équipe adverse révélée. Le tournoi retire le remplissage à la puissance de deux : **cinq joueurs donnent deux duels et une exemption**, puis nouveau tirage du round suivant. Les exemptions sont réparties en priorité parmi ceux qui en ont eu le moins. Les soins, pertes définitives et préparation de 90 secondes sont conservés.

`drift:spectate {matchId}` et `drift:stopSpectating` nécessitent le compte authentifié et son unique connexion de contrôle. Seul un participant du même tournoi, sans combat en cours et non prêt pour son propre duel, peut regarder. `drift:spectator` transmet uniquement identité des deux dresseurs, Pokémon actifs, niveaux/PV/statuts, tour et journal public ; aucune réserve, IV, capacité non jouée, combinaison ou jeton d’action. La vue se termine sur le résultat, se ferme au changement de contrôle/round/déconnexion, et ne reçoit jamais les événements de commande des combattants. Le monde sous la fenêtre est inerte, focus et touches sont capturés, retour au tableau possible à tout moment. Le gagnant d’un duel peut aussi suivre un autre duel encore en cours.

La migration additive **`010_rift_accounts.sql`** crée `rift_profiles`, `rift_runs`, `rift_run_entries`, sans modifier les neuf tables Aventure. `GET /api/rift/profile` lit le compte du JWT uniquement. `riftAccountRepository.js` compte les parties au lancement réel, puis les victoires/défaites et **la prime calculée pour le vainqueur**. Identifiant unique, empreinte des participants, transactions et registre SQL immuable empêchent les doubles crédits et comptent aussi les joueurs ayant quitté avant le bilan. Une partie sans vainqueur donne une défaite à chacun, aucune pièce. Les déconnexions expirant au même tick sont éliminées en lot avant résolution : aucun dernier compte absent ne gagne par simple ordre de parcours (tests 2/3/5 en exploration et tournoi). Les comptes existants commencent à zéro pour ces nouvelles statistiques ; pas de résultat historique inventé.

Le serveur attend la transaction de lancement avant d’ouvrir l’expédition et verrouille les changements de salon pendant cette attente. Un échec de règlement final est réessayé toutes les cinq secondes ; le résultat est conservé en mémoire au-delà de son délai habituel tant que le règlement reste en attente. `drift:state.settlement` informe le bilan de l’état pending/complete et du montant crédité. Les pièces de compte sont distinctes de la monnaie éphémère Drift et des Pokédollars Aventure.

**Limite de reprise :** salons, équipes temporaires, combats et règlements en attente restent en RAM. Un arrêt du processus perd l’expédition et un règlement non confirmé ; le registre SQL conserve la partie commencée, mais ne fabrique pas automatiquement une issue. La reprise durable des parties après crash est un chantier séparé. Les bilans détaillés restent les archives locales décrites ci-dessus, pas un historique SQL complet. Un incident réseau après COMMIT de lancement, suivi d’un changement de composition avant réessai, peut laisser une partie commencée sans déroulement ; une même composition réessaie avec le même identifiant pour éviter le double comptage.

Migration appliquée aux bases locales de jeu et de test sans réinitialisation. Avant la base de jeu : snapshot transactionnel privé `backups/before-rift-accounts-1791725261401.json` (schémas + lignes, mode 0600). `npm run db:verify` confirme désormais **12 tables métier et 11 migrations**, après l’ajout de la durée de récompense décrit ci-dessous. Ailleurs, exécuter `npm run db:migrate` avant le redémarrage.

Vérifications reproductibles : `npm test`, `npm run test:mysql`, lint sans correction et build ; `tests/rift-spectator.test.js` vérifie par Socket réel accès, confidentialité, commandes refusées, changement de contrôle, fin et sortie. `tests/rift-account-mysql.test.js` couvre concurrents, doubles crédits, composition immuable, rollback réel et API JWT. Recette navigateur : `node --env-file-if-exists=.env scripts/validateRiftMon.js`, avec trois comptes temporaires sur base de test, horloge accélérée par IPC privé et aucune commande de triche en production. Le scénario historique `scripts/validateDriftRun.js` et la recette du camp `scripts/validateDriftViewports.js` restent disponibles. Les trois recettes sont réussies sur le client compilé. La nouvelle vérifie un vrai duel entre deux sockets avec un troisième joueur au navigateur spectateur, sa finale gagnée, les deux défaites, le crédit SQL unique, le profil après rechargement, l’archive des trois équipes et le retour Aventure connecté. Neuf tables Aventure identiques avant/après les expéditions, aucune exception navigateur. **215 tests standards (193 réussis, 22 ignorés), 22/22 MySQL, 113 syntaxes, lint et build réussis**. Captures du parcours RiftMon : 13 écrans × quatre formats sous `BUILD_OUTPUT` ; cinq preuves inspectées copiées sous `docs/validation/riftmon-*.png`. Durée de 2 h accélérée dans la fixture, pas de revendication d’un playtest humain de deux heures.

### Prime RiftMon variable — effectif et exploration réellement jouée

Le forfait initial de 100 pièces est remplacé par **`floor(2,5 × nombre de joueurs au lancement × durée réelle d’exploration en minutes)`**, uniquement pour le vainqueur. Choix utilisateur explicite : **le tournoi ne rapporte pas de temps supplémentaire**. Les secondes et millisecondes sont prises en compte avant l’arrondi final à la pièce inférieure ; pas d’arrondi à la minute entière ni de prime minimale artificielle.

| Participants au départ | Exploration réelle | Pièces au vainqueur |
| --- | --- | --- |
| 2 | 20 min | 100 |
| 3 | 5 min | 37 |
| 4 | 30 min | 300 |
| 8 | 60 min | 1 200 |
| 16 | 120 min | 4 800 |
| 3 | 300 min | 2 250 |
| 16 | 300 min | 12 000 |

`server/game/drift/accountReward.js` centralise le barème version 1. `runManager.js` conserve l’effectif initial et fige `explorationMs` à l’entrée du tournoi, ou à la victoire anticipée ; calcul borné par le vrai départ après transaction, la fin d’exploration prévue et 300 minutes maximum (borne partagée avec les durées autorisées des salons). Préparation, duels, résultats et réessais SQL n’augmentent jamais ce temps. Les abandons et éliminations ne réduisent pas l’effectif initial. Un résultat immédiat peut rapporter zéro pièce ; sans vainqueur, chacun garde sa défaite mais personne n’obtient de pièce.

Le repository calcule le montant depuis **`rift_runs.participant_count`**, indépendant de la liste finale transmise. Durée/version de récompense et crédits sont enregistrés dans la même transaction. `011_rift_reward_duration.sql` ajoute seulement `reward_exploration_ms` et `reward_version`, tous deux nullables ; aucune réécriture d’un solde ou d’un ancien résultat. Un rejeu relit `rift_run_entries.coins_earned` : il ne recalcule pas avec un nouveau temps, un autre effectif ou un barème ultérieur. Les anciennes primes de 100 pièces restent donc intactes et sans détail historique inventé. Une durée absente ou invalide est refusée pour un nouveau règlement, pas pour la relecture d’un résultat déjà enregistré.

Le salon affiche une **estimation maximale** selon effectif/durée choisis, avec rappel du prorata en cas de fin anticipée. Le champ additif `report.accountReward` conserve le calcul prévu dans le bilan et les archives locales ; `settlement.reward` contient les mêmes paramètres confirmés par SQL. Seul `settlement.status === complete` annonce un crédit effectué ; un carnet seul présente une prime calculée. Les anciens rapports sans ce champ restent lisibles. Les pièces du compte n’affectent ni la monnaie Aventure ni l’argent temporaire Rift.

Migration 011 appliquée aux bases locales de jeu et de test, sans réinitialisation, après snapshots privés des trois tables Rift et du registre de migrations : `backups/before-rift-reward-pokemon_game-1791726069988.json` et `backups/before-rift-reward-pokemon_game_test-1791726069998.json` (0600). `npm run db:verify` conforme sur la base de jeu. Sur une autre installation, appliquer `npm run db:migrate` avant redémarrage.

Vérifications reproductibles :

- `node --test tests/rift-reward.test.js tests/rift-spectator.test.js` : barème 2–16, secondes/arrondi, zéro, bornes, fin précoce, effectif initial, attente/rounds du tournoi exclus, réessai SQL et absence de faux vainqueur.
- `npm test` : **228 tests, 203 réussis, 25 MySQL ignorés**, aucun échec. `npm run test:mysql` : **25/25**, dont gains 100/7/375/21/4 800/0, roster initial malgré un départ, concurrence, rollback, rejeu modifié et conservation de l’ancien forfait.
- Syntaxe des **115 fichiers JS**, lint sans correction et build réussis. `node --env-file-if-exists=.env scripts/validateRiftMon.js` : salon 3/120, estimation900, tournoi réel/spectateur, crédit unique900, détails cohérents, profil et carnet après rechargement, retour Aventure connecté ; quatre formats, aucune exception et neuf tables Aventure inchangées. Les deux heures sont accélérées par l’IPC de test uniquement.
- Preuves inspectées : `docs/validation/rift-reward-results-mobile.png`, `rift-reward-lobby-small-mobile.png` ; ensemble des captures sous `BUILD_OUTPUT`.

Client compilé et base migrée ; l’instance personnelle encore connectée sur 3000 est conservée. Le nouveau calcul nécessite son redémarrage, comme les fonctionnalités serveur des lots précédents. Les limites de reprise des parties/règlements en RAM restent celles décrites plus haut.

### Durées d’expédition — sept choix jusqu’à cinq heures

À la demande du 11 octobre, ajout de **40 minutes et 5 heures**, aux côtés de 20 min, 30 min, 1 h, 1 h 30 et 2 h. Le serveur reste autoritaire sur ces sept choix, à la création comme à la modification du salon. Le client utilise la liste reçue du serveur et le même ensemble en repli. Les sept boutons se répartissent sur deux lignes, avec cibles tactiles d’au moins 44 × 44 px, y compris à 320 px de largeur. L’accueil annonce désormais cinq heures maximum.

`accountReward.js` déduit sa borne de la durée maximale de `lobbyStore.js` : exploration réelle rémunérée jusqu’à 300 minutes, toujours au prorata et sans compter le tournoi. Exemple : trois participants et cinq heures complètes donnent **2 250 pièces** au vainqueur ; seize participants donnent **12 000 pièces**. Aucun nouveau schéma SQL nécessaire. Les salons d’attente inactifs expirent toujours après deux heures ; les expéditions lancées en sont exclues, ce qui est explicitement testé au passage des deux heures puis au déclenchement du tournoi à cinq heures.

Vérifications reproductibles : `npm test` (**229 tests, 204 réussis, 25 MySQL ignorés**), `npm run test:mysql` (**25/25**, dont crédits 40 et 300 minutes), syntaxe des **115 JS**, lint sans correction et build réussis. `node --env-file-if-exists=.env scripts/validateRiftMon.js` contrôle les sept boutons dans quatre formats, l’estimation 3 × 40 = 300 pièces, puis la création 3/300, le tournoi réel avec spectateur, le crédit unique de 2 250 pièces et sa relecture dans le profil et le carnet. **56 captures**, aucune exception navigateur, neuf tables Aventure inchangées. Horloge accélérée par IPC privé ; aucun playtest humain de cinq heures revendiqué. Captures inspectées : `docs/validation/rift-duration-choices-small-mobile.png` et `docs/validation/rift-duration-results-mobile.png`.

Client recompilé ; activation des nouvelles durées après redémarrage de l’instance serveur personnelle, conservée pour préserver les parties en mémoire. Aucun fichier de carte modifié.

## 7 ter. Bilans de combat — Aventure et Drift, 11 octobre 2026

L’événement `endbattle` était reçu puis ignoré par `UserMap.vue`, qui fermait immédiatement le combat. Le nouveau `BattleResultPanel.vue` présente explicitement Victoire, Défaite, Capture réussie, Combat quitté, Match nul ou Combat interrompu. Il reprend les cadres ivoire/bleu nuit/or du jeu, avec une zone de détails défilante et un bouton Continuer toujours accessible. Aucun délai de fermeture automatique.

Le résultat intercepte les commandes clavier/tactiles, relâche les touches déjà enfoncées et rend le monde sous-jacent inerte. Entrée, Espace, Échap ou Continuer ferment le bilan ; le focus reste dans le dialogue. Les dialogues d’après-combat et le carnet du tournoi attendent sa fermeture ; le soin/retour au centre reçu par `blackout` complète le bilan. Le temps serveur Drift continue de s’écouler et cette règle est rappelée dans le panneau.

Le champ additif `endbattle.summary` contient `outcome`, `mode`, `experience`, `money`, `loot`, `capturedPokemon`, `lostPokemon`. Un suivi du début/fin de combat calcule les deltas d’XP réellement acquis par Pokémon et les niveaux avant/après. L’argent est enregistré après attribution réussie, y compris les primes des champions ; les chaînes de butin Drift viennent directement du tirage réalisé. Capture, pertes et gains sont figés avant la purge de l’expédition. En Aventure, les K.O. ne sont pas présentés comme des pertes définitives. Aucun changement de récompenses, probabilités, mort permanente ou persistance dans ce lot.

`services/battleResult.js` conserve la compatibilité avec les serveurs envoyant seulement `reason`, `playerWon`, `captured`, `fled` et `draw`. Une fuite adverse en PVP ne devient pas une fuite du vainqueur ; timeout/fin du chrono ne deviennent pas des défaites. Sans résumé enrichi, le client affiche l’issue connue sans inventer de montants. **Le serveur personnel encore en cours utilise cette compatibilité ; les gains détaillés s’activeront après son prochain redémarrage.** Le client compilé est déjà servi après rechargement de la page.

Vérifications reproductibles :

- `npm test` : 179 tests, 163 réussis et 16 MySQL ignorés ; scénarios finaux Aventure/PVP/Drift, suivi XP/argent/capture/pertes et ancien protocole client.
- `npm run test:mysql` : 16/16 réussis ; capture, victoire, défaite, fuite réelles et récompenses des cinq arènes comparées aux soldes SQL.
- `npm --prefix vue-explorakit run lint -- --no-fix` puis `npm run build:client` ; syntaxe ciblée et contrôle des diffs réussis.
- `VISUAL_TEST_SERVER_PORT=31335 VISUAL_TEST_DEBUG_PORT=31336 node --env-file-if-exists=.env scripts/validateBattleResults.js` : issues injectées par Socket dans un serveur de test, puis vraie capture Aventure via orchestrateur, Ball et sauvegarde. Six anciens payloads, quatre formats, focus, blocage des déplacements et reprise après confirmation. Séquences Socket simulées : `endbattle → dialogue` conserve la première phrase et attend Continuer avant sa lecture ; `endbattle → blackout` complète le message de soin sans fermer le bilan. Aucun endpoint de test livré au jeu.
- `node --env-file-if-exists=.env scripts/validateDriftRun.js` : vraies fins de fuite, victoire PNJ et finale du tournoi, lecture du bilan puis fermeture avant le panneau suivant ; neuf tables Aventure inchangées et aucune exception JavaScript.

Captures Aventure dans `BUILD_OUTPUT` et Drift dans `BUILD_OUTPUT`. Six captures relues sont archivées dans `docs/validation/battle-result-*.png` (victoire, capture, défaite et tournoi ; mobile et paysage). La recette humaine PVP à deux navigateurs et le clavier/tactile sur appareil physique restent à confirmer.

## 8. Photographie actuelle du contenu

- 47 cartes physiques existent, 46 lieux sont actifs via deux alias d'intérieur et 45 sont atteignables depuis `start` ; seule `pk2` reste active mais isolée pour compatibilité avec les anciennes sauvegardes.
- Les 30 cartes générées sont actives : 8 routes, 5 villes, 5 arènes, 10 maisons et 2 boutiques.
- 37 PNJ sont placés : Mounir, 4 champions originaux, Éloi, 12 dresseurs de ville, la mère, 8 voyageurs, 5 guides et 5 habitants/vendeuses.
- 24 équipes sont définies, dont 18 utilisées par les dialogues actifs. Les quatre champions donnent leur badge, les archives accordent le Sceau Sylve ; attribution unique et transactionnelle.
- Le français couvre l'interface en jeu ainsi que les noms des 612 capacités et 223 talents ; l'anglais de l'interface est disponible mais les dialogues et messages serveur restent à traduire.
- Les boutiques vendent désormais les Balls et objets tenus dans une transaction serveur avec contrôle du solde ; la résolution de Clara/Aube Obscure, le combat final, l'épilogue et les crédits restent à écrire.
- L'état détaillé et les priorités sont maintenus dans `docs/AUDIT_CONTENU_JEU.md`.

## 9. Stratégie de tests minimale

### Couverture unitaire déjà présente — à conserver

- courbes d'expérience et niveaux 1, 50, 100 pour chaque groupe ;
- statistiques selon IV, EV (252/stat et 510 au total), natures neutres/bonus/malus, niveau et tier `k` ;
- table complète des efficacités de types ;
- dégâts physiques/spéciaux, immunités, critiques et précision ;
- états, pièges, terrains, météo et changements ;
- capture aux bornes de PV et multiplicateurs d'objets ;
- transitions et coordonnées de chaque carte ;
- sérialisation aller-retour d'une équipe sans changement d'UUID.

### Intégration existante et compléments prioritaires

Les scénarios inscription/connexion/starter, sauvegarde UUID, achats, récompense unique du premier dresseur, capture et trois orchestrateurs sont déjà testés. Le smoke HTTP/Socket couvre aussi la reprise de progression et la récupération après défaite.

L’ordre des champions et la stabilité du statut des quêtes sont maintenant couverts. Restent également à étendre : refus HTTP/Socket sans jeton ou hors propriétaire, concurrence de sauvegarde, interruption réelle du transport pendant les trois combats, navigation longue sans listeners résiduels, parcours de toutes les transitions et PVP humain. Le contrôle des 46 décors garantit leur chargement, pas ces parcours.

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
| 2026-10-16 | Contrats facultatifs, équipement direct et remplacement atomique des Drifts, quatre dresseurs facultatifs et début sauvage adouci | Métier/Socket/checkpoint, accessibilité des PNJ, mesure de dégâts et recette mobile des récompenses | Ressenti humain sur parties complètes ; contrats réservés aux nouvelles expéditions |
| 2026-10-16 | Colosseum : XP du combattant −20 %, part des réserves 30 → 40 % ; Balls −25 % dans les trois modes ; pistes de préparation moins répétitive documentées | Calculs métier, achats/checkpoint, débit SQL, recettes navigateur XP et boutique | Équilibrage humain ; variantes de parcours proposées uniquement |
| 2026-10-16 | Talents : réactions, PP/objets, contraintes et formes temporaires ; attaques Vol corrigées ; sprite mobile agrandi et aligné en bas | Tests de combats déterministes, sauvegarde des formes/objets, vraie recette Socket et mesures de silhouettes | Doubles non jouables ; Cherche Miel/Lumiattirance hors combat et Plaques/ROM non disponibles ; équilibrage humain |
| 2026-10-16 | Évolutions déterministes dans les trois modes, règles solo et choix de branches dans la fiche, rattrapage des anciens Pokémon, courbe d’XP persistante et sprites manquants | Tests seuils/ressources/Socket, SQL concurrent et recette navigateur Aventure/Colosseum | Équilibrage des conditions adaptées et recette sur téléphone physique |
| 2026-10-16 | Rift/Colosseum : choix parmi trois starters, talisman, dix objets stratégiques, dix pierres/45 évolutions, marchand de Drifts et attaques présentées en séquence | Tests métier/Socket/checkpoint et recette navigateur mobile de préparation complète ; régressions moteur et publication | Équilibrage économique et ressenti sur téléphone physique |
| 2026-10-15 | Colosseum : gains d’XP précédents triplés (×6 Aventure), 30 % supplémentaires à chaque réserviste vivant, cumul avec Entraînement collectif | Calculs avec/sans Drifts, deux formats, K.O., apprentissages/checkpoint ; bilan et reconnexion navigateur | Équilibrage des parcours après accélération de la progression |
| 2026-10-15 | Colosseum v2 : six gardiens, 18 espèces d’élite, choix de Drift par palier, aperçu tactique et nouveau décor portrait | Tests des offres, répétitions, checkpoints et règles v1 ; recette navigateur gardien/récompense/reconnexion et cadrage tactile | Équilibrage de parcours longs et ressenti sur téléphone physique |
| 2026-10-15 | Critiques/efficacité au-dessus des sprites ; sons d’attaque et catégorie Rift ; transitions à décors complets et glissement tactile carte/pavé | Tests des gestes, des couches décodées, de la catégorie d’attaque et du cycle audio ; recettes navigateur mobiles/bureau, chargement retardé et signal audio réel | Écoute et ressenti sur téléphone physique |
| 2026-10-15 | Petite prime par victoire/capture sauvage dans les trois modes ; Poké Ball ×1,15 ; niveaux des cartes et PNJ resserrés de 10 % au-dessus de 5 | 281 tests actifs, 37 SQL, audit des paliers et des rencontres ; capture effective, portefeuille, répétition et reprise | Ressenti de la progression et économie à confirmer sur des parties humaines |
| 2026-10-15 | XP ×2 Rift/Colosseum, barre avant bilan, apprentissage avec remplacement/refus et sauvegarde des choix dans les trois modes | 269 tests actifs, 36 SQL ; quatre recettes navigateur, XP avant bilan et carnet sur trois formats ; migration et recette HTTPS réussies | Équilibrage et recette sur téléphone physique |
| 2026-10-14 | Elo Rift Bronze–Diamant, rangs Colosseum 30/60, profils, recherche, classements et demandes d’amis | 252 tests actifs, 35 SQL ; concurrence/reprise et confidentialité ; parcours social sur quatre formats et delta réel Socket | Équilibrage des seuils sur des parties humaines ; pas de détection de collusion ni de présence en ligne |
| 2026-10-14 | IA Colosseum progressive tous les dix combats, Expert dès le défi 51, capacités/objets adaptés et palier visible | 249 tests actifs, 32 SQL, 91 combats simulés, informations cachées et reprise contrôlées ; recettes navigateur/mobile et compilation | Équilibrage humain ; anticipation bornée, pas de garantie d’optimalité |
| 2026-10-14 | 12 espèces par zone sauvage, premiers défis Colosseum variés, potions/médicaments/baies utilisables depuis le sac dans les trois modes | 238 tests actifs, 32 SQL, audits et compilation ; parcours navigateur de soin et contrôles Socket de consommation/reprise | Ressenti et équilibrage sur des parties humaines |
| 2026-10-14 | Sortie de `maison2` débloquée : deux collisions de porte corrigées | Portes configurées, aller-retour Rift/Colosseum 30/60, Aventure HTTPS avec reconnexion/sauvegarde ; 231 tests et audit contenu réussis ; partie active préservée | Aucun blocage restant sur cette porte |
| 2026-10-14 | PWA installable et cache hors ligne isolé ; salon/partie PvP papier-sauge ; format Colosseum 30 min et classements par durée | 227 tests actifs, 32 SQL ; audits, HTTP/reprise, lint/build ; trois recettes navigateur et installabilité Chromium | Installation et zones sûres sur téléphone physique, équilibrage des deux formats |
| 2026-10-14 | Sélection du texte désactivée dans l’interface de jeu, exceptions pour la saisie et le copier/coller | Lint/build et contrôle navigateur tactile de sélection/saisie | Confirmer le ressenti sur Safari/iPhone physique |
| 2026-10-14 | Rift Colosseum solo, heure fixe, K.O. définitifs, défis progressifs, classement SQL et accueil à trois modes | Tests moteur/Socket, SQL concurrent/reprise et parcours navigateur responsive ; régressions Aventure/Rift/mobile | Équilibrage humain sur une heure et téléphone physique |
| 2026-10-14 | Combat mobile : cadrage des deux Pokémon, indicateur de tour dans les commandes, grille adaptative et zones sûres | Recette tactile sur sept formats ; visibilité des pixels des sprites, aucun recouvrement, menus et ciblage attaque/capture | Confirmer le confort sur téléphone physique |
| 2026-10-14 | Vue mobile : caméra suivant le joueur, carte pleine hauteur disponible, commandes compactes adaptées à l’orientation ; objectif uniquement dans le menu | Trois tests caméra ; recette navigateur tactile sur sept formats, déplacement serveur, annulation du toucher et menus ; recette Rift jusqu’à 740×320 | Ressenti et zones sûres à confirmer sur téléphone physique |
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

| 2026-10-10 | Préparation locale Linux sous Node 22.16.0 / npm 10.9.2 après lecture des consignes et audits ; installation verrouillée des dépendances serveur (164 paquets) et client (972 paquets), compilation et démarrage sur le port 3000 | `npm ci --no-audit --no-fund`, `npm --prefix vue-explorakit ci --no-audit --no-fund`, `npm run build:client` et `npm --prefix vue-explorakit run lint -- --no-fix` réussis ; `npm test` : 70 réussis, 11 MySQL ignorés ; syntaxe des 72 fichiers JS serveur/scripts/tests valide ; accueil HTTP 200, ressources JS/CSS et transport Socket.IO accessibles après `npm start` | `npm run check:db` échoue avec `ECONNREFUSED LOCAL_DATABASE` : aucun serveur MySQL local installé/démarré ; configurer une base avant inscription, connexion et sauvegarde. Avertissements non bloquants : plage Node déclarée par `@achrinza/node-ipc`, dépendances dépréciées, Browserslist ancien et assets volumineux. Aucun lockfile ni code métier modifié. |

| 2026-10-10 | Installation demandée d'une nouvelle base locale : MySQL 8.0.46 depuis les paquets Ubuntu, extrait sous le compte utilisateur sans sudo ; bases de développement et de test, compte SQL dédié et `.env` adapté ; serveur relancé avec les nouveaux identifiants | `npm run check:db` et `npm run db:verify` réussis ; `npm run db:test:setup`, `npm run test:mysql` (11/11) et `npm run test:http` réussis (inscription, connexion, starter, inventaire, Socket.IO, progression, sauvegarde et récupération après défaite) ; services utilisateur actifs, accueil HTTP 200 et contrôle login sur le serveur courant | Blocage MySQL levé ; recette visuelle manuelle restante. Le schéma neuf inclut déjà les migrations 001–007, enregistrées comme état initial dans `schema_migrations`, sans rejouer leurs ALTER TABLE. |

| 2026-10-10 | Refonte du Pokédex dans `PokedexPanel.vue` : palette claire, typographie isolée du style global pixel, cartes compactes (5 colonnes ordinateur / 3 mobile), types traduits, collection et progression, recherche insensible aux accents et filtres par région/statut ; en-tête et filtres fixes, défilement interne, focus contenu et fermeture Échap. Clavier monde normalisé en minuscules avec ZQSD/WASD/flèches et protection de la saisie dans les panneaux | `npm --prefix vue-explorakit run lint -- --no-fix`, `npm run build:client`, `npm test` (70 réussis, 11 MySQL ignorés) ; `node --env-file-if-exists=.env scripts/validatePokedexViewports.js` valide Chromium en 1440×900, 390×844, 320×568 et 844×390 : aucun débordement, commandes ≥44 px, filtres et recherche, anglais, masquage des inconnus, focus/Échap, clavier majuscules et commandes mobiles ; captures inspectées dans `BUILD_OUTPUT` | Client reconstruit et servi par le serveur courant ; recharger la page pour récupérer les nouveaux assets. Validation sur appareil physique et confirmation utilisateur du problème clavier initial restantes. |


| 2026-10-11 | Confrontation de l'audit au code et aux tests ; synthèse livrés/partiels/manquants, suppression des priorités obsolètes, alignement d'AGENTS et des audits associés ; diagnostic MySQL du défaut Dune → Sylve | 71 tests standards actifs, 11/11 MySQL, smoke HTTP/Socket, audits capacités/talents/contenu, vérification des 7 migrations, syntaxe de 73 scripts, lint et build réussis ; diagnostic sur compte temporaire supprimé | Prochain lot : progression des champions ; Dune termine à 5/5 avec 1 badge, Sylve réactive ensuite la quête à 5/5. Recette humaine complète toujours ouverte |
| 2026-10-11 | Correctif client : inclure les huit intérieurs `gen_maison_ville…` / `gen_shop_ville…` déjà livrés dans le contexte Webpack, décors et premiers plans ; aucun fichier de carte modifié | Test `les décors de chaque lieu actif…` dans `tests/world-content.test.js` : échec constaté avant correction, succès après ; `node --env-file-if-exists=.env scripts/validatePokedexViewports.js` : images des 46 lieux décodées dans Chromium et contrôles Pokédex/clavier maintenus | Build servi sur le serveur local ; recharger le navigateur pour récupérer le correctif. La traversée humaine des intérieurs n'est pas encore certifiée |

| 2026-10-11 | Recherche des champions historiques demandée par le créateur : Hoze, Raphael, Ana et Wanda retrouvés dans `data/game/phrase.txt`, portraits/sprites présents ; récit et rôle de Wanda dans l'Aube Obscure documentés dans l'audit de contenu | Lecture du fichier et des notes `docs/legacy/todo.txt`, historique Git local des équipes/dialogues inspecté ; textes présents dès `54915cb` (26 février 2025) ; aucun branchement runtime de `phrase.txt` ni équipe dédiée à ces quatre noms retrouvés | Réutiliser ce scénario existant avant d'inventer de nouveaux champions ; correspondance Mounir/Moonpunch et implantation des personnages d'origine à clarifier. Aucun contenu de jeu modifié |

| 2026-10-11 | Chapitre I demandé : intégration de Hoze/Ocreville, Raphael/Floraville, Ana/Rochebourg et Wanda/Rivazur avec nouvelles équipes ; 12 dresseurs facultatifs, mère au village et lettre de Clara à Clairbois ; prérequis serveur, dialogues conditionnels et automatiques après victoire, récompenses concurrentes idempotentes, correction des anciennes quêtes ; textes adaptés au mobile et noms des arènes affichés | 75 tests standards actifs, 13/13 MySQL dont parcours Socket réel avec fuite, cinq victoires, lettre, reprise et duel annexe ; audits capacités/talents/contenu, smoke HTTP, lint/build ; Chromium 4 formats, textes/portraits, bouton tactile et PNJ ; aucune carte ni transition modifiée | Recette humaine et équilibrage des équipes/rencontres restant à faire ; les niveaux sauvages des routes générées restent descendants. La fin livrée est celle du chapitre I, pas le sauvetage de Clara. Équipes testées avec fixture forte sur base de test uniquement ; anciens badges et sauvegardes conservés |

| 2026-10-11 | Équilibrage demandé des zones sauvages et arènes : niveaux croissants 5–60 dans le sens réel du chapitre, arènes ×2 / dresseurs ×1,5 / sauvage ×1, facteur borné selon l’écart de niveau, duels de Clairbois ajustés ; correction de l’XP absente du dernier K.O. de dresseur | Test MySQL en échec avant correctif puis réussi ; 80 tests standards et 15/15 MySQL, dont montants exacts dans les cinq arènes via Socket ; `audit:balance`, `audit:content`, syntaxe et contrôle des diffs ; seuls les niveaux changent dans `nextMap.json`, aucun fichier Tiled/PNG modifié | Vérifier le rythme en partie normale et avec plusieurs partenaires ; pas de recalcul des niveaux/XP déjà acquis. Aucun changement client, build précédent conservé ; serveur local relancé après vérification de l’absence de connexions actives, MySQL/serveur actifs et HTTP 200 |
| 2026-10-11 | Direction console portable, fiche Pokémon/radar et XP, 32 sprites/portraits de civils et promenades serveur, musique des quatre types de combat ; EV persistants et corrections natures/évolution/blessures/statistiques permanentes | 103 tests (88 actifs + 15 MySQL), 15/15 MySQL, smoke HTTP/Socket, migration 008 vérifiée, audit contenu, 84 syntaxes JS, lint et build ; fiches/combats et dialogues en 4 tailles ; capture/effets en 2 tailles ; Pokédex et 46 décors revalidés | Promenades avec poses de face ; pas encore de planches directionnelles. Audio Safari/iOS et partie humaine complète à valider. Serveur personnel déjà présent sur 3000 laissé en place : redémarrage manuel requis pour le nouveau backend. Aucun fichier de carte modifié. |
| 2026-10-11 | Potentiel représenté par une étoile unique grise, pâle, jaune ou brillante, de taille croissante ; composant SVG commun au combat et à la fiche, libellés accessibles et animation respectueuse des préférences | Lint et build client réussis ; `validateAdventureViewports.js` rejoué via une copie temporaire avec contrôle des quatre couleurs/tailles, absence de K1–K4, scintillement du seul dernier rang et réduction des animations ; captures inspectées sur mobile, cadrage des fiches/combats sur quatre formats | Modification visuelle uniquement ; données, probabilités et calculs de potentiel conservés. Recharger le navigateur pour le nouveau client compilé. |

| 2026-10-11 | Retour des Centres Pokémon partagé par intérieur corrigé : provenance par joueur persistante, parvis validé, reprise après reconnexion/redémarrage/K.O., sauvegardes concurrentes drainées et transitions interdites sur déplacement bloqué | 92 tests standards + 16/16 MySQL, dont scénario Socket réel à deux comptes ; migration 009 appliquée sans réinitialisation, `db:verify` conforme, audit contenu et 87 syntaxes JS valides | Redémarrer le serveur personnel puis tester en jeu. Une ancienne sauvegarde déjà dans le centre sans provenance utilise une fois le parvis de `ville1`. Aucun fichier de carte, transition ou client modifié. |

| 2026-10-11 | Conception Drift et premier lot explicitement validé : choix Aventure/Drift, salons privés 2/4/8/16 et 20/30/60 min, préparation/reconnexion/transfert de l’hôte, catalogue fidèle des 59 Drifts ; mort définitive partout et tournoi simple retenus | 115 tests dont 99 actifs + 16 MySQL ignorés par `npm test`, 16/16 MySQL, import Excel vérifié, 92 syntaxes JS, lint/build ; navigateur à deux comptes, quatre formats, catalogue et sauvegarde Aventure inchangée | Lancement volontairement indisponible : sessions d’exploration, effets/économie et tournoi à implémenter selon §7 bis. Salons en mémoire, perdus au redémarrage. Aucun changement de carte ni migration SQL ; redémarrage manuel du serveur requis. |

| 2026-10-11 | Suite Drift demandée : exploration sur les cartes existantes, chrono serveur, compagnon/captures/XP éphémères, cinq slots et 59 effets, loot/revente/soins, mort définitive, téléportation et tournoi simple avec soins des survivants ; PNJ isolés par partie, contrôle unique et reprise 90 s | 169 tests dont 153 actifs et 16 ignorés par npm test ; 16/16 MySQL ; import Excel, audits capacités/talents/contenu, 102 syntaxes JS, lint/build ; Chromium deux comptes et quatre formats jusqu’au vainqueur, neuf tables Aventure inchangées ; tests d’arbres 2/4/8/16, exemptions/double K.O. et morts persistantes entre rounds | Lançable après redémarrage manuel du serveur personnel ; sessions en RAM perdues au redémarrage. Recette humaine des trois durées et équilibrage restant. Aucun changement de carte ni migration SQL. Détails et commandes §7 bis. |

| 2026-10-11 | Refonte visuelle des menus Drift après retour utilisateur : salon illustré et sièges réels, catalogue compact, carnet à cinq emplacements/icônes et fiche sélectionnée, équipe illustrée, tableau de tournoi et chrono compact ; focus/onglets/confirmations adaptés au clavier et mobile | Lint sans correction et build réussis ; syntaxe des deux scripts ; navigateur sur quatre formats : salon/invitations/16 places/catalogue, cinq équipements par vrais clics, recherche, fiche, sixième refusé, confirmation annulée, portraits, tournoi et sauvegardes Aventure intactes ; captures inspectées | Recharger le client compilé. Ressenti sur téléphone physique et appréciation finale de la DA par le créateur restants ; gameplay/serveur et cartes conservés. |

| 2026-10-11 | Camp inaccessible malgré un compte connecté : ancienne instance sur 3000 sans namespace Drift remplacée ; messages séparés pour session, serveur et réseau, bouton Réessayer avec le jeton courant | 173 tests dont 157 réussis et 16 MySQL ignorés ; nouvelles régressions Socket réelles, lint/build ; Chromium sur le serveur relancé : connexion, 59 Drifts, création, prêt et départ du salon | Aucun compte ni sauvegarde modifié, aucune écriture SQL du diagnostic. Client compilé à recharger ; MySQL et combats non rejoués pour ce correctif. |

| 2026-10-11 | HUD Drift sans superposition, inventaire synchronisé et chargement/fin explicités ; bilan de fin anticipée et raison de déconnexion distinguée de l’abandon | 174 tests dont 158 réussis et 16 MySQL ignorés, lint/build ; Socket et Chromium : porte aller/retour, reconnexion, Balls réelles et consommation, quatre formats, tournoi et fin anticipée ; aucune exception JS ni changement des neuf tables Aventure ; recette Aventure visuelle réussie | Aucun crash reproduit sur la porte testée, transition exacte signalée encore inconnue. Aucun asset/carte modifié. Serveur personnel conservé avec ses connexions ; nouvelle raison de forfait à activer au prochain redémarrage, interface compilée disponible après rechargement. |

| 2026-10-11 | Bilan manuel de fin de combat commun Aventure/Drift : victoire/défaite/capture/fuite/égalité/interruption, gains réels, pertes Drift, priorité sur dialogues/tournoi et contrôles clavier/tactiles | 179 tests dont 163 réussis et 16 MySQL ignorés ; 16/16 MySQL, primes des cinq arènes confrontées aux soldes ; lint/build/syntaxe ; Chromium quatre formats, capture réelle Aventure et parcours Drift complet avec confirmations, anciens événements compatibles | Client compilé disponible après rafraîchissement. Serveur personnel conservé avec ses connexions et sa RAM : montants détaillés du nouveau résumé après prochain redémarrage ; issue simple déjà compatible. Aucun changement de carte ni de règles de combat. |

| 2026-10-11 | Souvenirs Drift : équipes de tous les participants avant purge, starter/tournoi/pertes, Drifts et statistiques réelles, journal, records, fiches Pokémon et export ; dix archives locales par compte consultables au camp | 189 tests dont 173 réussis et 16 MySQL ignorés ; dix nouveaux tests rapport/historique ; lint/build/syntaxe ; navigateur quatre formats, vraie capture et finale, export JSON identique, archive relue après rechargement, neuf tables Aventure inchangées | Rapport révélé uniquement après la fin et sans restauration du jeu éphémère. Client compilé ; collecte active pour les nouvelles parties après prochain redémarrage du serveur, conservé avec ses connexions. Aucun changement de carte ou schéma SQL. |

| 2026-10-11 | RiftMon bleu : accueil connecté/profil, salons publics/privés/recherche, tous les effectifs 2–16 et durées jusqu’à 120 min, tirage par round/exemption unique répartie, menu Survivants et spectateur ; 100 pièces par victoire, statistiques transactionnelles, boutique Bientôt, solo Aventure. Correctifs retour Socket camp→Aventure et forfaits simultanés sans faux vainqueur | 215 tests (193 réussis + 22 MySQL ignorés), 22/22 MySQL, migration 010 après snapshot privé, 12 tables/10 migrations conformes, 113 syntaxes, lint/build ; trois recettes navigateur, RiftMon 52 captures/4 formats, vrai tournoi à trois/spectateur/100 pièces idempotentes/profil et archive après reload/retour Aventure connecté ; neuf tables Aventure inchangées | Client compilé et base migrée ; backend nouveau à activer par redémarrage du serveur personnel, conservé car connecté. Parties toujours en RAM : crash = expédition perdue, règlement en attente non durable. Pas de statistiques historiques inventées ni de modification de carte ; recette humaine longue et sur téléphone physique restante. |

| 2026-10-11 | Captures Rift réussies éligibles au drop de Drift : 15 % de base, bonus collectionneur et raretés sauvages ; source capture consignée, butin affiché dans le bilan et conseil du sac actualisé | 217 tests dont 195 réussis/22 MySQL ignorés ; cas gain/aucun gain/seuil/bonus/rareté/refus/raté/absence de doublon, archives ; syntaxe, lint et build réussis ; Chromium quatre formats : capture/butin visible, inventaire, bilan/archives et neuf tables Aventure inchangées | Aucun gain d’XP, monnaie, Ball/Potion ou soin ajouté aux captures ; Aventure et tournoi inchangés. Activation au prochain redémarrage du serveur personnel ; aucune carte ou donnée SQL modifiée. |

| 2026-10-11 | Prime du vainqueur Rift calculée sur effectif initial × minutes réellement explorées × 2,5, arrondi inférieur ; tournoi exclu et fin précoce au prorata ; estimation salon et détail bilan/carnet ; durée/version persistées par migration 011, anciens crédits conservés | 228 tests (203 réussis + 25 MySQL ignorés), 25/25 MySQL, 115 syntaxes, lint/build, migration sauvegardée et vérifiée ; Chromium quatre formats : 3 joueurs/120 min = 900 pièces créditées une fois, détails archivés et compte relu, neuf tables Aventure intactes | Serveur personnel préservé avec ses connexions : activation au prochain redémarrage. Aucun changement de carte, gain de combat ou monnaie Aventure. Durée test accélérée, pas de revendication de playtest humain deux heures. |

| 2026-10-11 | Durées Rift étendues à 20/30/40/60/90/120/300 minutes ; sept boutons mobiles, accueil actualisé et borne de récompense partagée jusqu’à cinq heures | 229 tests (204 réussis + 25 MySQL ignorés), 25/25 MySQL, 115 syntaxes, lint/build ; 105 combinaisons de salon et maintien après deux heures ; Chromium quatre formats/56 captures, 3 joueurs/300 min = 2 250 pièces créditées une fois, archive/profil relus, neuf tables Aventure intactes | Client compilé ; serveur personnel conservé, activation après redémarrage. Aucune migration SQL ni carte modifiée. Horloge de test accélérée ; recette humaine longue restante. |

| 2026-10-11 | Publication Git demandée : regrouper les lots Aventure, interface console portable et RiftMon, ses sept durées et sa prime variable ; conserver le catalogue source, les migrations, les tests et les preuves visuelles ; référencer le commit client depuis le dépôt principal | Deux branches `master` synchronisées avec leurs origines avant publication, diffs sans erreur ; dernière recette : 204 tests actifs, 25/25 MySQL, lint/build et navigateur quatre formats réussis. Publication via le compte GitHub `Ybinout` : client `ExplorakitVue` (`96bfccf`), puis `Explorakit` avec son pointeur de sous-module exact ; empreintes des arbres locaux/distants comparées | `.env`, sauvegardes privées, dépendances et `dist/` restent ignorés. Aucun redémarrage serveur ni changement de base dans cette opération. |

| 2026-10-14 | Six axes : reprise Rift durable, guide Aventure, chapitre II et refuges, huit intérieurs peuplés, quatre médicaments, boutique cosmétique et archives serveur, modules/validation/CI | 210 tests unitaires et 28 tests MySQL ; SIGKILL/reprise réelle ; chapitres I et II par Socket ; 360 combats simulés ; recette navigateur quatre formats, achats/équipement/historique sur navigateur vierge et soin sauvegardé. Deux régressions trouvées puis corrigées : conflit SQL d’achats simultanés et liste de cibles vide au premier accès au sac | Migration 012 additive ; aucun fichier de carte modifié. Retour au dernier checkpoint, architecture mono-instance, anciens souvenirs locaux conservés. Tests humains longs et téléphone physique non réalisés. |

| 2026-10-14 | Contrôle GitHub et fenêtre crash/règlement : compilation explicitement production, captures d’échec, résultat SQL prioritaire sur un checkpoint antérieur | Échec CI reproduit avec NODE_ENV=test puis parcours complet réussi après correction ; 28/28 MySQL et test de crash avec checkpoint ancien, rapport identique et une seule victoire | Les mêmes règles et le même client sont conservés. La reprise ne rejoue jamais une partie dont le règlement SQL est terminé. |

| 2026-10-14 | DA du Pokédex partagée : variables papier/sauge, menus et localisation, panneaux du monde, fiches, dialogues et barre Rift ; commandes tactiles masquées sous les panneaux | Lint/build production et recette Chromium sur quatre formats, sept menus, recherche, fermeture, langue, boutique/dialogue visuels, vraie expédition Rift et soin SQL ; captures inspectées | Camp et combat conservent leurs styles propres. Aucune carte, règle serveur ou migration modifiée ; validation physique mobile restante. |

| 2026-10-14 | Soin complet et répétable à la fin du dialogue de la mère, message explicite et journal Rift exact | 212 tests unitaires, 28/28 MySQL, conversation autorisée, PV/PP/statuts/K.O., sauvegarde et reconnexion, refus de rejeu, point de retour préservé ; audit contenu et syntaxe | Aucun changement client, carte ou schéma. Les pertes définitives Rift restent définitives. |

## 12. Notes pour les prochaines interventions

Avant de corriger un point :

1. vérifier l'état Git racine et celui de `vue-explorakit/` ;
2. cibler un lot réduit ;
3. ajouter d'abord le test qui expose le problème si possible ;
4. préserver la compatibilité des événements réseau ;
5. mettre à jour ce document et son journal ;
6. suivre la section 7 réconciliée ; l'audit de contenu existe déjà et doit être complété par la cohérence narrative et la recette réelle.
7. ne jamais modifier les JSON, TMX ou PNG de cartes hors du lot explicitement confié à l'agent cartes ; les autres agents ne raccordent que les transitions déjà livrées dans `nextMap.json`.


### Historique des livraisons de contenu

Les paragraphes datés ci-dessous décrivent les étapes de génération, pas la liste actuelle des travaux à faire. Les sections 2 et 7 et `AUDIT_CONTENU_JEU.md` donnent l’état actif.

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

### Installation et déploiement — 10 et 11 octobre 2026

Le projet a été validé sous Linux avec une base MySQL/MariaDB dédiée. Les commandes `npm run check:db`, `npm run db:verify`, `npm run test:mysql` et `npm run test:http` vérifient le stockage et les parcours ; les comptes de recette sont nettoyés. Les paramètres propres à un hébergement et les sauvegardes restent dans sa documentation privée.

Le client est compilé avec `VUE_APP_PUBLIC_PATH=/explorakit/`. Routeur, API, sprites et Socket.IO partagent ce préfixe. Le déploiement conserve les autres applications. Recette HTTPS : accueil, authentification, Aventure, camp Rift et connexions WebSocket ; aucun échec de ressource ni erreur JavaScript. Les migrations sont appliquées après sauvegarde et contrôlées par `db:verify`.

### Simplification du camp — 11 octobre 2026

Accueil recentré sur une seule action : onglets Rejoindre / Créer sur desktop et mobile. En-tête compact, un seul compagnon, formulaire de code avec les parties disponibles. Palmarès, récompenses et guide repliables ; boutique inactive retirée ; solo placé immédiatement après le panneau de jeu. Catalogue et historique conservés sous forme de lignes discrètes. Styles limités au composant DriftLobby, adaptations du sous-répertoire préservées. Vérification : compilation puis parcours Chromium desktop/mobile, création/quitter un salon, accès solo et panneaux secondaires.

Résultat : build réussi ; Chromium valide les deux onglets (un seul panneau visible), création privée à deux joueurs puis sortie, ouverture du palmarès, accès solo avec canvas, sessions WebSocket Aventure/Drift, et largeurs 390/320 px sans débordement. Aucune erreur JavaScript ni ressource en échec. Captures desktop et mobile inspectées. Compte de recette nettoyé.

### Accès Aventure mis en avant — 11 octobre 2026

Bouton « Jouer une aventure en solo » déplacé directement sous l’en-tête, avant les actions RiftMon, dans une carte contrastée. Description : progression à son rythme dans un monde partagé, multijoueur facultatif. Le parcours Aventure et les interactions multijoueurs restent inchangés. Vérification : build et contrôle Chromium du bouton sur desktop/mobile et de son accès au canvas du jeu.

### Mise en ligne des six axes — 14 octobre 2026

Migration 012 appliquée après sauvegarde SQL et préflight réussi ; vérification des 16 tables et 12 migrations conforme. Aucune expédition n’était active lors du remplacement de l’ancienne version. Build temporaire testé puis installé, anciens fichiers hachés conservés pour les onglets déjà ouverts ; sauvegarde de l’ancien build dans le dossier privé de déploiement. Service `explorakit.service` relancé, checkpoint SQL écrit chaque seconde et port de diagnostic fermé. Parcours HTTPS : inscription/connexion, namespaces Aventure et Drift derrière Nginx, accès solo et canvas, camp mobile et absence d’erreur navigateur. Comptes temporaires supprimés. Les réponses HTML de `app.binout.fr/` et `api-test.binout.fr/` ont exactement la même empreinte avant/après.

### Validation GitHub en environnement neuf — 14 octobre 2026

La première exécution GitHub a validé le socle et révélé un défaut de configuration de compilation : `NODE_ENV=test` transmis par le job produisait un client impropre au navigateur. Le problème a été reproduit localement ; `verify:release` force désormais `NODE_ENV=production` et `BABEL_ENV=production` pour la seule compilation, en conservant l’isolation test du backend. Le scénario navigateur conserve une capture et ses erreurs en cas d’échec. Aucune règle de jeu modifiée ; la correction de compilation concerne uniquement les contrôles de publication.

La reprise confronte aussi le checkpoint au règlement SQL : si le serveur est tombé après avoir crédité la victoire mais avant d’avoir enregistré le dernier checkpoint, le résultat SQL et son rapport sont restaurés au lieu de rejouer la fin. `test:recovery` simule cet ordre avec un ancien checkpoint réinjecté après le règlement, et vérifie le bilan identique et une seule victoire.
