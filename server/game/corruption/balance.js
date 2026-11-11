const config=require('../../../data/game/corruption_balance.json');
function penalty(p){return Object.keys(p?.corruption?.modules||{}).reduce((sum,family)=>sum+(config.statPenalties[family]||0),0);}
function factor(p){return (100-penalty(p))/100;}
function restricted(p){return require('../drift/pokemonFactory').legendary.has(Number(p?.data?.id||p?.pokemon_id||p));}
module.exports={config,penalty,factor,restricted};
