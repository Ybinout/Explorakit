const test=require('node:test'),assert=require('node:assert/strict');
const {ONE_IN,rollWildShiny}=require('../server/game/models/shiny');
const factory=require('../server/game/drift/pokemonFactory'),pc=require('../server/persistence/pokemonStorageRepository'),team=require('../server/persistence/teamRepository');
const codec=require('../server/game/drift/checkpointCodec');
test('exactly one of 4,000 independent server draws is shiny; loading never rerolls it',()=>{
 let count=0;const original=Math.random;Math.random=()=>{throw Error('Shiny must not consume the species, ability or AI draw');};
 try{for(let roll=0;roll<4000;roll++){const p={data:{id:570}};rollWildShiny(p,max=>{assert.equal(max,4000);return roll;});if(p.shiny)count++;}}finally{Math.random=original;}
 assert.equal(ONE_IN,4000);assert.equal(count,1);
});
test('Gen5 shiny K4 with held item and corruption survives party rows, PC, checkpoints and evolution',()=>{
 const p=factory.create(570,30,true);p.shiny=true;p.k=4;p.heldItem='life_orb';p.currentHp=2;p.status='burn';
 const module=require('../server/game/corruption/modules'),rules=require('../server/game/corruption/pokemon');
 const key=module.pools.Dark.move.find(key=>!p.abilities.includes(module.get(key).corruptionModule.move)),item=module.get(key);assert(item); // Use the real installer, not a parallel test representation.
 const plan=rules.install(p,item,{slot:p.abilities.length<4?p.abilities.length:0,expectedRevision:0,expectedMoves:[...p.abilities]});Object.assign(p,plan.pokemon||plan);
 const row=Object.fromEntries(team.POKEMON_COLUMNS.map((key,i)=>[key,team.pokemonToRow(p,1,0)[i]]));
 for(const saved of[team.rowToPokemon(row),pc.decodePokemon(pc.encodePokemon(p)),codec.decode(codec.encode(p))]){
  assert(saved.shiny);assert.equal(saved.data.id,570);assert.equal(saved.k,4);assert.equal(saved.heldItem,'life_orb');assert.equal(saved.currentHp,2);assert.deepEqual(saved.iv,p.iv);assert(saved.corruption);
  saved.updatePokemon(571);assert(saved.shiny);assert.equal(saved.data.id,571);
 }
 assert.equal(team.rowToPokemon({...row,shiny:undefined}).shiny,false);
});
test('Illusion and Transform copy the target appearance without changing the saved shiny identity',()=>{
 const forms=require('../server/game/abilities/abilityForms'),e=require('../server/game/battle/battleEngine');
 const fox=factory.create(571,50,true),target=factory.create(25,50,true);target.shiny=true;forms.attachTeam([fox,target]);forms.sync(fox,'entry');
 assert.equal(fox.__battle.illusion.id,25);assert.equal(fox.__battle.illusion.shiny,true);assert.equal(fox.shiny,false);
 const ditto=factory.create(132,50,true);ditto.shiny=true;target.shiny=false;
 e.useattack('Transform',ditto,target,{consumePp:false});assert(ditto.__battle.transformed);assert.equal(ditto.__battle.transformSpriteShiny,false);assert.equal(pc.decodePokemon(pc.encodePokemon(ditto)).data.id,132);assert(pc.decodePokemon(pc.encodePokemon(ditto)).shiny);
});
