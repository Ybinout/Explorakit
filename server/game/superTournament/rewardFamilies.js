// Families describe the benefit, not its strength, scope or downside.
// Temporary PP recovery and the mythic PP refill belong to the same family.
const overrides={
 power_miracle:'healing',power_mana:'pp',power_reunion:'revive',
 power_vampire:'healing',power_fountain:'healing',power_sanctuary:'healing',
 power_phoenix:'survival',power_bastion:'defense',
 pact_patchwork:'defense',pact_umbrella:'defense',pact_feather:'speed',pact_snack:'healing',pact_picnic:'healing',
 pact_hunter:'critical',pact_cold_blood:'critical',pact_dance:'speed',
 pact_rampart:'defense',pact_veil:'defense',pact_fortress:'defense',
 pact_leech:'healing',pact_breath:'healing',pact_velvet:'healing',pact_moss:'healing',pact_opening:'damage',pact_last_stand:'damage',pact_quickstep:'speed',pact_spark:'critical',pact_resupply:'pp',pact_campfire:'healing'
};
function family(card){
 if(!card)return null;
 if(overrides[card.key])return overrides[card.key];
 if(['heal','restore','reset'].includes(card.kind))return 'healing';
 if(card.kind==='cure')return 'status';
 if(card.kind==='pact')return 'damage';
 if(card.kind==='opponent')return 'opponent';
 if(card.kind==='fortune')return 'fortune';
 return {pp:'pp',revive:'revive',money:'money',item:'candy'}[card.kind]||null;
}
module.exports={family};
