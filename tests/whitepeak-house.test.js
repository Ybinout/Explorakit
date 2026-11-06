const test=require('node:test'),assert=require('node:assert/strict');
const rules=require('../server/game/whitepeak/rules'),repo=require('../server/persistence/whitepeakHouseRepository');
const {createDuelHouse}=require('../server/game/whitepeak/duelHouse'),factory=require('../server/game/drift/pokemonFactory');
const locks=require('../server/game/social/tradeLocks');
const trainers=require('../server/game/whitepeak/trainers');
test('all trainer choices provide exactly one to six enemies at the matching levels, with usable sets',()=>{
 for(const entry of trainers.list())for(const count of [1,3,6]){
  const own=Array.from({length:count},(_,i)=>({level:31+i*9})),team=trainers.create(entry.key,own);
  assert.equal(team.pokemons.length,count,entry.name);
  team.pokemons.forEach((p,i)=>{assert.equal(p.level,own[i].level,entry.name);assert(p.abilities.length>0&&p.abilities.length<=4);assert(p.currentHp===p.maxHp);assert(p.data.id>=1&&p.data.id<=493);assert(p.abilities.every(move=>require('../server/game/battle/battleEngine').getMoveByName(move)));});
  const unique=trainers.create(entry.key,own,50,{uniqueItems:true}).pokemons.map(p=>p.heldItem).filter(Boolean);assert.equal(new Set(unique).size,unique.length);
  assert(trainers.create(entry.key,own,50).pokemons.every(p=>p.level===50));
 }
});
test('formats and wagers are server validated; twelve is allowed only for 2v2',()=>{
 assert.equal(rules.settings({mode:'2v2',format:12}).format,12);
 assert.throws(()=>rules.settings({mode:'doubles'}));assert.throws(()=>rules.settings({mode:'2v2',format:18}));
 assert.throws(()=>rules.settings({mode:'pve',trainerKey:'dia1',money:10}));
 assert.throws(()=>rules.settings({mode:'2v1',pokemonStake:true}));
 assert.deepEqual(repo.split(1001,[1,2]),[{userId:1,amount:501},{userId:2,amount:500}]);
});
let serial=10000;
async function fixture(config={mode:'2v1',level:50,money:0}){
 let room=null,time=100000,emissions=0,settlements=0;const contexts=new Map(),snapshots=[];
 const count=config.mode==='1v1'?2:config.mode==='pve'?1:config.mode==='2v1'?3:4,ids=Array.from({length:count},()=>++serial);
 for(const id of ids){
  const team=Array.from({length:6},(_,i)=>factory.create([503,94,212,248,445,121][i],40+i,true));
  team.forEach((p,i)=>{p.shiny=i===0;p.abilities=['Splash'];p.heldItem=null;});
  const player={currentmap:rules.HALL,x:13*32+16,y:5*32+16,equipe:{pokemons:team},inventoryBusy:false};
  const events=[],socket={connected:true,handshake:{auth:{houseDoubles:1}},emit:(e,d)=>events.push([e,d])};
  contexts.set(id,{id,username:'Reader'+id,socket,events,account:{active:()=>socket.connected},getPlayer:()=>player,canUse:()=>true,reload:async()=>{}});
  snapshots.push({userId:id,user:{username:'Reader'+id,money:50000},team,entries:[],items:{}});
 }
 const store={...repo,inspect:async()=>({snapshots,digest:'private'}),start:async data=>({teams:repo.select(snapshots,data.sides,data.selections,data.config),balances:ids.map(userId=>({userId,balance:50000}))})};
 const house=createDuelHouse({contexts,getRoom:()=>room,setRoom:r=>{room=r;},emitRoom:()=>emissions++,now:()=>time,emitSpectator:()=>{},wallet:()=>{},store,
  finishDuel:async()=>{settlements++;return{payments:[],winnerId:room?.outcome?.winnerId};}});
 await house.create(ids[0],rules.settings(config));
 async function place(){for(const [i,id]of ids.entries()){const side=config.mode==='1v1'?i:config.mode==='2v1'?i?1:0:Math.floor(i/2),p=contexts.get(id).getPlayer();Object.assign(p,{x:(side?19:8)*32+16,y:8*32+16});await house.step(id);}}
 async function confirm(){for(const id of ids){const side=room.sides.find(s=>s.ids.includes(id));await house.command('confirm',id,{id:room.id,sideRevision:side.revision});}}
 return{house,ids,contexts,snapshots,get room(){return room;},place,confirm,get settlements(){return settlements;},advance:n=>{time+=n;},cleanup(){if(room)locks.release(ids,room.id);},get emissions(){return emissions;}};
}
test('2v1 podiums require one solo and two allies; inventories and chat are private to their camp',async()=>{
 const f=await fixture();try{await f.place();assert.equal(f.room.phase,'preparation');assert.deepEqual(f.room.sides.map(s=>s.ids.length),[1,2]);
  assert.equal(f.room.preparationDeadline,220000);assert.equal(f.room.sides[1].composition.length,6);
  const solo=f.house.view(f.room,f.ids[0]),ally=f.house.view(f.room,f.ids[1]),watcher=f.house.view(f.room,99999);
  assert.equal(solo.preparation.composition.every(p=>p.ownerId===f.ids[0]),true);assert.equal(watcher.preparation,null);assert(!JSON.stringify(solo).includes(f.snapshots[1].team[0].uuid));
  f.house.command('chat',f.ids[1],{id:f.room.id,message:'On garde ce trio ?'});
  assert.equal(f.house.view(f.room,f.ids[2]).preparation.chat.length,1);assert.equal(f.house.view(f.room,f.ids[0]).preparation.chat.length,0);
  assert.throws(()=>f.house.command('inspect',f.ids[0],{id:f.room.id,ownerId:f.ids[1],pokemonUuid:f.snapshots[1].team[0].uuid}));
 }finally{f.cleanup();}
});
test('every composition edit resets both confirmations, rejects stale revisions and foreign or repeated Pokemon',async()=>{
 const f=await fixture();try{await f.place();const side=f.room.sides[1],id=f.ids[1];await f.house.command('confirm',id,{id:f.room.id,sideRevision:0});assert(side.confirmed.has(id));
  const refs=[...side.composition].reverse();f.house.command('compose',f.ids[2],{id:f.room.id,sideRevision:0,composition:refs});assert.equal(side.confirmed.size,0);assert.equal(side.revision,1);
  await assert.rejects(()=>f.house.command('confirm',id,{id:f.room.id,sideRevision:0}));
  assert.throws(()=>f.house.command('compose',id,{id:f.room.id,sideRevision:1,composition:[refs[0],refs[0]]}));
  assert.throws(()=>f.house.command('compose',id,{id:f.room.id,sideRevision:1,composition:[{ownerId:f.ids[0],uuid:f.snapshots[0].team[0].uuid}]}));
  assert.equal(f.room.phase,'preparation');
 }finally{f.cleanup();}
});
test('twelve per camp is six from each owner and never changes the original Adventure teams',async()=>{
 const f=await fixture({mode:'2v2',format:12,level:100});try{await f.place();assert.deepEqual(f.room.sides.map(s=>s.composition.length),[12,12]);const original=f.snapshots.map(s=>s.team.map(p=>[p.uuid,p.level,p.experience]));
  await f.confirm();assert.equal(f.room.phase,'battle');assert.deepEqual(f.room.copies.map(p=>p.equipe.pokemons.length),[12,12]);assert(f.room.copies.every(p=>p.equipe.pokemons.every(p=>p.level===100)));assert(f.room.copies.every(p=>p.equipe.pokemons[0].shiny&&p.equipe.pokemons[0].data.id===503));
  assert.deepEqual(f.snapshots.map(s=>s.team.map(p=>[p.uuid,p.level,p.experience])),original);
  assert.equal(f.room.engine.rules.rewards,false);assert.equal(f.room.engine.rules.report,false);
 }finally{f.cleanup();}
});
test('only the controller can act, relay adds no turn, stale actions fail, and a new active owner receives control',async()=>{
 const f=await fixture();try{await f.place();await f.confirm();const r=f.room,side=r.sides[1],owner=side.control.ownerId,partner=side.ids.find(id=>id!==owner),round=r.engine.round,token=r.engine.token,revision=side.control.revision;
  assert.throws(()=>f.house.command('action',partner,{id:r.id,turnId:token,controlRevision:revision,action:'attack',number:0}));
  f.house.command('pass',owner,{id:r.id,turnId:token,controlRevision:revision});assert.equal(side.control.controllerId,partner);assert.equal(r.engine.round,round);assert.equal(r.engine.pending.size,0);
  assert.throws(()=>f.house.command('action',owner,{id:r.id,turnId:token,controlRevision:revision,action:'attack',number:0}));
  f.house.command('action',partner,{id:r.id,turnId:token,controlRevision:side.control.revision,action:'change',number:1});
  const solo=r.sides[0].control;
  f.house.command('action',solo.controllerId,{id:r.id,turnId:token,controlRevision:solo.revision,action:'attack',number:0});
  assert.equal(side.control.ownerId,partner);assert.equal(side.control.controllerId,partner);assert.equal(r.engine.round,round);
 }finally{f.cleanup();}
});
test('preparation timeout cannot be bypassed by a late confirmation and releases every lock',async()=>{
 const f=await fixture();try{await f.place();f.advance(120000);await assert.rejects(()=>f.house.command('confirm',f.ids[0],{id:f.room.id,sideRevision:0}));assert.equal(f.room,null);assert(f.ids.every(id=>!locks.locked(id)));assert.equal(f.settlements,0);}finally{f.cleanup();}
});
test('disconnect during preparation cancels; in battle it allows reconnect then forfeits at the grace deadline',async()=>{
 const f=await fixture();try{await f.place();await f.confirm();const r=f.room,id=f.ids[1],c=f.contexts.get(id),deadline=r.engine.deadline,round=r.engine.round;c.socket.connected=false;f.house.disconnect(id,c);f.advance(29000);await f.house.tick();assert.equal(r.phase,'battle');assert.equal(r.engine.round,round);
  c.socket.connected=true;c.restoredHouse=null;await f.house.step(id);assert(!r.disconnected.has(id));assert.equal(r.engine.deadline,deadline+29000);c.socket.connected=false;f.house.disconnect(id,c);f.advance(30000);await f.house.tick();assert.equal(r.phase,'finished');assert.equal(f.settlements,1);assert(f.ids.every(id=>!locks.locked(id)));
 }finally{f.cleanup();}
});
test('PvE really awards no XP or EV after every enemy KO and never modifies the owned party',async()=>{
 const f=await fixture({mode:'pve',trainerKey:'champion_wanda'});try{
  const original=f.snapshots[0].team.map(p=>[p.uuid,p.level,p.experience,{...p.ev}]),r=f.room;
  for(const p of r.copies[1].equipe.pokemons)p.currentHp=0;r.engine.prune();r.engine.checkEnd();await f.house.tick();
  assert.equal(r.phase,'finished');assert.deepEqual(f.snapshots[0].team.map(p=>[p.uuid,p.level,p.experience,{...p.ev}]),original);assert.equal(f.contexts.get(f.ids[0]).events.filter(([event])=>event==='battleExperience').length,0);
 }finally{f.cleanup();}
});
test('PvE resolves an actual human/AI turn through the shared strategic engine without rewards',async()=>{
 for(const trainer of trainers.list()){
  const f=await fixture({mode:'pve',trainerKey:trainer.key});try{const r=f.room,c=r.sides[0].control;assert(f.house.command('action',f.ids[0],{id:r.id,turnId:r.engine.token,controlRevision:c.revision,action:'attack',number:0}),trainer.name);assert.equal(r.engine.round,1);assert.equal(f.contexts.get(f.ids[0]).events.filter(([event])=>event==='battleExperience').length,0);}finally{f.cleanup();}
 }
});
test('old clients remain outside collaborative podiums and cannot accidentally join an unreadable preparation',async()=>{
 const f=await fixture();try{f.contexts.get(f.ids[1]).supportsHouseModes=false;await f.place();assert.equal(f.room.phase,'waiting');assert(!f.room.ids.includes(f.ids[1]));f.house.cancel('done');f.contexts.get(f.ids[0]).supportsHouseModes=false;await assert.rejects(()=>f.house.create(f.ids[0],{mode:'2v1'}),/Actualise/);assert.equal(f.room,null);}finally{f.cleanup();}
});
test('a repeated unchanged composition preserves confirmations; KO replacement transfers ownership normally',async()=>{
 const f=await fixture();try{await f.place();const side=f.room.sides[1],owner=side.ids[0];await f.house.command('confirm',owner,{id:f.room.id,sideRevision:0});
  f.house.command('compose',owner,{id:f.room.id,sideRevision:0,composition:side.composition});assert(side.confirmed.has(owner));assert.equal(side.revision,0);
  await f.confirm();const r=f.room;r.copies[1].equipe.pokemons[0].currentHp=0;r.engine.prune();r.engine.request();assert(r.engine.replacementPhase);
  const partner=side.ids[1],token=r.engine.token;f.house.command('pass',side.control.controllerId,{id:r.id,turnId:token,controlRevision:side.control.revision});
  f.house.command('action',partner,{id:r.id,turnId:token,controlRevision:side.control.revision,action:'change',number:1});
  assert.equal(side.control.ownerId,partner);assert.equal(side.control.controllerId,partner);
 }finally{f.cleanup();}
});
test('2v1 allows one corrupted Pokemon per camp, shared across both allies rather than per owner',async()=>{
 const f=await fixture();try{
  for(const s of f.snapshots)s.team[0].corruption={version:1,revision:1,permanent:true,modules:{}};
  await f.place();const r=f.room,side=r.sides[1],id=side.ids[0],view=f.house.view(r,id);
  assert.equal(view.maxCorrupted,1);assert.equal(view.preparation.composition.filter(p=>p.corrupted).length,2);
  await assert.rejects(()=>f.house.command('confirm',id,{id:r.id,sideRevision:0}),/Un seul/);
  assert.equal(side.confirmed.size,0);
  const secondOwner=side.ids[1];side.composition=side.composition.map(ref=>ref.ownerId===secondOwner&&ref.uuid===f.snapshots[2].team[0].uuid?{ownerId:secondOwner,uuid:f.snapshots[2].team[3].uuid}:ref);
  assert.deepEqual(repo.select(f.snapshots,r.sides.map(s=>s.ids),r.sides.map(s=>s.composition),r.config).map(team=>team.filter(p=>p.corruption?.permanent).length),[1,1]);
  f.snapshots[0].team[1].corruption={version:1,revision:1,permanent:true,modules:{}};
  assert.throws(()=>repo.select(f.snapshots,r.sides.map(s=>s.ids),r.sides.map(s=>s.composition),{...r.config,maxCorrupted:99}),/Un seul/);
 }finally{f.cleanup();}
});
for(const format of [6,12])test(`2v2 ${format}v${format} permits exactly two corrupted Pokemon in each shared camp`,async()=>{
 const f=await fixture({mode:'2v2',format,level:50,money:0});try{
  for(const s of f.snapshots)s.team[0].corruption={version:1,revision:1,permanent:true,modules:{}};
  await f.place();const r=f.room;assert.equal(f.house.view(r,f.ids[0]).maxCorrupted,2);
  for(const side of r.sides)assert.equal(f.house.view(r,side.ids[0]).preparation.composition.filter(p=>p.corrupted).length,2);
  await f.confirm();assert.equal(r.phase,'battle');assert.deepEqual(r.copies.map(copy=>copy.equipe.pokemons.filter(p=>p.corruption?.permanent).length),[2,2]);
  const side=r.sides[0],third=f.snapshots[0].team[1];third.corruption={version:1,revision:1,permanent:true,modules:{}};
  assert.throws(()=>repo.select(f.snapshots,[side.ids],[side.composition],r.config),/Deux/);
 }finally{f.cleanup();}
});

test('House previews and every generated party use six distinct terminal Gen1–4 species, including stone and branch evolutions',()=>{
 const all=[...require('../data/game/evolutions.json').rules,...require('../data/game/stone_evolutions.json').rules],evolving=new Set(all.filter(r=>r.to<=493).map(r=>r.from));
 for(const entry of trainers.list()){
  assert.equal(entry.species.length,6,entry.key);assert.equal(new Set(entry.species).size,6,entry.key);
  assert(entry.species.every(id=>id<=493&&!evolving.has(id)),entry.key);
  const p=trainers.create(entry.key,entry.species.map(()=>({level:50}))).pokemons;
  assert.deepEqual(p.map(p=>p.data.id),entry.species);
  for(const pokemon of p){assert(require('../server/game/abilities/abilityDex').getSpeciesAbilitySlots(pokemon.data.id).some(a=>a.name===pokemon.passiveAbility),`${entry.key} ${pokemon.data.id} ${pokemon.passiveAbility}`);assert(pokemon.heldItem);assert(pokemon.movePp.every(pp=>pp>0));}
 }
 assert.deepEqual(trainers.list().find(t=>t.key==='aspha_route2').species.slice(0,3),[448,475,373]);
 assert.equal(trainers.list().find(t=>t.key==='champion_hoze').species[0],9);
 assert.equal(trainers.list().find(t=>t.key==='mathilde_pikapika').species[0],26);
 assert.equal(require('../server/game/world/pnjTeamFactory').getPnjTeam('hoze').pokemons[0].data.id,7,'Adventure keeps its intentional Squirtle');
 assert.deepEqual(require('../server/game/superTournament/content').createTeam(0).pokemons.map(p=>p.data.id),[19,19,20],'Tower content remains separate');
});
test('an active House refresh does not replay the entrance and can restore exactly the current unaccepted choice',async()=>{
 const f=await fixture({mode:'pve',trainerKey:'dia1'});try{const r=f.room,id=f.ids[0],c=f.contexts.get(id),before=c.events.length,token=r.engine.token,deadline=r.engine.deadline,round=r.engine.round,team=r.copies.map(p=>p.equipe.pokemons.map(p=>[p.uuid,p.currentHp,[...p.movePp]]));
  await f.house.step(id);assert.equal(c.events.slice(before).filter(([e])=>e==='battletrigger').length,0);
  c.events.length=0;assert(f.house.resync(id));const request=c.events.findLast(([e])=>e==='requestAction')?.[1];assert.equal(request.turnId,token);assert.equal(r.engine.round,round);assert.equal(r.engine.deadline,deadline);
  assert.deepEqual(r.copies.map(p=>p.equipe.pokemons.map(p=>[p.uuid,p.currentHp,[...p.movePp]])),team);
  const control=c.events.findLast(([e])=>e==='whitepeak:control')[1];assert(control.canControl);assert.equal(control.turnId,token);
  assert.equal(f.house.resync(999999),false);
 }finally{f.cleanup();}
});
test('resynchronizing a pending shared action never repeats it or asks its camp to act twice',async()=>{
 const f=await fixture();try{await f.place();await f.confirm();const r=f.room,s=r.sides[0],id=s.control.controllerId,c=f.contexts.get(id),token=r.engine.token;
  f.house.command('action',id,{id:r.id,turnId:token,controlRevision:s.control.revision,action:'attack',number:0});const pending=r.engine.pending.get(r.copies[0]),round=r.engine.round,deadline=r.engine.deadline;
  c.events.length=0;f.house.resync(id);assert(!c.events.some(([e])=>e==='requestAction'));assert.equal(r.engine.pending.get(r.copies[0]),pending);assert.equal(r.engine.round,round);assert.equal(r.engine.deadline,deadline);assert.equal(c.events.findLast(([e])=>e==='whitepeak:control')[1].canControl,false);
 }finally{f.cleanup();}
});
test('resynchronization retains the required replacement or pivot prompt and its allowed slots',async()=>{
 const f=await fixture();try{await f.place();await f.confirm();const r=f.room,id=f.ids[0],c=f.contexts.get(id),p=r.copies[0];p.equipe.pokemons[0].currentHp=0;r.engine.prune();r.engine.request();
  c.events.length=0;const token=r.engine.token,deadline=r.engine.deadline;f.house.resync(id);const request=c.events.findLast(([e])=>e==='requestAction')[1];assert(request.replacement);assert.equal(request.turnId,token);assert.deepEqual(request.allowedPokemonIndexes,[1,2,3,4,5]);assert.equal(r.engine.deadline,deadline);
  p.equipe.pokemons[0].currentHp=1;r.engine.requestPivot(p,{remaining:[]});c.events.length=0;f.house.resync(id);const pivot=c.events.findLast(([e])=>e==='requestAction')[1];assert(pivot.replacement);assert(pivot.turnId.includes(':pivot:'));assert(r.engine.pivotSwitch);assert(r.engine.turnContinuation);
 }finally{f.cleanup();}
});
test('leaving during turn resolution preserves its pending actions, then accepts the first choice of the next turn',async()=>{
 const f=await fixture({mode:'pve',trainerKey:'dia1'});try{const r=f.room,id=f.ids[0],c=f.contexts.get(id),human=r.copies[0],npc=r.copies[1];npc.equipe.pokemons.forEach(p=>{p.abilities=['Splash'];p.movePp=[40];p.heldItem=null;});r.engine.pending.set(npc,{action:'attack',number:0});
  const initialPp=human.equipe.pokemons[0].movePp[0];f.house.command('action',id,{id:r.id,turnId:r.engine.token,controlRevision:r.sides[0].control.revision,action:'attack',number:0});assert(!r.engine.awaiting);assert.equal(human.equipe.pokemons[0].movePp[0],initialPp-1);
  const nextRoundAt=r.engine.nextRoundAt;c.socket.connected=false;f.house.disconnect(id,c);f.advance(1000);await f.house.tick();c.socket.connected=true;c.restoredHouse=null;c.events.length=0;await f.house.step(id);assert.equal(r.engine.nextRoundAt,nextRoundAt+1000);assert(!c.events.some(([e])=>e==='requestAction'));assert.equal(r.engine.round,1);
  f.advance(1800);await f.house.tick();assert.equal(r.engine.round,2);const control=r.sides[0].control;assert(f.house.command('action',id,{id:r.id,turnId:r.engine.token,controlRevision:control.revision,action:'attack',number:0}));assert.equal(human.equipe.pokemons[0].movePp[0],initialPp-2);
 }finally{f.cleanup();}
});

for(const [mode,format]of [['1v1',6],['2v2',6],['2v2',12]])test(`Double ${mode} ${format}: real four-actives, owners control separate slots, relay, stale actions and forfeit settle once`,async()=>{
 const f=await fixture({mode,format,battleFormat:'double',level:50,money:1000});try{await f.place();await f.confirm();const r=f.room;assert.equal(r.phase,'battle');assert.equal(r.engine.sim.gameType,'doubles');assert(r.engine.sim.sides.every(s=>s.active.length===2));assert.equal(r.engine.sim.p1.pokemon.length,format);
 const side=r.sides[0],first=side.doubleControls[0],actor=first.controllerId,packet={id:r.id,slot:0,turnId:r.engine.token,controlRevision:first.revision};
 if(mode==='2v2'){const ally=side.ids.find(id=>id!==actor);assert.throws(()=>f.house.command('action',ally,{...packet,action:'attack',moveIndex:0}));await f.house.command('pass',actor,packet);assert.equal(side.doubleControls[0].controllerId,ally);assert.throws(()=>f.house.command('action',actor,{...packet,action:'attack',moveIndex:0}));await f.house.command('action',ally,{...packet,controlRevision:side.doubleControls[0].revision,action:'attack',moveIndex:0});}else await f.house.command('action',actor,{...packet,action:'attack',moveIndex:0});
 assert(r.engine.choices[0][0]);const before=r.engine.token;f.house.resync(actor);assert.equal(r.engine.token,before);assert(r.engine.choices[0][0]);
 await f.house.command('forfeit',actor,{id:r.id});await f.house.tick();assert.equal(r.phase,'finished');assert.equal(f.settlements,1);for(const c of f.contexts.values())assert(!c.getPlayer().inbattle);
 }finally{f.cleanup();}
});
