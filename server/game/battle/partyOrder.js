// Battle engines keep the active Pokémon at index 0. This separate position
// preserves the player's chosen party order across switches, saves and resumes.
function rememberPartyOrder(team) {
    for (const [index, pokemon] of (team?.pokemons || []).entries()) pokemon.battlePartySlot = index;
}

function orderedParty(pokemons = []) {
    return pokemons.map((pokemon, index) => ({ pokemon, index }))
        .sort((a, b) => {
            const rank = entry => Number.isInteger(entry.pokemon.battlePartySlot)
                ? entry.pokemon.battlePartySlot : Number.MAX_SAFE_INTEGER;
            return rank(a) - rank(b) || a.index - b.index;
        }).map(entry => entry.pokemon);
}

function restorePartyOrder(team) {
    if (!Array.isArray(team?.pokemons)) return;
    team.pokemons.splice(0, team.pokemons.length, ...orderedParty(team.pokemons));
    for (const pokemon of team.pokemons) delete pokemon.battlePartySlot;
}

function preservePartyOrder(battle, playerCount = 1) {
    return async (...args) => {
        try { return await battle(...args); }
        finally { for (const player of args.slice(0, playerCount)) restorePartyOrder(player?.equipe); }
    };
}

module.exports = { rememberPartyOrder, orderedParty, restorePartyOrder, preservePartyOrder };
