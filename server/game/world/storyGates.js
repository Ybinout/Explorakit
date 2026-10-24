const roomObstacles = require('./roomObstacles');
const { gates } = require('../../../data/game/story_gates.json');
const { npcBattles } = require('../../../data/game/progression.json');
const { effectiveStoryFlags, hasCompletedBattle } = require('./storyProgression');

function isLocked(gate, progress = {}) {
    if (gate.kind === 'barricade') return roomObstacles.isLocked(gate, progress);
    return effectiveStoryFlags(progress)[gate.requiredFlag] !== 'true'
        && !hasCompletedBattle(npcBattles[gate.npcBattle], progress);
}
function candidatesForStep(map, direction, x, y, nextMap = null) {
    return gates.filter(gate => {
        if (gate.map !== map) return false;
        // Also protect the real exit for saves made beyond the barrier before its introduction.
        if (nextMap && gate.nextMap === nextMap) return true;
        const t = gate.tiles;
        return direction === gate.direction && x >= t.x && x < t.x + t.width && y >= t.y && y < t.y + t.height;
    }).concat(roomObstacles.candidates(map, x, y).map(o => ({...o, message:o.blockedMessage, messageEn:o.blockedMessageEn})));
}
function snapshot(progress = {}) {
    return gates.map(gate => ({
        id: gate.id, map: gate.map, tiles: gate.tiles, direction: gate.direction,
        name: gate.name, locked: isLocked(gate, progress)
    })).concat(roomObstacles.snapshot(progress));
}
module.exports = { gates, isLocked, candidatesForStep, snapshot };
