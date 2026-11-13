# Observations passives des entrées — confidentiel, 13 novembre 2026

Ce correctif n’est ni une note de patch publique ni une annonce aux joueurs. Après clarification du 13 novembre 2026, le propriétaire a explicitement autorisé la publication du code sur GitHub, tout en conservant les notes et annonces en jeu inchangées. La décision et ses paramètres se trouvent côté serveur ; les scripts livrés au navigateur et les sources publiées restent consultables.

## Fonctionnement

Le client de jeu PC, y compris Electron, transmet au maximum un petit résumé toutes les deux secondes s’il y a eu des activations. Il ne transmet ni texte saisi, ni position de souris, ni coordonnées de carte, ni capture d’écran. La frappe dans le chat et les champs de saisie, les touches maintenues, les clics programmés par les commandes clavier du jeu, les manettes et les appareils mobiles ne constituent pas des indices synthétiques.

Le serveur lie les observations au compte authentifié. Un paquet ne peut pas fournir le score retenu ou désigner un autre joueur. Les commandes réellement reçues donnent leurs propres intervalles et catégories ; le contrôleur de pêche mesure uniquement les ferrages valides avec son horloge, après vérification de la canne, de l’état de pêche et de l’identifiant du lancer. Une erreur d’observation ne change jamais le résultat de la pêche.

Le score croise la régularité prolongée des activations, la cadence des commandes réseau, la répétition des actions, les réactions à la pêche inférieures aux délais humains habituels et, avec un faible poids seulement, les événements déclarés synthétiques. Il faut au moins 80 commandes, deux minutes d’observations et vingt secondes supplémentaires de confirmation, au moins trois signaux et une corroboration côté serveur. Un événement synthétique isolé, une courte rafale, une touche maintenue ou une pêche très rapide isolée ne suffisent pas.

Les résumés du navigateur restent des indications falsifiables : isTrusted ne prouve pas qu’un humain est à l’origine de l’action. La spécification [UI Events du W3C](https://www.w3.org/TR/uievents/) distingue les événements distribués par script ; Electron propose aussi [webContents.sendInputEvent](https://www.electronjs.org/docs/latest/api/web-contents). Le test d’Electron 45.3.1 emploie réellement cette méthode et vérifie qu’un événement natif trusted reste couvert par les autres critères.

## Message et conservation

À forte confiance, une seule transaction crée le message exact « J’utilise un autoclicker 🤖 » pour chaque amitié acceptée au début de l’opération et encore valable lors de l’écriture. Le sender est le joueur concerné. Le marqueur serveur non forgeable via l’API de messages normale permet d’afficher « Automatique » dans la conversation ; il ne prétend pas que le joueur a tapé l’aveu lui-même.

Les messages passent par la messagerie persistante existante. Les amis connectés reçoivent le message et leur compteur non lu ; les amis hors ligne le retrouvent à la prochaine connexion. Les demandes en attente et les non-amis ne reçoivent rien. Un échec SQL annule tout le lot. Un délai persistant de sept jours par compte évite les messages répétés après reconnexion, redémarrage ou traitements concurrents.

La nouvelle table privée input_observations ne possède aucune route de lecture publique et n’entre pas dans les flags de progression. Les listes en mémoire sont bornées à 160 commandes, 24 réactions et 12 résumés ; les éléments de plus de vingt minutes sont écartés lors de l’analyse. Une seule ligne par compte conserve le dernier résumé et le marqueur de répétition. Une connexion nouvelle attend les sauvegardes de la session remplacée, comme les autres opérations du compte. La sauvegarde des observations s’effectue au maximum une fois par minute, et à la fermeture.

Aucun bannissement, déconnexion forcée, ralentissement d’action, modification de capture, retrait de récompense, blocage de pêche ou changement d’inventaire n’est associé au score. Si la base d’observations est indisponible, le jeu continue. Les protections réseau générales du jeu restent celles qui existaient déjà.

## Limites

C’est une heuristique prudente, pas une preuve infaillible. Des automatismes qui imitent bien les irrégularités humaines peuvent ne pas être signalés ; aucun algorithme client ne certifie l’origine physique d’un clic. Le choix d’une confiance élevée et l’attribution automatique visible limitent les erreurs et les confusions. Aucun compte réel n’a été utilisé pour les tests et aucun message de test n’a été envoyé en production.

## Vérifications

29 tests de logique, sept cas de pêche existants pertinents et dix tests MySQL/réseau passent. Les tests couvrent les contrôles d’identité, paquets falsifiés, rejeux, rafales manuelles, manettes, téléphones, reprise des observations, déduplication durable, amis hors ligne et annulation atomique. Les montants d’argent, positions et Pokémon restent identiques dans les tests SQL.

Chromium, WebKit et un véritable Electron 45.3.1 exécutent le même client compilé : message automatique et message manuel distincts, affichage PC/mobile, chat exclu, clavier trusted et clic synthétique, sessions courtes sans accusation, exemption iPhone. Les compte-rendus sont dans docs/validation/input-observation-private-2026-11-13.json. Le client est compilé avec le build 9e7a43f22dded07d. Les tests utilisent exclusivement explorakit_test.

La migration 043 ajoute uniquement input_observations et son reçu de migration. Les notes publiques, leur version et l’historique ne changent pas. En cas de retour à l’ancien runtime, conserver la table additive ; ne jamais restaurer ou supprimer les données des joueurs pour annuler ce correctif.
