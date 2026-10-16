const moves = require('../../../data/game/moves.json');
const pools = require('../../../data/game/pokemonData.json');
const traits = require('../../../data/game/ability_move_traits.gen7.json').moves;
// Expedition opening only; no change to PvP, arena teams or saved companions.
const levels = { start:{min:3,max:5}, route1:{min:6,max:9} };
function tuneWildMoves(pokemon) {
    if(pokemon.level>14)return pokemon;
    const cap=pokemon.level<=6?40:pokemon.level<=10?45:55;
    const available=new Set(pools[pokemon.data.id]||[]);
    const candidates=moves.filter(m=>available.has(m.ename.toLowerCase().replace(/[^a-z0-9]+/g,'-'))
        && m.power>0 && m.power<=cap && m.combat?.power_type==='standard'
        && !traits[m.ename]?.multihit && !['Rollout','Ice Ball','Fury Cutter','Snore','Fake Out','Last Resort','Dream Eater'].includes(m.ename));
    candidates.sort((a,b)=>Number(pokemon.data.type.includes(b.type))-Number(pokemon.data.type.includes(a.type))||b.power-a.power);
    pokemon.abilities=[];pokemon.movePp=[];
    for(const move of candidates.slice(0,3))pokemon.addAbility(move.ename);
    if(!pokemon.abilities.length)pokemon.addAbility('Tackle');
    pokemon.addAbility('Growl');return pokemon;
}
module.exports={levels,tuneWildMoves};
