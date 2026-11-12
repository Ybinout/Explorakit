const {randomInt}=require('node:crypto');
const ONE_IN=4000;
// Independent server-only entropy. Never consume species/trait/AI random streams.
function rollWildShiny(pokemon,draw=randomInt,bonuses=null){
    if(!pokemon?.data?.id)throw Error('Pokémon sauvage introuvable.');
    pokemon.shiny=draw(ONE_IN)<(bonuses?.shiny===2?2:1);
    return pokemon;
}
function isShiny(value){return value===true||value===1||value==='1';}
module.exports={ONE_IN,rollWildShiny,isShiny};
