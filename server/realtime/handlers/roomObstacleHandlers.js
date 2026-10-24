const obstacles = require('../../game/world/roomObstacles');
const { dbPool } = require('../../config/database');
const { loadProgressState } = require('../../persistence/progressionRepository');

// Called only within Space's interaction guard. No client-supplied obstacle/flag/position.
async function clearNearbyRoomObstacle({ socket, userId, player, getPlayer, emitProgression }) {
    if (!obstacles.obstacles.some(o => o.map === player.currentmap)) return false;
    const progress = await loadProgressState(userId);
    if (!socket.connected || getPlayer() !== player || player.inbattle || player.inventoryBusy) return true;
    const obstacle = obstacles.nearby(player, progress);
    if (!obstacle) return false;
    const origin = { map: player.currentmap, x: player.x, y: player.y };
    player.inventoryBusy = true;
    player.isMoving = false;
    socket.emit('roomObstacleAction', { active: true, id: obstacle.id, map: obstacle.map,
        duration: obstacle.duration, message: obstacle.message });
    try {
        await new Promise(resolve => setTimeout(resolve, obstacle.duration));
        if (!socket.connected || getPlayer() !== player || player.inbattle
            || player.currentmap !== origin.map || player.x !== origin.x || player.y !== origin.y) return true;
        await dbPool.execute(
            "INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'true') ON DUPLICATE KEY UPDATE flag_value='true'",
            [userId, obstacle.requiredFlag]
        );
        if (socket.connected && getPlayer() === player) {
            emitProgression(await loadProgressState(userId));
            socket.emit('progressionNotice', { message: obstacle.done });
        }
        return true;
    } finally {
        player.inventoryBusy = false;
        if (socket.connected) socket.emit('roomObstacleAction', { active: false });
    }
}
module.exports = { clearNearbyRoomObstacle };
