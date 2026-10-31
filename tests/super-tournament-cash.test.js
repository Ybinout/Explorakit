const test=require('node:test'),assert=require('node:assert/strict');
const cash=require('../server/game/superTournament/cashPrizes'),content=require('../server/game/superTournament/content');
const {TournamentController}=require('../server/game/superTournament/controller'),codec=require('../server/game/drift/checkpointCodec'),factory=require('../server/game/drift/pokemonFactory');
function setup(){let snapshot=null,version=0,balance=100,fail=false;const events=[];
 const persist={async load(){return {run:snapshot?codec.decode(snapshot):null,version};},async save(id,run,v,options={}){assert.equal(id,1);assert.equal(v,version);if(fail){fail=false;throw Error('checkpoint');}if(options.payout){balance+=cash.quote(options.payout.room).total;options.payout.balance=balance;}snapshot=run?codec.encode(run):null;return ++version;}};
 const create=()=>new TournamentController({userId:1,getPlayer:()=>({id:'owner',username:'tester'}),emit:(e,d)=>events.push([e,d]),travel:async()=>{},persist});
 return {c:create(),create,events,get balance(){return balance;},fail(){fail=true;}};
}
const team=()=>({pokemons:[factory.create(9,100,true)]});
async function start(c){await c.next();await c.atomic(()=>c.startBattle());}
async function win(c){await c.atomic(()=>{const b=c.run.battle;for(const p of b.b.equipe.pokemons)p.currentHp=0;b.prune();b.checkEnd();c.reconcile();c.reconcile();});}
async function skip(c){await c.claimReward({offerId:c.run.reward.id,skip:true});}
test('four progressive room tiers, Lucie bonus, linear cycle bonus and capped multiplier',()=>{
 assert.equal(cash.ROOMS_PER_CYCLE,content.roster.length);
 for(const [room,total]of [[1,3000],[4,3000],[5,5000],[8,5000],[9,7500],[12,7500],[13,10000],[15,10000],[16,30000],[17,3750],[32,37500],[65,6000],[80,60000],[1000000,60000]])assert.equal(cash.quote(room).total,total);
 for(const room of [0,-1,1.5,NaN,Infinity])assert.throws(()=>cash.quote(room));
 for(const [cycle,total]of [[1,122000],[2,152500],[3,183000],[4,213500],[5,244000],[20,244000]])assert.equal(Array.from({length:16},(_,i)=>cash.quote((cycle-1)*16+i+1).total).reduce((a,b)=>a+b),total);
 assert.equal(cash.schedule().firstCycleTotal,122000);
});
test('partial KOs earn points only; the full-room victory credits cash once after persistence',async()=>{
 const f=setup(),c=f.c;await c.register(team());await start(c);await c.atomic(()=>{c.run.battle.b.equipe.pokemons[0].currentHp=0;c.run.battle.prune();c.reconcile();});assert.equal(c.run.score,100);assert.equal(f.balance,100);assert.equal(c.run.cash.earned,0);
 await win(c);assert.equal(f.balance,3100);assert.equal(c.run.cash.earned,3000);assert.equal(c.run.cash.paidThrough,1);assert.equal(f.events.filter(([e])=>e==='superTournamentPayout').length,1);assert.equal(f.events.findLast(([e])=>e==='endbattle')[1].summary.money,3000);
 await c.atomic(()=>c.reconcile());await skip(c);assert.equal(f.balance,3100);
 const resumed=f.create();await resumed.load();assert.equal(f.balance,3100);assert.equal(resumed.run.cash.earned,3000);
});
test('failed persistence rolls back the win and cash, with no payout event before retry',async()=>{
 const f=setup(),c=f.c;await c.register(team());await start(c);f.fail();await assert.rejects(()=>win(c),/checkpoint/);assert.equal(c.run.phase,'battle');assert.equal(c.run.cash.earned,0);assert.equal(f.balance,100);assert(!f.events.some(([e])=>e==='superTournamentPayout'));
 await win(c);assert.equal(f.balance,3100);assert.equal(c.run.cash.earned,3000);
});
test('two complete cycles keep cash, score and recovery cards distinct and grant no XP',async()=>{
 const f=setup(),c=f.c;await c.register(team());const xp=c.run.player.equipe.pokemons[0].experience;
 for(let i=0;i<32;i++){await start(c);await win(c);assert.equal(c.run.phase,'reward');await skip(c);}
 assert.equal(c.run.cash.earned,274500);assert.equal(f.balance,274600);assert.equal(c.run.score,9600);assert.equal(c.run.player.money,0);assert.equal(c.run.player.equipe.pokemons[0].experience,xp);
 await c.abandon();assert.equal(f.balance,274600);assert.equal(f.events.findLast(([e])=>e==='superTournamentFinished')[1].moneyEarned,274500);
});
test('losing the next room preserves earlier earnings and adds no new room prize',async()=>{
 const f=setup(),c=f.c;await c.register(team());await start(c);await win(c);await skip(c);await start(c);
 await c.atomic(()=>{const b=c.run.battle;for(const p of b.a.equipe.pokemons)p.currentHp=0;b.prune();b.checkEnd();c.reconcile();});assert.equal(c.run,null);assert.equal(f.balance,3100);assert.equal(f.events.filter(([e])=>e==='superTournamentPayout').length,1);
});
test('old attempts start cash at their current progress without paying previous victories',async()=>{
 const f=setup(),c=f.c;await c.register(team());await c.atomic(()=>{delete c.run.cash;c.run.room=4;c.run.cleared=5;c.run.phase='cleared';});
 const resumed=f.create();await resumed.load();assert.deepEqual(resumed.run.cash,{version:1,paidThrough:5,earned:0,last:null});assert.equal(f.balance,100);
 await start(resumed);await win(resumed);assert.equal(resumed.run.cash.last.room,6);assert.equal(resumed.run.cash.earned,5000);assert.equal(f.balance,5100);
});
