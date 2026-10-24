const { loadCollisionData } = require('./mapRepository');
const { hasCompletedBattle } = require('./storyProgression');
const { npcBattles } = require('../../../data/game/progression.json');
const map = 'route2_maison';
const collision = loadCollisionData(map);
const obstacles = [
    { y: 15, done: 'Les cristaux éclatent. Un premier passage est ouvert.', doneEn: 'The crystals shatter. The first passage is open.' },
    { y: 11, done: 'La deuxième barrière cède. Tu te rapproches de Lucie.', doneEn: 'The second barrier breaks. Lucie is getting closer.' },
    { y: 8, done: 'Le dernier obstacle vole en éclats. Lucie est devant toi.', doneEn: 'The last obstacle shatters. Lucie is right ahead.' }
].map((entry, index) => ({
    ...entry, id: `lucie_barricade_${index + 1}`, requiredFlag: `lucie_barricade_${index + 1}_cleared`,
    // Keep IDs/flags for existing players. Only the presentation changes.
    map, kind: 'barricade', appearance: 'corrupted-crystal', name: 'Cristaux de l’Aube Obscure', duration: 2600, direction: 'up',
    message: 'Tu frappes de toutes tes forces !', messageEn: 'You strike with all your strength!',
    tiles: { x: 7, y: entry.y, width: 14, height: 1 },
    cells: Array.from({ length: 14 }, (_, i) => ({ x: 7 + i, y: entry.y })).filter(p => collision[p.y]?.[p.x] === 0),
    blockedMessageEn: 'Dark crystals block the way. Stand nearby and press A / Space to break them.',
    blockedMessage: 'Des cristaux sombres bloquent le passage. Appuie sur A / Espace à proximité pour les briser.'
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
    return obstacles.map(o => ({ id: o.id, map: o.map, name: o.name, kind: o.kind, appearance: o.appearance,
        direction: o.direction, tiles: o.tiles, cells: o.cells, locked: isLocked(o, progress) }));
}
function entryDialogue(player, progress) {
    if (player?.currentmap !== map || Math.floor(player.y / 32) < 16 || !isLocked(obstacles[0], progress)) return null;
    return 'lucie_room_entry';
}
module.exports = { obstacles, isLocked, candidates, nearby, snapshot, entryDialogue };
