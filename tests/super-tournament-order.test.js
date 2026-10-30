const test=require('node:test'),assert=require('node:assert/strict');
const {TournamentController}=require('../server/game/superTournament/controller');
const factory=require('../server/game/drift/pokemonFactory'),codec=require('../server/game/drift/checkpointCodec');
function setup(){let snapshot=null,version=0,fail=false;const events=[];
 const persist={async load(){return {version,run:snapshot?codec.decode(snapshot):null};},async save(_id,run,v){assert.equal(v,version);if(fail){fail=false;throw Error('disk');}snapshot=run?codec.encode(run):null;return ++version;}};
 const create=()=>new TournamentController({userId:1,persist,getPlayer:()=>({id:'socket',username:'tester'}),emit:(e,d)=>events.push([e,d]),travel:async()=>{}});
 return {c:create(),create,events,fail(){fail=true;},version:()=>version};
}
const team=()=>({pokemons:[9,94,212,248,445,121].map(id=>{const p=factory.create(id,100,true);p.abilities=['Tackle','Protect'];p.movePp=[3,0];p.heldItem='leftovers';return p;})});
const bank=party=>Object.fromEntries(party.map(p=>[p.uuid,JSON.parse(JSON.stringify(p))]));
for(const phase of ['sas','ready','reward','cleared'])test(`${phase}: reorder is durable and preserves every fighter, injuries and the Adventure team`,async()=>{
 const f=setup(),original=team(),before=codec.encode(original);await f.c.register(original);
 await f.c.atomic(()=>{const r=f.c.run;r.phase=phase;r.score=200;r.player.equipe.pokemons[0].currentHp=12;r.player.equipe.pokemons[0].status='poison';r.player.equipe.pokemons[1].currentHp=0;r.player.equipe.pokemons[2].movePp=[1,0];});
 const previous=f.c.run.player.equipe.pokemons,contents=bank(previous),ids=previous.map(p=>p.uuid).reverse();
 await f.c.execute(()=>f.c.reorderTeam({orderedUuids:ids}));assert.deepEqual(f.c.run.player.equipe.pokemons.map(p=>p.uuid),ids);assert.deepEqual(bank(f.c.run.player.equipe.pokemons),contents);assert.equal(f.c.run.phase,phase);assert.equal(f.c.run.score,200);assert.deepEqual(codec.encode(original),before);
 const resumed=f.create();await resumed.load();assert.deepEqual(resumed.run.player.equipe.pokemons.map(p=>p.uuid),ids);assert.deepEqual(bank(resumed.run.player.equipe.pokemons),contents);
 assert.deepEqual(f.events.filter(([e])=>e==='superTournamentState').at(-1)[1].team.map(p=>p.uuid),ids);
});
test('duplicate, foreign, missing, incomplete and oversized rosters are rejected without a save',async()=>{
 const f=setup();await f.c.register(team());const ids=f.c.run.player.equipe.pokemons.map(p=>p.uuid),before=codec.encode(f.c.run),version=f.version();
 for(const orderedUuids of [undefined,null,[],ids.slice(1),[...ids,ids[0]],[...ids.slice(0,-1),ids[0]],[...ids.slice(0,-1),'foreign'],[...ids.slice(0,-1),1]])await assert.rejects(()=>f.c.reorderTeam({orderedUuids}),/invalide/);
 assert.equal(f.version(),version);assert.deepEqual(codec.encode(f.c.run),before);
});
test('failed save restores the old order and all resources, then a retry can succeed',async()=>{
 const f=setup();await f.c.register(team());const before=codec.encode(f.c.run),ids=f.c.run.player.equipe.pokemons.map(p=>p.uuid).reverse();f.fail();await assert.rejects(()=>f.c.reorderTeam({orderedUuids:ids}),/disk/);assert.deepEqual(codec.encode(f.c.run),before);assert.deepEqual(f.events.at(-1)[1].team.map(p=>p.uuid),codec.decode(before).player.equipe.pokemons.map(p=>p.uuid));await f.c.reorderTeam({orderedUuids:ids});
});
test('the next battle uses the chosen lead and the order remains after victory and entry into the next room',async()=>{
 const f=setup(),c=f.c;await c.register(team());const ids=c.run.player.equipe.pokemons.map(p=>p.uuid).reverse();await c.reorderTeam({orderedUuids:ids});await c.next();await c.atomic(()=>c.startBattle());assert.equal(c.run.battle.active(0).uuid,ids[0]);await assert.rejects(()=>c.reorderTeam({orderedUuids:ids.slice().reverse()}),/combat/);
 await c.atomic(()=>{const b=c.run.battle;for(const p of b.b.equipe.pokemons)p.currentHp=0;b.prune();b.checkEnd();c.reconcile();});assert.equal(c.run.phase,'reward');assert.deepEqual(c.run.player.equipe.pokemons.map(p=>p.uuid),ids);
 const next=ids.slice();[next[0],next[1]]=[next[1],next[0]];await c.reorderTeam({orderedUuids:next});await c.claimReward({offerId:c.run.reward.id,skip:true});await c.next();assert.equal(c.run.room,1);assert.deepEqual(c.run.player.equipe.pokemons.map(p=>p.uuid),next);
});
