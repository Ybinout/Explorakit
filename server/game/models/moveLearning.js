const { randomUUID } = require('node:crypto');
const { species } = require('../../../data/game/level_up_moves.json');
const { getMoveDefinition, getMaxMovePp, normalizeMovePp } = require('../battle/battleResources');

function queueLevelMoves(pokemon, previousLevel, evolution = false) {
    pokemon.pendingMoves ||= [];
    const known = new Set([...pokemon.abilities, ...pokemon.pendingMoves.map(choice => choice.move)]);
    for (const [level, move] of species[pokemon.data.id] || []) {
        if (!(evolution ? level === 0 : level > previousLevel && level <= pokemon.level) || known.has(move)) continue;
        pokemon.pendingMoves.push({ id: randomUUID(), move, level: evolution ? pokemon.level : level, speciesId: pokemon.data.id });
        known.add(move);
    }
}

// Only the first server-issued offer can be resolved; clients never supply a move.
function resolveMoveChoice(pokemon, { choiceId, slot } = {}) {
    if (!pokemon || pokemon.currentHp <= 0) throw Error('Ce Pokémon ne peut pas apprendre maintenant.');
    const choice = pokemon.pendingMoves?.[0];
    if (!choice || choice.id !== choiceId || !getMoveDefinition(choice.move)) throw Error('Ce choix n’est plus disponible.');
    if (slot !== null && (!Number.isInteger(slot) || slot < 0 || slot > 3 || slot > pokemon.abilities.length))
        throw Error('Choisis une attaque à oublier.');
    const result = { abilities: [...pokemon.abilities], movePp: [...pokemon.movePp], pendingMoves: pokemon.pendingMoves.slice(1) };
    normalizeMovePp(result);
    if (slot !== null) {
        if (result.abilities.includes(choice.move)) throw Error('Cette attaque est déjà connue.');
        result.abilities[slot] = choice.move;
        result.movePp[slot] = getMaxMovePp(choice.move);
    }
    return result;
}

module.exports = { queueLevelMoves, resolveMoveChoice };
