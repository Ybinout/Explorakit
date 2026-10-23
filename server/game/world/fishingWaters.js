const { maps } = require('../../../data/game/fishing_waters.json');
const { loadCollisionData } = require('./mapRepository');
const directions = { up: [0,-1], down: [0,1], left: [-1,0], right: [1,0] };
const profiles = Object.fromEntries(Object.entries(maps).map(([name, profile]) => [name, new Map(profile.cells.map(c => [c.tile,c]))]));
// World positions use the same 32 px grid as authoritative movement. The float
// targets a real water pixel, never the middle of a partially dry shoreline tile.
function waterNear(player) {
    const cells = profiles[player?.currentmap];
    if (!cells || !Number.isFinite(player.x) || !Number.isFinite(player.y)) return null;
    const x = Math.floor(player.x/32), y = Math.floor(player.y/32);
    if (cells.has(y*28+x) || loadCollisionData(player.currentmap)[y]?.[x] !== 0) return null;
    const order = [...new Set([player.direction, ...Object.keys(directions)])];
    for (const direction of order) {
        const delta = directions[direction]; if (!delta) continue;
        const tx=x+delta[0], ty=y+delta[1];
        if (tx<0 || tx>=28 || ty<0 || ty>=20) continue;
        const water=cells.get(ty*28+tx);
        if (water) return { x:water.x, y:water.y, direction };
    }
    return null;
}
module.exports = { waterNear };
