const evolution = require('../../game/models/evolution');
const { evolvePokemon, evolvePokemonWithStone } = require('../../persistence/evolutionRepository');

function registerEvolutionHandlers({ socket, userId, getPlayer, canUse = () => true }) {
    socket.on('getPokemonEvolutions', (payload, ack) => {
        const pokemon = getPlayer()?.equipe?.pokemons?.find(p => p.uuid === payload?.pokemonUuid);
        if (typeof ack === 'function') ack(pokemon ? { success: true, options: evolution.options(pokemon) } : { success: false, message: 'Ce Pokémon ne t’appartient pas.' });
    });
    for (const event of ['evolvePokemon', 'useEvolutionStone']) socket.on(event, async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {}, p = getPlayer();
        if (!p || p.inbattle || p.inventoryBusy || !canUse()) return reply({ success: false, message: 'Attends la fin de l’action en cours.' });
        const pokemon = p.equipe?.pokemons?.find(poke => poke.uuid === payload?.pokemonUuid);
        if (!pokemon) return reply({ success: false, message: 'Ce Pokémon ne t’appartient pas.' });
        p.inventoryBusy = true;
        try {
            const result = event === 'useEvolutionStone'
                ? await evolvePokemonWithStone(userId, pokemon.uuid, payload?.itemKey)
                : await evolvePokemon(userId, pokemon.uuid, payload);
            Object.assign(pokemon, result.pokemon);
            socket.emit('teamStateChanged', { equipe: p.equipe, reason: 'evolution' });
            socket.emit('bagUpdated', { items: result.items });
            reply({ success: true, equipe: p.equipe, evolution: result.evolution, items: result.items });
        } catch (error) {
            if (error.code) console.error('Évolution impossible:', error.message);
            reply({ success: false, message: error.code ? 'Sauvegarde indisponible. Réessaie dans un instant.' : error.message });
        } finally { p.inventoryBusy = false; }
    });
}
module.exports = { registerEvolutionHandlers };
