const test=require('node:test'),assert=require('node:assert/strict');
const cash=require('../server/game/superTournament/cashPrizes'),content=require('../server/game/superTournament/content');
const {TournamentController}=require('../server/game/superTournament/controller'),codec=require('../server/game/drift/checkpointCodec'),factory=require('../server/game/drift/pokemonFactory');
function setup(){let snapshot=null,version=0,balance=100,fail=false;const events=[];
 const persist={async load(){return {run:snapshot?codec.decode(snapshot):null,version};},async save(id,run,v,options={}){assert.equal(id,1);assert.equal(v,version);if(fail){fail=false;throw Error('checkpoint');}if(options.payout){balance+=cash.quote(options.payout.room).total;options.payout.balance=balance;}snapshot=run?codec.encode(run):null;return ++version;}};
 const create=()=>new TournamentController({random:()=>.99,userId:1,getPlayer:()=>({id:'owner',username:'tester'}),emit:(e,d)=>events.push([e,d]),travel:async()=>{},persist});
 return {c:create(),create,events,get balance(){return balance;},fail(){fail=true;},seed(run){snapshot=codec.encode(run);}};
}
const team=()=>({pokemons:[factory.create(9,100,true)]});
async function start(c){await c.next();await c.atomic(()=>c.startBattle());}
async function win(c){await c.atomic(()=>{const b=c.run.battle;for(const p of b.b.equipe.pokemons)p.currentHp=0;b.prune();b.checkEnd();c.reconcile();c.reconcile();});}
async function skip(c){await c.claimReward({offerId:c.run.reward.id,skip:true});}
test('four progressive room tiers, Lucie bonus, linear uncapped cycle scaling',()=>{
 assert.equal(cash.ROOMS_PER_CYCLE,content.roster.length);
 for(const [room,total]of [[1,5440],[4,5440],[5,10880],[8,10880],[9,16320],[12,16320],[13,21760],[15,21760],[16,76160],[17,10880],[32,152320],[65,27200],[80,380800],[1000000,4760000000]])assert.equal(cash.quote(room).total,total);
 for(const room of [0,-1,1.5,NaN,Infinity])assert.throws(()=>cash.quote(room));
 for(const [cycle,total]of [[1,272000],[2,544000],[3,816000],[4,1088000],[5,1360000],[20,5440000]])assert.equal(Array.from({length:16},(_,i)=>cash.quote((cycle-1)*16+i+1).total).reduce((a,b)=>a+b),total);
 assert.equal(cash.schedule().firstCycleTotal,272000);assert.equal(cash.schedule().cycleTotalIncrement,272000);assert.equal(cash.schedule().maxMultiplier,null);
});
test('partial KOs earn points only; the full-room victory credits cash once after persistence',async()=>{
 const f=setup(),c=f.c;await c.register(team());await start(c);await c.atomic(()=>{c.run.battle.b.equipe.pokemons[0].currentHp=0;c.run.battle.prune();c.reconcile();});assert.equal(c.run.score,100);assert.equal(f.balance,100);assert.equal(c.run.cash.earned,0);
 await win(c);assert.equal(f.balance,5540);assert.equal(c.run.cash.earned,5440);assert.equal(c.run.cash.paidThrough,1);assert.equal(f.events.filter(([e])=>e==='superTournamentPayout').length,1);assert.equal(f.events.findLast(([e])=>e==='endbattle')[1].summary.money,5440);
 await c.atomic(()=>c.reconcile());await skip(c);assert.equal(f.balance,5540);
 const resumed=f.create();await resumed.load();assert.equal(f.balance,5540);assert.equal(resumed.run.cash.earned,5440);
});
test('failed persistence rolls back the win and cash, with no payout event before retry',async()=>{
 const f=setup(),c=f.c;await c.register(team());await start(c);f.fail();await assert.rejects(()=>win(c),/checkpoint/);assert.equal(c.run.phase,'battle');assert.equal(c.run.cash.earned,0);assert.equal(f.balance,100);assert(!f.events.some(([e])=>e==='superTournamentPayout'));
 await win(c);assert.equal(f.balance,5540);assert.equal(c.run.cash.earned,5440);
});
test('two complete cycles keep cash, score and recovery cards distinct and grant no XP',async()=>{
 const f=setup(),c=f.c;await c.register(team());const xp=c.run.player.equipe.pokemons[0].experience;
 for(let i=0;i<32;i++){await start(c);await win(c);assert.equal(c.run.phase,'reward');await skip(c);}
 assert.equal(c.run.cash.earned,816000);assert.equal(f.balance,816100);assert.equal(c.run.score,9600);assert.equal(c.run.player.money,0);assert.equal(c.run.player.equipe.pokemons[0].experience,xp);
 await c.abandon();assert.equal(f.balance,816100);assert.equal(f.events.findLast(([e])=>e==='superTournamentFinished')[1].moneyEarned,816000);
});
test('losing the next room preserves earlier earnings and adds no new room prize',async()=>{
 const f=setup(),c=f.c;await c.register(team());await start(c);await win(c);await skip(c);await start(c);
 await c.atomic(()=>{const b=c.run.battle;for(const p of b.a.equipe.pokemons)p.currentHp=0;b.prune();b.checkEnd();c.reconcile();});assert.equal(c.run,null);assert.equal(f.balance,5540);assert.equal(f.events.filter(([e])=>e==='superTournamentPayout').length,1);
});
test('old attempts start cash at their current progress without paying previous victories',async()=>{
 const f=setup(),c=f.c;await c.register(team());await c.atomic(()=>{delete c.run.cash;c.run.room=4;c.run.cleared=5;c.run.phase='cleared';});
 const resumed=f.create();await resumed.load();assert.deepEqual(resumed.run.cash,{version:1,paidThrough:5,earned:0,last:null});assert.equal(f.balance,100);
 await start(resumed);await win(resumed);assert.equal(resumed.run.cash.last.room,6);assert.equal(resumed.run.cash.earned,10880);assert.equal(f.balance,10980);
});

test('a saved receipt from the previous tariff is kept while the next victory uses the new price',async()=>{
 const f=setup(),c=f.c;await c.register(team());const saved=codec.decode(codec.encode(c.run));saved.room=0;saved.cleared=1;saved.phase='cleared';saved.cash={version:1,paidThrough:1,earned:10000,last:{room:1,amount:10000}};f.seed(saved);
 const resumed=f.create();await resumed.load();assert.equal(resumed.run.cash.earned,10000);assert.equal(f.balance,100);
 await start(resumed);await win(resumed);assert.equal(resumed.run.cash.earned,15440);assert.equal(resumed.run.cash.last.amount,5440);assert.equal(f.balance,5540);
});
