const test=require('node:test'),assert=require('node:assert/strict');
const factory=require('../server/game/drift/pokemonFactory'),balls=require('../server/game/items/captureBalls');
const item=key=>require('../server/game/battle/battleResources').getItemDefinition(key);
const clone=p=>require('../server/game/drift/checkpointCodec').decode(require('../server/game/drift/checkpointCodec').encode(p));

test('Master Ball is guaranteed throughout both Dark Continents; elite EVs alone reset, HP and original traits remain valid',()=>{
 for(const map of ['jungle1','jungle9','DC2_44','DC2_01','start']){
  const p=factory.create(130,300,true);require('../server/game/world/darkEncounters').prepare(p,'jungle9',()=>0);p.recalculateStats();p.currentHp=p.maxHp;p.shiny=true;
  const before=clone(p),ctx=balls.context(p,{map});balls.validate(item('master_ball'),p,ctx);assert.equal(balls.fixedChance(item('master_ball'),ctx),1);
  balls.prepareCaptured(p,item('master_ball'));assert(Object.values(p.ev).every(v=>v===0));assert.deepEqual(p.iv,before.iv);assert.equal(p.level,300);assert.equal(p.k,4);assert(p.shiny&&p.corruption.permanent);assert(p.maxHp<before.maxHp);assert(p.currentHp>0&&p.currentHp<=p.maxHp);
 }
 const p=factory.create(9,100,true),before=clone(p);balls.prepareCaptured(p,item('master_ball'));assert.deepEqual(p.ev,before.ev);assert.deepEqual(p.iv,before.iv);
 assert.equal(require('../server/game/items/itemSales').getSellPrice('master_ball'),2000000);assert.equal(require('../server/game/items/itemSales').getSellPrice('exp_share'),100);
});
test('capture destination honors the single corrupted party member and full-PC check before spending a Ball',()=>{
 const {DriftBattle}=require('../server/game/drift/driftBattle');
 const first=factory.create(143,100,true),enemy=factory.create(130,100,true);for(const p of[first,enemy]){p.corruption={version:1,revision:1,permanent:true,modules:{}};p.abilities=['Splash'];p.movePp=[40];p.heldItem=null;}
 const a={id:'a',currentmap:'jungle1',equipe:{pokemons:[first]},items:{master_ball:1},storageCount:require('../server/game/storage/pokemonStorage').CAPACITY,drifts:[],equipped:[]};
 const b={npc:true,equipe:{pokemons:[enemy]},items:{},drifts:[],equipped:[]};const battle=new DriftBattle(a,b,{type:'wild',emit(){},random:()=>.9999,rules:{darkAdventure:true,rewards:false,report:false,bagAllowed:true}});
 assert(balls.needsStorage(enemy,a.equipe.pokemons));assert.equal(battle.action(a,{action:'bag',itemKey:'master_ball',turnId:battle.token}),false);assert.equal(a.items.master_ball,1);assert(!battle.finished);
});
test('five new full-evolution teams have legal moves, actual modules, K4, trained stats and six unique compatible items',()=>{
 const sets=require('../server/game/whitepeak/corruptedPracticeSets'),practice=require('../server/game/whitepeak/practiceTeams'),machines=Object.values(require('../data/game/machines.json').machines);
 const next=new Set(require('../data/game/evolutions.json').rules.map(r=>r.from).concat(require('../data/game/stone_evolutions.json').rules.map(r=>r.from)));
 const policy=require('../server/game/items/heldItemPolicy'),slots=require('../server/game/abilities/abilityDex').getSpeciesAbilitySlots;
 assert.equal(sets.length,5);
 for(const entry of sets){
  for(const s of entry.members){assert(!next.has(s.id),s.id);assert(slots(s.id).some(a=>a.name===s.ability));for(const m of s.moves)assert(machines.some(x=>x.move===m&&x.species.includes(s.id)),`${s.id}: ${m}`);}
  const foes=[6,9,3,94,149,212].map(id=>factory.create(id,100,true)),before=JSON.stringify(foes),team=practice.create(entry.key,foes,100);
  assert.equal(JSON.stringify(foes),before);assert.equal(new Set(team.pokemons.map(p=>p.heldItem)).size,6);assert.equal(team.pokemons.filter(p=>p.corruption?.permanent).length,1);
  for(const p of team.pokemons){assert.equal(p.k,4);assert.equal(p.level,100);assert.equal(p.currentHp,p.maxHp);assert.equal(p.abilities.length,4);assert.equal(Object.values(p.ev).reduce((a,b)=>a+b,0),508);assert(policy.canHold(p,p.heldItem));}
  if(entry.key==='practice_steel_revenants')assert(team.pokemons.find(p=>p.data.id===429).abilities.includes('Parting Shot'));
 }
});
test('House opening adapts without reading a pending command, private EVs, items or exact opposing stats',()=>{
 const {openingLead}=require('../server/game/whitepeak/openingLead');
 const first=factory.create(6,100,true),second=factory.create(9,100,true);first.abilities=['Flamethrower'];second.abilities=['Surf'];for(const p of[first,second]){p.heldItem=null;p.passiveAbility=null;p.movePp=[15];}
 const foe=factory.create(464,100,true);foe.abilities=['Stone Edge','Earthquake'];
 for(const key of ['iv','ev','heldItem','attack','defense','specialAttack','specialDefense','speed','k'])Object.defineProperty(foe,key,{get(){throw Error('Private opposing value '+key);}});
 assert.equal(openingLead({pokemons:[first,second]},[foe]).pokemons[0].data.id,9);
});
test('new kick, support, Facade and Return visual signatures are distinct, bounded and retain old families',async()=>{
 const {moveVisual}=await import('../vue-explorakit/src/services/moveVisuals.js');
 const styles=['Helping Hand','Facade','Return','Blaze Kick','Double Kick','Rolling Kick'].map(moveName=>moveVisual({moveName}));assert.equal(new Set(styles.map(s=>s.style)).size,6);
 for(const moveName of ['High Jump Kick','Low Kick','Blaze Kick','Stomp'])assert.equal(moveVisual({moveName}).family,'kick');
 for(const v of styles)for(const key of ['windupMs','travelMs','impactMs'])assert(v[key]>0&&v[key]<=800);
 assert.equal(moveVisual({moveName:'Ice Beam'}).style,'frost-beam');assert.equal(moveVisual({moveName:'Crunch'}).family,'bite');
 const {MoveEffectRenderer}=await import('../vue-explorakit/src/services/moveEffectRenderer.js');let painted=0;const ctx=new Proxy({createRadialGradient:()=>({addColorStop(){}})},{get:(o,k)=>o[k]||(()=>painted++),set:(o,k,v)=>{o[k]=v;return true;}});
 const renderer=new MoveEffectRenderer({getContext:()=>ctx},{now:()=>0,requestFrame:()=>1,cancelFrame(){}});renderer.resize(390,550,3);
 for(const fx of styles)for(const stage of ['windup','travel','impact']){renderer.setEffect({...fx,stage,result:{success:true}},{startX:70,startY:400,targetX:300,targetY:150});renderer.paintAt(170);assert(renderer.stats.particles<=72);}
 assert(painted>200);renderer.dispose();
});
test('offline mutation leases serialize HTTP and connection initialization, including failure cleanup and draining sessions',async()=>{
 const {beginSession,withOfflineMutation}=require('../server/realtime/offlineMutation');let release,committed=false;
 const mutation=withOfflineMutation(987654321,async()=>{await new Promise(r=>{release=r;});committed=true;});
 await assert.rejects(withOfflineMutation(987654321,()=>{}),{statusCode:409});
 const first=beginSession(987654321),replacement=beginSession(987654321);let ready=false;first.ready.then(()=>{ready=true;});await Promise.resolve();assert(!ready);
 release();await mutation;await first.ready;assert(committed);assert(ready);await assert.rejects(withOfflineMutation(987654321,()=>{}),{statusCode:409});
 first.release();first.release();await assert.rejects(withOfflineMutation(987654321,()=>{}),{statusCode:409});replacement.release();
 await assert.rejects(withOfflineMutation(987654321,()=>{throw Error('rollback');}),/rollback/);assert.equal(await withOfflineMutation(987654321,()=>42),42);
});
