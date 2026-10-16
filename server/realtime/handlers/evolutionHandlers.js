const evolution = require('../../game/models/evolution');
const { evolvePokemon } = require('../../persistence/evolutionRepository');

function registerEvolutionHandlers({ socket, userId, getPlayer, canUse = () => true }) {
    socket.on('getPokemonEvolutions', (payload, ack) => {
        const pokemon = getPlayer()?.equipe?.pokemons?.find(p => p.uuid === payload?.pokemonUuid);
        if (typeof ack === 'function') ack(pokemon ? { success: true, options: evolution.options(pokemon) } : { success: false, message: 'Ce Pokémon ne t’appartient pas.' });
    });
    socket.on('evolvePokemon', async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {}, p = getPlayer();
        if (!p || p.inbattle || p.inventoryBusy || !canUse()) return reply({ success: false, message: 'Attends la fin de l’action en cours.' });
        const pokemon = p.equipe?.pokemons?.find(poke => poke.uuid === payload?.pokemonUuid);
        if (!pokemon) return reply({ success: false, message: 'Ce Pokémon ne t’appartient pas.' });
        p.inventoryBusy = true;
        try {
            const result = await evolvePokemon(userId, pokemon.uuid, payload);
            Object.assign(pokemon, result.pokemon);
            socket.emit('teamStateChanged', { equipe: p.equipe, reason: 'evolution' });
            reply({ success: true, equipe: p.equipe, evolution: result.evolution });
        } catch (error) {
            if (error.code) console.error('Évolution impossible:', error.message);
            reply({ success: false, message: error.code ? 'Sauvegarde indisponible. Réessaie dans un instant.' : error.message });
        } finally { p.inventoryBusy = false; }
    });
}
module.exports = { registerEvolutionHandlers };
