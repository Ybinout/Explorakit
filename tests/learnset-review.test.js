const test=require('node:test'),assert=require('node:assert/strict');
const ref=require('../data/vendor/pokeapi/learnsets.gen7.json'),levels=require('../data/game/level_up_moves.json').species;
const factory=require('../server/game/drift/pokemonFactory'),wild=require('../server/game/world/wildPokemonFactory');
const learning=require('../server/game/models/moveLearning'),{machines,teachMachine}=require('../server/game/items/machines');
const catalog=require('../data/game/moves.json'),resources=require('../server/game/battle/battleResources');
const normalize=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'').replace(/^vicegrip$/,'visegrip');
test('all 493 playable species exactly match supported USUM level-up records, with only the documented double-battle move excluded',()=>{
 const byName=new Map(catalog.map(m=>[normalize(m.ename),m.ename]));let excluded=0;
 for(let id=1;id<=493;id++){
  const expected=ref.species[id].level.map(([level,move])=>{const name=byName.get(normalize(ref.moves[move].name));if(!name){assert.equal(move,671);excluded++;}return name?[level,name]:null;}).filter(Boolean);
  assert.deepEqual(new Set(levels[id].map(e=>JSON.stringify(e))),new Set(expected.map(e=>JSON.stringify(e))),`Species #${id}`);
 }
 assert.equal(excluded,4);assert.equal(Object.keys(levels).length,809);
});
test('Sandshrew has its complete progression and Force Poigne is restored for Krabby and its other learners',()=>{
 assert(levels[27].length>10);assert(levels[27].some(([level,name])=>name==='Earthquake'&&level>1));
 for(const id of[98,99,127,303,341,342])assert(levels[id].some(([,name])=>name==='Vise Grip'),`Species #${id}`);
 const p=factory.create(98,4,true);p.level=5;learning.queueLevelMoves(p,4);assert(p.pendingMoves.some(c=>c.move==='Vise Grip'));
});
for(const [id,from,to,name]of[[143,56,57,'High Horsepower'],[157,73,74,'Burn Up'],[57,47,48,'Stomping Tantrum'],[167,53,54,'Toxic Thread'],[438,21,22,'Tearful Look']])
 test(`natural learning #${id} offers ${name} at level ${to} without overwriting the selected set`,()=>{
  const p=factory.create(id,from,true),before=[...p.abilities];p.gainExperience(p.getNextLevelExpForLevel(to)-p.experience);
  assert.equal(p.level,to);assert(p.pendingMoves.some(c=>c.move===name&&c.level===to));assert.deepEqual(p.abilities,before);
 });
for(const [id,level,expected]of[[129,5,['Splash']],[132,5,['Transform']],[201,5,['Hidden Power']],[235,50,['Sketch']]])
 test(`new encounter #${id} has its real small move set, without invented attacks or duplicate slots`,async()=>{
  const p=await wild.createAtLevel(id,level);assert.deepEqual(p.abilities,expected);assert.equal(p.movePp.length,expected.length);
 });
test('random expedition starters have only distinct moves already learned at their level',()=>{
 const starters=factory.starterChoices(()=>.4,18);assert.equal(starters.length,3);
 for(const p of starters){assert(p.abilities.length>0&&p.abilities.length<=4);assert.equal(new Set(p.abilities).size,p.abilities.length);const allowed=learning.availableLevelMoves(p.data.id,p.level);assert(p.abilities.every(n=>allowed.includes(n)));assert(Object.values(p.iv).every(v=>v>=18));}
});
test('each added move has a priced CS with documented species compatibility; compatible teaching is pure and unrelated species are rejected',()=>{
 for(const move of catalog.filter(m=>m.catalogueRevision===2)){
  const entry=Object.entries(machines).find(([,m])=>m.move===move.ename);assert(entry,move.ename);const [key,m]=entry;assert([3000,4000,5000].includes(m.price));
  const p=factory.create(m.species[0],50,true);p.abilities=['Splash'];p.movePp=[1];const before=JSON.stringify(p),result=teachMachine(p,key,{slot:1,expectedMoves:[...p.abilities]});assert.equal(result.abilities[1],move.ename);assert.equal(result.movePp[1],resources.getMaxMovePp(move.ename));assert.equal(JSON.stringify(p),before);
  const incompatible=Array.from({length:493},(_,i)=>i+1).find(id=>!m.species.includes(id));assert.throws(()=>teachMachine(factory.create(incompatible,50,true),key,{}),/compatible/);
 }
});
