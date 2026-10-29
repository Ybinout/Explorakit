const test=require('node:test'),assert=require('node:assert/strict');
const wild=require('../server/game/world/wildPokemonFactory'),moduleItem=require('../server/game/items/experienceModule');
async function fixed(work){const before=Math.random;Math.random=()=>.5;try{return await work();}finally{Math.random=before;}}
test('module is a permanent personal key item, only 7p awards it and its dialogue stays in character',()=>{
 const item=require('../data/game/items.json').items.find(i=>i.key===moduleItem.ITEM_KEY);assert.equal(item.category,'key');assert(item.unique&&item.experienceModule);assert.equal(item.buy_price,0);assert.equal(require('../server/game/items/itemSales').getSellPrice(item.key),0);
 const rewards=Object.entries(require('../data/game/progression.json').npcBattles).filter(([,d])=>d.reward?.items?.[item.key]);assert.deepEqual(rewards.map(([k])=>k),['champion_7p']);assert.equal(rewards[0][1].reward.items[item.key],1);
 const line=require('../data/game/interact.json').find(i=>i.name==='champion_7p_after').sentences.find(s=>s.text.includes('Module d’expérience'));assert(line);assert.match(line.text,/meilleur du meilleur/);assert.equal(line.imageName,'7ps.png');
 assert.deepEqual(moduleItem.view(false,'true'),{owned:false,active:false,levelBonus:0});assert.deepEqual(moduleItem.view(true,'false'),{owned:true,active:false,levelBonus:0});assert.deepEqual(moduleItem.view(true,'true'),{owned:true,active:true,levelBonus:10});
});
test('level 5 Squirtle appears at level 15 with coherent XP, HP, stats and natural moves; other rolls are identical',()=>fixed(async()=>{
 const base=await wild.createAtLevel(7,5),boosted=await wild.createAtLevel(7,5,{experienceModuleActive:true});assert.equal(base.level,5);assert.equal(boosted.level,15);assert.equal(boosted.experience,boosted.getNextLevelExpForLevel(15));assert.equal(boosted.currentHp,boosted.maxHp);assert(boosted.maxHp>base.maxHp&&boosted.attack>base.attack&&boosted.speed>base.speed);
 assert.deepEqual(boosted.iv,base.iv);assert.equal(boosted.k,base.k);assert.equal(boosted.passiveAbility,base.passiveAbility);assert.equal(boosted.nature,base.nature);assert.notDeepEqual(boosted.abilities,base.abilities);assert.deepEqual(boosted.movePp,boosted.abilities.map(require('../server/game/battle/battleResources').getMaxMovePp));
 const off=await wild.createAtLevel(7,5,{experienceModuleActive:false});assert.equal(off.level,5);assert.equal((await wild.createAtLevel(7,100,{experienceModuleActive:true})).level,110);
}));
test('grass, caves and legendary rolls use zone+10 once, with the same species draw and no evolution',()=>fixed(async()=>{
 for(const map of ['start','route2','cave1','route14'])for(const value of [.5,0]){
  const before=await wild(map,()=>value),after=await wild(map,()=>value,{experienceModuleActive:true});assert.equal(after.data.id,before.data.id);assert.equal(after.level,before.level+10);assert.deepEqual(after.iv,before.iv);assert.equal(after.k,before.k);
 }
 const never=()=>{throw Error('Encounter-free location rolled');};assert.equal(await wild('centre',never,{experienceModuleActive:true}),null);
 assert.deepEqual(require('../server/game/world/pnjTeamFactory').getPnjTeam('sevenp').pokemons.map(p=>p.level),[63,64,64,64,65,66]);
}));
test('fishing uses exactly the same bonus, and boosted Abra guarantees are not boosted a second time',()=>fixed(async()=>{
 const encounter=require('../server/game/world/fishingEncounters').fishingEncounter('start',()=>.5),fish=await wild.createAtLevel(encounter.id,encounter.level,{experienceModuleActive:true});assert.equal(fish.level,encounter.level+10);assert.equal(fish.data.id,encounter.id);
 const base=await wild.createAtLevel(7,15,{experienceModuleActive:true});const abra=await require('../server/persistence/adventureEncounterRepository').applyEncounterGuarantee(1,'route2',base,{execute:async()=>[[]]});assert.equal(abra.data.id,63);assert.equal(abra.level,25);assert.equal(base.level,25);
}));
test('module RPC guards missing owners, busy players, combat, transitions and malformed switches without touching SQL',async()=>{
 const handlers={},events=[];let player=null,allowed=true;require('../server/realtime/handlers/experienceModuleHandlers').registerExperienceModuleHandlers({socket:{on:(k,fn)=>handlers[k]=fn,emit:(...e)=>events.push(e)},userId:1,getPlayer:()=>player,canUse:()=>allowed});
 const run=async payload=>{let reply;await handlers.setExperienceModule(payload,r=>reply=r);return reply;};
 assert.equal((await run({active:true})).success,false);player={inbattle:true};assert.equal((await run({active:true})).success,false);player={inventoryBusy:true};assert.equal((await run({active:true})).success,false);player={};allowed=false;assert.equal((await run({active:true})).success,false);allowed=true;assert.equal((await run({active:'true'})).success,false);assert.equal(player.inventoryBusy,false);assert.deepEqual(events,[]);
});

test('stale progress snapshots cannot overwrite an explicit module switch or change an already spawned opponent',async()=>{
 const p={};moduleItem.initializePlayer(p,{active:false});assert.equal(p.experienceModuleActive,false);p.experienceModuleActive=true;moduleItem.initializePlayer(p,{active:false});assert.equal(p.experienceModuleActive,true);
 const reconnected={};moduleItem.initializePlayer(reconnected,{active:true});assert.equal(reconnected.experienceModuleActive,true);
 const encountered=await wild.createAtLevel(7,5,{experienceModuleActive:true});p.experienceModuleActive=false;assert.equal(encountered.level,15);
});
