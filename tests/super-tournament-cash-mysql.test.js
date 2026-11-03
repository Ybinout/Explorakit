const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,repository,factory,TournamentController;
test.before(()=>{if(!enabled)return;if(process.env.DB_NAME!=='explorakit_test')throw Error('Dedicated test database required');db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');repository=require('../server/persistence/superTournamentRepository');factory=require('../server/game/drift/pokemonFactory');({TournamentController}=require('../server/game/superTournament/controller'));});
test.after(async()=>{await db?.end();});
async function fixture(){const u=await users.createUserWithStarter('tcash_'+randomUUID(),'test-password',{starterId:7});const events=[];const create=()=>new TournamentController({random:()=>.99,userId:u.id,getPlayer:()=>({id:'cash-owner-'+u.id,username:u.username}),emit:(e,d)=>events.push([e,d]),travel:async()=>{}});const c=create();await c.load();await c.register({pokemons:[factory.create(9,100,true)]});return {u,c,create,events,async balance(){const [[r]]=await db.execute('SELECT money FROM users WHERE id=?',[u.id]);return Number(r.money);},cleanup:()=>db.execute('DELETE FROM users WHERE id=?',[u.id])};}
async function start(c){await c.next();await c.atomic(()=>c.startBattle());}
async function win(c){await c.atomic(()=>{const b=c.run.battle;for(const p of b.b.equipe.pokemons)p.currentHp=0;b.prune();b.checkEnd();c.reconcile();});}
async function skip(c){await c.claimReward({offerId:c.run.reward.id,skip:true});}
test('SQL room payouts are atomic, durable on reconnect, preserved on abandon and cannot be replayed',{skip:!enabled},async()=>{const f=await fixture();try{
 await start(f.c);await win(f.c);assert.equal(await f.balance(),5086);const loaded=await repository.load(f.u.id);assert.equal(loaded.run.cash.earned,5086);
 await assert.rejects(()=>repository.save(f.u.id,loaded.run,loaded.version,{payout:{runId:loaded.run.id,room:1}}),/prime de salle/);assert.equal(await f.balance(),5086);
 const resumed=f.create();await resumed.load();assert.equal(await f.balance(),5086);await skip(resumed);await resumed.abandon();assert.equal(await f.balance(),5086);assert.equal((await repository.load(f.u.id)).run,null);
 assert.equal(f.events.findLast(([e])=>e==='superTournamentPayout')[1].balance,5086);
 }finally{await f.cleanup();}});
test('SQL two stale controllers cannot both collect the same win',{skip:!enabled},async()=>{const f=await fixture();try{
 await start(f.c);const a=f.create(),b=f.create();await a.load();await b.load();const results=await Promise.allSettled([win(a),win(b)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.equal(await f.balance(),5086);assert.equal((await repository.load(f.u.id)).run.cash.earned,5086);
 }finally{await f.cleanup();}});
test('SQL a wallet write failure rolls back checkpoint, score, payout and client notice together',{skip:!enabled},async()=>{const f=await fixture();const getConnection=db.getConnection;let injected=false;try{
 await start(f.c);db.getConnection=async function(){const c=await getConnection.call(db),execute=c.execute,release=c.release;c.execute=async function(sql,...args){if(!injected&&sql.startsWith('UPDATE users SET money=money+')){injected=true;throw Error('injected wallet failure');}return execute.call(this,sql,...args);};c.release=function(){c.execute=execute;c.release=release;return release.call(this);};return c;};
 await assert.rejects(()=>win(f.c),/injected wallet failure/);db.getConnection=getConnection;assert(injected);assert.equal(await f.balance(),0);assert.equal(f.c.run.phase,'battle');assert.equal(f.c.run.cash.earned,0);const saved=await repository.load(f.u.id);assert.equal(saved.run.phase,'battle');assert.equal(saved.run.score,0);assert.equal(saved.run.cash.earned,0);assert(!f.events.some(([e])=>e==='superTournamentPayout'));
 await win(f.c);assert.equal(await f.balance(),5086);
 }finally{db.getConnection=getConnection;await f.cleanup();}});
test('SQL room cash adds to simultaneous Adventure money instead of overwriting it',{skip:!enabled},async()=>{const f=await fixture();try{
 await start(f.c);await Promise.all([win(f.c),require('../server/persistence/userRepository').awardUserMoney(f.u.id,500)]);assert.equal(await f.balance(),5586);
 }finally{await f.cleanup();}});
test('SQL purse ceiling caps the real credit without blocking a win or minting unreceived earnings',{skip:!enabled},async()=>{const f=await fixture();try{
 const max=Number.MAX_SAFE_INTEGER;await db.execute('UPDATE users SET money=? WHERE id=?',[max-1000,f.u.id]);await start(f.c);await win(f.c);assert.equal(await f.balance(),max);assert.equal(f.c.run.cash.earned,1000);assert.equal(f.c.run.cash.last.amount,1000);assert.equal(f.c.run.cash.last.limited,true);
 await skip(f.c);await start(f.c);await win(f.c);assert.equal(await f.balance(),max);assert.equal(f.c.run.cash.earned,1000);assert.equal(f.c.run.cash.last.amount,0);assert.equal(f.c.run.cash.paidThrough,2);
 }finally{await f.cleanup();}});
test('SQL complete two cycles award the exact schedule, while XP and the sealed wallet stay untouched',{skip:!enabled,timeout:30000},async()=>{const f=await fixture();try{
 const xp=f.c.run.player.equipe.pokemons[0].experience;for(let i=0;i<32;i++){await start(f.c);await win(f.c);await skip(f.c);}assert.equal(await f.balance(),762960);assert.equal(f.c.run.cash.earned,762960);assert.equal(f.c.run.score,9600);assert.equal(f.c.run.player.money,0);assert.equal(f.c.run.player.equipe.pokemons[0].experience,xp);
 }finally{await f.cleanup();}});

test('SQL saved pre-nerf earnings and receipt stay unchanged; only the next victory uses the reduced tariff',{skip:!enabled},async()=>{const f=await fixture();try{
 Object.assign(f.c.run,{phase:'cleared',room:0,cleared:1,reward:null,cash:{version:1,paidThrough:1,earned:6400,last:{room:1,amount:6400}}});f.c.version=await repository.save(f.u.id,f.c.run,f.c.version);await db.execute('UPDATE users SET money=6400 WHERE id=?',[f.u.id]);
 const resumed=f.create();await resumed.load();assert.equal(resumed.run.cash.earned,6400);assert.equal(resumed.run.cash.last.amount,6400);assert.equal(await f.balance(),6400);
 await start(resumed);await win(resumed);assert.equal(resumed.run.cash.last.amount,5086);assert.equal(resumed.run.cash.earned,11486);assert.equal(await f.balance(),11486);assert.equal(resumed.run.cash.paidThrough,2);
 await f.create().load();assert.equal(await f.balance(),11486);
 }finally{await f.cleanup();}});
