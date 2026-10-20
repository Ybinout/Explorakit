const { randomUUID } = require('node:crypto');

function replacementIndexes(team) {
    return (team?.pokemons || team || []).flatMap((pokemon, index) =>
        index > 0 && Number(pokemon?.currentHp) > 0 ? [index] : []);
}

// Separate from a normal turn: no attack, item, trapping check or turn cost.
function requestReplacement(io, player, { timeoutMs = 60000 } = {}) {
    const socket = io.sockets.sockets.get(player.id);
    if (!socket) return Promise.resolve({ action: 'disconnect', reason: 'socket_missing' });
    if (!replacementIndexes(player.equipe).length) return Promise.resolve({ action: 'unavailable' });
    const replacementId = randomUUID();
    return new Promise(resolve => {
        let timer, settled = false;
        const finish = response => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.off('actionResponse', respond);
            socket.off('disconnect', disconnect);
            resolve(response);
        };
        const prompt = () => socket.emit('requestAction', {
            message: 'Choisis le Pokémon à envoyer au combat.', replacement: true,
            replacementId, allowedPokemonIndexes: replacementIndexes(player.equipe)
        });
        const respond = (response = {}) => {
            if (response.replacementId !== replacementId) return;
            if (response.action !== 'change' || !replacementIndexes(player.equipe).includes(response.number)) {
                prompt();
                return;
            }
            finish({ action: 'change', number: response.number });
        };
        const disconnect = () => finish({ action: 'disconnect', reason: 'player_disconnected' });
        socket.on('actionResponse', respond);
        socket.once('disconnect', disconnect);
        timer = setTimeout(() => {
            const number = replacementIndexes(player.equipe)[0];
            finish(Number.isInteger(number) ? { action: 'change', number, timedOut: true } : { action: 'unavailable' });
        }, timeoutMs);
        prompt();
    });
}

module.exports = { replacementIndexes, requestReplacement };
