const fs = require('fs').promises; // Utilisez la version asynchrone de fs
const Pokemon = require('./pokemon.js'); 

function choisirPokemonSauvageAleatoire(pokemonArray) {
    if (pokemonArray.length === 0) {
        return null; // Aucun Pokémon sauvage disponible
    }
    const randomIndex = Math.floor(Math.random() * pokemonArray.length);
    return pokemonArray[randomIndex];
}

function choisirPokemonSauvagePourUneMap(mapName, jsonData) {
    const map = jsonData.maps.find(map => map.mapName === mapName);
    
    if (!map) {
        console.error(`La carte ${mapName} n'existe pas.`);
        return null;
    }

    const wildPokemon = map.wildpokemon;
    return choisirPokemonSauvageAleatoire(wildPokemon);
}

async function CreatePokemon(mapName) {
    try {
        // Lire le fichier JSON
        const data = await fs.readFile('nextMap.json', 'utf8');
        
        // Parser le contenu JSON
        const jsonData = JSON.parse(data);

        // Appeler la fonction pour choisir le Pokémon sauvage pour la carte spécifiée
        const chosenPokemon = choisirPokemonSauvagePourUneMap(mapName, jsonData);
        
        if (chosenPokemon !== null) {
            // console.log(`Pour la carte ${mapName}, le Pokémon sauvage choisi est le numéro ${chosenPokemon}`);

            const poke = new Pokemon(chosenPokemon, "test", 0, 0, null, "Timid", null);
            // console.log('le pokemon créé ?', poke);
            return poke;
        } else {
            // console.log(`Aucun Pokémon sauvage n'a été choisi pour la carte ${mapName}.`);
            return null;
        }
    } catch (err) {
        console.error(err);
        throw err;
    }
}

module.exports = CreatePokemon; 

