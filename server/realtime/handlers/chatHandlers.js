const { getPlayerDisplayName } = require('../playerState');

function registerChatHandlers({
    socket,
    io,
    players,
    activeChatSessions,
    socketToChatSession,
    closeChatSession,
    closeChatSessionForSocket
}) {
    socket.on('chatMessage', (payload = {}) => {
        const chatId = typeof payload.chatId === 'string'
            ? payload.chatId
            : socketToChatSession.get(socket.id);
        if (!chatId) return;

        const session = activeChatSessions.get(chatId);
        if (!session?.participants?.includes(socket.id)) return;

        const rawMessage = typeof payload.message === 'string' ? payload.message.trim() : '';
        if (!rawMessage) return;
        const chatPayload = {
            chatId,
            fromId: socket.id,
            fromName: getPlayerDisplayName(players[socket.id]),
            message: rawMessage.slice(0, 300),
            timestamp: Date.now()
        };

        session.participants.forEach((participantId) => {
            if (players[participantId]) io.to(participantId).emit('chatMessage', chatPayload);
        });
    });

    socket.on('leaveChat', (payload = {}) => {
        const requestedChatId = typeof payload.chatId === 'string' ? payload.chatId : null;
        if (requestedChatId) {
            const session = activeChatSessions.get(requestedChatId);
            if (session?.participants?.includes(socket.id)) {
                closeChatSession(requestedChatId, 'left_chat', socket.id);
            }
            return;
        }
        closeChatSessionForSocket(socket.id, 'left_chat');
    });
}

module.exports = { registerChatHandlers };
