const defaultStore = require('./pnjStore');
const { getPnjsForMap } = defaultStore;
const { loadCollisionData, changeMapData, InteractMapData } = require('./mapRepository');
const terrain = new Map();
const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];

function getTerrain(map) {
    if (!terrain.has(map)) terrain.set(map, {
        collision: loadCollisionData(map), change: changeMapData(map), interaction: InteractMapData(map)
    });
    return terrain.get(map);
}

function canRoamTo(pnj, x, y, players, map = getTerrain(pnj.map), store = defaultStore) {
    if (pnj.blockingWidth > 1) return false;
    if (Math.abs(x - pnj.anchorX) + Math.abs(y - pnj.anchorY) > pnj.roamRadius) return false;
    // Two-tile footprint, like the existing collision/interaction system.
    for (const tileY of [y, y - 1]) {
        if (map.collision[tileY]?.[x] !== 0 || map.interaction[tileY]?.[x]) return false;
        const occupant = store.getPnjAtTile(pnj.map, x, tileY);
        if (occupant && occupant.name !== pnj.name) return false;
        // Keep doorways, transition approaches and narrow passages clear.
        for (const [dx, dy] of [[0, 0], ...directions]) {
            if (map.change[tileY + dy]?.[x + dx] || map.interaction[tileY + dy]?.[x + dx]) return false;
        }
    }
    if (directions.filter(([dx, dy]) => map.collision[y + dy]?.[x + dx] === 0).length < 3) return false;
    return !players.some(player => Math.abs(Math.floor(player.x / 32) - x) <= 2
        && Math.abs(Math.floor(player.y / 32) - y) <= 2);
}

function tickRoaming(players, now, deadlines, random = Math.random, store = defaultStore) {
    const changed = new Set();
    const byMap = new Map();
    for (const player of Object.values(players)) {
        const list = byMap.get(player.currentmap) || [];
        list.push(player);
        byMap.set(player.currentmap, list);
    }
    for (const [map, occupants] of byMap) {
        for (const pnj of store.getPnjsForMap(map)) {
            if (!pnj.roamRadius || now < (deadlines.get(pnj.name) || 0)) continue;
            deadlines.set(pnj.name, now + 2200 + random() * 3000);
            // A character stays still during approach, dialogue and battle.
            if (occupants.some(p => Math.abs(Math.floor(p.x / 32) - pnj.x) <= 3
                && Math.abs(Math.floor(p.y / 32) - pnj.y) <= 3)) continue;
            const first = Math.floor(random() * directions.length);
            for (let i = 0; i < directions.length; i++) {
                const [dx, dy] = directions[(first + i) % directions.length];
                if (!canRoamTo(pnj, pnj.x + dx, pnj.y + dy, occupants, getTerrain(map), store)) continue;
                store.movePnj(pnj.name, map, pnj.x + dx, pnj.y + dy);
                changed.add(map);
                break;
            }
        }
    }
    return changed;
}

function startPnjMovement(io, getPlayers, actorsForPlayer=player=>getPnjsForMap(player.currentmap)) {
    const deadlines = new Map();
    const timer = setInterval(() => {
        const players = getPlayers();
        const changed = tickRoaming(players, Date.now(), deadlines);
        for (const player of Object.values(players)) {
            if (changed.has(player.currentmap)) io.to(player.id).emit('pnjsList', {
                mapname: player.currentmap, pnjs: actorsForPlayer(player), walking: true
            });
        }
    }, 500);
    timer.unref();
    io.httpServer?.once('close', () => clearInterval(timer));
    return () => clearInterval(timer);
}

module.exports = { canRoamTo, tickRoaming, startPnjMovement };
