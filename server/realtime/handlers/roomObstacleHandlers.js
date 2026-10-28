const obstacles = require('../../game/world/roomObstacles');
const repository = require('../../persistence/roomObstacleRepository');
const { loadProgressState } = require('../../persistence/progressionRepository');

function nearCrystal(player) {
    return obstacles.obstacles.some(o => o.map === player?.currentmap && o.cells.some(p =>
        Math.abs(p.x - Math.floor(player.x / 32)) + Math.abs(p.y - Math.floor(player.y / 32)) <= 1));
}

// Older clients keep Space: one action also means one hit, with no automatic follow-up.
async function clearNearbyRoomObstacle({ socket, userId, player, getPlayer, emitProgression, canUse = () => true }) {
    if (!nearCrystal(player)) return false;
    const origin = { map: player.currentmap, x: player.x, y: player.y };
    const isCurrent = () => socket.connected && getPlayer() === player && !player.inbattle && canUse()
        && player.currentmap === origin.map && player.x === origin.x && player.y === origin.y;
    if (player.inventoryBusy || !isCurrent()) return true;
    player.inventoryBusy = true;
    player.isMoving = false;
    try {
        const result = await repository.strike(userId, player, isCurrent);
        if (!result || !isCurrent()) return Boolean(result);
        if (result.blocked) { socket.emit('progressionNotice', { message: result.blocked }); return true; }
        const { obstacle, hits } = result;
        const target = obstacle.cells.reduce((best, cell) => {
            const distance = c => Math.abs(c.x * 32 + 16 - origin.x) + Math.abs(c.y * 32 + 16 - origin.y);
            return !best || distance(cell) < distance(best) ? cell : best;
        }, null);
        socket.emit('roomObstacleAction', { active: true, manual: true, id: obstacle.id, map: obstacle.map,
            hits, requiredHits: 10, duration: 380, strikeTimes: [80], success: hits === 10,
            message: hits === 10 ? obstacle.done : obstacle.message,
            messageEn: hits === 10 ? obstacle.doneEn : obstacle.messageEn, origin, target });
        const progress = await loadProgressState(userId);
        if (isCurrent()) emitProgression(progress);
        return true;
    } finally {
        player.inventoryBusy = false;
    }
}

function registerRoomObstacleHits({ account, canUse, ...context }) {
    let queue = Promise.resolve(), pending = 0, lastPress = 0, working = false;
    account.on('roomObstacle:hit', data => {
        const player = context.getPlayer(), press = data?.pressId;
        if (!Number.isSafeInteger(press) || press <= lastPress) return;
        lastPress = press;
        if (!account.active() || !canUse() || !nearCrystal(player) || player.inbattle
            || (player.inventoryBusy && !working) || pending >= 10) return;
        const origin = { map: player.currentmap, x: player.x, y: player.y };
        // Keep rapid taps, but cancel queued inputs if the player leaves this spot.
        const current = () => account.active() && canUse() && context.getPlayer() === player
            && player.currentmap === origin.map && player.x === origin.x && player.y === origin.y;
        pending++;
        queue = queue.then(async () => {
            if (!current()) return;
            working = true;
            try { await clearNearbyRoomObstacle({ ...context, player, canUse: current }); }
            finally { working = false; }
        }).catch(error => {
            console.error('Erreur cristaux :', error?.message || error);
            context.socket.emit('interactionRejected', { reason: 'interaction_unavailable' });
        }).finally(() => { pending--; });
        return queue;
    });
}

module.exports = { clearNearbyRoomObstacle, registerRoomObstacleHits };
