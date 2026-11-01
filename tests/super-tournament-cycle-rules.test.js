const test=require('node:test'),assert=require('node:assert/strict');
const {TournamentController}=require('../server/game/superTournament/controller');
const factory=require('../server/game/drift/pokemonFactory'),codec=require('../server/game/drift/checkpointCodec');
const {getMaxMovePp}=require('../server/game/battle/battleResources');
function party(){return {pokemons:[9,94,212].map((id,i)=>{const p=factory.create(id,100,true);p.heldItem=['leftovers','life_orb',null][i];p.abilities=['Tackle','Protect'];p.movePp=[2,0];return p;})};}
function fixture(){let snapshot=null,version=0,fail=false,saves=0;const events=[];
 const persist={load:async()=>({run:snapshot?codec.decode(snapshot):null,version}),save:async(_id,run,v)=>{assert.equal(v,version);if(fail){fail=false;throw Error('disk');}saves++;snapshot=run?codec.encode(run):null;return ++version;}};
 const create=()=>new TournamentController({userId:1,persist,getPlayer:()=>({id:'test',username:'Test'}),emit:(e,p)=>events.push([e,p]),travel:async()=>{}});
 return{c:create(),create,events,saves:()=>saves,fail:()=>{fail=true;}};
}
function injure(team){for(const [i,p]of team.pokemons.entries()){p.currentHp=i===0?0:1;p.status='poison';p.movePp=[0,0];p.riftFainted=i===0;p.__battle={statStages:{attack:4},sleepTurns:2};}team.pokemons[1].heldItem=null;}
function healthy(team){for(const p of team.pokemons){assert.equal(p.currentHp,p.maxHp);assert.equal(p.status,'normal');assert.deepEqual(p.movePp,p.abilities.map(getMaxMovePp));assert(!p.riftFainted);assert(!p.__battle);}}
const identity=team=>team.pokemons.map(p=>({uuid:p.uuid,id:p.data.id,experience:p.experience,iv:p.iv,ev:p.ev,level:p.level,k:p.k,abilities:p.abilities,heldItem:p.heldItem}));
test('registration rejects duplicate species despite different UUIDs, K or held objects, without writes or healing',async()=>{
 const f=fixture(),team=party();team.pokemons[1]=factory.create(9,50,true);team.pokemons[0].currentHp=1;
 const before=codec.encode(team);assert.notEqual(team.pokemons[0].uuid,team.pokemons[1].uuid);
 await assert.rejects(()=>f.c.register(team),/chaque espèce/);assert.equal(f.saves(),0);assert.equal(f.c.active,false);assert.deepEqual(codec.encode(team),before);
});
test('registration rejects a repeated held item but permits several empty item slots',async()=>{
 const f=fixture(),team=party();team.pokemons[1].heldItem='leftovers';const before=codec.encode(team);
 await assert.rejects(()=>f.c.register(team),/chaque objet tenu/);assert.equal(f.saves(),0);assert.deepEqual(codec.encode(team),before);
 team.pokemons.forEach(p=>p.heldItem=null);await f.c.register(team);assert(f.c.active);healthy(f.c.run.player.equipe);
});
test('a different species in the same evolution line is allowed; eggs, empty parties and missing species stay invalid',async()=>{
 const f=fixture(),team=party();team.pokemons[1]=factory.create(7,20,true);await f.c.register(team);
 for(const party of [{pokemons:[]},{pokemons:[{data:{id:7},isEgg:true}]},{pokemons:[{uuid:'unknown'}]}])await assert.rejects(()=>fixture().c.register(party));
});
for(const room of[16,32,48,160])test(`entry into room ${room+1} fully restores KO/HP/status/PP once, preserving progression, order and remaining items`,async()=>{
 const f=fixture(),original=party(),originalBytes=codec.encode(original);await f.c.register(original);
 await f.c.atomic(()=>{const r=f.c.run;injure(r.player.equipe);r.room=room-1;r.cleared=room;r.score=room*300;r.phase='cleared';});
 const before=identity(f.c.run.player.equipe);await f.c.next();healthy(f.c.run.player.equipe);assert.deepEqual(identity(f.c.run.player.equipe),before);
 assert.deepEqual(f.c.run.cycleRecovery,{cycle:room/16+1,room:room+1});assert.equal(f.c.run.phase,'ready');assert.equal(f.c.run.score,room*300);
 assert.deepEqual(codec.encode(original),originalBytes);assert.equal(await f.c.next(),false);
 const restored=f.create();await restored.load();healthy(restored.run.player.equipe);
 await restored.atomic(()=>injure(restored.run.player.equipe));assert.equal(await restored.next(),false);
 const again=f.create();await again.load();assert.equal(again.run.player.equipe.pokemons[0].currentHp,0);
 assert.equal(f.events.filter(([e])=>e==='progressionNotice').length,1);
});
test('ordinary room transitions keep injuries, KO, statuses and spent PP',async()=>{
 for(const room of[0,1,14,16,17,30]){const f=fixture();await f.c.register(party());await f.c.atomic(()=>{injure(f.c.run.player.equipe);f.c.run.room=room;f.c.run.phase='cleared';});
  const before=codec.encode(f.c.run.player.equipe);await f.c.next();assert.deepEqual(codec.encode(f.c.run.player.equipe),before);assert.equal(f.events.filter(([e])=>e==='progressionNotice').length,0);
 }
});
test('a failed cycle checkpoint rolls back the heal and notice; retry commits exactly once',async()=>{
 const f=fixture();await f.c.register(party());await f.c.atomic(()=>{const r=f.c.run;injure(r.player.equipe);r.room=15;r.cleared=16;r.phase='cleared';});
 const before=codec.encode(f.c.run);f.fail();await assert.rejects(()=>f.c.next(),/disk/);assert.deepEqual(codec.encode(f.c.run),before);assert.equal(f.events.filter(([e])=>e==='progressionNotice').length,0);
 await f.c.next();healthy(f.c.run.player.equipe);assert.equal(f.events.filter(([e])=>e==='progressionNotice').length,1);
});
test('existing sealed attempts can resume without being invalidated by the new registration clauses',async()=>{
 const f=fixture();await f.c.register(party());await f.c.atomic(()=>{const r=f.c.run;injure(r.player.equipe);r.player.equipe.pokemons[1].heldItem='leftovers';r.room=15;r.cleared=16;r.phase='cleared';});
 const before=codec.encode(f.c.run);const restored=f.create();await restored.load();assert.deepEqual(codec.encode(restored.run),before);await restored.next();healthy(restored.run.player.equipe);
});
