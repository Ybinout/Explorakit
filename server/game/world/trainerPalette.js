const COLORS=['blue','sage','lavender','sand'], MODES=['light','dark'];
const KEYS=new Set(COLORS.flatMap(c=>MODES.map(m=>`${c}-${m}`)));
function normalizeTrainerPalette(value) { return KEYS.has(value)?value:null; }
module.exports={normalizeTrainerPalette};
