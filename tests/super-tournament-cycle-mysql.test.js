const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,teams,repo,factory,codec,TournamentController;
test.before(()=>{if(!enabled)return;if(process.env.DB_NAME!=='explorakit_test')throw Error('Dedicated test database required');
 db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');repo=require('../server/persistence/superTournamentRepository');factory=require('../server/game/drift/pokemonFactory');codec=require('../server/game/drift/checkpointCodec');({TournamentController}=require('../server/game/superTournament/controller'));
});
test.after(async()=>db?.end());
async function fixture(){const u=await users.createUserWithStarter('cycle_'+randomUUID(),'Cycle-rules-test-2026',{starterId:7}),events=[];
 const create=()=>new TournamentController({userId:u.id,getPlayer:()=>({id:'owner',username:u.username}),emit:(e,p)=>events.push([e,p]),travel:async()=>{}});
 return{u,create,events,remove:()=>db.execute('DELETE FROM users WHERE id=?',[u.id])};
}
test('SQL registration rejects both clauses without writing a checkpoint or changing Adventure resources',{skip:!enabled},async()=>{
 const f=await fixture();try{
  const c=f.create();await c.load();const original=codec.encode(await teams.loadEquipe(f.u.id));
  await assert.rejects(()=>c.register({pokemons:[factory.create(9,50,true),factory.create(9,100,true)]}),/chaque espèce/);
  const party=[factory.create(9,50,true),factory.create(94,100,true)];party.forEach(p=>p.heldItem='leftovers');
  await assert.rejects(()=>c.register({pokemons:party}),/chaque objet tenu/);
  const stored=await repo.load(f.u.id);assert.equal(stored.run,null);assert.equal(stored.version,0);assert.deepEqual(codec.encode(await teams.loadEquipe(f.u.id)),original);
 }finally{await f.remove();}
});
test('SQL cycle recovery commits once; stale contenders fail, reconnection does not repeat the heal, Adventure stays untouched',{skip:!enabled},async()=>{
 const f=await fixture();try{
  const original=codec.encode(await teams.loadEquipe(f.u.id)),c=f.create();await c.load();await c.register({pokemons:[9,94,212].map(id=>factory.create(id,100,true))});
  await c.atomic(()=>{const r=c.run;r.room=15;r.cleared=16;r.score=4800;r.phase='cleared';for(const p of r.player.equipe.pokemons){p.currentHp=0;p.status='poison';p.movePp=p.abilities.map(()=>0);}});
  const a=f.create(),b=f.create();await a.load();await b.load();await a.next();await assert.rejects(()=>b.next(),/tentative a changé/);
  const stored=(await repo.load(f.u.id)).run;assert.equal(stored.room,16);assert.equal(stored.phase,'ready');assert.equal(stored.cycleRecovery.cycle,2);
  for(const p of stored.player.equipe.pokemons){assert.equal(p.currentHp,p.maxHp);assert.equal(p.status,'normal');assert.deepEqual(p.movePp,p.abilities.map(require('../server/game/battle/battleResources').getMaxMovePp));}
  await b.load();assert.equal(await b.next(),false);await a.atomic(()=>{a.run.player.equipe.pokemons[0].currentHp=1;});
  const resumed=f.create();await resumed.load();assert.equal(await resumed.next(),false);assert.equal(resumed.run.player.equipe.pokemons[0].currentHp,1);
  assert.equal(f.events.filter(([e])=>e==='progressionNotice').length,1);assert.deepEqual(codec.encode(await teams.loadEquipe(f.u.id)),original);
 }finally{await f.remove();}
});
