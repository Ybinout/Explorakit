const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,repo,codec,factory,TournamentController;
test.before(()=>{if(!enabled)return;if(process.env.DB_NAME!=='explorakit_test')throw Error('Dedicated test database required');db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');repo=require('../server/persistence/superTournamentRepository');codec=require('../server/game/drift/checkpointCodec');factory=require('../server/game/drift/pokemonFactory');({TournamentController}=require('../server/game/superTournament/controller'));});
test.after(async()=>{await db?.end();});
async function fixture(key,room=1){const u=await users.createUserWithStarter('taug_'+randomUUID(),'test-password',{starterId:7}),events=[];
 const create=()=>new TournamentController({userId:u.id,random:()=>.99,getPlayer:()=>({id:'owner',username:u.username}),emit:(e,d)=>events.push([e,d]),travel:async()=>{}});
 const c=create();await c.load();await c.register({pokemons:[factory.create(9,120,true),factory.create(94,120,true)]});
 await c.atomic(()=>{c.run.phase='reward';c.run.room=room-1;c.run.cleared=room;c.run.reward={id:randomUUID(),afterRoom:room,cards:[key,'heal_10','cure']};});
 const data={offerId:c.run.reward.id,cardKey:key};return {u,c,create,events,data,party:codec.encode(c.run.player.equipe),async balance(){const [[r]]=await db.execute('SELECT money FROM users WHERE id=?',[u.id]);return Number(r.money);},async stock(k){const [[r]]=await db.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?',[u.id,k]);return Number(r?.quantity)||0;},cleanup:()=>db.execute('DELETE FROM users WHERE id=?',[u.id])};
}
test('SQL money cards use the authoritative cycle price, update the purse and total, and survive abandon',{skip:!enabled},async()=>{
 for(const [key,amount]of [['prize_money_10k',3180],['prize_money_25k',15896],['prize_money_50k',31790]]){const f=await fixture(key,17);try{
  await f.c.claimReward({...f.data,amount:9999999,quantity:99});assert.equal(await f.balance(),amount);assert.equal(f.c.run.cash.earned,amount);assert.equal(f.c.run.cash.paidThrough,0);assert.equal(f.c.run.phase,'cleared');assert.deepEqual(codec.encode(f.c.run.player.equipe),f.party);
  assert.equal(f.events.findLast(([e])=>e==='superTournamentPayout')[1].balance,amount);const resumed=f.create();await resumed.load();assert.equal(await f.balance(),amount);await resumed.abandon();assert.equal(await f.balance(),amount);assert.equal((await repo.load(f.u.id)).run,null);
 }finally{await f.cleanup();}}
});
test('SQL both candies enter only the owner Adventure bag, with no healing or XP inside the run',{skip:!enabled},async()=>{
 for(const [key,item]of [['prize_super_candy','rare_candy'],['prize_mega_candy','mega_candy']]){const f=await fixture(key);try{
  const before=await f.stock(item);await f.c.claimReward({...f.data,itemKey:'masterball',quantity:99});assert.equal(await f.stock(item),before+1);assert.equal(await f.stock('masterball'),0);assert.equal(await f.balance(),0);assert.deepEqual(codec.encode(f.c.run.player.equipe),f.party);
  assert(f.events.findLast(([e])=>e==='bagUpdated')[1].items.some(i=>i.key===item&&i.quantity===before+1));assert.equal(f.c.run.lastAugment.quantity,1);
  const resumed=f.create();await resumed.load();assert.equal(await f.stock(item),before+1);await assert.rejects(()=>resumed.claimReward(f.data));await resumed.abandon();assert.equal(await f.stock(item),before+1);
 }finally{await f.cleanup();}}
});
for(const [key,kind]of [['prize_money_10k','money'],['prize_mega_candy','item']]){
 test(`SQL two stale controllers can collect the ${kind} augmentation only once`,{skip:!enabled},async()=>{const f=await fixture(key);try{
  const a=f.create(),b=f.create();await a.load();await b.load();const result=await Promise.allSettled([a.claimReward(f.data),b.claimReward(f.data)]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.filter(r=>r.status==='rejected').length,1);
  assert.equal(await f.balance(),kind==='money'?1590:0);assert.equal(await f.stock('mega_candy'),kind==='item'?1:0);assert.equal(f.events.filter(([e])=>e==='superTournamentRewardApplied').length,1);
 }finally{await f.cleanup();}});
 test(`SQL failed ${kind} grant rolls back the offer and emits no reward; retry succeeds`,{skip:!enabled},async()=>{const f=await fixture(key),getConnection=db.getConnection;let injected=false;try{
  db.getConnection=async function(){const c=await getConnection.call(db),execute=c.execute,release=c.release;c.execute=async function(sql,...args){if(!injected&&sql.startsWith(kind==='money'?'UPDATE users SET money=money+':'INSERT INTO user_items')){injected=true;throw Error('injected grant failure');}return execute.call(this,sql,...args);};c.release=function(){c.execute=execute;c.release=release;return release.call(this);};return c;};
  await assert.rejects(()=>f.c.claimReward(f.data),/injected grant failure/);db.getConnection=getConnection;assert(injected);assert.equal(await f.balance(),0);assert.equal(await f.stock('mega_candy'),0);assert.equal(f.c.run.phase,'reward');assert(!f.c.run.lastAugment);assert.equal((await repo.load(f.u.id)).run.reward.id,f.data.offerId);assert(!f.events.some(([e])=>['superTournamentRewardApplied','superTournamentPayout','bagUpdated'].includes(e)));
  await f.c.claimReward(f.data);assert.equal(await f.balance(),kind==='money'?1590:0);assert.equal(await f.stock('mega_candy'),kind==='item'?1:0);
 }finally{db.getConnection=getConnection;await f.cleanup();}});
}
test('SQL a foreign offer is refused, concurrent wallet credits add, and purse/stock caps do not strand a run',{skip:!enabled},async()=>{
 const f=await fixture('prize_money_10k');try{await assert.rejects(()=>f.c.claimReward({...f.data,offerId:'foreign'}));assert.equal(await f.balance(),0);await Promise.all([f.c.claimReward(f.data),users.awardUserMoney(f.u.id,500)]);assert.equal(await f.balance(),2090);}finally{await f.cleanup();}
 for(const key of ['prize_money_10k','prize_mega_candy']){const x=await fixture(key);try{
  if(key==='prize_money_10k')await db.execute('UPDATE users SET money=? WHERE id=?',[Number.MAX_SAFE_INTEGER-500,x.u.id]);else await db.execute("INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,'mega_candy',2147483647)",[x.u.id]);
  await x.c.claimReward(x.data);assert.equal(x.c.run.phase,'cleared');assert.equal(x.c.run.lastAugment.limited,true);
  if(key==='prize_money_10k'){assert.equal(await x.balance(),Number.MAX_SAFE_INTEGER);assert.equal(x.c.run.cash.earned,500);assert.equal(x.c.run.lastAugment.amount,500);}else{assert.equal(await x.stock('mega_candy'),2147483647);assert.equal(x.c.run.lastAugment.quantity,0);}
 }finally{await x.cleanup();}}
});
test('SQL room prize, augmentation and following room stay separate across a reconnect',{skip:!enabled},async()=>{
 for(const key of ['prize_money_10k','prize_mega_candy']){const f=await fixture(key);try{
  await f.c.atomic(()=>{f.c.run.phase='sas';f.c.run.room=0;f.c.run.cleared=0;f.c.run.reward=null;});
  const win=async()=>{await f.c.next();await f.c.atomic(()=>f.c.startBattle());await f.c.atomic(()=>{const b=f.c.run.battle;for(const p of b.b.equipe.pokemons)p.currentHp=0;b.prune();b.checkEnd();f.c.reconcile();});};
  await win();assert.equal(await f.balance(),6103);await f.c.atomic(()=>{f.c.run.reward.cards=[key,'heal_10','cure'];});await f.c.claimReward({offerId:f.c.run.reward.id,cardKey:key});
  await win();assert.equal(await f.balance(),key==='prize_money_10k'?13796:12206);assert.equal(f.c.run.cash.earned,await f.balance());assert.equal(f.c.run.cash.paidThrough,2);assert.equal(await f.stock('mega_candy'),key==='prize_mega_candy'?1:0);
  const resumed=f.create();await resumed.load();assert.equal(resumed.run.lastAugment.offerId,f.c.run.lastAugment.offerId);assert.equal(await f.balance(),key==='prize_money_10k'?13796:12206);
 }finally{await f.cleanup();}}
});
