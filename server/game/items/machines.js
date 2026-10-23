const { machines } = require('../../../data/game/machines.json');
const { getMoveDefinition, getMaxMovePp, normalizeMovePp } = require('../battle/battleResources');

function teachMachine(pokemon, itemKey, { slot, expectedMoves } = {}) {
    const machine = typeof itemKey === 'string' && Object.hasOwn(machines,itemKey) ? machines[itemKey] : null;
    if (!machine || !getMoveDefinition(machine.move)) throw Error('CS introuvable.');
    if (!pokemon || pokemon.isEgg || !(pokemon.currentHp > 0)) throw Error('Choisis un Pokémon conscient, hors œuf.');
    if (!machine.species.includes(pokemon.data.id)) throw Error('Ce Pokémon n’est pas compatible avec cette CS.');
    if (pokemon.abilities.includes(machine.move)) throw Error('Ce Pokémon connaît déjà cette attaque.');
    if (!Array.isArray(expectedMoves) || JSON.stringify(expectedMoves) !== JSON.stringify(pokemon.abilities))
        throw Error('Les attaques de ce Pokémon ont changé. Choisis à nouveau.');
    if (!Number.isInteger(slot) || slot < 0 || slot > 3 || (pokemon.abilities.length < 4 ? slot !== pokemon.abilities.length : slot >= pokemon.abilities.length))
        throw Error('Choisis l’attaque à remplacer.');
    const result = { abilities: [...pokemon.abilities], movePp: [...(pokemon.movePp || [])],
        pendingMoves: (pokemon.pendingMoves || []).filter(choice => choice.move !== machine.move) };
    normalizeMovePp(result);
    result.abilities[slot] = machine.move;
    result.movePp[slot] = getMaxMovePp(machine.move);
    return result;
}
module.exports = { machines, teachMachine };
