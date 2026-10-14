const { useMedicine } = require('../../persistence/medicineRepository');
const { loadUserItems } = require('../../persistence/itemRepository');
function registerMedicineHandlers({ socket, userId, getPlayer, canUse = () => true }) {
    socket.on('useMedicine', async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        const p = getPlayer();
        if (!p || p.inbattle || p.inventoryBusy || !canUse())
            return reply({ success: false, message: 'Attends la fin de l’action en cours.' });
        const pokemon = p.equipe?.pokemons?.find((p) => p.uuid === payload?.pokemonUuid);
        p.inventoryBusy = true;
        try {
            const result = await useMedicine(userId, pokemon, payload?.itemKey);
            Object.assign(pokemon, result);
            socket.emit('teamStateChanged', { equipe: p.equipe, reason: 'medicine' });
            const items = await loadUserItems(userId);
            socket.emit('bagUpdated', { items });
            reply({ success: true, items });
        } catch (e) {
            if (e.code) console.error('Soin impossible:', e.message);
            reply({ success: false, message: e.code ? 'Le soin est temporairement indisponible.' : e.message });
        } finally {
            p.inventoryBusy = false;
        }
    });
}
module.exports = { registerMedicineHandlers };
