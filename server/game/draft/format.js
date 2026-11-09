const config = require('../../../data/game/draft_mode.json');
// Freeze generation/pack rules per table. Existing snapshots keep their format,
// including a partially circulated Rift pack; no picked card is taken away.
const legacy = Object.freeze({
    version: 1,
    classicRounds: 4,
    packSize: 8,
    riftPackSize: 8,
    riftPicks: 8,
    weights: Object.freeze({
        pokemon: 30,
        move: 25,
        item: 20,
        nature: 10,
        iv: 10,
        ability: 5,
    }),
});
function current() {
    return {
        version: 4,
        classicRounds: config.classicRounds,
        packSize: config.packSize,
        riftPackSize: config.riftPackSize,
        riftPicks: config.riftPicks,
        weights: { ...config.weights },
        moveDamageChance: config.moveDamageChance,
        itemBerryChance: config.itemBerryChance,
    };
}
function forRun(run) {
    return run?.draftFormat || (run?.phase === 'lobby' ? current() : legacy);
}
function isRift(run) {
    return run.round === forRun(run).classicRounds;
}
function packSize(run) {
    const f = forRun(run);
    return isRift(run) ? f.riftPackSize : f.packSize;
}
function picks(run) {
    const f = forRun(run);
    return isRift(run) ? f.riftPicks : f.packSize;
}
module.exports = { current, forRun, isRift, packSize, picks };
