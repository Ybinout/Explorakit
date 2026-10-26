# Données de noms PokeAPI

Les fichiers `move_names.csv` et `ability_names.csv` proviennent du dépôt public [PokeAPI/pokeapi](https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv). Ils servent uniquement à générer hors ligne les noms français utilisés par l'interface avec `npm run generate:i18n`.

Projet source : https://github.com/PokeAPI/pokeapi  
Licence du projet source : BSD-3-Clause (`https://github.com/PokeAPI/pokeapi/blob/master/LICENSE.md`)

La logique de combat continue d'utiliser les noms anglais comme identifiants stables ; la traduction n'est appliquée qu'à l'affichage.

`reference-texts.fr.json` conserve uniquement les textes français des 612 capacités et 223 talents du catalogue RiftMon. Sources : `move_flavor_text.csv` et `ability_flavor_text.csv`, révision immuable `81d20919845b6a445969b9265aab5cec6b04cece`, version la plus récente disponible jusqu’au groupe 18 (Ultra-Soleil/Ultra-Lune). Les empreintes des CSV et le groupe retenu pour chaque texte sont enregistrés dans le fichier. Les nombres de combat proviennent du catalogue local, jamais de ces textes. Les adaptations de présentation sont dans `data/game/pokemon_reference_overrides.fr.json`.

Régénération hors ligne : `node scripts/generatePokemonReference.js` ; vérification : même commande avec `--check`. Les descriptions sont embarquées dans le client, sans requête externe pendant le jeu. Licence du projet PokeAPI : BSD-3-Clause, source et attribution conservées ci-dessus.
