const obstacles = require('../../game/world/roomObstacles');
const { dbPool } = require('../../config/database');
const { loadProgressState } = require('../../persistence/progressionRepository');

// Called only within Space's interaction guard. No client-supplied obstacle/flag/position.
async function clearNearbyRoomObstacle({ socket, userId, player, getPlayer, emitProgression }) {
    if (!obstacles.obstacles.some(o => o.map === player.currentmap&&o.cells.some(p=>Math.abs(p.x-Math.floor(player.x/32))+Math.abs(p.y-Math.floor(player.y/32))<=1))) return false;
    const progress = await loadProgressState(userId);
    if (!socket.connected || getPlayer() !== player || player.inbattle || player.inventoryBusy) return true;
    const obstacle = obstacles.nearby(player, progress);
    if (!obstacle) return false;
    if(obstacle.requiresFlag&&(require('../../game/world/labStory').view(progress).flags?.[obstacle.requiresFlag]!=='true'||require('../../game/world/testReplayState').active(progress,'professor_story'))){
        socket.emit('progressionNotice',{message:obstacle.requiresMessage||obstacle.blockedMessage});return true;
    }
    const origin = { map: player.currentmap, x: player.x, y: player.y };
    const target = obstacle.cells.reduce((best, cell) => {
        const distance = c => Math.abs(c.x * 32 + 16 - origin.x) + Math.abs(c.y * 32 + 16 - origin.y);
        return !best || distance(cell) < distance(best) ? cell : best;
    }, null);
    let completed = false;
    player.inventoryBusy = true;
    player.isMoving = false;
    socket.emit('roomObstacleAction', { active: true, id: obstacle.id, map: obstacle.map,
        duration: obstacle.duration, strikeTimes: obstacle.strikeTimes, message: obstacle.message, messageEn: obstacle.messageEn, origin, target });
    try {
        await new Promise(resolve => setTimeout(resolve, obstacle.duration));
        if (!socket.connected || getPlayer() !== player || player.inbattle
            || player.currentmap !== origin.map || player.x !== origin.x || player.y !== origin.y) return true;
        await dbPool.execute(
            "INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'true') ON DUPLICATE KEY UPDATE flag_value='true'",
            [userId, obstacles.progressFlag(obstacle,progress)]
        );
        if (socket.connected && getPlayer() === player) {
            completed = true;
            emitProgression(await loadProgressState(userId));
            socket.emit('progressionNotice', { type: 'room_obstacle', message: obstacle.done });
        }
        return true;
    } finally {
        player.inventoryBusy = false;
        if (socket.connected) socket.emit('roomObstacleAction', { active: false, id: obstacle.id, map: obstacle.map,
            success: completed, message: obstacle.done, messageEn: obstacle.doneEn });
    }
}
module.exports = { clearNearbyRoomObstacle };
