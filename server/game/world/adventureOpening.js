const config = Object.freeze({
    flag: 'adventure_opening',
    bed: { map: 'etage', x: 592, y: 336 },
    dialogue: 'adventure_mother_departure'
});
function stage(progress) { return progress?.flags?.[config.flag] || null; }
function waking(map, progress) { return map === config.bed.map && stage(progress) === 'sleeping'; }
function entryDialogue(map, progress) { return map === 'start' && stage(progress) === 'outside' ? config.dialogue : null; }
module.exports = { config, stage, waking, entryDialogue };
