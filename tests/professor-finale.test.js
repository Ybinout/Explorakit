const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const story=require('../server/game/world/labStory'),departure=require('../server/game/world/lucieDeparture');
const base=require('../server/game/world/pnjStore'),maps=require('../server/game/world/mapRepository');
const room=require('../server/game/world/roomObstacles'),dialogues=require('../server/game/world/interactionRepository');
test('Wanda, captive Lucie and healthy Lucie are personal and follow the actual quest stages',()=>{
 let p={flags:{}},leaving=false;
 const own=departure.scopedStore(story.scopedStore(base,()=>p),()=>p,()=>leaving);
 const other=departure.scopedStore(story.scopedStore(base,()=>({flags:{}})),()=>({flags:{}}));
 assert(!own.getPnjsForMap('route2').some(n=>n.name==='wanda_professor'));
 p={flags:{lucie_house_exited:'true'}};assert(own.getPnjAtTile('route2',14,7));assert(!other.getPnjAtTile('route2',14,7));
 p.flags.professor_lab_key='true';assert(!own.getPnjsForMap('route2').some(n=>n.name==='wanda_professor'));
 assert(own.getPnjAtTile('professor_lab',13,11));assert(own.getPnjAtTile('professor_lab',13,5));
 p.flags.professor_defeated='true';assert(departure.pending(p,departure.professor));p.flags.professor_departure='seen';assert(!own.getPnjAtTile('professor_lab',13,11));assert(!own.isPnjBlockingTile('professor_lab',13,11));
 leaving=true;assert(own.getPnjAtTile('professor_lab',13,11));leaving=false;
 p.flags.lucie_rescued='true';assert(!own.getPnjAtTile('professor_lab',13,5));assert(own.getPnjAtTile('start',5,8));assert(!other.getPnjAtTile('start',5,8));
 assert.equal(own.getPnjAtTile('start',6,8).interactionName,'dia0');assert.equal(own.getPnjsForMap('start').filter(n=>n.name==='mere_clara').length,1);
 assert.equal(dialogues.getSentenceForName('dia0',p)[1],'dia0_final');assert.equal(dialogues.getEndSentenceInformation('dia0_final'),'heal');
});
test('Personal actors retain the normal two-row footprint and the reunited mother stays beside Lucie',()=>{
 const initial=base.getPnjsForMap('start').find(n=>n.name==='mere_clara');
 try {
  base.movePnj('mere_clara','start',7,8);
  const own=story.scopedStore(base,()=>({flags:{lucie_rescued:'true'}}));
  const other=story.scopedStore(base,()=>({flags:{}}));
  assert.equal(own.getPnjAtTile('start',6,7).name,'mere_clara');assert(own.isPnjBlockingTile('start',6,7));
  assert.equal(own.getPnjAtTile('start',5,7).name,'lucie_home');assert(own.isPnjBlockingTile('start',5,7));
  assert.equal(own.getPnjAtTile('start',7,8),null);assert(!own.isPnjBlockingTile('start',7,8));
  assert.equal(other.getPnjAtTile('start',7,8).name,'mere_clara');assert.equal(own.getPnjsForMap('start').filter(n=>n.name==='mere_clara').length,1);
  assert.equal(own.getPnjAtTile('professor_lab',13,10).name,'professor_story');assert(own.isPnjBlockingTile('professor_lab',13,10));
 } finally {base.movePnj('mere_clara','start',initial.x,initial.y);}
});
test('Action on the painted door/rock is spatially authoritative; the rock clue requires inspecting the door',()=>{
 const player={currentmap:'start',x:24*32+16,y:16*32+16};
 assert.equal(maps.loadCollisionData('start')[15][24],0);assert.equal(maps.loadCollisionData('start')[17][26],0);
 assert.equal(story.interaction(player,{flags:{}}).dialogue,'professor_lab_door_unknown');
 assert.equal(story.interaction(player,{flags:{professor_lead:'true'}}).dialogue,'professor_lab_door');
 assert(story.interaction(player,{flags:{professor_lab_key:'true'}}).enter);
 const rock={currentmap:'start',x:26*32+16,y:17*32+16};assert.equal(story.interaction(rock,{flags:{professor_lead:'true'}}),null);
 assert.equal(story.interaction(rock,{flags:{lab_door_inspected:'true'}}).dialogue,'professor_lab_rock');
 assert.equal(story.interaction(rock,{flags:{lab_door_inspected:'true',professor_lab_key:'true'}}).dialogue,'professor_lab_rock_empty');
 assert.equal(story.interaction({...rock,currentmap:'route2'},{flags:{lab_door_inspected:'true'}}),null);
});
test('Laboratory crystals seal every route to Lucie, have ten hits, and the exit remains reachable',()=>{
 const obstacle=room.obstacles.find(o=>o.id==='lab_crystals'),c=maps.loadCollisionData('professor_lab');
 assert.equal(obstacle.strikeTimes.length,10);assert.equal(obstacle.requiresFlag,'professor_defeated');
 function reachable(progress){const q=[[13,16]],seen=new Set();for(const[x,y]of q){const key=x+':'+y;if(seen.has(key)||c[y]?.[x]!==0||obstacle.cells.some(p=>p.x===x&&p.y===y)&&room.isLocked(obstacle,progress))continue;seen.add(key);for(const[dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]])q.push([x+dx,y+dy]);}return seen;}
 const blocked=reachable({flags:{professor_defeated:'true'}});assert(blocked.has('13:12'));assert(blocked.has('13:17'));assert(!blocked.has('13:6'));
 assert(reachable({flags:{professor_defeated:'true',lab_crystals_cleared:'true'}}).has('13:6'));
 for(const x of [13,14])assert.equal(maps.getNextMap('professor_lab',x,17).nextMap,'start');
 assert.equal(require('../server/game/world/regionMap').regionLocation('professor_lab'),'start');
 assert.equal(maps.loadCollisionData('start')[8][5],0);
});
test('The professor has six independent level-90 K3 strategic builds and the human expert policy',()=>{
 const factory=require('../server/game/world/pnjTeamFactory'),resources=require('../server/game/battle/battleResources'),engine=require('../server/game/battle/battleEngine');
 const a=factory.getPnjTeam('professor_final'),b=factory.getPnjTeam('professor_final');
 assert.deepEqual(a.pokemons.map(p=>p.data.id),[450,437,94,121,212,445]);assert.equal(a.__trainerPlan.ai,'expert');assert.equal(a.__trainerPlan.aceUuid,undefined);
 for(const [i,p]of a.pokemons.entries()){
  assert.equal(p.level,90);assert.equal(p.k,3);assert.equal(p.abilities.length,4);assert(p.currentHp===p.maxHp&&p.maxHp>0);
  assert.equal(Object.values(p.ev).reduce((a,b)=>a+b,0),508);assert(resources.getItemDefinition(p.heldItem));assert(p.abilities.every(m=>engine.getMoveByName(m)));assert.notEqual(p.uuid,b.pokemons[i].uuid);
 }
 const field=engine.createBattleState();engine.applySwitchInEffects(a.pokemons[0],field.sides.enemy,field.sides.player,field,b.pokemons[2]);assert.equal(field.weather.kind,'sandstorm');
 const carch=a.pokemons.at(-1);assert.equal(carch.heldItem,'yache_berry');assert(carch.abilities.includes('Swords Dance'));
});
test('The professor uses the existing splash, a native 32px sprite and indoor backgrounds',async()=>{
 const {arenaChampion}=await import('../vue-explorakit/src/services/arenaEntrance.js'),{battleEnvironment}=await import('../vue-explorakit/src/services/battleEnvironment.js');
 assert.equal(arenaChampion('professor_lab','trainer','professor_story').portrait,'prof.png');
 assert.equal(arenaChampion('professor_lab','wild','professor_story'),null);assert.equal(arenaChampion('start','trainer','professor_story'),null);
 assert.equal(battleEnvironment('professor_lab',false,'rain'),'professor-lab');assert.equal(battleEnvironment('professor_lab',true),'colosseum');
 const sprite=fs.readFileSync('vue-explorakit/src/assets/pnj/professor-pixel-v1.png');assert.deepEqual([sprite.readUInt32BE(16),sprite.readUInt32BE(20)],[32,32]);
 for(const suffix of ['', '_f'])assert(fs.existsSync('vue-explorakit/src/assets/professor_lab'+suffix+'.png'));
});
