# Animations, Maison PvE, captures et sécurité — 13 novembre 2026

## Changements de jeu

Les coups de pied ont une silhouette de pied, une trajectoire arquée et un impact propre. Double Pied, Pied Brûleur et les coups tournants partagent la famille, avec leurs variantes. Coup de Main fait apparaître deux mains et des étincelles près de son destinataire. Façade a une ruée et des éclats anguleux ; Retour une traînée et un impact étoilé. Les animations précédentes restent disponibles. Les phases restent dans la file de présentation existante ; aucun dégât, priorité ni statut n’est changé. Les échecs n’affichent pas un impact réussi. Le catalogue visuel généré couvre les 640 capacités du serveur, y compris Choc Émotionnel et Boule Pollen.

Le choix du premier Pokémon utilise le planificateur humain existant, à partir de la composition ouverte adverse. Les intentions soumises, les objets adverses non révélés, les IV/EV et les statistiques exactes adverses ne sont pas consultés. Une petite préférence pour le meneur du plan complète l’évaluation des matchups ; elle ne force pas une ouverture identique. Seule la copie temporaire de l’adversaire en Maison est réordonnée.

## Cinq nouvelles équipes

Toutes ont six espèces finales, K4, des EV spécialisés et un objet différent par Pokémon. Les IV sont à 31, sauf la Vitesse à 0 sur les membres prévus pour Distorsion. Chacune contient exactement un Pokémon corrompu. Elles s’adaptent au nombre de Pokémon et au niveau de l’équipe du joueur, comme les adversaires existants. Aucun gain d’XP ni de récompense PvE.

| Équipe | Composition | Plan |
| --- | --- | --- |
| Horlogers d’argile | Octillery corrompu, Archéodong, Symbios, Lançargot, Rhinastoc, Tutankafer | Distorsion, immunités utiles et gros attaquants lents. Octillery gagne Lentiteintée. |
| Relais de coton | Girafarig corrompu, Lanturn, Noadkoko, Vacilys, Hélédelle, Kapoera | Girafarig Farceur transmet Hâte/Amnésie ; pivots et absorptions couvrent les receveurs. Hélédelle exploite Cran et Façade. |
| Forteresse volante | Apireine corrompue, Nidoqueen, Xatu, Coudlangue, Tartard, Scalproie | Apireine Garde Magik se renforce et se soigne ; pièges, soins, renvoi des statuts et priorité complètent l’usure. |
| Marée nocturne | Luminéon corrompu, Armaldo, Coatox, Vacilys, Lanturn, Grotadmorv | Luminéon Crachin et module défensif Plante soutient Glissade, Peau Sèche et les absorptions Eau/Électrik. |
| Revenants d’acier | Magirêve corrompu, Mammochon, Ohmassacre, Pashmilla, Drascore, Baggaïd | Magirêve Régé-Force utilise une CS corrompue Dernier Mot. Pivots, Sabotage, Provoc et pièges désorganisent les défenses. |

Les trois équipes d’entraînement précédentes sont conservées. Les mouvements naturels ont été vérifiés contre les compatibilités CS du jeu ; seul Dernier Mot de Magirêve provient explicitement du module universel.

## Capture et revente

La Master Ball garantit la capture des Pokémon sauvages sur l’île et le véritable Dark Continent, Élites comprises. Les contrôles habituels restent actifs : rencontre sauvage, stock réel, tour courant, place disponible. Les Balls Corrompues gardent leurs chances de 30 %, leurs conditions de type et leur restriction contre les Élites.

Une Élite capturée conserve son espèce, niveau, K, IV, statut shiny et corruption naturelle, mais ses six EV sont remis à zéro avant la sauvegarde et ses statistiques recalculées. Les PV restent compris entre 1 et le nouveau maximum. Si un autre Pokémon corrompu est déjà dans l’équipe, elle rejoint le PC, même si l’équipe n’est pas pleine. Si le PC est plein, la Ball n’est pas consommée. Les données de capture, le Pokédex, le placement et le débit de Ball sont validés dans la transaction versionnée existante ; un paquet rejoué ou une reconnexion ne donne pas une deuxième capture.

Revente aux boutiques : Master Ball à **2 000 000 ₽**, Multi Exp à **100 ₽**. Ces prix sont déterminés par le catalogue serveur. Aucune vente de Master Ball par les boutiques n’est ajoutée et les catégories de l’Hôtel des Ventes ne sont pas rouvertes.

## Audit de sécurité

### Faille corrigée : équipe en mémoire et écriture HTTP concurrente

Les anciennes routes HTTP de changement d’objet tenu et de réorganisation pouvaient écrire alors qu’une session Socket détenait encore une copie de l’équipe. Une déséquipement HTTP pouvait rendre l’objet au sac sans le retirer de la copie active ; une sauvegarde ultérieure de cette copie pouvait le réintroduire. Le risque concerne notamment les objets tenus et les écritures tardives après déconnexion.

Les deux routes utilisent maintenant un verrou de mutation hors session. Toute session active, en initialisation ou en drainage refuse ces écritures HTTP avec un statut 409. Les commandes Socket normales continuent de mettre à jour ensemble la base et la copie active. Si une mutation HTTP commence avant la connexion, la nouvelle session attend sa fin avant de lire l’équipe. Le verrou reste acquis jusqu’à la fin des tâches et sauvegardes de déconnexion ; un remplacement de session ne crée pas de fenêtre sans protection. Les erreurs libèrent le verrou et ne bloquent pas durablement le compte.

Les verrous SQL existants contre échanges, raids, Drafts et checkpoints Dark Continent restent actifs, y compris hors connexion. Aucune route publique ne reçoit un objet Pokémon complet à sauvegarder.

### Opérations examinées

- Identité HTTP/Socket issue du jeton signé ; lecture d’équipe restreinte au propriétaire.
- Sauvegarde manuelle issue de l’équipe serveur, sans import des statistiques du navigateur.
- Équipement, ordre d’équipe et PC : UUID possédés, état de combat et verrou d’inventaire.
- Achats et ventes : catalogue serveur, contexte de boutique serveur, quantités entières, débit conditionnel et transaction.
- Échanges : proposition relue côté serveur, empreinte de confirmation, débit atomique, reçu rejouable sans double crédit.
- Corruption : catalogue de modules, coûts, propriété, révision et attaques attendues contrôlés côté serveur.
- Utilisation des soins, vitamines, relances et CS : reconstruction du Pokémon sauvegardé et compatibilités serveur.
- Captures, récompenses et reprise Dark Continent : état, tirage et checkpoint serveur, version et transaction avant émission.
- Administration et session unique : permissions serveur et fin des écritures de la session remplacée.

Les tests envoient des jetons invalides, UUID étrangers, quantités négatives/non entières et champs frauduleux de prix, argent, statistiques et capture. Les transactions concurrentes sont testées jusqu’au solde et au stock SQL réellement sauvegardés.

### Portée et limites

Cet audit porte sur les chemins de jeu et d’inventaire examinés et leurs tests ciblés. Il ne constitue pas une garantie universelle contre toute attaque, ni un audit de l’infrastructure ou des dépendances. Le verrou de copie active vise l’architecture actuelle à un processus de jeu ; un déploiement futur avec plusieurs processus écrivains devrait partager ce verrou entre eux. La console peut modifier l’affichage local mais ne devient pas une source d’autorité pour la progression persistante.

## Vérification reproductible

- `tests/combat-captures-security-20261113.test.js` : captures, restrictions, cinq équipes, ouverture, animations et courses de sessions.
- `tests/combat-captures-security-20261113-mysql.test.js` : vraies captures dans l’équipe/PC, reconnexion, ventes concurrentes et serveur HTTP/Socket authentifié.
- `scripts/validateCorruptedHouseCombat20261113.js` : dix simulations réelles contre offensive et défense, toutes terminées, PP/PV valides et aucune XP.
- `scripts/validateCombatCapturesSecurity20261113Browser.js` : client compilé, Chromium/WebKit, PC et mobile, affichage des équipes et des animations, reprise d’une Élite avec Master Ball.
- Toutes les recettes SQL utilisent exclusivement `explorakit_test`. Les émulations WebKit ne remplacent pas un iPhone physique.

Aucune migration ni modification des comptes joueurs n’est nécessaire. Les notes publiques restent brèves et l’historique précédent est conservé.

Résultat final : **121 tests de logique, 48 tests SQL, dix combats terminés et 24 vues Chromium/WebKit** validés. Lint sans erreur, build `d01c4c4fa6c2d065`.
