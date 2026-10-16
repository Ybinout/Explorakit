const {SUPPORTED_ABILITIES}=require('./abilityEngine');
const {REACTION_ABILITIES}=require('./abilityReactions');
const {ABILITIES}=require('./abilityForms');
const doublesOnly=new Set(['Battery','Friend Guard','Healer','Minus','Plus','Receiver','Symbiosis','Telepathy']);
const overworldPending=new Set(['Honey Gather','Illuminate']);
const singleBattleAbilities=new Set([...SUPPORTED_ABILITIES,...REACTION_ABILITIES,...ABILITIES].filter(a=>!doublesOnly.has(a)));
function status(name) {
    if(doublesOnly.has(name))return 'double_only';
    if(overworldPending.has(name))return 'overworld_pending';
    return singleBattleAbilities.has(name)?'single_battle':'missing';
}
module.exports={singleBattleAbilities,doublesOnly,overworldPending,status};
