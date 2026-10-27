// Separate, independent rolls. These never replace the ordinary wild-item roll
// and are unaffected by expedition loot bonuses or the encountered species.
const crystals=Object.freeze(require('../../../data/game/items.json').items.filter(i=>i.wildCrystalChance>0));
function roll(random=Math.random){return crystals.filter(i=>random()<i.wildCrystalChance);}
function awardExpedition(player,random=Math.random){
    const found=roll(random);
    for(const item of found)player.items[item.key]=(player.items[item.key]||0)+1;
    return found;
}
module.exports={crystals,roll,awardExpedition};
