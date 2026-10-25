const config = require('../../../data/game/hoze_collapse.json');
function elapsed(startedAt, now = Date.now()) { return Math.max(0, now - startedAt); }
function contains(hole, x, y) {
    if (Array.isArray(hole.cells)) return hole.cells.some(([dx,dy]) => x === hole.x + dx && y === hole.y + dy);
    return x >= hole.x && x < hole.x + hole.width && y >= hole.y && y < hole.y + hole.height;
}
function blocked(startedAt, x, y, now = Date.now()) {
    return config.holes.some(h => elapsed(startedAt, now) >= h.atMs && contains(h, x, y));
}
function snapshot(startedAt, now = Date.now()) {
    return { map: config.map, revision: config.revision || 1, epoch: startedAt, elapsedMs: elapsed(startedAt, now), fallMs: config.fallMs,
        warningMs: config.warningMs, holes: config.holes };
}
function safeTile(player, collision, startedAt, now = Date.now(), occupied = () => false) {
    const origin = { x: Math.floor(player.x / 32), y: Math.floor(player.y / 32) };
    const queue = [origin], seen = new Set([`${origin.x},${origin.y}`]);
    for (let i = 0; i < queue.length; i++) {
        const p = queue[i];
        if (collision[p.y]?.[p.x] === 0 && !blocked(startedAt, p.x, p.y, now) && !occupied(p.x,p.y)) return p;
        // Prefer the centre when two escape cells are equally near.
        const dx = p.x < 14 ? 1 : -1;
        for (const [x,y] of [[p.x+dx,p.y],[p.x,p.y+1],[p.x,p.y-1],[p.x-dx,p.y]]) {
            const key = `${x},${y}`;
            if (seen.has(key) || !collision[y] || x < 0 || x >= collision[y].length) continue;
            // Search through collapsing cells, never through existing walls.
            if (collision[y][x] !== 0) continue;
            seen.add(key);queue.push({x,y});
        }
    }
    return null;
}
module.exports = { config, elapsed, contains, blocked, snapshot, safeTile };
