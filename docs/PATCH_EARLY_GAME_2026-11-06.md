# Début d’Aventure — 6 novembre 2026

## Parcours et présentation

- Accueil : une seule entrée Aventure. Les deux autres modes restent dans le code et ne sont pas ouverts côté serveur.
- Création : Carapuce « Début facile », Bulbizarre « Début mitigé », Salamèche « Début compliqué ». Carapuce est présélectionné ; aucune modification des statistiques de création.
- Maman : position fixe (5,7), rappel du service de soin ajouté aux dialogues concernés ; premier départ toujours distinct du soin. Lucie sauvée reste à proximité en (6,8).
- Wayne : premier dialogue d’entraînement sans combat, rappel tant que la leçon n’est pas terminée. Les seules cases réelles d’herbes du village reçoivent un voile pulsant discret, sans timer de rendu supplémentaire. Après la leçon, son combat et les indices existants vers Aspha sont conservés ; le conseil d’entraînement précède ses anciennes répliques de victoire.

## Guide interactif et sauvegarde

Le composant `TutorialCoach` est une solution locale équivalente à un guide pas à pas : masque SVG, cible encadrée, explications ancrées, focus sur le bouton de continuation et zone interactive ouverte uniquement sur la commande demandée. Aucun service externe ni nouvelle dépendance. La mesure utilise les changements d’étape, ResizeObserver et les événements de viewport, sans polling par frame. Les notes de mise à jour attendent la fin de la leçon pour les nouveaux comptes.

Étapes : PV, étoile K, types, actions, vraie attaque, explication de capture, vraie utilisation de Poké Ball, soins. Les étapes explicatives ne font pas avancer le moteur ; les choix de l’initiation n’ont pas de délai d’expiration. La première cible est un Chenipan de niveau 3 utilisant Sécrétion : il survit au premier coup et ne peut pas brûler sur un effet secondaire. Après capture, il retrouve son apprentissage normal, dont Charge. Ce traitement ne s’applique pas aux autres rencontres.

Les RPC sont authentifiés et rattachés à l’UUID de la rencontre. Le client ne peut pas remplacer l’attaque ou la capture par une simple validation de panneau. Le serveur écrit la progression dans un petit JSON versionné de `player_story_flags` ; les anciens comptes sans ce flag ne sont pas inscrits au tutoriel.

La capture verrouille le compte, vérifie la possession de l’équipe, consomme une seule Ball et enregistre le Pokémon/Pokédex ainsi que l’étape de soin dans la même transaction. Les répétitions sont idempotentes ; une erreur annule l’ensemble. Une équipe de six envoie la prise vers la première place libre du PC, y compris au-delà de la première boîte. Les récompenses ordinaires suivent ensuite le chemin existant.

Une déconnexion libère immédiatement l’attente pédagogique avant le drainage des tâches du compte. À la reconnexion, les étapes sont conservées ; une nouvelle rencontre d’entraînement reprend la dernière explication non terminée. Une capture déjà validée reste acquise, sans seconde Ball consommée ni second Pokémon. Les checkpoints exacts du Dark Continent restent inchangés.

## Apparence féminine

Le rendu corrige le débris noir isolé et aligne les silhouettes de la planche 256×256, tout en gardant les images auteur intactes. Une pose de marche nord manquante est dérivée de l’alternance des jambes existante. Trois silhouettes distinctes par direction, deux temps de repos identiques et un appui cohérent sur les seize cellules. Les cinq couleurs de tenue sont remplacées exactement ; peau, blanc des yeux, cheveux et contours restent intacts. Huit palettes clair/nocturne sont mises en cache par image ; les clients affichent la palette du propriétaire, indépendamment de leur propre thème.

## Vérifications reproductibles

Utiliser exclusivement `explorakit_test`, avec les variables de connexion fournies par l’environnement et un build isolé. Ne jamais lancer ces recettes sur la base des joueurs.

```sh
DB_NAME=explorakit_test DB_TEST_NAME=explorakit_test RUN_MYSQL_TESTS=1 node --env-file=.env --test tests/early-game.test.js tests/early-game-mysql.test.js tests/adventure-opening.test.js tests/trainer-palette.test.js
DB_NAME=explorakit_test DB_TEST_NAME=explorakit_test RUN_MYSQL_TESTS=1 node --env-file=.env --test tests/battle-runtime-integration.test.js tests/early-game-mysql.test.js
RELEASE_DIST_DIR=/tmp/riftmon-early-game-release-dist DB_TEST_NAME=explorakit_test node --env-file=.env scripts/validateEarlyGameBrowser.js
RELEASE_DIST_DIR=/tmp/riftmon-early-game-release-dist DB_TEST_NAME=explorakit_test node --env-file=.env scripts/validateFemalePaletteBrowser.js
RELEASE_DIST_DIR=/tmp/riftmon-early-game-release-dist DB_TEST_NAME=explorakit_test node --env-file=.env scripts/validateAdventureOpeningBrowser.js
```

La recette complète utilise Chromium et WebKit, les quatre formats 320×568, 393×852, 844×390 et 1365×900, une reconnexion pendant l’explication et après la capture, les trois starters, les boutons réels et le retour chez Wayne. Pour la reproductibilité, la fréquence de rencontre est imposée dans le processus de test ; les adversaires de Wayne ont 1 PV uniquement dans cette recette après le tutoriel. Son équipe de production reste inchangée. Les deux autres starters sont placés devant les herbes par une fixture SQL dédiée ; les combats restent ceux du moteur réel.

La recette des couleurs utilise deux comptes/observateurs réels et les options du client. La recette d’ouverture vérifie aussi l’image retardée sous le fondu, le lit, les vrais escaliers, l’interpellation automatique, l’absence de soin, la reprise du dialogue et le mouvement réduit. Ces essais ne constituent pas une vérification sur téléphone physique. Les résultats ciblés et limites sont conservés dans le rapport JSON ; aucune réussite de la suite globale historique n’est revendiquée.

## Publication

Publier le client avant le pointeur de sous-module serveur. Sauvegarder sources, index et SQL ; vérifier l’absence de duel actif avant le redémarrage contrôlé. Aucune migration ou réécriture des comptes existants n’est nécessaire. Conserver les anciens assets pour les onglets déjà ouverts, vérifier les bundles HTTPS et les voisins Knov/API. Le reçu de déploiement est ajouté au rapport après contrôle des données utilisateur.

Publication contrôlée effectuée :client `fd96721f`,source `aa696cc7`,build `29846dd99d2faf3b`. Les données utilisateur et deux checkpoints Dark sont conservés ; sauvegarde et21 assets HTTPS vérifiés. Le service est actif sans redémarrage automatique/avertissement et les applications voisines sont inchangées. Voir le reçu JSON pour les détails.
