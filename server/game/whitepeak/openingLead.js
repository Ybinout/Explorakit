const engine = require('../battle/battleEngine');
const ai = require('../battle/humanTrainerAI');
// Open team sheets only. No submitted action, hidden item, IV or exact opposing
// stats enter the planner. This reorders only the House's temporary NPC copy.
function openingLead(team, playerTeam, preferredSpecies = null) {
    const field = engine.createBattleState();
    const index = ai.chooseReplacement({team:team.pokemons, opponentTeam:playerTeam,
        field, ownSide:field.sides.enemy, enemySide:field.sides.player,
        openingBias:team.pokemons.map(p => p.data.id === preferredSpecies ? 12 : 0)});
    if (index > 0) team.pokemons.unshift(...team.pokemons.splice(index, 1));
    return team;
}
module.exports = {openingLead};
