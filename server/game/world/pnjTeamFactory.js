const fs = require('fs');
const path = require('node:path');
const Pokemon = require('../models/Pokemon');
const Equipe = require('../models/Team');
const { getExperienceRate, getTotalExperienceForLevel } = require('../models/progression');
const pokedex = require('../../../data/game/pokedex.json');

const PNJ_TEAMS_PATH = path.resolve(__dirname, '..', '..', '..', 'data', 'game', 'pnj_teams.json');
const pnjTeamsData = JSON.parse(fs.readFileSync(PNJ_TEAMS_PATH, 'utf8'));

const pnjTeamsByName = new Map(
    pnjTeamsData.pnjs.map((pnj) => [pnj.name, pnj])
);

function getPnjTeam(pnjName, { mode } = {}) {
    const pnjData = pnjTeamsByName.get(pnjName);
    if (!pnjData) {
        console.log(`Le PNJ ${pnjName} n'a pas d'équipe enregistrée.`);
        return null;
    }

    // Une nouvelle equipe est construite pour chaque combat afin de ne jamais
    // partager les PV, statuts ou changements d'ordre entre deux joueurs.
    const equipe = new Equipe();

    pnjData.team.forEach(pokemonData => {
        const species = pokedex.find((entry) => entry.id === pokemonData.pokemonId);
        const level = mode === 'adventure' ? (pokemonData.adventureLevel ?? pokemonData.level) : pokemonData.level;
        const experience = Number.isInteger(level) && level > 0
            ? getTotalExperienceForLevel(level, getExperienceRate(species?.exp))
            : pokemonData.experience;
        const pokemon = new Pokemon(
            pokemonData.pokemonId,
            pokemonData.name,
            null,
            experience, // Niveau explicite pour le contenu ; XP historiques toujours acceptées.
            pokemonData.givenIv,
            pokemonData.nature,
            pokemonData.k,
            pokemonData.ev
        );

        pokemonData.abilities.forEach(ability => pokemon.addAbility(ability));
        pokemon.passiveAbility = pokemonData.passiveAbility || pokemon.passiveAbility;
        pokemon.heldItem = pokemonData.heldItem || null;
        equipe.ajouterPokemon(pokemon);
    });

    require('../battle/trainerTactics').attachPlan(equipe, pnjData);
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
