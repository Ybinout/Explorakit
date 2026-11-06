# Dark, laboratoire Safari, Doubles et pause du Tournoi

État : **publié et vérifié**. Demande complète dans la pièce jointe `bb0f384a-8875-4e32-91b9-003afaec7a6f/Pasted text.txt`.

## Règles confirmées

- Recul des objets corrompus sur les PV maximum, peut mettre K.O., protections habituelles pertinentes conservées.
- Restes corrompus : fin du quatrième tour consécutif actif ; changement remet le compteur à zéro.
- Pause uniquement entre les combats ; copie scellée de tournoi sauvegardée, équipe Aventure disponible dehors.
- Doubles réels 1v1 et 2v2 (6v6 ou12v12), deux actifs par camp, aucun gain XP. Options simples, argent et mises de Pokémon 1v1 conservés.

## Fonctionnement livré

- Dark : grille100–300, augmentation en descendant/vers l’est, Jungle9=290–300 ; corrompus+5 plafonnés300. Plaques14/21/25%, Jungle9=31%, cristaux inchangés.
- Objets : sept recettes, chacun consomme un objet classique+40 de chaque cristal. Reçus dans `corruption_receipts`, opération `held_craft`, transaction/verrou propriétaire/idempotence existants ; aucune migration nécessaire.
- Laboratoire Safari réutilise le bâtiment `safari_shop`, boutique conservée. Carte et collisions spécifiques `safari_lab` ; scientifique distinct ; interface de recettes responsive.
- Doubles : adaptateur serveur autour de `@pkmn/sim@0.10.15` (MIT), sans modifier le moteur simple. Formule IV×K et EV RiftMon, types/modules et objets corrompus adaptés. Le client ne reçoit pas le simulateur ni les choix adverses.
- Pause : snapshot versionné conservé en base. Retour/reprise et position sauvegardés ensemble, vérification de propriété, XP peut retrouver les inscrits déplacés dans le PC.
- Annonces : le chemin Drift/Tour/Dark manquait de message de lancement ; annonce avant animation et résultat. Les autres orchestrateurs possèdent déjà cette annonce et seront vérifiés.

## Art

Compétence `imagegen`, outil intégré. Source générée : `exec-fbe9e367-c1d9-4ed7-a31b-14a81e57e87a.png`. Asset de production `vue-explorakit/src/assets/safari_lab.png`448×320 ; conversion de résolution par canvas, pas de dégradation des autres assets.

Prompt : laboratoire RPG2D vu du dessus, art pixel GBA/DS cohérent avec le laboratoire du professeur, format7:5/grille28×20, sol bleu-gris, petits établis contre les murs, cristaux violets, écrans cyan, grande aire de circulation, sortie centrée en bas, aucun personnage/texte/HUD. Une boutique et un scientifique sont ajoutés par les acteurs du jeu.

## Sources techniques

- [Simulateur Pokémon Showdown extrait, API et licence](https://github.com/pkmn/ps/tree/main/sim).
- [Architecture officielle du simulateur](https://github.com/smogon/pokemon-showdown/blob/master/sim/SIMULATOR.md).
- [Protocole du simulateur](https://github.com/smogon/pokemon-showdown/blob/master/sim/SIM-PROTOCOL.md).

## Vérifications

- Régressions ciblées Dark, objets, Tour, Maison simple/collaborative.
- Tests mécaniques Doubles, ciblage, coups de zone, talents/objets, remplacements, relais, reconnexion et confidentialité.
- MySQL : fabrication concurrence/rejeu/rollback, pause CAS/reconnexion/PC, mises et règlement des Doubles.
- Recettes Chromium/WebKit PC/mobile, graphique laboratoire/collisions/panneaux, animations et contrôle.
- Lint/build isolé, performance et publication avec sauvegardes et vérification des données utilisateur.

## Résultats

- **268 tests de domaine** : Dark, objets corrompus, corruption, capacités/talents, Doubles, Tour et Maison simple/collaborative ; aucun échec ou test ignoré.
- **60 tests MySQL** : fabrication concurrence/rejeu/rollback ; pause CAS, propriété équipe/PC et positions ; XP vers un inscrit déplacé au PC ; mises argent/Pokémon depuis le PC réglées une fois ; autres règles simples préservées.
- **52 tests de boucle de combat réels** : sommeil, malédiction, brûlure, poison, paralysie et résidus dans les orchestrateurs Aventure. Aucun échec ou test ignoré dans cette sélection.
- Recette authentifiée à cinq clients dans Chromium puis WebKit : PC/mobile/paysage, clair/nocturne, six onglets, quatre actifs, vrai ciblage des quatre commandes en 2v2 6/12, relais indépendant, choix partiel après reconnexion, tribunes sans informations privées, mises et abandon par l’interface, sept recettes, six panneaux et pause/reprise par l’hôtesse. 64 vues et16 parcours fonctionnels par moteur, dont cadrage complet des cartes Pokémon ; rapports définitifs du même build dans `DARK_DOUBLES_2026-11-06.json`.
- Lint, build isolé, syntaxe des JavaScript modifiés, importeur Python et `git diff --check` valides. La suite globale historique n’est pas déclarée entièrement verte et aucun test sur téléphone physique n’est revendiqué.

Le simulateur est chargé au démarrage du service : le premier duel ne déclenche pas son import. Son code reste exclusivement côté serveur. Sonde reproductible : `node scripts/benchmarkDoubles.js`, sans compte ni écriture dans le jeu ; cinq combats simultanés avec douze Pokémon par camp,444 décisions, ~23 ms au95e percentile et89Mo de tas pour le processus isolé sur ce serveur. Ces mesures ne sont pas une garantie réseau/client.

Les sept objets utilisent les mêmes règles dans le moteur simple et le moteur Double. Les objets incompatibles ne peuvent pas être équipés ni échangés en combat ; Abri, Garde Large, Télépathe, Paratonnerre, Illusion, Morphéo, pivots et remplacement d’un seul survivant après deux K.O. sont vérifiés. Le dernier tour victorieux conserve ses attaques/K.O. dans la file visuelle. Les PP viennent du catalogue RiftMon, sans augmentation implicite par le simulateur.

Le laboratoire réutilise la boutique bleue de safari8, avec vente conservée et un scientifique séparé. Ses collisions permettent d’atteindre les deux PNJ et la sortie ; le marchand reste derrière le comptoir. Le panneau d’accueil de Tour utilise le système d’interaction ordinaire, sans interception silencieuse par l’hôtesse.

Pause : aucun soin, versement, nouveau tirage ou changement d’équipe du tournoi pendant la pause. La reprise exige toujours la propriété des inscrits, même déplacés au PC ; un Pokémon échangé/relâché doit être récupéré ou la tentative abandonnée. L’abandon en pause garde la position Aventure courante, y compris sur le Dark Continent.

Règles Doubles basées sur Gen7, adaptées à nos données ; Téléport reprend le pivot moderne de priorité−6 demandé. Les649 espèces et toutes les capacités/objets du catalogue ont une entrée ; Celebration est l’alias interne de Celebrate. Simulateur exclusivement côté serveur.

Un abandon en pause conserve la position Aventure actuelle et ne permet pas de quitter le Dark Continent.

Second asset imagegen : `vue-explorakit/src/assets/battle/double-hall-v1.webp`, source `exec-28e931e1-67f4-4d62-ae3e-d7fcc8907269.png`. Prompt : salle de duel bleu/or pixel art, sol sobre et vide, fenêtres enneigées en fond, sans personne ni socle peint ; les deux socles adverses suivent les positions responsives calculées.


Le décor des Doubles est préchargé avec les sprites avant l’ouverture du terrain. Conversion PNG→WebP sans perte :1 779 430→1 283 450 octets ; tous les pixels RGBA décodés sont identiques. L’original de génération reste dans le répertoire d’images générées et la version utilisée est dans le dépôt.

## Publication

Aucune migration SQL nécessaire. Publication client puis serveur avec contrôle du parent Git, sauvegarde SQL/sources/index/dépendances, conservation des anciens assets et vérification des Pokémon/PC/soldes/checkpoints. Reçu de publication enregistré après les contrôles HTTPS dans `DARK_DOUBLES_2026-11-06.json`. Modes Rift/Colosseum fermés, Knov/API et annonce publique conservés.


Publication du6 novembre2026 à11:08UTC :client `3b28afc2`, code serveur `f778adcb`, build `6e4d20833e95febc`, PID3991351. Sauvegarde SQL/sources/client/index/dépendances sur le disque dédié, aucune migration.16 comptes,61 Pokémon d’équipe et684 du PC conservés à l’identique, ainsi que noms de boîtes, soldes, classements, cartes et checkpoint Dark.23 assets HTTPS identiques au build. Aucune reprise automatique ni erreur/avertissement de service ; Rift/Colosseum fermés, Knov/API et notes publiques inchangés.
