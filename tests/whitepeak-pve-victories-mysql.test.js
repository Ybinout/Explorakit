const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,base,house,teams;
test.before(()=>{if(!enabled)return;assert.equal(process.env.DB_NAME,'explorakit_test');db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');base=require('../server/persistence/whitepeakRepository');house=require('../server/persistence/whitepeakHouseRepository');teams=require('../server/persistence/teamRepository');});
test.after(async()=>{await db?.end();});
test('PvE completion reads committed historical wins, independently per player and trainer, without writing progression',{skip:!enabled},async()=>{
 const ids=[];try{
  for(let i=0;i<2;i++)ids.push((await users.createUserWithStarter('Victory_'+randomUUID().slice(0,10),randomUUID())).id);
  const original=await Promise.all(ids.map(id=>teams.loadEquipe(id)));
  async function result(owner,trainerKey,winnerId,reason='finished',mode='pve'){
   const config=require('../server/game/whitepeak/rules').settings({mode,trainerKey,money:0,level:50}),participants=mode==='pve'?[owner]:ids,sides=participants.map(id=>[id]);
   const state=await house.inspect(participants,sides,config),selections=sides.map(side=>state.snapshots.find(s=>s.userId===side[0]).team.map(p=>({ownerId:side[0],uuid:p.uuid}))),id=randomUUID();
   await house.start({id,ids:participants,sides,config,selections,digest:state.digest});
   await base.finishDuel(id,winnerId,reason);return id;
  }
  assert.deepEqual(await base.pveVictories(ids[0]),[]);
  const win=await result(ids[0],'dia1',ids[0]);
  await result(ids[0],'dia1',ids[0]); // Repeat victories count once.
  await result(ids[0],'champion_hoze',null); // NPC win.
  await result(ids[0],'champion_ana',null,'draw');
  await result(ids[0],'champion_wanda',null,'interrupted');
  await result(ids[0],'champion_raph',ids[0],'forfeit');
  await result(ids[1],'champion_hoze',ids[1]);
  await result(ids[0],'champion_hoze',ids[0],'finished','1v1'); // PvP cannot mark an NPC.
  assert.deepEqual(await base.pveVictories(ids[0]),['dia1']);
  assert.deepEqual(await base.pveVictories(ids[1]),['champion_hoze']);
  await base.finishDuel(win,ids[0]);assert.deepEqual(await base.pveVictories(ids[0]),['dia1']);
  await result(ids[0],'champion_hoze',ids[0]);assert.deepEqual(new Set(await base.pveVictories(ids[0])),new Set(['dia1','champion_hoze']));
  for(let i=0;i<ids.length;i++)assert.deepEqual(await teams.loadEquipe(ids[i]),original[i]);
 }finally{for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);}
});
test('victory history rejects invalid account identifiers instead of accepting a client filter',{skip:!enabled},async()=>{
 for(const id of [null,'1',-1,0,1.5,Number.MAX_SAFE_INTEGER+1])await assert.rejects(()=>base.pveVictories(id),/Dresseur invalide/);
});
