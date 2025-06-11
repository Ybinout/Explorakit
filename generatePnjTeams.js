const fs = require('fs');
const Pokemon = require('./pokemon'); // Remplace par le bon chemin vers ton fichier Pokémon
const Equipe = require('./equipe'); // Remplace par le bon chemin vers ton fichier Equipe

const pnjTeamsData = JSON.parse(fs.readFileSync('./source_Json/pnj_teams.json', 'utf8'));

const pnjTeamsCache = {};

function getPnjTeam(pnjName) {
    if (!pnjTeamsCache[pnjName]) {
        const pnjData = pnjTeamsData.pnjs.find(pnj => pnj.name === pnjName);
        if (!pnjData) {
            console.log(`Le PNJ ${pnjName} n'a pas d'équipe enregistrée.`);
            return null;
        }
        
        const equipe = new Equipe();

        pnjData.team.forEach(pokemonData => {
            const pokemon = new Pokemon(
                pokemonData.pokemonId,
                pokemonData.name,
                null, // Le niveau est calculé automatiquement à partir de l'expérience
                pokemonData.experience, // On utilise l'expérience définie dans le JSON
                pokemonData.givenIv,
                pokemonData.nature,
                pokemonData.k
            );

            pokemonData.abilities.forEach(ability => pokemon.addAbility(ability));

            equipe.ajouterPokemon(pokemon);
        });

        pnjTeamsCache[pnjName] = equipe;
    }
    return pnjTeamsCache[pnjName];
}


module.exports = {
    pnjTeams: pnjTeamsCache,
    getPnjTeam
};
