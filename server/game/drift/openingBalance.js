const moves = require('../../../data/game/moves.json');
const traits = require('../../../data/game/ability_move_traits.gen7.json').moves;
// Expedition opening only; no change to PvP, arena teams or saved companions.
const levels = { start:{min:2,max:5}, route1:{min:6,max:9} };
function tuneWildMoves(pokemon) {
    if(pokemon.level>14)return pokemon;
    require('../models/moveLearning').assignNaturalMoves(pokemon);
    const cap=pokemon.level<=6?40:pokemon.level<=10?45:55;
    const available=new Set(pokemon.abilities);
    const candidates=moves.filter(m=>available.has(m.ename) && m.power>0 && m.power<=cap
        && m.combat?.power_type==='standard' && !traits[m.ename]?.multihit);
    candidates.sort((a,b)=>Number(pokemon.data.type.includes(b.type))-Number(pokemon.data.type.includes(a.type))||b.power-a.power);
    if(!candidates.length)return pokemon;
    const selected=candidates.slice(0,3).map(m=>m.ename);
    for(const name of available)if(selected.length<4&&!selected.includes(name)&&moves.find(m=>m.ename===name)?.combat?.damage_class==='status')selected.push(name);
    pokemon.abilities=[];pokemon.movePp=[];selected.forEach(name=>pokemon.addAbility(name));return pokemon;
}
module.exports={levels,tuneWildMoves};
