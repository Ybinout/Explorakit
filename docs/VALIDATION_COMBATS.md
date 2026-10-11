# Validation de stabilité des combats

Passe initiale : 3 octobre 2026 ; notes de suivi réconciliées le 11 octobre 2026.
Périmètre : moteur commun, combats sauvage/dresseur/PVP, persistance MySQL, contrat Socket.IO et affichage ordinateur/mobile.  
Verdict : **validation technique réussie**. Le système de combat peut être considéré stable pour les scénarios listés ci-dessous.

## Couverture obtenue

| Scénario demandé | Preuve reproductible | Résultat |
| --- | --- | --- |
| Combat sauvage | Capture réelle, victoire par attaque, gain d'expérience, PP persisté, K.O., remplacement forcé, fuite et défaite terminale dans `battle-runtime-integration.test.js` | Validé |
| Combat dresseur | Victoire, récompense monétaire, sauvegarde, changement manuel et fuite avec une vraie base MySQL | Validé |
| PVP | Deux sockets scriptées passent réellement par `startPvpBattle` : tour simultané, animation d'attaque, victoire du bon joueur et abandon simultané | Validé |
| Attaques physique, spéciale et de statut | Tests déterministes du moteur : défenses physique/spéciale distinctes, dégâts et modification de statistiques sans dégâts | Validé |
| Critique, immunité, raté et efficacité | Tests déterministes ; correction de la table Gen 7 qui omettait notamment Sol → Vol, Normal → Roche/Acier et plusieurs résistances Dragon | Validé et corrigé |
| Changement manuel et forcé | Parcours réels dresseur et sauvage, avec ordre de l'équipe sauvegardé | Validé |
| Hurlement, Demi-Tour et Relais | Les vraies capacités produisent `forceSwitch`, `switchSelf` et `batonPass`, puis le résolveur change le combattant et transmet les bonus de Relais | Validé |
| Objets, capture et PP épuisés | Hyper Ball consommée et capture persistée ; objet tenu via HTTP ; PP décrémentés/persistés ; Lutte automatique et effets Dépit/Rancune couverts | Validé |
| Victoire, fuite et défaite | Raisons terminales stables (`victory`, `fled`, `defeat`, `finished`, `both_fled`) et sauvegarde contrôlée | Validé |
| Récupération après défaite | Smoke test HTTP/Socket : équipe soignée, retour à la maison faute de centre et position persistée | Validé |
| Ordinateur | Chrome headless, application de production et vrai composant Vue, 1440 × 900 : aucun débordement, scène et commandes entièrement visibles | Validé |
| Mobile portrait | Chrome headless, 390 × 844 : aucun débordement, deux sprites et fiches visibles, boutons de 47 px minimum | Validé |

## Commandes de contrôle

```powershell
npm test
npm run db:test:setup
npm run test:mysql
npm run test:http
npm run audit:moves
npm run audit:abilities
npm run build:client
npm --prefix vue-explorakit run lint
npm run test:visual
```

Résultats de la passe :

- suite standard : 70 tests, 59 réussis, 11 tests MySQL ignorés comme prévu, aucun échec ;
- suite MySQL dédiée : 11/11 réussis ;
- audit des capacités : 612 capacités, 99 familles d'effets, aucun effet inconnu, cas spécial non géré ou capacité partielle ;
- audit des talents : 809 Pokémon et 223 talents cohérents, aucune erreur de données ;
- smoke HTTP/Socket : authentification, objet tenu et récupération après défaite réussis ;
- lint et build de production : réussis ;
- validation navigateur : 2/2 viewports réussis.

## Captures de référence

- [Combat ordinateur](validation/battle-desktop.png)
- [Combat mobile](validation/battle-mobile.png)

Le test visuel est reproductible par `npm run test:visual`. Il crée un compte temporaire exclusivement dans la base portant `test`, démarre le serveur sur un port isolé, ouvre Chrome ou Edge headless, mesure la mise en page, enregistre les captures, puis supprime le compte.

## Limites non bloquantes

- Le PVP est validé au niveau de l'orchestrateur avec deux sockets conformes au contrat, tandis que l'authentification et le transport Socket.IO sont validés séparément par le smoke test. Une session humaine à deux navigateurs reste utile pour le ressenti réseau.
- Le portrait mobile est validé par un vrai moteur Chromium et des métriques tactiles ; un appareil physique et le paysage restent conseillés pour la recette ergonomique finale.
- La météo, les terrains et les sons ont depuis été intégrés dans `BattleOverlay.vue` ; voir `AUDIT_ANIMATIONS_COMBAT.md`.
- Le mode double n'est pas exposé par l'interface ; ses primitives moteur ne constituent pas un combat double jouable.

## Suite recommandée

L'extraction de `BattleOverlay.vue` et l'audit de contenu sont déjà livrés. Le 11 octobre, les 11 tests MySQL/orchestrateurs et le smoke HTTP/Socket ont été rejoués avec succès ; les captures de combat restent celles de la passe initiale et n'ont pas été régénérées. La prochaine priorité est le défaut de progression des champions décrit dans `AUDIT_PROJET.md`, puis la recette réelle du parcours et le découpage progressif des gros fichiers.

