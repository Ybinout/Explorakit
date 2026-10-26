const { onAccountEvent } = require('../accountConnection');
const { editEquipe } = require('../../persistence/teamRepository');

function registerTeamOrderHandlers({ socket, userId, getPlayer, canUse = () => true, persist = editEquipe }) {
    onAccountEvent(socket, 'reorderTeam', async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        const player = getPlayer();
        if (!player || player.inbattle || player.inventoryBusy || !canUse())
            return reply({ success: false, message: 'Attends la fin de l’action en cours.' });
        const team = player.equipe?.pokemons;
        const ids = payload?.orderedUuids;
        if (!Array.isArray(team) || !Array.isArray(ids) || !ids.length || ids.length > 6 || ids.length !== team.length ||
            new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !team.some(p => p.uuid === id)))
            return reply({ success: false, message: 'Ordre invalide.' });
        player.inventoryBusy = true;
        try {
            const ordered = ids.map(id => team.find(p => p.uuid === id));
            await persist(userId, { ...player.equipe, pokemons: ordered });
            player.equipe.pokemons = ordered;
            socket.emit('teamStateChanged', { equipe: player.equipe, reason: 'reorder' });
            reply({ success: true, equipe: player.equipe });
        } catch (error) {
            console.error('Réorganisation impossible:', error.message);
            reply({ success: false, message: 'Ordre non enregistré. Réessaie dans un instant.' });
        } finally { player.inventoryBusy = false; }
    });
}
module.exports = { registerTeamOrderHandlers };
