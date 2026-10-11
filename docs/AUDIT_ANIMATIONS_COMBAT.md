# Audit de la vue et des animations de combat

Date : 3 octobre 2026  
Périmètre : combats sauvage, dresseur et PVP ; client Vue 2, événements Socket.IO et rendu CSS.  
Statut : passe statique et validation Chromium ordinateur/mobile terminées ; recette ergonomique sur appareils physiques seulement recommandée.

## Verdict

Le combat possède maintenant une base visuelle cohérente et jouable : entrée douce, animation de chaque capacité, impacts, dégâts, soins, changement de Pokémon, capture, informations de PV/statut/talent et interface responsive. Le serveur reste l'autorité de jeu ; le nouvel événement `battleMoveAnimation` ne transporte que des informations de présentation.

La vue de combat, son état de présentation, ses animations et ses minuteries sont désormais isolés dans `BattleOverlay.vue`. `UserMap.vue` conserve uniquement l'ouverture/fermeture du combat, la réception Socket.IO et l'émission des actions.

Après contrôle sur plusieurs captures réelles en 896 px de large, le placement ne dépend plus des dimensions brutes des PNG. Le client mesure au chargement la zone alpha réellement visible de chaque sprite, puis centre son contour et pose son point le plus bas sur une ancre fixe de plateforme. La taille est bornée par le plus grand côté visible, et non uniquement par la hauteur : un Pokémon très large comme Racaillou ne devient donc plus surdimensionné. Le Pokémon du joueur est légèrement plus grand pour accentuer la perspective et ancré exactement au bord inférieur, sans marge ; l'adversaire, calibré à environ 120 px, est placé plus haut sur sa plateforme. L'indicateur de tour est également centré entre la scène et les commandes afin de ne plus recouvrir une fiche.

Les mêmes mesures alpha servent maintenant au ciblage. Les projectiles partent du centre visible de l'attaquant et terminent au centre visible de la cible, sans coordonnées fixes dépendantes du viewport. Les nombres de dégâts et les retours raté/critique/efficacité suivent également le sprite concerné. La capture reprend exactement ce point, puis enchaîne lancer en arc, impact, aspiration, chute sur la plateforme, zéro à trois secousses et résultat.

## Constats et corrections

| Priorité | Constat avant la passe | Correction appliquée | État |
| --- | --- | --- | --- |
| P0 | Les boutons principaux restaient utilisables hors du tour du joueur. | Tous les choix sont désactivés tant que `requestAction` n'a pas ouvert un tour ; un indicateur affiche clairement « À toi de jouer » ou « Résolution du tour ». | Corrigé |
| P0 | Une capacité de statut ou sans dégâts n'avait aucun retour visuel. | Les trois orchestrateurs émettent `battleMoveAnimation` avec l'acteur, le type et la classe de dégâts ; le client joue une aura, un projectile ou une impulsion physique. | Corrigé |
| P1 | Les impacts étaient déduits uniquement d'une baisse de PV et pouvaient être faux lors d'un changement de Pokémon. | Les variations de PV ne sont comparées que si l'identité du Pokémon est inchangée ; dégâts et soins disposent de retours distincts. | Corrigé |
| P1 | La transition d'ouverture utilisait un clignotement plein écran de deux secondes. | Elle est remplacée par une entrée courte en fondu/glissement ; `prefers-reduced-motion` neutralise les animations importantes. | Corrigé |
| P1 | Les barres de PV ne donnaient ni valeur accessible ni inertie visuelle. | Valeurs numériques, attributs `progressbar` et traînée jaune retardée lors des dégâts. | Corrigé |
| P1 | La capture ignorait le nombre d'oscillations calculé par le serveur. | L'animation joue maintenant de zéro à trois oscillations selon `payload.shakes`, puis le résultat. | Corrigé |
| P1 | Les projectiles et la Ball visaient des coordonnées génériques et pouvaient traverser le vide. | Le chemin est calculé depuis les contours opaques des deux sprites à chaque animation ; la capture dispose d'un impact et d'une aspiration réellement centrés sur l'adversaire. | Corrigé |
| P1 | La liste de changement affichait six boutons codés en dur, y compris les cases vides, le Pokémon actif et les K.O. | Liste dynamique avec PV, état actif et désactivation des choix invalides. | Corrigé |
| P1 | La scène utilisait une hauteur fixe et des coordonnées surtout en pixels. | Taille limitée au viewport, positions proportionnelles, disposition mobile dédiée et commandes adaptées aux petits écrans. | Corrigé, à valider sur appareils réels |
| P2 | Les messages changeaient sans transition et sans annonce accessible. | Chaque message possède une transition courte et une zone `aria-live`. | Corrigé |
| P2 | Les talents nouvellement intégrés n'étaient pas visibles en combat. | Le talent passif est affiché dans la fiche de chaque combattant quand il est présent. | Corrigé |

## Chaîne d'animation actuelle

1. L'orchestrateur détermine la capacité et émet `battleMoveAnimation` selon le point de vue du client.
2. Le client anime le Pokémon attaquant et un effet coloré par type.
3. Le moteur résout la capacité sans dépendre de l'animation.
4. `introAnimation` synchronise l'état complet du combat.
5. Le client compare les PV du même Pokémon, anime l'impact ou le soin, puis la barre retardée rejoint la nouvelle valeur.
6. Les textes métier restent envoyés par `battleText` et la prochaine action par `requestAction`.

Cette séparation évite de retarder ou de modifier les règles selon les performances graphiques du navigateur.

## Lots réalisés après l'audit

### Validation fonctionnelle et visuelle réalisée

La passe de stabilité couvre désormais attaque physique, spéciale et de statut ; critique, raté, immunité et efficacité ; dégâts résiduels et soins ; mise K.O. ; changement manuel et forcé ; Hurlement, Relais et Demi-Tour ; capture ; victoire, fuite et défaite. Les trois orchestrateurs sont exécutés dans la suite MySQL dédiée et le contrat HTTP/Socket est vérifié séparément.

Le script `npm run test:visual` ouvre l'application construite dans Chromium et valide 1440 × 900 et 390 × 844. Il contrôle les débordements, les deux sprites, les fiches, la scène, les commandes, une cible tactile d'au moins 44 px et l'égalité géométrique entre la cible calculée, le projectile et la Ball. Les captures de référence sont `docs/validation/battle-desktop.png`, `battle-mobile.png`, `battle-capture-desktop.png` et `battle-capture-mobile.png`. Le paysage et un appareil physique restent une vérification ergonomique recommandée, non un blocage métier.

### P1 — extraction de la vue de combat — terminée

`BattleOverlay.vue` contient le template, les styles, l'état visuel, les différences de PV et toutes les minuteries. Sa surface publique est limitée aux mises à jour d'état et aux animations ; il émet seulement les choix du joueur et les demandes de chargement du sac.

### P2 — résultat visuel enrichi — terminé

Le serveur émet maintenant `battleMoveResult` avec raté, blocage, immunité, critique et multiplicateur d'efficacité. Le client affiche des retours dédiés sans analyser les phrases françaises.

### P2 — météo, terrain et sons — terminé

L'événement `battleFieldState` synchronise les calques pluie, soleil, tempête de sable, grêle et les quatre terrains. Les sons synthétiques Web Audio couvrent attaque, statut, soin, K.O., raté, critique et capture, avec bouton muet persistant et respect de la réduction des animations.

### P2 — poids des ressources — terminé pour le combat

Le fond de combat est converti en WebP reproductible : 2 168 859 octets deviennent 171 704 octets. Les vues secondaires sont chargées paresseusement et les sprites Pokémon sont copiés comme ressources statiques au lieu d'un grand contexte `require()`. Le chunk jeu passe d'environ 1 012 Kio à 213 Kio avant compression. Les grands portraits de dialogue restent le prochain lot d'optimisation d'images.

### P3 — catalogue visuel par familles

Il n'est pas nécessaire de créer 612 animations uniques. Une bibliothèque de 12 à 20 familles (contact, projectile, rayon, onde, sol, météo, soin, amélioration, baisse, statut, piège, changement) associées aux métadonnées des capacités donnera beaucoup plus de variété avec peu de code.

## Vérifications automatisées de cette passe

- syntaxe des trois orchestrateurs de combat : réussie ;
- lint Vue : réussi sans erreur ;
- build frontend de production : réussi ;
- tests Node : 73 au total, 62 réussis et 11 tests MySQL ignorés par la suite standard ;
- tests MySQL/orchestrateurs : 11/11 réussis ;
- validation Chromium : 2/2 viewports réussis, ciblage projectile/Ball à moins de 3 px du centre calculé et quatre captures conservées dans `docs/validation/` ;
- avertissements conservés : grands portraits de dialogue, `caniuse-lite` ancien et dépréciations de Vue CLI.

## Critère de clôture

La passe est validée techniquement : les trois types de combat, les branches prioritaires, le ciblage dynamique, l'overlay extrait et les deux formats d'affichage passent leurs contrôles reproductibles. Mise à jour du 11 octobre : cette tranche verticale et les 30 cartes générées sont déjà raccordées, de même que les boutiques et les champions. La priorité courante est la cohérence des quêtes dans l'ordre réel des champions, puis la recette du parcours ; voir section 7 de `AUDIT_PROJET.md`. Les résultats visuels ci-dessus restent ceux de la passe datée du 3 octobre.
