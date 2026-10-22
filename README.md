# RiftMon

Fan game web privé construit avec Vue 2, Node.js, Express, Socket.IO et MySQL.

Adresse officielle : https://riftmon.binout.fr/ — Aventure, Rift multijoueur et Colosseum. Les anciens liens `app.binout.fr/explorakit/` redirigent vers ce domaine ; Knov reste sur `app.binout.fr`. Les noms techniques des dépôts/dossiers et la base existante sont conservés pour préserver les installations et sauvegardes.

Voir [le déploiement](deploy/README.txt) avant toute publication sur le VPS.

## Organisation

- `server/` : API HTTP, temps réel, règles de jeu et persistance ;
- `vue-explorakit/` : client Vue ;
- `data/game/` : données de gameplay JSON ;
- `data/maps/` : cartes Tiled ;
- `database/` : schéma et migrations MySQL ;
- `docs/` : audit vivant et anciennes notes ;
- `scripts/` : outils de développement hors runtime ;
- `tests/` : tests de non-régression.

## Installation

Cloner avec `git clone --recurse-submodules https://github.com/Ybinout/Explorakit.git`. Pour un clone existant, exécuter `git submodule update --init --recursive`.


1. Copier `.env.example` vers `.env` et changer au minimum `JWT_SECRET`.
2. Importer `database/schema.sql` pour une nouvelle base. Pour une base existante, sauvegarder puis appliquer toutes les migrations versionnées avec `npm run db:migrate`.
3. Installer les dépendances avec `npm install` puis `npm --prefix vue-explorakit install`.
4. Construire le client avec `npm run build:client`.
5. Démarrer avec `npm start`.

Pour compiler le client puis lancer tout le jeu en une seule commande :

```bash
npm run launch
```

## Vérifications

- `npm test`
- `npm --prefix vue-explorakit run lint`
- `npm run build:client`
- `npm run check:db` pour vérifier la connexion et les moteurs de tables
- `npm run test:mysql` avec `DB_TEST_NAME` pointant obligatoirement vers une base dédiée dont le nom contient `test`
- `npm run audit:moves` pour vérifier les 612 capacités
- `npm run audit:abilities` pour vérifier les talents Gen 7 des 809 Pokémon et leur couverture mécanique

Les tests MySQL refusent de s'exécuter sur une base dont le nom ne contient pas `test`. Par défaut, les commandes utilisent `pokemon_game_test`.

## Maintenance de la base

```bash
npm run db:preflight
npm run db:backup
npm run db:migrate
npm run db:verify
npm run db:test:setup
npm run test:mysql
npm run test:http
npm run db:backfill:abilities
```

Les commandes contrôlent les données, créent une sauvegarde locale ignorée par Git, appliquent les migrations, préparent une base de test séparée et valident le parcours HTTP/Socket.IO. Le backfill attribue de façon déterministe un talent Gen 7 valide aux Pokémon déjà sauvegardés sans modifier les talents déjà valides.

La référence de maintenance et les priorités restantes sont dans `docs/AUDIT_PROJET.md`.
