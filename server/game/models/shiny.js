const {randomInt}=require('node:crypto');
const ONE_IN=4000;
// Independent server-only entropy. Never consume species/trait/AI random streams.
function rollWildShiny(pokemon,draw=randomInt){
    if(!pokemon?.data?.id)throw Error('Pokémon sauvage introuvable.');
    pokemon.shiny=draw(ONE_IN)===0;
    return pokemon;
}
function isShiny(value){return value===true||value===1||value==='1';}
module.exports={ONE_IN,rollWildShiny,isShiny};
