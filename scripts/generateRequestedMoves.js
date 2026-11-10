// Explicit later-generation moves requested for RiftMon; no natural learnsets changed.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file)));
const write = (file, value, indent) => {
    const bytes = JSON.stringify(value, null, indent) + '\n', target = path.join(root, file);
    if (process.argv.includes('--check')) {
        if (fs.readFileSync(target, 'utf8') !== bytes) throw Error('Stale ' + file);
    } else fs.writeFileSync(target, bytes);
};
const moves = read('data/game/moves.json');
let next = Math.max(...moves.map(move => move.id)) + 1;
for (const [ename, sourceMoveId, type, power, pp, effects] of [
    ['Wave Crash', 834, 'Water', 120, 10, []],
    ['Ice Spinner', 861, 'Ice', 80, 15, [{kind:'clear_terrain', target:'field'}]],
    // Secondary effects are applied by the shared ability-reaction engine.
    ['Spirit Break', 789, 'Fairy', 75, 15, []],
]) {
    const index = moves.findIndex(move => move.ename === ename);
    const move = {id:index < 0 ? next++ : moves[index].id, sourceMoveId, catalogueRevision:3, ename, type,
        category:'phy', power, accuracy:100, pp,
        combat:{damage_class:'physical', power_type:'standard', priority:0, crit_stage:0, target:'single', effects}};
    if (index < 0) moves.push(move); else moves[index] = move;
}
write('data/game/moves.json', moves, 4);
const flags = read('data/game/move_ability_flags.gen7.json');
flags.moves['Wave Crash'] = {contact:true, recoil:[33,100]};
flags.moves['Ice Spinner'] = {contact:true};
flags.moves['Spirit Break'] = {contact:true, secondary:true};
write('data/game/move_ability_flags.gen7.json', flags, 2);
const traits = read('data/game/ability_move_traits.gen7.json');
traits.moves['Wave Crash'] = {}; traits.moves['Ice Spinner'] = {};
traits.moves['Spirit Break'] = {secondaries:[{chance:100,boosts:{spa:-1}}]};
write('data/game/ability_move_traits.gen7.json', traits, 2);
console.log(JSON.stringify({moves:moves.length, checked:process.argv.includes('--check')}));
