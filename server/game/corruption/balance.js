const config=require('../../../data/game/corruption_balance.json');
function penalty(p){return Object.keys(p?.corruption?.modules||{}).reduce((sum,family)=>sum+(config.statPenalties[family]||0),0);}
function factor(p){return (100-penalty(p))/100;}
function restricted(p){const id=Number(p?.data?.id||p?.pokemon_id||p);return id===292||require('../drift/pokemonFactory').legendary.has(id);}
function restrictedSpecies(){return [...new Set([...require('../drift/pokemonFactory').legendary,292])];}
function restrictionReason(p){return Number(p?.data?.id||p?.pokemon_id||p)===292?'Munja ne peut pas être corrompu.':'Les Pokémon légendaires et fabuleux ne peuvent pas être corrompus.';}
module.exports={config,penalty,factor,restricted,restrictedSpecies,restrictionReason};
