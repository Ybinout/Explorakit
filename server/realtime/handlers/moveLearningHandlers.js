const { learnMove } = require('../../persistence/moveLearningRepository');

function registerMoveLearningHandlers({ socket, userId, getPlayer, canUse = () => true }) {
    socket.on('learnMove', async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        const p = getPlayer();
        if (!p || p.inbattle || p.inventoryBusy || !canUse())
            return reply({ success: false, message: 'Attends la fin de l’action en cours.' });
        const pokemon = p.equipe?.pokemons?.find(poke => poke.uuid === payload?.pokemonUuid);
        if (!pokemon) return reply({ success: false, message: 'Ce Pokémon ne t’appartient pas.' });
        p.inventoryBusy = true;
        try {
            Object.assign(pokemon, await learnMove(userId, pokemon.uuid, payload));
            socket.emit('teamStateChanged', { equipe: p.equipe, reason: 'move_learning' });
            reply({ success: true, equipe: p.equipe });
        } catch (error) {
            if (error.code) console.error('Apprentissage impossible:', error.message);
            reply({ success: false, message: error.code ? 'Sauvegarde indisponible. Réessaie dans un instant.' : error.message });
        } finally { p.inventoryBusy = false; }
    });
}
module.exports = { registerMoveLearningHandlers };
