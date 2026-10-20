# Audit du contenu du jeu

Dernière confrontation au code et aux contrôles : 14 octobre 2026.

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

Le chapitre I est raccordé : Mounir (identifiant `moonpunch`), puis les champions d’origine Hoze → Raphael → Ana → Wanda, puis la lettre d’Aspha aux archives de Clairbois. Douze dresseurs de ville proposent des combats facultatifs uniques. Les scènes évoluent avec les victoires persistantes. Le chapitre II prolonge désormais la lettre : Sofiane à Clairbois remet un registre, Noz à Rivazur témoigne, Thibaut est affronté à Rochebourg (56–58), puis Aspha est retrouvée à Floraville. Cet arc est conclu ; aucun épilogue global ni crédits ne sont déclarés livrés.

### Défauts confirmés lors de la revue du 11 octobre

- **Rendu corrigé :** huit intérieurs possédaient leurs données et PNG, mais le contexte Webpack du client excluait leurs noms. Le filtre client a été corrigé sans modifier les cartes ; les 46 lieux actifs et leurs premiers plans disponibles sont chargés et décodés par le test Chromium.
- **Progression corrigée :** les numéros de badges ne fixent plus la progression. Six étapes ordonnées terminent uniquement le chapitre I, après la lecture de la lettre. Prérequis vérifiés au dialogue, au lancement du combat et dans la transaction de récompense ; les anciennes récompenses restent acquises, les anciens statuts erronés sont recalculés à la lecture.
- **Ancienne alerte résolue :** `route4` est déjà à 42–48, et non 100–110. La descente des niveaux dans la région générée a été corrigée dans la passe d’équilibrage du 11 octobre : elle monte désormais de 38–41 à 57–60 dans le sens réel du parcours.

## État mesuré

| Domaine | État réel | Limite restante |
|---|---:|---|
| Cartes JSON installées | 47 | `pk1`, `route5` et `route6` restent installées mais inactives |
| Lieux actifs | 46 | 44 cartes actives et 2 alias d'intérieur ; `pk2` reste active uniquement pour compatibilité |
| Lieux atteignables depuis `start` | 45 | tous les lieux actifs sauf `pk2` |
| Parcours généré actif | 30/30 | 8 routes, 5 villes, 5 arènes, 10 maisons et 2 boutiques |
| PNJ placés | 45 | 8 nouveaux occupants d’intérieurs : 4 pour Aspha, 2 refuges et 2 vendeurs ; atlas existant réutilisé |
| Équipes de dresseurs | 25 | 19 utilisées ; Garry et les 5 anciennes équipes générées restent archivés, sans PNJ actif |
| Combats persistants | 19 | Timmy, Mounir, 4 champions, 12 habitants et Thibaut ; récompenses uniques |
| Quêtes / distinctions | 4 / 5 | 4 badges de champions + Sceau Sylve des archives ; clés historiques préservées |
| Dialogues | 83 (141 phrases) | Deux chapitres, prérequis, victoires, retrouvailles, refuges et boutiques |
| Objets | 13 | 3 Balls, 4 objets tenus, 4 médicaments et 2 objets clés ; utilisation hors combat des médicaments |

## Parcours des cartes

Le raccord actif s’appuie uniquement sur les passages déjà présents :

`route4` → `gen_route8` → Ocreville → `gen_route7` → Floraville → `gen_route6` → `gen_route5` → Rochebourg → `gen_route4` → Rivazur → `gen_route3` → `gen_route2` → Clairbois → `gen_route1` → `route3`.

Chaque ville possède une entrée d’arène et les portes d’intérieur livrées par l’agent cartes. Leurs destinations et retours sont seulement raccordés dans `nextMap.json` par le présent lot.

Le raccord direct `route3` → `gen_route1` a été retiré : il nécessitait de modifier `route3.json` et ses PNG. Le retour `gen_route1` → `route3` reste valide car il utilise un passage déjà généré.

## Intérieurs raccordés

L’agent cartes a livré et validé douze portes, leurs intérieurs et leurs retours. Le rapport reproductible est dans `docs/correctif_villes/verification.json` et le contrôle se lance avec `python docs/correctif_villes/validate_access.py`.

Les évolutions de gameplay doivent désormais se limiter à la configuration, aux PNJ, aux dialogues et à l’économie. Toute nouvelle porte ou modification visuelle reste réservée à l’agent cartes.

## PNJ, champions et progression

Le parcours approuvé suit Ocreville → Floraville → Rochebourg → Rivazur → Clairbois. Les quatre champions originaux remplacent les identités générées ; leurs portraits et sprites correspondent enfin à leurs noms. Les voyageurs et guides utilisent des apparences distinctes des quatre champions.

| Personnage | Lieu / case (x, y) | Équipe et niveaux | Récompense |
|---|---|---|---|
| Timmy | Interaction existante du village `start`, x=18 | Rattata 5 | 600 pièces, quête d’entraînement |
| Mounir / Moonpunch | `ville1_arene` (13, 5) | Machoc 18, Onix 19, Carabaffe 20 | 1 200 pièces, piste vers Hoze |
| Hoze | Ocreville, `gen_arene5` (13, 5) | Sablaireau 40, Camérupt 41, Hippodocus 43 | 1 800 pièces, Badge Dune |
| Raphael | Floraville, `gen_arene4` (13, 5) | Cotovol 44, Roserade 45, Alakazam 46 | 2 400 pièces, Badge Floraison |
| Ana | Rochebourg, `gen_arene3` (13, 5) | Archéodong 48, Steelix 49, Pingoléon 50 | 3 000 pièces, Badge Minerai |
| Wanda | Rivazur, `gen_arene2` (13, 5) | Bekipan 52, Ludicolo 52, Léviator 53, Milobellus 54 | 3 600 pièces, Badge Marée |
| Éloi | Clairbois, `gen_arene1` (13, 5) | Lecture de la lettre, sans combat | Sceau Sylve, fin du chapitre I |

Les niveaux explicites de `pnj_teams.json` sont convertis avec la courbe d’expérience de chaque espèce. Les anciennes définitions par XP restent acceptées. Les nouveaux partenaires ont des IV fixes et `k=1`, sauf les derniers Pokémon des champions et de Mounir (`k=2`). Tous leurs talents sont déjà gérés par le moteur ; objets et capacités appartiennent aux catalogues du jeu. Cette configuration est une première base d’équilibrage à éprouver en partie normale.

| Ville | Dresseurs facultatifs | Niveaux | Récompenses |
|---|---|---|---|
| Ville du Lac | Lina, Bastien | 12 ; 13–14 | 150 ; 200 |
| Ocreville | Nadir, Salomé | 36–37 ; 38 | 350 ; 380 |
| Floraville | Sofiane, Noé | 40–41 ; 42 | 400 ; 420 |
| Rochebourg | Malo, Maëlle | 44–45 ; 46 | 450 ; 480 |
| Rivazur | Louis, Inès | 48–49 ; 50 | 500 ; 520 |
| Clairbois | Robin, Célia | 54–55 ; 56 | 550 ; 580 |

Chaque habitant annonce ses niveaux avant le combat, puis donne un conseil ou un témoignage. Les récompenses ne sont versées qu’une fois ; après victoire, le dialogue remplace le défi, y compris après reconnexion. Une fuite ou défaite laisse le défi disponible. Les dialogues de victoire apparaissent automatiquement après le combat et restent consultables en reparlant au personnage.

La mère, placée dans `start` (6, 8), introduit la disparition d’Aspha et dirige vers Mounir. À la fin de chaque conversation, elle soigne gratuitement toute l’équipe : PV et PP au maximum, statuts retirés et Pokémon K.O. rétablis en Aventure. Le soin est sauvegardé et ne remplace pas le dernier Centre comme point de retour. En Rift, elle soigne l’équipe encore présente ; les Pokémon définitivement perdus ne reviennent pas. Son soin est identifié dans le journal sans augmenter le compteur « Soins au Centre ». Les huit intérieurs supplémentaires ont désormais un PNJ : Sofiane, Noz, Thibaut, Aspha, Lyse, Abel et les deux vendeurs. Aucun emplacement de carte n’a été modifié. Les 12 planches 4×4 existantes sont réutilisées ; aucun asset de carte ni JSON/TMX de carte n’a changé. Les tests tiennent compte des **deux cases** occupées par chaque PNJ, des portes et de toutes les arrivées dans les villes.

## Langues

Les options proposent Français et English. Le choix persiste sur l’appareil et couvre le menu en jeu, les écrans Pokédex/quêtes/sauvegarde/options, les commandes de combat, les résultats visuels et la capture.

Les 612 capacités du moteur et les 223 talents Gen 7 du catalogue disposent d’un nom français. Les tables sont générées avec `npm run generate:i18n` et leur couverture est testée.

Les dialogues narratifs et les messages produits par le serveur restent principalement en français. Les écrans d’authentification et certaines erreurs techniques ne sont pas encore entièrement bilingues.

## Histoire et économie

### Champions du scénario d'origine retrouvés — 11 octobre 2026

`data/game/phrase.txt` contient les dialogues avant/après combat de **Hoze → Raphael → Ana → Wanda**. Hoze recommande Raphael ; Raphael dirige vers Ana ; Ana envoie vers sa sœur dans la ville voisine, puis le document enchaîne sur Wanda. Wanda se présente comme une fondatrice ayant quitté l'Aube Obscure. Ces textes sont déjà présents dans le commit `54915cb` du 26 février 2025, sous `source_Json/phrase.txt`, puis conservés dans le dossier actuel.

Ce contenu a été adapté dans `interact.json` le 11 octobre. `phrase.txt` reste la source historique conservée ; il n’est pas chargé directement par le runtime. Dans les versions des fichiers d'équipes/dialogues des références Git locales inspectées, aucune équipe dédiée à ces quatre noms n'a été retrouvée, ni emplacement d'arène original explicite. Les équipes `champion_sylve`, `champion_maree`, `champion_minerai`, `champion_floraison`, `champion_dune` sont désormais inactives et conservées comme archives.

Les portraits `hoze.png`, `raph.png`, `ana.png`, `wanda.png` et leurs sprites sont maintenant raccordés aux quatre personnages. Le choix des villes a été explicitement approuvé par le créateur. Les nouvelles équipes, témoignages d’habitants et lettre sont des ajouts de cette passe ; le rôle de Wanda comme fondatrice ayant quitté l’organisation et le lien de fratrie avec Ana viennent du scénario retrouvé.

Les notes historiques mentionnent Mounir sans formaliser son lien à `moonpunch`. L’adaptation emploie « Mounir, surnommé Moonpunch », en conservant l’identifiant et sa victoire historique pour les sauvegardes. Aucun autre rôle de champion n’est attribué à Cynthia.

Les boutiques accessibles vendent les trois Balls et les quatre objets tenus. Le serveur contrôle la présence du joueur dans une boutique et effectue débit du solde et ajout au sac dans une transaction MySQL. La revente, les objets de soin utilisables et les objets clés restent à construire.

## Équilibrage XP et niveaux — 11 octobre 2026

Les niveaux sauvages sont configurés dans `nextMap.json`. Seuls les champs `level` ont été modifiés : espèces, transitions, cartes Tiled et assets restent identiques. Les villes et intérieurs n’ont toujours aucun combat sauvage. Les niveaux des cinq arènes sont conservés, puisqu’ils suivent déjà la nouvelle difficulté des routes précédentes ; les deux habitants de Clairbois sont adaptés à la fin du parcours.

| Zone sauvage, dans l’ordre réel | Niveaux |
|---|---|
| Village de départ | 5–7 |
| Route 1 | 8–11 |
| Route 2 | 12–16 |
| Route 3, après Mounir (18–20) | 21–25 |
| Grotte 1 / Grotte 2 | 26–30 / 31–35 |
| Route 4 d’origine | 35–38 |
| Route générée 8, vers Hoze | 38–41 |
| Route générée 7, vers Raphael | 42–45 |
| Routes générées 6 puis 5, vers Ana | 45–47 / 47–49 |
| Route générée 4, vers Wanda | 50–52 |
| Routes générées 3 puis 2, vers Clairbois | 53–55 / 55–57 |
| Route générée 1, dernier sentier | 57–60 |

Le retour final vers l’ancienne route 3 revient volontairement dans une région plus facile ; le voyageur du dernier sentier l’annonce. `pk2`, isolée et conservée pour compatibilité, garde ses niveaux 10–14.

`experience_balance.json` configure les multiplicateurs **sauvage ×1, dresseur ×1,5, arène ×2** et le parcours de référence contrôlé par les tests. La base reste `(12 + 0,9 × niveau²) × (0,9 + 0,1 × k)`. Elle est multipliée par un facteur d’écart de niveau `(niveau adverse / niveau receveur)^1,25`, borné entre 0,25 et 1,5 : une équipe très au-dessus de la zone reçoit moins, un partenaire en retard reçoit davantage. La courbe d’expérience cumulée, les niveaux acquis et le potentiel `k` des joueurs ne sont pas modifiés ; aucun plafond de niveau n’est ajouté. Le Pokémon actif conscient reçoit l’XP, sans nouveau partage automatique d’équipe.

Au niveau 40, contre un adversaire `k=1` de même niveau : 1 452 XP sauvages, 2 178 XP de dresseur, 2 904 XP d’arène. Le passage 40 → 41 coûte 4 681 XP pour la croissance standard ; cible théorique d’environ 3 à 4 victoires sauvages par niveau pour cette croissance. Les espèces à croissance différente gardent leur rythme propre. Ce calcul ne constitue pas une recette humaine du temps de jeu.

**Correctif moteur associé :** la boucle dresseur pouvait sortir avant d’attribuer l’XP du dernier adversaire. Les K.O. sont désormais comptabilisés par instance, y compris à la sortie de boucle et après un changement adverse, sans double attribution. La différence arène/dresseur vient de la définition serveur du combat ; le navigateur ne choisit pas son multiplicateur. Fuite sans K.O. : aucune XP. Pas de nouvelle prime d’XP globale de victoire qui ferait doublon.

Vérifications : `npm run audit:balance` donne les niveaux/XP par zone et les récompenses théoriques des arènes ; `tests/experience-balance.test.js` contrôle le parcours, les bornes réellement générées, les écarts, les facteurs d’XP et le rythme sans plafond. Le test MySQL du dernier K.O. échouait avant correction. Les tests d’arène couvrent chaque K.O., la fuite et la persistance exacte ; le parcours Socket contrôle le bonus d’XP des cinq arènes jusque dans MySQL.

## Vérifications

Rejoués le 11 octobre après équilibrage : 80 tests standards réussis / 15 tests MySQL ignorés dans `npm test` ; 15/15 MySQL, dont parcours Socket réel (refus avant prérequis, fuite, cinq victoires, scènes automatiques, lettre, reconnexion et dresseur facultatif). Les comptes et équipes renforcées de test sont créés uniquement dans la base dédiée et supprimés ensuite. Ces tests ne mesurent pas la difficulté humaine.

Contrôles dédiés : `node --test tests/story-content.test.js`, `npm run test:mysql`, `node --env-file-if-exists=.env scripts/validateStoryViewports.js`. Le test navigateur utilise les dialogues réellement reçus du serveur, les quatre formats 1440×900, 390×844, 320×568 et 844×390, le portrait, la commande tactile et les PNJ d’Ocreville. Captures dans `/tmp/explorakit-story-validation`.

- `npm run audit:content` : 47 cartes installées, 46 lieux actifs avec les alias, 45 atteignables, aucune carte générée inactive ni destination inconnue ;
- `python docs/correctif_villes/validate_access.py` : 12 portes, retours, foregrounds et synchronisation TMX/JSON validés par l’agent cartes ;
- `tests/world-content.test.js` : passages actifs, destinations, raccords d’intérieur, PNJ et traductions ;
- contrôle PNG des 12 sprites de PNJ : dimensions 256×256, transparence RGBA et correspondance exhaustive avec `pnjs.jsonc` ;
- les validateurs dans `docs/gen_routes`, `docs/gen_villes` et `docs/gen_interieurs` restent les contrôles propres aux cartes générées ;
- le raccord gameplay ne contient plus de script modifiant les JSON/TMX des villes.

## Priorités suivantes

1. Recette humaine du chapitre I et ajustement des niveaux/équipes. La courbe sauvage et les bonus d’XP ont été redistribués ; vérifier en partie réelle le rythme d’entraînement de plusieurs Pokémon et les retours au Centre.
2. Vérifier sur téléphone physique les dialogues, les combats et les déplacements ; compléter le PVP à deux navigateurs.
3. Ajouter du contenu aux huit intérieurs vides et prévoir de nouveaux lieux de soins avec le responsable cartes, sans fabriquer de portes hors de ce lot.
4. Développer la suite Aspha/Aube Obscure après la lettre, puis la résolution, le combat final et l’épilogue.
5. Ajouter les soins utilisables et les objets clés, puis l’anglais des dialogues et écrans restants.

## Ajouts du 14 octobre 2026

Les refuges de Lyse (Floraville) et Abel (Ocreville) composent une quête annexe de deux visites, avec deux Potions offertes par personne, une seule fois. Le chapitre II se déverrouille après la lettre du chapitre I. Sofiane remet le registre ; Noz révèle le contact ; Thibaut donne 1 800 pièces après victoire ; Aspha donne une lettre et 1 200 pièces lors des retrouvailles. Les récompenses sont sérialisées par compte et les drapeaux sont conservés après reconnexion.

Les boutiques proposent Potion (20 PV, 200), Super Potion (50 PV, 700), Antidote (poison simple/sévère, 100) et Rappel (moitié des PV, 1 500). Un objet sans effet ou une cible non possédée n’entraîne aucun débit. Les prix sont en monnaie Aventure, distincte des pièces RiftMon.

Le camp dispose de trois titres et trois cadres à 100/250/500 pièces RiftMon, sans avantage en combat. Les vingt derniers rapports serveur sont visibles aux participants uniquement. Les captures navigateur se reproduisent avec `test:release-browser` ; les 360 combats de `audit:simulation` sont une mesure de bots, pas une validation de difficulté humaine.
