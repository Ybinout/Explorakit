const { onAccountEvent } = require('../accountConnection');
const { transferHeldItem } = require('../../persistence/itemRepository');
const { planHeldItemTransfer } = require('../../game/items/heldItemTransfer');

function registerHeldItemTransferHandlers({ socket, userId, getPlayer, canUse = () => true, persist = transferHeldItem }) {
    onAccountEvent(socket, 'transferHeldItem', async (payload, acknowledge) => {
        const reply = typeof acknowledge === 'function' ? acknowledge : () => {};
        const player = getPlayer();
        if (!player || player.inbattle || player.inventoryBusy || player.superTournamentActive || !canUse())
            return reply({ success: false, message: 'Les objets ne sont pas modifiables maintenant.' });
        player.inventoryBusy = true;
        try {
            planHeldItemTransfer(player.equipe?.pokemons, payload);
            const transfers = await persist(userId, Number(payload.teamId), payload);
            for (const { pokemonUuid, heldItem } of transfers)
                player.equipe.pokemons.find(p => p.uuid === pokemonUuid).heldItem = heldItem;
            socket.emit('teamStateChanged', { equipe: player.equipe, reason: 'held-item-transfer' });
            reply({ success: true, transfers });
        } catch (error) {
            reply({ success: false, message: error.message || 'Objet non déplacé. Réessaie.' });
        } finally { player.inventoryBusy = false; }
    });
}

module.exports = { registerHeldItemTransferHandlers };
