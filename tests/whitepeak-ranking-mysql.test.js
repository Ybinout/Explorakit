const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,base,house,ranking,users,teams,factory;
test.before(async()=>{if(!enabled)return;assert.equal(process.env.DB_NAME,'explorakit_test');db=require('../server/config/database').dbPool;base=require('../server/persistence/whitepeakRepository');house=require('../server/persistence/whitepeakHouseRepository');ranking=require('../server/persistence/whitepeakRankingRepository');users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');factory=require('../server/game/drift/pokemonFactory');await ranking.initialize();});
test.after(async()=>{await db?.end();});
async function fixture(){const ids=[];for(let i=0;i<4;i++){const u=await users.createUserWithStarter('Honor_'+randomUUID(),randomUUID());ids.push(u.id);await teams.editEquipe(u.id,{pokemons:[9,94,212,248,445,121].map(id=>factory.create(id,60,true))});await db.execute('UPDATE users SET money=100000 WHERE id=?',[u.id]);}
 return{ids,async legacy(){const pair=ids.slice(0,2),config={money:0},state=await base.inspectDuel(pair,[null,null],config),id=randomUUID(),result=await base.startDuel({id,ids:pair,uuids:[null,null],config,digest:state.digest});return{id,result};},async advanced(mode='2v1',format=6){const active=mode==='2v1'?ids.slice(0,3):ids,sides=mode==='2v1'?[[ids[0]],ids.slice(1,3)]:[ids.slice(0,2),ids.slice(2)],config=require('../server/game/whitepeak/rules').settings({mode,format,money:1000}),state=await house.inspect(active,sides,config),selections=sides.map(side=>side.flatMap(ownerId=>state.snapshots.find(s=>s.userId===ownerId).team.slice(0,side.length===1||format===12?6:3).map(p=>({ownerId,uuid:p.uuid})))),id=randomUUID();return{id,result:await house.start({id,ids:active,sides,config,digest:state.digest,selections})};},async close(){for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);ranking.invalidate();}};
}
test('SQL mode scores preserve 1v1 and award both allies independently; last team retains its starting order', {skip:!enabled},async()=>{
 const f=await fixture();try{const one=await f.legacy();one.result.teams[0].reverse();await base.finishDuel(one.id,f.ids[0]);
  const classic=await ranking.page({mode:'1v1',userId:f.ids[0]});assert.equal(classic.own.wins,1);assert.deepEqual(classic.own.team,[9,94,212,248,445,121]);
  const duo=await f.advanced();await base.finishDuel(duo.id,f.ids[1]);
  for(const id of f.ids.slice(1,3)){const r=await ranking.page({mode:'2v1',userId:id});assert.equal(r.own.wins,1);assert.equal(r.own.points,30);assert.equal(r.own.winrate,100);assert.deepEqual(r.own.team,[9,94,212,9,94,212]);}
  assert.equal((await ranking.page({mode:'1v1',userId:f.ids[0]})).own.points,30);assert.equal((await ranking.page({mode:'2v1',userId:f.ids[0]})).own.losses,1);
  await base.finishDuel(duo.id,f.ids[1]);assert.equal((await ranking.page({mode:'2v1',userId:f.ids[1]})).own.wins,1);
 }finally{await f.close();}
});
test('SQL 12v12 stores the full common party for all four participants; cancellation leaves their previous records intact', {skip:!enabled},async()=>{
 const f=await fixture();try{const duel=await f.advanced('2v2',12);await base.finishDuel(duel.id,f.ids[0]);for(const id of f.ids){const r=(await ranking.page({mode:'2v2',userId:id})).own;assert.equal(r.team.length,12);assert.equal(r.format,12);assert.equal(r.wins,f.ids.indexOf(id)<2?1:0);}
  const cancelled=await f.advanced('2v2');await base.finishDuel(cancelled.id,null,'server_restart');assert.equal((await ranking.page({mode:'2v2',userId:f.ids[0]})).own.team.length,12);
 }finally{await f.close();}
});
test('SQL ranking failure rolls back the result, payments and both score stores', {skip:!enabled},async()=>{
 const f=await fixture(),get=db.getConnection;try{const duel=await f.advanced();db.getConnection=async function(){const c=await get.call(db),execute=c.execute,release=c.release;c.execute=async function(sql,...args){if(sql.startsWith('INSERT INTO whitepeak_mode_scores'))throw Error('injected ranking failure');return execute.call(this,sql,...args);};c.release=function(){c.execute=execute;c.release=release;return release.call(this);};return c;};
  await assert.rejects(()=>base.finishDuel(duel.id,f.ids[1]),/injected/);db.getConnection=get;
  assert.equal((await ranking.page({mode:'2v1',userId:f.ids[1]})).own,null);const[[row]]=await db.execute('SELECT phase FROM whitepeak_duels WHERE id=?',[duel.id]);assert.equal(row.phase,'active');
  await base.finishDuel(duel.id,f.ids[1]);assert.equal((await ranking.page({mode:'2v1',userId:f.ids[1]})).own.wins,1);
 }finally{db.getConnection=get;await f.close();}
});
test('SQL pagination and literal search retain global rank and reject invalid modes', {skip:!enabled},async()=>{
 const f=await fixture();try{const d=await f.legacy();await base.finishDuel(d.id,f.ids[0]);const[[u]]=await db.execute('SELECT username FROM users WHERE id=?',[f.ids[0]]),all=await ranking.page({mode:'1v1',userId:f.ids[0]}),search=await ranking.page({mode:'1v1',search:u.username,page:99});assert.equal(search.rows.length,1);assert.equal(search.rows[0].rank,all.own.rank);assert.equal(search.page,1);assert.equal((await ranking.page({search:'%_'})).rows.length,0);for(let i=0;i<21;i++){const u=await users.createUserWithStarter('Page_'+randomUUID(),randomUUID());f.ids.push(u.id);await db.execute("INSERT INTO whitepeak_mode_scores(mode,user_id,wins,points) VALUES('1v1',?,1,30)",[u.id]);}const second=await ranking.page({mode:'1v1',page:2});assert.equal(second.page,2);assert(second.rows.length>=3);assert(second.rows.every(r=>r.rank>20));await assert.rejects(()=>ranking.page({mode:'pve'}));
 }finally{await f.close();}
});
