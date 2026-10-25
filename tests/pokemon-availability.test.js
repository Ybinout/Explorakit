const test=require('node:test'),assert=require('node:assert/strict');
const {buildReport,reachableMaps,EVOLUTION_ONLY}=require('../scripts/auditPokemonAvailability');
const wild=require('../server/game/world/wildPokemonFactory');
const factory=require('../server/game/drift/pokemonFactory');
const evolution=require('../server/game/models/evolution');
const stones=require('../server/game/items/stoneEvolution');
const learning=require('../server/game/models/moveLearning');
const {getMoveDefinition,getMaxMovePp}=require('../server/game/battle/battleResources');
const {maps}=require('../data/game/nextMap.json');
const rules=require('../data/game/evolutions.json').rules;
const stoneRules=require('../data/game/stone_evolutions.json').rules;

test('all 493 Gen I–IV species are obtainable on real connected maps, including rare legendaries with both sprites',()=>{
 const report=buildReport();assert.equal(report.total,493);assert.equal(report.excluded,0);assert.equal(report.legendary,35);assert.equal(report.legendaryOneIn,3000);
 assert.deepEqual(report.missing,[]);assert.deepEqual(report.missingSprites,[]);assert.deepEqual(report.forbiddenWild,[]);
 assert.equal(report.direct+report.evolutionOnly,493);
 for(const id of EVOLUTION_ONLY)assert.equal(report.entries.find(p=>p.id===id).method,'evolution',String(id));
 for(const entry of report.entries.filter(p=>p.method==='capture'))for(const place of entry.locations){assert(reachableMaps().has(place.map));assert(!maps.find(m=>m.mapName===place.map).legacyOnly);}
 assert.deepEqual(maps.find(m=>m.mapName==='start').level,{min:2,max:5});
});

test('Adventure rolls every configured grass species; fishing species create valid Pokémon and moves',async()=>{
 const report=buildReport(),oldRandom=Math.random;
 try {
  for(const map of maps.filter(m=>report.zones.includes(m.mapName)))for(let i=0;i<map.wildpokemon.length;i++){
   Math.random=()=>(i+.5)/map.wildpokemon.length;
   const p=await wild(map.mapName);
   assert.equal(p.data.id,map.wildpokemon[i]);assert(p.currentHp>0);assert.equal(p.level>=map.level.min&&p.level<=map.level.max,true);
   assert(p.abilities.length>0&&p.abilities.length<=4);
   for(const move of p.abilities)assert(getMoveDefinition(move),`${p.data.id}: ${move}`);
  }
 } finally { Math.random=oldRandom; }
 for(const entry of report.entries.filter(p=>p.method==='capture'&&p.locations.some(l=>l.method==='fishing'))){
  const location=entry.locations.find(l=>l.method==='fishing'),level=maps.find(m=>m.mapName===location.map).level.min;
  const p=await wild.createAtLevel(entry.id,level);assert.equal(p.data.id,entry.id);assert.equal(p.level,level);assert(p.currentHp>0&&p.abilities.every(getMoveDefinition));
 }
});

test('all required evolution edges resolve in the shared engine and their stones are sold on accessible maps',()=>{
 const shops=require('../server/game/world/shopCatalog'),flags=Object.fromEntries(require('../data/game/shop_offers.json').tiers.filter(t=>t.flag).map(t=>[t.flag,'true']));
 const available=new Set([...shops.SHOP_MAPS].filter(m=>reachableMaps().has(m)).flatMap(mapName=>shops.getShopCatalog({mapName,flags}).map(i=>i.key)));
 for(const rule of [...rules,...stoneRules].filter(r=>r.to<=493&&!factory.legendary.has(r.from))){
  const p=factory.create(rule.from,100,true);p.gender=rule.gender||'female';
  if(rule.move)p.abilities=[rule.move];
  if(rule.relativeStats!=null){p.attack=100+rule.relativeStats;p.defense=100;}
  if(rule.personalityBranch!=null){let n=0;while(!evolution.matches(p,rule)&&n<100)p.uuid='coverage-'+n++;}
  if(rule.item){assert(available.has(rule.item),rule.item);assert.equal(stones.target(p,rule.item).id,rule.to);stones.evolve(p,rule.item);}
  else{assert(evolution.matches(p,rule),JSON.stringify(rule));evolution.evolve(p,{fromSpeciesId:rule.from,targetId:rule.to});}
  assert.equal(p.data.id,rule.to);
 }
});

test('late wild captures retain their required evolution move in Adventure and both expeditions',async()=>{
 for(const [id,move,map]of [[221,'Ancient Power','route13'],[438,'Mimic','cave1'],[439,'Mimic','gen_route8']]){
  const p=await wild.createAtLevel(id,60);assert(p.abilities.includes(move));assert.equal(p.movePp[p.abilities.indexOf(move)],getMaxMovePp(move));assert(evolution.automatic(p));
  let found;for(let i=0;i<1000&&!found;i++){const candidate=factory.wild(map,{},()=>(i+.5)/1000);if(candidate.data.id===id)found=candidate;}
  assert(found&&found.abilities.includes(move),`${id}: expedition evolution blocked`);assert(evolution.automatic(found));
 }
 const low=await wild.createAtLevel(438,5);assert(!low.abilities.includes('Mimic'),'Do not teach before the species learning level');
});

test('evolving Swinub offers Ancient Power, keeping player choice and allowing Mamoswine',()=>{
 const p=factory.create(220,32,true);p.abilities=['Tackle','Growl','Mud-Slap','Ice Shard'];p.movePp=p.abilities.map(getMaxMovePp);
 p.gainExperience(p.getNextLevelExpForLevel(33)-p.experience);assert.equal(p.data.id,221);assert(!p.abilities.includes('Ancient Power'));
 const offer=p.pendingMoves.find(m=>m.move==='Ancient Power');assert(offer);
 // Resolve preceding legitimate offers in order, then accept the evolution move.
 while(p.pendingMoves[0].id!==offer.id)Object.assign(p,learning.resolveMoveChoice(p,{choiceId:p.pendingMoves[0].id,slot:null}));
 Object.assign(p,learning.resolveMoveChoice(p,{choiceId:offer.id,slot:3}));p.checkEvolution();assert.equal(p.data.id,473);
});
