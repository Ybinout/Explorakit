const { randomUUID } = require('node:crypto');
const { onAccountEvent } = require('../accountConnection');
const { worldRoom } = require('../worldRooms');
const { getPlayerDisplayName } = require('../playerState');

function normalizeWorldMessage(value) {
    if (typeof value !== 'string' || value.length > 640) return null;
    const text = value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/gu, ' ').trim();
    return text && Array.from(text).length <= 160 ? text : null;
}

// One transient packet to the authoritative map room. No history or DB write.
function registerWorldChatHandlers({ socket, io, getPlayer, available = () => true, now = Date.now }) {
    let lastSentAt = -Infinity;
    onAccountEvent(socket, 'world:chat', (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        const player = getPlayer();
        if (!player || !socket.connected || !player.currentmap || player.inbattle || !available(player))
            return reply({ success: false, message: 'Termine ton action avant de parler.' });
        const text = normalizeWorldMessage(payload && !Array.isArray(payload) ? payload.message : null);
        if (!text) return reply({ success: false, message: 'Écris un message de 1 à 160 caractères.' });
        const timestamp = now();
        if (timestamp - lastSentAt < 2000) return reply({ success: false, message: 'Patiente un instant avant de reparler.' });
        lastSentAt = timestamp;
        io.to(worldRoom(player.currentmap)).emit('world:speech', {
            id: randomUUID(), fromId: socket.id, fromName: getPlayerDisplayName(player),
            map: player.currentmap, text, durationMs: 7000
        });
        reply({ success: true });
    });
}
module.exports = { normalizeWorldMessage, registerWorldChatHandlers };
