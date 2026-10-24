const { loadCollisionData } = require('./mapRepository');
const { hasCompletedBattle } = require('./storyProgression');
const { npcBattles } = require('../../../data/game/progression.json');
const map = 'route2_maison';
const collision = loadCollisionData(map);
const obstacles = [
    { y: 15, message: 'Tu dénoues la corde qui retient les planches…', done: 'Les premières planches sont écartées. La maison reste silencieuse.' },
    { y: 11, message: 'Tu soulèves les planches une à une, sans faire de bruit…', done: 'Le passage se dégage. Tu entends une respiration au fond de la pièce.' },
    { y: 8, message: 'Tu retires la dernière traverse avec précaution…', done: 'Lucie est là, juste devant toi.' }
].map((entry, index) => ({
    ...entry, id: `lucie_barricade_${index + 1}`, requiredFlag: `lucie_barricade_${index + 1}_cleared`,
    map, kind: 'barricade', name: 'Planches entassées', duration: 2600, direction: 'up',
    tiles: { x: 7, y: entry.y, width: 14, height: 1 },
    cells: Array.from({ length: 14 }, (_, i) => ({ x: 7 + i, y: entry.y })).filter(p => collision[p.y]?.[p.x] === 0),
    messageEn: 'Boards block the way. Stand nearby and press A / Space.',
    blockedMessage: 'Des planches barrent le passage. Approche-toi et appuie sur A / Espace pour les dégager.'
}));
function isLocked(obstacle, progress = {}) {
    return progress.flags?.[obstacle.requiredFlag] !== 'true'
        && progress.flags?.lucie_freed !== 'true'
        && !hasCompletedBattle(npcBattles.lucie_route2, progress);
}
function candidates(mapName, x, y) {
    return obstacles.filter(o => o.map === mapName && o.cells.some(p => p.x === x && p.y === y));
}
function nearby(player, progress) {
    const x = Math.floor(player.x / 32), y = Math.floor(player.y / 32);
    return obstacles.find(o => o.map === player.currentmap && isLocked(o, progress)
        && o.cells.some(p => Math.abs(p.x - x) + Math.abs(p.y - y) <= 1));
}
function snapshot(progress) {
    return obstacles.map(o => ({ id: o.id, map: o.map, name: o.name, kind: o.kind,
        direction: o.direction, tiles: o.tiles, cells: o.cells, locked: isLocked(o, progress) }));
}
module.exports = { obstacles, isLocked, candidates, nearby, snapshot };
