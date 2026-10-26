const { onAccountEvent } = require('../accountConnection');
const { useRepel } = require('../../persistence/repelRepository');
const { loadUserItems } = require('../../persistence/itemRepository');
const { validateRepel } = require('../../game/items/repel');
function registerRepelHandlers({ socket, userId, getPlayer, canUse, flushPositionSave, schedulePositionSave }) {
    onAccountEvent(socket, 'useRepel', async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        const p = getPlayer();
        if (!p || p.inbattle || p.inventoryBusy || !canUse())
            return reply({ success: false, message: 'Attends la fin de l’action en cours.' });
        p.inventoryBusy = true;
        try {
            validateRepel(p, payload?.itemKey);
            // Drain old position snapshots before installing the transaction's new counter.
            if (!await flushPositionSave()) throw Error('La sauvegarde est indisponible. Réessaie dans un instant.');
            p.repelSteps = await useRepel(userId, payload?.itemKey);
            schedulePositionSave();
            socket.emit('fieldEffectState', { repelSteps: p.repelSteps });
            const items = await loadUserItems(userId);
            socket.emit('bagUpdated', { items });
            reply({ success: true, items, repelSteps: p.repelSteps });
        } catch (e) {
            if (e.code) console.error('Repousse impossible:', e.message);
            reply({ success: false, message: e.code ? 'Cet objet est temporairement indisponible.' : e.message });
        } finally { p.inventoryBusy = false; }
    });
}
module.exports = { registerRepelHandlers };
