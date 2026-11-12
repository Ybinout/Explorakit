const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,repo,base,users,teams,pc,factory;
test.before(()=>{if(!enabled)return;assert.equal(process.env.DB_NAME,'explorakit_test');db=require('../server/config/database').dbPool;repo=require('../server/persistence/whitepeakHouseRepository');base=require('../server/persistence/whitepeakRepository');users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');pc=require('../server/persistence/pokemonStorageRepository');factory=require('../server/game/drift/pokemonFactory');});
test.after(async()=>{await db?.end();});
async function fixture(mode='2v1',format=6,withCorruption=false){
 const ids=[],parties=[],extra=[];const count=mode==='pve'?1:mode==='2v1'?3:4;
 for(let n=0;n<count;n++){
  const u=await users.createUserWithStarter('house_'+randomUUID(),randomUUID());ids.push(u.id);
  const team={pokemons:[503,94,212,248,445,121].map((id,i)=>{const p=factory.create(id,31+i,true);p.shiny=i===0;p.heldItem=null;p.abilities=['Splash'];return p;})};
  const corrupt=p=>require('../server/game/corruption/pokemon').install(p,require('../server/game/corruption/modules').get('cmod_defense_ice'),{expectedRevision:0});
  if(withCorruption)corrupt(team.pokemons[0]);
  await teams.editEquipe(u.id,team);parties.push(team.pokemons.map(pc.encodePokemon));
  const p=factory.create(570,47,true);p.shiny=true;if(withCorruption)corrupt(p);await pc.storeCapturedPokemon(u.id,p);extra.push(p);
  await db.execute('UPDATE users SET money=100000 WHERE id=?',[u.id]);
 }
 const sides=mode==='pve'?[[ids[0]]]:mode==='2v1'?[[ids[0]],ids.slice(1)]:[ids.slice(0,2),ids.slice(2)];
 const config=require('../server/game/whitepeak/rules').settings({mode,format,level:50,money:mode==='pve'?0:1001,...(mode==='pve'?{trainerKey:'champion_wanda'}:{})});
 const state=await repo.inspect(ids,sides,config),selections=sides.map(side=>side.flatMap(ownerId=>{const s=state.snapshots.find(s=>s.userId===ownerId);return s.team.slice(0,side.length===1||format===12?6:3).map(p=>({ownerId,uuid:p.uuid}));}));
 const id=randomUUID();return {ids,parties,extra,sides,config,state,selections,id,start:()=>repo.start({id,ids,sides,config,selections,digest:state.digest}),async money(){const result=[];for(const id of ids){const[[r]]=await db.execute('SELECT money FROM users WHERE id=?',[id]);result.push(Number(r.money));}return result;},async unchanged(){for(const[i,id]of ids.entries())assert.deepEqual((await teams.loadEquipe(id)).pokemons.map(pc.encodePokemon),parties[i]);},async cleanup(){for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);}};
}
test('SQL 2v1 escrow uses equal stakes per camp, splits winnings and records both allies once', {skip:!enabled}, async()=>{
 const f=await fixture();try{await f.start();assert.deepEqual(await f.money(),[98999,99499,99500]);
  const result=await base.finishDuel(f.id,f.ids[1],'finished');assert.deepEqual(result.winners,f.ids.slice(1));assert.deepEqual(await f.money(),[98999,100500,100501]);
  await Promise.all([base.finishDuel(f.id,f.ids[1]),base.finishDuel(f.id,f.ids[0])]);assert.deepEqual(await f.money(),[98999,100500,100501]);
  const ranking=await base.leaderboard({mode:f.config.mode==='pve'?'1v1':f.config.mode});assert.equal(ranking.find(r=>r.id===f.ids[0]).losses,1);for(const id of f.ids.slice(1)){assert.equal(ranking.find(r=>r.id===id).wins,1);assert.equal(ranking.find(r=>r.id===id).points,30);}await f.unchanged();
 }finally{await f.cleanup();}
});
test('SQL 12v12 selects six per owner and permits an owned PC Pokemon without changing its storage slot', {skip:!enabled}, async()=>{
 const f=await fixture('2v2',12);try{
  f.selections[0][0]={ownerId:f.ids[0],uuid:f.extra[0].uuid};
  const started=await f.start();assert.deepEqual(started.teams.map(t=>t.length),[12,12]);assert.equal(started.teams[0][0].uuid,f.extra[0].uuid);assert.equal(started.teams[0][0].data.id,570);assert(started.teams[0][0].shiny);
  assert.deepEqual(await f.money(),[99499,99500,99499,99500]);await base.finishDuel(f.id,f.ids[0],'finished');
  assert.deepEqual(await f.money(),[100500,100501,99499,99500]);assert.equal((await pc.loadEntries(f.ids[0]))[0].pokemon.uuid,f.extra[0].uuid);await f.unchanged();
 }finally{await f.cleanup();}
});
test('SQL foreign Pokemon, duplicate refs, uneven contributions and held-item duplicates cannot debit money', {skip:!enabled}, async()=>{
 const f=await fixture();try{
  const original=f.selections[1].map(p=>({...p}));f.selections[1][0]={...f.selections[0][0]};await assert.rejects(()=>f.start(),/Propriétaire/);
  f.selections[1]=original.map(p=>({...p}));f.selections[1][1]={...f.selections[1][0]};await assert.rejects(()=>f.start(),/double/);
  f.selections[1]=f.state.snapshots[1].team.map(p=>({ownerId:f.ids[1],uuid:p.uuid}));await assert.rejects(()=>f.start(),/Chaque allié/);
  assert.deepEqual(await f.money(),[100000,100000,100000]);
 }finally{await f.cleanup();}
});
test('SQL stale team or PC snapshot and insufficient teammate funds roll the start back', {skip:!enabled}, async()=>{
 const f=await fixture();try{
  await db.execute('UPDATE users SET money=0 WHERE id=?',[f.ids[2]]);await assert.rejects(()=>f.start(),/disposer/);assert.deepEqual(await f.money(),[100000,100000,0]);
  await db.execute('UPDATE users SET money=100000 WHERE id=?',[f.ids[2]]);
  const team=await teams.loadEquipe(f.ids[0]);team.pokemons[0].heldItem='leftovers';await teams.editEquipe(f.ids[0],team);
  await assert.rejects(()=>f.start(),/changé/);assert.deepEqual(await f.money(),[100000,100000,100000]);
  const[[r]]=await db.execute('SELECT COUNT(*) n FROM whitepeak_duels WHERE id=?',[f.id]);assert.equal(Number(r.n),0);
 }finally{await f.cleanup();}
});
test('SQL failed settlement rolls back every payment and score; the same receipt can be retried', {skip:!enabled}, async()=>{
 const f=await fixture('2v2',6),get=db.getConnection;let injected=false;try{
  await f.start();db.getConnection=async function(){const c=await get.call(db),execute=c.execute,release=c.release;c.execute=async function(sql,...args){const result=await execute.call(this,sql,...args);if(!injected&&sql.startsWith('UPDATE whitepeak_duels SET phase=')){injected=true;throw Error('injected result rollback');}return result;};c.release=function(){c.execute=execute;c.release=release;return release.call(this);};return c;};
  await assert.rejects(()=>base.finishDuel(f.id,f.ids[0]),/injected/);db.getConnection=get;assert.deepEqual(await f.money(),[99499,99500,99499,99500]);
  const[rows]=await db.execute('SELECT user_id FROM whitepeak_duel_scores WHERE user_id IN (?,?,?,?)',f.ids);assert.equal(rows.length,0);
  await base.finishDuel(f.id,f.ids[0]);assert.deepEqual(await f.money(),[100500,100501,99499,99500]);
 }finally{db.getConnection=get;await f.cleanup();}
});
test('SQL server restart refunds all four participants exactly once and never changes Adventure progression', {skip:!enabled}, async()=>{
 const f=await fixture('2v2',12);try{await f.start();await base.recoverDuels();assert.deepEqual(await f.money(),[100000,100000,100000,100000]);await base.recoverDuels();assert.deepEqual(await f.money(),[100000,100000,100000,100000]);await f.unchanged();}finally{await f.cleanup();}
});
test('SQL PvE records no cash reward, ladder win, XP or EV and returns the owned party unchanged', {skip:!enabled}, async()=>{
 const f=await fixture('pve');try{const started=await f.start();assert.equal(started.teams[0].length,6);await base.finishDuel(f.id,f.ids[0]);await f.unchanged();assert.deepEqual(await f.money(),[100000]);assert(!(await base.leaderboard({mode:f.config.mode==='pve'?'1v1':f.config.mode})).some(r=>r.id===f.ids[0]));}finally{await f.cleanup();}
});
test('SQL 2v1 refuses two corrupted allies before debiting and accepts one per camp', {skip:!enabled},async()=>{
 const f=await fixture('2v1',6,true);try{
  await assert.rejects(()=>f.start(),/Un seul/);assert.deepEqual(await f.money(),[100000,100000,100000]);
  const owner=f.state.snapshots[2];f.selections[1]=f.selections[1].map(ref=>ref.uuid===owner.team[0].uuid?{ownerId:owner.userId,uuid:owner.team[3].uuid}:ref);
  const started=await f.start();assert.deepEqual(started.teams.map(team=>team.filter(p=>p.corruption?.permanent).length),[1,1]);
  await base.finishDuel(f.id,null,'interrupted');await f.unchanged();
 }finally{await f.cleanup();}
});
for(const format of [6,12])test(`SQL 2v2 ${format}v${format} accepts two corrupted Pokemon per camp and rejects a third from PC without a debit`, {skip:!enabled},async()=>{
 const f=await fixture('2v2',format,true);try{
  const original={...f.selections[0][1]};f.selections[0][1]={ownerId:f.ids[0],uuid:f.extra[0].uuid};
  await assert.rejects(()=>f.start(),/Deux/);assert.deepEqual(await f.money(),[100000,100000,100000,100000]);
  const[[row]]=await db.execute('SELECT COUNT(*) n FROM whitepeak_duels WHERE id=?',[f.id]);assert.equal(Number(row.n),0);
  f.selections[0][1]=original;const started=await f.start();assert.deepEqual(started.teams.map(team=>team.filter(p=>p.corruption?.permanent).length),[2,2]);
  await base.finishDuel(f.id,null,'interrupted');await f.unchanged();assert.deepEqual(await f.money(),[100000,100000,100000,100000]);
 }finally{await f.cleanup();}
});

test('SQL legendary cap is per selected combined camp; disabling it accepts both allies and preserves the default checkbox rule',{skip:!enabled},async()=>{
 const f=await fixture('2v1');try{
 for(const[index,id]of f.ids.slice(1).entries()){const team=await teams.loadEquipe(id);const p=factory.create(index?151:150,100,true);p.heldItem=null;team.pokemons[0]=p;await teams.editEquipe(id,team);}
 f.state=await repo.inspect(f.ids,f.sides,f.config);f.selections=f.sides.map(side=>side.flatMap(ownerId=>f.state.snapshots.find(s=>s.userId===ownerId).team.slice(0,side.length===1?6:3).map(p=>({ownerId,uuid:p.uuid}))));
 const start=()=>repo.start({id:f.id,ids:f.ids,sides:f.sides,config:f.config,selections:f.selections,digest:f.state.digest});await assert.rejects(start(),/Un seul Pokémon légendaire ou fabuleux/);assert.deepEqual(await f.money(),[100000,100000,100000]);
 f.config.legendaryLimit=false;f.state=await repo.inspect(f.ids,f.sides,f.config);const started=await start();assert.equal(started.teams[1].filter(p=>factory.legendary.has(p.data.id)).length,2);await base.finishDuel(f.id,null,'interrupted');assert.deepEqual(await f.money(),[100000,100000,100000]);
 }finally{await f.cleanup();}
});
