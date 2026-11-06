const test=require('node:test'),assert=require('node:assert/strict'),codec=require('../server/game/drift/checkpointCodec');
const {TournamentController}=require('../server/game/superTournament/controller');
const factory=require('../server/game/drift/pokemonFactory');
function fixture(){let v=0,snapshot,fail=false;const moves=[],events=[],real={userId:42,username:'Pause',id:'pause',equipe:{pokemons:[factory.create(9,80,true),factory.create(94,80,true)]}};
 const persist={async load(){return{version:v,run:snapshot?codec.decode(snapshot):null};},async save(id,run,version,options){assert.equal(version,v);if(fail){fail=false;throw Error('write failure');}snapshot=run?codec.encode(run):null;moves.push(options);return ++v;},async assertOwnership(id,ids){assert.equal(id,42);assert.deepEqual(ids,real.equipe.pokemons.map(p=>p.uuid));}};
 const create=()=>new TournamentController({userId:42,persist,getPlayer:()=>real,emit:(e,d)=>events.push([e,d]),travel:async dest=>moves.push(dest),now:()=>100000});
 return{c:create(),create,real,moves,events,fail(){fail=true;}};
}
test('pause durably seals exact HP/PP/held effects/reward/rerolls then reconnect resumes without healing or payout',async()=>{
 const f=fixture(),c=f.c;await c.register(f.real.equipe);await c.next();c.run.player.equipe.pokemons[0].currentHp=17;c.run.player.equipe.pokemons[0].movePp[0]=1;c.run.player.equipe.pokemons[0].heldItem=null;c.run.player.equipe.pokemons[0].__battle={arbitrary:3};c.run.phase='reward';c.run.score=2200;c.run.room=13;c.run.rerolls.remaining=7;c.run.reward={id:'saved-offer',cards:[],afterRoom:14};await c.atomic(()=>true);
 const old=codec.decode(codec.encode(c.run));await c.pause();assert(!c.active);assert(c.run.paused);assert.equal(f.real.superTournamentActive,false);assert.equal(f.moves.at(-1).map,'super_tournament_lobby');assert(f.moves.some(m=>m.relocate?.map==='super_tournament_lobby'));
 await assert.rejects(c.register(f.real.equipe),/déjà/);assert.equal(await c.next(),false);await assert.rejects(c.reorderTeam({orderedUuids:[]}),/combat/);
 f.real.equipe.pokemons[0].currentHp=999;const restored=f.create();await restored.load();assert(restored.run.paused);await restored.resume();assert(!restored.active);await restored.continueRun();assert(restored.active);assert.equal(f.moves.at(-1).map,'super_tournament_room');
 const p=restored.run.player.equipe.pokemons[0];assert.equal(p.currentHp,17);assert.equal(p.movePp[0],1);assert.equal(p.heldItem,null);assert.deepEqual(p.__battle,old.player.equipe.pokemons[0].__battle);assert.equal(restored.run.score,2200);assert.equal(restored.run.rerolls.remaining,7);assert.equal(restored.run.reward.id,'saved-offer');
});
test('pause refused during combat and storage failure restores active run with no travel; paused abandon preserves adventure combat flag',async()=>{
 const f=fixture();await f.c.register(f.real.equipe);f.c.run.battle={};await assert.rejects(f.c.pause(),/entre deux/);f.c.run.battle=null;f.fail();const count=f.moves.length;await assert.rejects(f.c.pause(),/write failure/);assert(f.c.active);assert.equal(f.moves.length,count);await f.c.pause();f.real.inbattle=true;f.c.publish();assert.equal(f.real.inbattle,true);
});
test('resume refuses a changed registered owner before unsealing; a normal pause save carries no XP or reward claim',async()=>{
 const f=fixture();await f.c.register(f.real.equipe);await f.c.pause();const saved=f.moves.findLast(m=>m.relocate);assert(!saved.experienceClaim&&!saved.rewardClaim&&!saved.payout);f.c.persist.assertOwnership=async()=>{throw Error('missing owner');};await assert.rejects(f.c.continueRun(),/missing owner/);assert(f.c.run.paused);assert(!f.c.active);
});
