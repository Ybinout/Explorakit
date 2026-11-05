const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,teams,repo,codec,factory,TournamentController,twists,engine;
test.before(()=>{if(!enabled)return;if(process.env.DB_NAME!=='explorakit_test')throw Error('Dedicated test DB required');db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');repo=require('../server/persistence/superTournamentRepository');codec=require('../server/game/drift/checkpointCodec');factory=require('../server/game/drift/pokemonFactory');twists=require('../server/game/superTournament/twists');engine=require('../server/game/battle/battleEngine');({TournamentController}=require('../server/game/superTournament/controller'));});
test.after(async()=>db?.end());
async function fixture(key='pact_cold_blood'){
 const u=await users.createUserWithStarter('tower_twist_'+randomUUID(),randomUUID(),{starterId:7}),original=codec.encode(await teams.loadEquipe(u.id));
 const create=()=>new TournamentController({userId:u.id,random:()=>.99,getPlayer:()=>({id:'owner',username:u.username}),emit:()=>{},travel:async()=>{}}),c=create();await c.load();await c.register({pokemons:[9,94].map(id=>factory.create(id,120,true))});
 await c.atomic(()=>{c.run.phase='reward';c.run.room=0;c.run.cleared=1;c.run.reward={id:randomUUID(),afterRoom:1,cards:[key,'heal_10','cure','pp_3']};});
 return{u,c,create,original,data:{offerId:c.run.reward.id,cardKey:key},remove:()=>db.execute('DELETE FROM users WHERE id=?',[u.id])};
}
test('SQL reroll spends one token durably, replaces all four cards, rejects replay and never changes Adventure or wallet',{skip:!enabled},async()=>{
 const f=await fixture();try{const old=f.c.run.reward,party=codec.encode(f.c.run.player.equipe);await f.c.rerollReward(f.data);const saved=await repo.load(f.u.id);assert.notEqual(saved.run.reward.id,old.id);assert(saved.run.reward.cards.every(k=>!old.cards.includes(k)));assert.equal(saved.run.rerolls.remaining,1);assert.equal(saved.run.rerolls.spent,1);assert.deepEqual(codec.encode(saved.run.player.equipe),party);
  const resumed=f.create();await resumed.load();assert.deepEqual(resumed.run.reward,saved.run.reward);await assert.rejects(()=>resumed.claimReward(f.data));await resumed.rerollReward({offerId:resumed.run.reward.id});assert.equal(resumed.run.rerolls.remaining,0);await assert.rejects(()=>resumed.rerollReward({offerId:resumed.run.reward.id}));assert.deepEqual(codec.encode(await teams.loadEquipe(f.u.id)),f.original);assert.equal(Number((await db.execute('SELECT money FROM users WHERE id=?',[f.u.id]))[0][0].money),0);
 }finally{await f.remove();}
});
test('SQL two stale rerolls spend exactly once and a failed checkpoint preserves the token and old offer',{skip:!enabled},async()=>{
 const f=await fixture(),acquire=db.getConnection.bind(db);try{
  let injected=false;db.getConnection=async()=>{const c=await acquire(),execute=c.execute.bind(c),release=c.release.bind(c);c.execute=async(sql,...args)=>{if(!injected&&sql.startsWith('UPDATE super_tournament_profiles')){injected=true;throw Error('injected reroll failure');}return execute(sql,...args);};c.release=()=>{c.execute=execute;c.release=release;release();};return c;};
  await assert.rejects(()=>f.c.rerollReward(f.data),/injected/);db.getConnection=acquire;assert(injected);assert.equal(f.c.run.rerolls.remaining,2);assert.equal((await repo.load(f.u.id)).run.reward.id,f.data.offerId);
  const a=f.create(),b=f.create();await a.load();await b.load();const results=await Promise.allSettled([a.rerollReward(f.data),b.rerollReward(f.data)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await repo.load(f.u.id)).run.rerolls.spent,1);
 }finally{db.getConnection=acquire;await f.remove();}
});
test('SQL a cycle credits one carryable reroll and heals once, even with stale contenders and reconnects',{skip:!enabled},async()=>{
 const f=await fixture();try{await f.c.atomic(()=>{f.c.run.phase='cleared';f.c.run.reward=null;f.c.run.room=15;f.c.run.cleared=16;f.c.run.player.equipe.pokemons[0].currentHp=1;});const a=f.create(),b=f.create();await a.load();await b.load();await a.next();await assert.rejects(()=>b.next());let saved=(await repo.load(f.u.id)).run;assert.equal(saved.rerolls.remaining,4);assert.equal(saved.rerolls.grantedThroughCycle,2);assert.equal(saved.player.equipe.pokemons[0].currentHp,saved.player.equipe.pokemons[0].maxHp);
  const resumed=f.create();await resumed.load();assert.equal(await resumed.next(),false);assert.equal(resumed.run.rerolls.remaining,4);
 }finally{await f.remove();}
});
test('SQL a bargain is owner-scoped, unique and persistent in real battle snapshots, then disappears on exit',{skip:!enabled},async()=>{
 const f=await fixture();try{const before=codec.encode(f.c.run.player.equipe);await f.c.claimReward({...f.data,effects:{critical:100,speed:100}});assert.deepEqual(codec.encode(f.c.run.player.equipe),before);assert.equal(twists.active(f.c.run.player)[0].key,'pact_cold_blood');const c=f.create();await c.load();await c.next();await c.atomic(()=>c.startBattle());const p=c.run.battle.active(0),fx=require('../server/game/drift/driftEffects');assert.equal(fx.criticalStage(p),1);assert.equal(fx.speed(p),.9);
  const restored=f.create();await restored.load();const live=restored.run.battle.active(0),plain=structuredClone(live);assert(engine.getBattleSpeed(live)<engine.getBattleSpeed(plain));assert.equal(fx.criticalStage(live),1);await restored.abandon();assert.deepEqual(codec.encode(await teams.loadEquipe(f.u.id)),f.original);await restored.register(await teams.loadEquipe(f.u.id));assert.deepEqual(twists.active(restored.run.player),[]);
 }finally{await f.remove();}
});
for(const count of[1,2])test(`SQL ${count}-opponent card is consumed once, credits only present KOs and keeps the next team complete`,{skip:!enabled},async()=>{
 const f=await fixture(count===1?'next_opponent_one':'next_opponent_two');try{await f.c.claimReward(f.data);const c=f.create();await c.load();await c.next();await c.atomic(()=>c.startBattle());assert.equal(c.run.battle.b.equipe.pokemons.length,count);const restored=f.create();await restored.load();assert.equal(restored.run.battle.b.equipe.pokemons.length,count);assert.equal(twists.pending(restored.run.player),null);
  await restored.atomic(()=>{const b=restored.run.battle;for(const p of b.b.equipe.pokemons)p.currentHp=0;b.prune();b.checkEnd();restored.reconcile();});assert.equal(restored.run.score,count*100);assert.equal(restored.run.cash.last.amount,6103);await restored.claimReward({offerId:restored.run.reward.id,skip:true});await restored.next();await restored.atomic(()=>restored.startBattle());assert.equal(restored.run.battle.b.equipe.pokemons.length,3);assert.deepEqual(codec.encode(await teams.loadEquipe(f.u.id)),f.original);
 }finally{await f.remove();}
});
test('SQL legacy attempt gains only its current-cycle token without resetting progress or old earnings',{skip:!enabled},async()=>{
 const f=await fixture();try{await f.c.atomic(()=>{delete f.c.run.rerolls;f.c.run.room=79;f.c.run.cleared=80;f.c.run.score=24000;f.c.run.cash.earned=12345;});const c=f.create();await c.load();assert.equal(c.run.rerolls.remaining,2);assert.equal(c.run.rerolls.grantedThroughCycle,5);assert.equal(c.run.score,24000);assert.equal(c.run.cash.earned,12345);const version=c.version;await c.load();assert.equal(c.version,version);
 }finally{await f.remove();}
});
test('SQL critical bargains combine and an old dual-pact save resumes with both benefits without resetting the attempt',{skip:!enabled},async()=>{
 const f=await fixture('pact_hunter');try{
  await f.c.claimReward(f.data);await f.c.atomic(()=>{const r=f.c.run;r.phase='reward';r.reward={id:randomUUID(),afterRoom:1,cards:['pact_cold_blood','heal_10','cure','pp_3']};});
  await f.c.claimReward({offerId:f.c.run.reward.id,cardKey:'pact_cold_blood'});assert.equal(twists.criticalStage(f.c.run.player),2);
  await f.c.atomic(()=>{const r=f.c.run;r.player.superTournamentPacts=['pact_hunter','pact_cold_blood'];r.phase='cleared';r.reward=null;r.score=300;});
  const c=f.create();await c.load();await c.next();await c.atomic(()=>c.startBattle());const restored=f.create();await restored.load();const fx=require('../server/game/drift/driftEffects'),p=restored.run.battle.active(0);
  assert.equal(fx.criticalStage(p),2);assert.equal(fx.speed(p),.9);assert.equal(restored.run.score,300);assert.equal(restored.run.room,1);assert.deepEqual(restored.run.player.superTournamentPacts,['pact_hunter','pact_cold_blood']);assert.deepEqual(codec.encode(await teams.loadEquipe(f.u.id)),f.original);
 }finally{await f.remove();}
});
test('SQL repeated pact choices stack on fresh offers; replay, stale controllers and failed third activation cannot duplicate a stack',{skip:!enabled},async()=>{
 const f=await fixture('pact_fairy');try{
  await f.c.claimReward(f.data);await assert.rejects(()=>f.c.claimReward(f.data));
  await f.c.atomic(()=>{f.c.run.phase='reward';f.c.run.reward={id:randomUUID(),afterRoom:2,cards:['pact_fairy','heal_10','pp_3','cure']};});const second={offerId:f.c.run.reward.id,cardKey:'pact_fairy'},a=f.create(),b=f.create();await a.load();await b.load();const result=await Promise.allSettled([a.claimReward(second),b.claimReward(second)]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  const restored=f.create();await restored.load();assert.equal(twists.count(restored.run.player,'pact_fairy'),2);assert.equal(restored.run.player.superTournamentPacts.length,1);assert.equal(twists.active(restored.run.player)[0].stacks,2);assert.equal(restored.run.score,0);assert.equal(restored.run.cash.earned,0);assert.deepEqual(codec.encode(await teams.loadEquipe(f.u.id)),f.original);
  await restored.atomic(()=>{restored.run.phase='reward';restored.run.reward={id:randomUUID(),afterRoom:3,cards:['pact_fairy','heal_10','pp_3','cure']};});const before=codec.encode(restored.run),acquire=db.getConnection.bind(db);let fired=false;
  db.getConnection=async()=>{const c=await acquire(),execute=c.execute.bind(c),release=c.release.bind(c);c.execute=async(sql,...args)=>{if(!fired&&sql.startsWith('UPDATE super_tournament_profiles')){fired=true;throw Error('injected_stack_save_failure');}return execute(sql,...args);};c.release=()=>{c.execute=execute;c.release=release;release();};return c;};
  try{await assert.rejects(()=>restored.claimReward({offerId:restored.run.reward.id,cardKey:'pact_fairy'}),/injected_stack/);}finally{db.getConnection=acquire;}assert.deepEqual(codec.encode(restored.run),before);assert.equal(twists.count((await repo.load(f.u.id)).run.player,'pact_fairy'),2);
 }finally{await f.remove();}
});
