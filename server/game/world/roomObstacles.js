const { loadCollisionData } = require('./mapRepository');
const { hasCompletedBattle } = require('./storyProgression');
const { npcBattles } = require('../../../data/game/progression.json');
const map = 'route2_maison';
const strikeTimes = Object.freeze([550, 1280, 2050, 2820, 3590]);
const strikeDuration = 4140;
const collision = loadCollisionData(map);
const obstacles = [
    { y: 15, done: 'Les cristaux éclatent. Un premier passage est ouvert.', doneEn: 'The crystals shatter. The first passage is open.' },
    { y: 11, done: 'La deuxième barrière cède. Tu te rapproches de Lucie.', doneEn: 'The second barrier breaks. Lucie is getting closer.' },
    { y: 8, done: 'Le dernier obstacle vole en éclats. Lucie est devant toi.', doneEn: 'The last obstacle shatters. Lucie is right ahead.' }
].map((entry, index) => ({
    ...entry, id: `lucie_barricade_${index + 1}`, requiredFlag: `lucie_barricade_${index + 1}_cleared`,
    // Keep IDs, flags and collision cells for existing players.
    map, kind: 'barricade', appearance: 'corrupted-crystal', name: 'Cristaux de l’Aube Obscure', duration: strikeDuration, strikeTimes, direction: 'up',
    message: 'Tu frappes de toutes tes forces !', messageEn: 'You strike with all your strength!',
    tiles: { x: 7, y: entry.y, width: 14, height: 1 },
    cells: Array.from({ length: 14 }, (_, i) => ({ x: 7 + i, y: entry.y })).filter(p => collision[p.y]?.[p.x] === 0),
    blockedMessageEn: 'Dark crystals block the way. Stand nearby and press A / Space to break them.',
    blockedMessage: 'Des cristaux sombres bloquent le passage. Appuie sur A / Espace à proximité pour les briser.'
}));
const labCollision=loadCollisionData('professor_lab');
obstacles.push({id:'lab_crystals',requiredFlag:'lab_crystals_cleared',map:'professor_lab',kind:'barricade',appearance:'corrupted-crystal',name:'Champ de cristaux',duration:strikeDuration,strikeTimes,direction:'up',
    tiles:{x:9,y:8,width:10,height:1},cells:Array.from({length:10},(_,i)=>({x:9+i,y:8})).filter(p=>labCollision[p.y]?.[p.x]===0),
    requiresFlag:'professor_defeated',message:'Tu frappes de toutes tes forces !',messageEn:'You strike with all your strength!',done:'Les derniers cristaux éclatent. Tu peux enfin rejoindre Lucie.',doneEn:'The last crystals shatter. You can finally reach Lucie.',
    requiresMessage:'Un champ sombre protège les cristaux. Le Professeur doit être arrêté.',
    blockedMessage:'Des cristaux barrent le passage vers Lucie. Appuie sur A / Espace pour les briser.',blockedMessageEn:'Crystals block the way to Lucie. Press A / Space to break them.'});
function progressFlag(obstacle,progress={}) {
    const replay=obstacle.map==='professor_lab'?require('./labStory').replay(progress):require('./testReplayState').active(progress,'lucie_route2');
    return replay?require('./testReplayState').obstacleFlag(obstacle):obstacle.requiredFlag;
}
function isLocked(obstacle, progress = {}) {
    if(obstacle.map==='professor_lab')return !require('./labStory').rescued(progress)&&progress.flags?.[progressFlag(obstacle,progress)]!=='true';
    const replay = require('./testReplayState');
    if (replay.active(progress, 'lucie_route2')) return progress.flags?.[replay.obstacleFlag(obstacle)] !== 'true';
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
module.exports = { obstacles, isLocked, progressFlag, candidates, nearby, snapshot, entryDialogue };
