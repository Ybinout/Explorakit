const fs = require('fs');
const path = require('node:path');
const Pokemon = require('../models/Pokemon');
const Equipe = require('../models/Team');

const PNJ_TEAMS_PATH = path.resolve(__dirname, '..', '..', '..', 'data', 'game', 'pnj_teams.json');
const pnjTeamsData = JSON.parse(fs.readFileSync(PNJ_TEAMS_PATH, 'utf8'));

const pnjTeamsByName = new Map(
    pnjTeamsData.pnjs.map((pnj) => [pnj.name, pnj])
);

function getPnjTeam(pnjName) {
    const pnjData = pnjTeamsByName.get(pnjName);
    if (!pnjData) {
        console.log(`Le PNJ ${pnjName} n'a pas d'équipe enregistrée.`);
        return null;
    }

    // Une nouvelle equipe est construite pour chaque combat afin de ne jamais
    // partager les PV, statuts ou changements d'ordre entre deux joueurs.
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
        pokemon.passiveAbility = pokemonData.passiveAbility || pokemon.passiveAbility;
        pokemon.heldItem = pokemonData.heldItem || null;
        equipe.ajouterPokemon(pokemon);
    });

    return equipe;
}

// Exemple d'utilisation
// const timmyTeam = getPnjTeam('garry');
// if (timmyTeam) {
//     console.log(`Equipe de garry :`);
//     timmyTeam.afficherEquipe();
// }

module.exports = {
    pnjTeams: pnjTeamsByName,
    getPnjTeam
};
