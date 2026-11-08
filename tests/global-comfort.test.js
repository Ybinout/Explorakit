const test=require('node:test'),assert=require('node:assert/strict'),factory=require('../server/game/drift/pokemonFactory'),training=require('../server/game/items/automaticTraining'),{medicineBatch}=require('../server/game/items/medicineEffects');
const mon=()=>{const p=factory.create(9,50,true);p.iv={hp:20,attack:26,defense:27,specialAttack:28,specialDefense:29,speed:30};p.recalculateStats();p.currentHp-=9;return p;};
function goal(p,stat='attack',target=31){return training.normalize({kind:'iv',pokemonUuid:p.uuid,stat,target});}
for(const stat of training.STATS)test('automatic IV target '+stat+' uses its own reagent, stops at the first exact roll and leaves every other stat intact',()=>{
 const p=mon(),before=JSON.stringify(p),g=goal(p,stat,31);let n=0;const r=training.batch(p,g,100,{random:()=>++n<3?.25:.999});
 assert.equal(r.consumed,3);assert.equal(r.after,31);assert(r.reached);assert.equal(r.remaining,97);assert.equal(JSON.stringify(p),before);assert.equal(r.result.iv[stat],31);
 for(const k of training.STATS.filter(k=>k!==stat))assert.equal(r.result.iv[k],p.iv[k]);assert.equal(r.result.maxHp-r.result.currentHp,9);assert(r.result.currentAttack>0);
});
test('automatic goals are strict; callers cannot select arbitrary items, abilities, invented stats or fractional targets',()=>{
 const p=mon();for(const patch of [{kind:'ability',target:'Huge Power'},{stat:'k'},{target:32},{target:NaN},{target:30.5},{pokemonUuid:''},{kind:'nature',target:'NatureBidon'}])assert.throws(()=>training.normalize({...goal(p),...patch}));
 assert.equal(training.normalize({...goal(p),itemKey:'supreme_candy'}).itemKey,'iv_randomizer_attack');assert.equal(require('../server/game/models/Pokemon').natureNames.length,25);
});
test('automatic batches never consume more than five, preserve the last (even lower) roll and stop with empty stock or an already satisfied goal',()=>{
 const p=mon(),g=goal(p);let draws=0;
 let r=training.batch(p,g,3,{random:()=>{draws++;return 0;}});assert.equal(r.consumed,3);assert.equal(r.after,0);assert(!r.reached);assert.equal(draws,3);
 r=training.batch(p,g,100,{random:()=>0});assert.equal(r.consumed,5);
 assert.equal(training.batch(p,g,0).consumed,0);assert.equal(training.batch(p,goal(p,'attack',26),3).consumed,0);
 assert.throws(()=>training.batch(p,g,1,{limit:6}));assert.throws(()=>training.batch({...p,currentHp:0},g,2));assert.throws(()=>training.batch({...p,isEgg:true},g,2));
 const confirmation=require('../server/game/items/ivRerollConfirmation');assert.throws(()=>confirmation.requireIvRerollConfirmation(p,g.itemKey),/Confirme/,'manual high-IV safeguard stays in place');
});
test('automatic IV can target zero or a lower exact IV and does not stop at a higher roll',()=>{
 const p=mon();let r=training.batch(p,goal(p,'attack',0),3,{random:()=>0});assert.equal(r.consumed,1);assert.equal(r.after,0);assert(r.reached);
 const rolls=[31,20];r=training.batch(p,goal(p,'attack',20),3,{random:()=>(rolls.shift()+.5)/32});assert.equal(r.consumed,2);assert.equal(r.after,20);assert(r.reached);
});
test('automatic Nature rolls use all twenty-five natural outcomes, stop exactly and do not consume when already correct',()=>{
 const Pokemon=require('../server/game/models/Pokemon');for(const [index,target]of Pokemon.natureNames.entries()){
  const p=mon();p.nature=Pokemon.natureNames[(index+1)%25];const g=training.normalize({kind:'nature',pokemonUuid:p.uuid,target}),r=training.batch(p,g,10,{random:()=>(index+.5)/25});assert.equal(r.consumed,1);assert.equal(r.after,target);assert(r.reached);assert.equal(r.result.nature,target);
  p.nature=target;assert.equal(training.batch(p,g,10).consumed,0);
 }
});
for(const [key,cap]of [['rare_candy',100],['mega_candy',150],['supreme_candy',200]])test(key+' batches respect level cap and stock; training, wounds, moves and deferred evolution use the canonical level-up path',()=>{
 const p=factory.create(9,cap-3,true);p.currentHp-=10;p.status='poison';p.movePp[0]=1;const before=JSON.stringify(p),r=medicineBatch(p,key,200,1000);
 assert.equal(r.consumed,3);assert.equal(r.level,cap);assert.equal(r.experience,p.getNextLevelExpForLevel(cap));assert.equal(r.maxHp-r.currentHp,10);assert.equal(r.status,'poison');assert.deepEqual(r.movePp,p.movePp);assert.equal(r.trainingChange.before,cap-3);assert.equal(r.trainingChange.after,cap);assert.equal(JSON.stringify(p),before);
 const q=factory.create(4,15,true),batch=medicineBatch(q,key,5,2);assert.equal(batch.consumed,2);assert.equal(batch.level,17);assert.equal(batch.evolutionState.pending.targetId,5);assert(batch.pendingMoves.length>=q.pendingMoves.length);assert.throws(()=>medicineBatch({...q,evolutionState:{pending:{id:'existing'}}},key,5,2),/évolution/);
});
test('raid XP is exactly level times five hundred per registered participant, including protected KO/withdrawn, but excludes reserves and permanent losses',()=>{
 const xp=require('../server/game/raids/experience'),team=[mon(),mon(),mon(),mon(),mon()];team[1].currentHp=0;team[1].__darkSurvivalSettled=true;team[3].__darkContinentDead=true;
 const run={combat:{boss:{level:100},models:team.slice(0,4).map(p=>({ownerId:7,pokemon:p}))}},member={id:7,team:{pokemons:team}},before=team.map(p=>p.experience),awards=xp.award(run,member);
 assert.deepEqual(awards.map(p=>p.uuid),team.slice(0,3).map(p=>p.uuid));for(let i=0;i<3;i++)assert.equal(team[i].experience-before[i],50000);assert.equal(team[1].currentHp,0);assert.equal(team[3].experience,before[3]);assert.equal(team[4].experience,before[4]);assert.equal(xp.award(run,{id:8,team:member.team}).length,0);
 for(const level of [100,125,175,200,300])assert.equal(xp.amount({level}),level*1000/2);
});
test('public patch history starts now, hides internal entries, deduplicates latest version and orders newest first',()=>{
 const{history}=require('../server/game/world/patchHistory');const first={version:'first',date:'2026-11-08',fr:{title:'First'}},newer={version:'newer',date:'2026-11-09'},duplicate={...first,fr:{title:'Corrected'}};
 assert.deepEqual(history({since:'2026-11-08',patches:[first,{version:'secret',date:'2026-11-10',internal:true},{version:'old',date:'2026-11-07'}],current:newer}).map(p=>p.version),['newer','first']);assert.equal(history({patches:[first],current:duplicate})[0].fr.title,'Corrected');assert.equal(history()[0].version,require('../data/game/latest_patch.json').version);assert.deepEqual(new Set(history().map(p=>p.version)),new Set(require('../data/game/patch_history.json').patches.map(p=>p.version)));
});
test('automatic jobs serialize one account, accept duplicate request IDs once, and cancellation stops after the already committing batch',async()=>{
 const {EventEmitter}=require('node:events'),{registerAutomaticTrainingHandlers}=require('../server/realtime/handlers/automaticTrainingHandlers');const socket=new EventEmitter();socket.connected=true;const p=mon(),player={equipe:{pokemons:[p]}},states=[];let calls=0,release;
 socket.on('training:autoState',s=>states.push(structuredClone(s)));
 registerAutomaticTrainingHandlers({socket,userId:1,getPlayer:()=>player,loadItems:async()=>[],pause:async()=>{},repository:{async step(){calls++;await new Promise(r=>release=r);return {pokemon:p,before:26,after:0,consumed:5,remaining:95,reached:false};}}});
 const request=(event,data)=>new Promise(r=>socket.emit(event,data,r)),id='request-0001',payload={id,kind:'iv',pokemonUuid:p.uuid,stat:'attack',target:31};
 assert((await request('training:autoStart',payload)).success);assert(player.inventoryBusy);assert.equal(calls,1);assert((await request('training:autoStart',payload)).success);assert.equal(calls,1);assert(!(await request('training:autoStart',{...payload,id:'request-0002'})).success);
 await request('training:autoCancel',{id});release();for(let i=0;i<20&&player.inventoryBusy;i++)await new Promise(r=>setImmediate(r));assert(!player.inventoryBusy);assert.equal(calls,1);assert.equal(states.at(-1).phase,'cancelled');assert.equal(states.at(-1).used,5);
 assert((await request('training:autoStart',payload)).success);assert.equal(calls,1,'retrying the same finished request never consumes twice');
});
test('automatic jobs stop on disconnect and never change inventory/party when a SQL batch fails',async()=>{
 const {EventEmitter}=require('node:events'),{registerAutomaticTrainingHandlers}=require('../server/realtime/handlers/automaticTrainingHandlers');for(const mode of ['disconnect','rollback']){
  const socket=new EventEmitter();socket.connected=true;const p=mon(),before=JSON.stringify(p),player={equipe:{pokemons:[p]}},states=[];let calls=0,release;
  socket.on('training:autoState',s=>states.push(s));registerAutomaticTrainingHandlers({socket,userId:1,getPlayer:()=>player,loadItems:async()=>[],pause:async()=>{},repository:{async step(){calls++;await new Promise(r=>release=r);if(mode==='rollback')throw Error('transaction rejected');return{pokemon:p,before:26,after:26,consumed:1,remaining:10,reached:false};}}});
  await new Promise(r=>socket.emit('training:autoStart',{id:'request-'+mode,kind:'iv',pokemonUuid:p.uuid,stat:'attack',target:31},r));if(mode==='disconnect'){socket.connected=false;socket.emit('disconnect');}release();for(let i=0;i<20&&player.inventoryBusy;i++)await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.equal(states.at(-1).phase,mode==='disconnect'?'cancelled':'error');assert.equal(JSON.stringify(p),before);assert(!player.inventoryBusy);
 }
});
for(const mode of ['rift','colosseum'])test(mode+' automatic training uses only expedition inventory, validates goal and keeps checkpoint-compatible results',()=>{
 const economy=require('../server/game/drift/economy'),codec=require('../server/game/drift/checkpointCodec'),p={alive:true,run:{mode,phase:'exploration'},equipe:{pokemons:[mon(),mon()]},items:{iv_randomizer_attack:3,nature_capsule:2},drifts:[],equipped:[]};const reserve=JSON.stringify(p.equipe.pokemons[1]);
 const first=economy.automaticTraining(p,{kind:'iv',pokemonUuid:p.equipe.pokemons[0].uuid,stat:'attack',target:31},{random:()=>0});assert.equal(first.consumed,3);assert.equal(first.current,0);assert.equal(first.remaining,0);assert.equal(p.items.iv_randomizer_attack,0);assert.equal(JSON.stringify(p.equipe.pokemons[1]),reserve);const restored=codec.decode(codec.encode(p));assert.equal(restored.equipe.pokemons[0].iv.attack,0);assert.equal(restored.items.iv_randomizer_attack,0);
 const nature=require('../server/game/models/Pokemon').natureNames[0];const r=economy.automaticTraining(p,{kind:'nature',pokemonUuid:p.equipe.pokemons[0].uuid,target:nature},{random:()=>0});assert(r.reached);assert.equal(p.equipe.pokemons[0].nature,nature);p.inbattle=true;assert.throws(()=>economy.automaticTraining(p,{kind:'iv',pokemonUuid:p.equipe.pokemons[0].uuid,stat:'attack',target:31}),/indisponible/);
});
