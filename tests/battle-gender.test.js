const test=require('node:test'),assert=require('node:assert/strict');
const {gender}=require('../server/game/items/stoneEvolution'),presentation=require('../server/game/battle/presentationState');
const rates=require('../data/game/stone_evolutions.json').genderRates;
const factory=require('../server/game/drift/pokemonFactory');
const {DriftBattle}=require('../server/game/drift/driftBattle');
const mon=(id,value)=>({data:{id},uuid:'stable-gender-fixture',gender:value});
test('single-sex and genderless species override every contradictory stored value',()=>{
 for(const[id,expected]of [[29,'female'],[113,'female'],[380,'female'],[32,'male'],[128,'male'],[475,'male'],[132,'genderless'],[292,'genderless'],[376,'genderless']])
  for(const previous of [undefined,'male','female','genderless'])assert.equal(gender(mon(id,previous)),expected,`${id} / ${previous}`);
 for(let id=1;id<=493;id++){
  assert(Number.isInteger(rates[id]),String(id));const expected=rates[id]===0?'male':rates[id]===8?'female':rates[id]<0?'genderless':null;
  if(expected)for(const previous of ['male','female','genderless'])assert.equal(gender(mon(id,previous)),expected,String(id));
 }
});
test('mixed species retain a legal sex and resolve old genderless data without reroll or mutation',()=>{
 for(const value of ['male','female'])assert.equal(gender(mon(1,value)),value);
 const p=mon(1,'genderless'),before=JSON.stringify(p),expected=gender(mon(1,undefined));
 for(let i=0;i<20;i++)assert.equal(gender(p),expected);assert.equal(JSON.stringify(p),before);
 assert.equal(gender(null),null);assert.equal(gender({data:{id:1}}),null);
});
test('battle metadata is independent of raw fields, hides eggs/humans, and follows the current fighters',()=>{
 const a=mon(128,'female'),b=mon(113,'male'),before=JSON.stringify([a,b]);
 assert.deepEqual(presentation.genders(a,b),{player:'male',opponent:'female'});
 assert.equal(JSON.stringify([a,b]),before);
 assert.deepEqual(presentation.genders({...a,isEgg:true},{storyActor:'professor'}),{player:null,opponent:null});
 // Transform changes the visual species, not Ditto’s original species/sex.
 assert.equal(presentation.genders({...mon(132,'male'),__battle:{transformSpeciesId:128}},a).player,'genderless');
});
test('the shared Rift/Colosseum/PvP orchestrator sends authoritative sexes on updates and replacements',()=>{
 for(const type of ['wild','arena','pvp']){
  const a={socketId:'a',userId:1,equipe:{pokemons:[factory.create(128,20,true),factory.create(113,20,true)]},drifts:[],equipped:[]};
  const b={socketId:'b',userId:2,npc:type!=='pvp',equipe:{pokemons:[factory.create(132,20,true)]},drifts:[],equipped:[]};
  a.equipe.pokemons[0].gender='female';b.equipe.pokemons[0].gender='male';const records=[];
  const battle=new DriftBattle(a,b,{type,random:()=>.5,now:()=>1000,emit:(p,event,data)=>records.push({p,event,data}),rules:{report:false,rewards:false}});
  const intro=()=>records.filter(r=>r.p===a&&r.event==='introAnimation').at(-1).data;
  assert.deepEqual(intro().genders,{player:'male',opponent:'genderless'});
  a.equipe.pokemons.reverse();battle.sync();assert.deepEqual(intro().genders,{player:'female',opponent:'genderless'});
  assert.equal(intro().player.equipe.pokemons[0].data.id,113);
  if(type==='pvp')assert.deepEqual(records.filter(r=>r.p===b&&r.event==='introAnimation').at(-1).data.genders,{player:'genderless',opponent:'female'});
  battle.finish(null,'fled');
 }
});
