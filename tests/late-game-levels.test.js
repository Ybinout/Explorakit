const test=require('node:test'),assert=require('node:assert/strict');
const maps=require('../data/game/nextMap.json').maps;
const {getPnjTeam}=require('../server/game/world/pnjTeamFactory');
const wild=require('../server/game/world/wildPokemonFactory');
test('late Adventure zones rise steadily from Ana to the level 66 final champion',async()=>{
 const progression=[['route11',47,49],['route12',49,51],['ville4',49,51],['cave_rochebrume1',51,53],['cave_rochebrume2',53,55],['cave_rochebrume3',55,57],['route13',57,59],['route14',59,61],['ville5',59,61]];
 let previousMax=46;
 for(const[name,min,max]of progression){const zone=maps.find(m=>m.mapName===name);assert.deepEqual(zone.level,{min,max});assert(min<=previousMax+1,`${name}: no sudden level cliff`);previousMax=max;if(zone.wildpokemon.length){const p=await wild(name);assert(p.level>=min&&p.level<=max);assert(p.abilities.length>0);}}
 assert.equal(Math.max(...getPnjTeam('ana').pokemons.map(p=>p.level)),49);
 assert.equal(Math.max(...getPnjTeam('wanda').pokemons.map(p=>p.level)),56);
 const final=getPnjTeam('sevenp');assert.equal(Math.max(...final.pokemons.map(p=>p.level)),66);assert.equal(final.pokemons.find(p=>p.data.id===130).level,66);
 for(const name of ['ville4','ville5'])for(const zone of maps.filter(m=>m.mapName.startsWith(name+'_')))assert.deepEqual(zone.level,maps.find(m=>m.mapName===name).level);
});
