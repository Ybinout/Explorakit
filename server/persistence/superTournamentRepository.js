const {dbPool,withTransaction}=require('../config/database');
const codec=require('../game/drift/checkpointCodec');
const content=require('../game/superTournament/content');
const cashPrizes=require('../game/superTournament/cashPrizes');
async function load(id){const [[row]]=await dbPool.execute('SELECT version,snapshot,best_score,best_rooms FROM super_tournament_profiles WHERE user_id=?',[id]);return {version:Number(row?.version||0),run:row?.snapshot?codec.decode(row.snapshot):null,best:Number(row?.best_score||0)};}
async function save(id,run,version,{score=run?.score||0,rooms=run?.cleared||0,returnToCenter=false,payout=null}={}){
 let snapshot=run&&!payout?await codec.encodeAsync(run):null;
 const result=await withTransaction(async c=>{
  // Persist the exit together with the final score. A lost connection between
  // the commit and the map packet must not reopen the island on reconnect.
  const center=run===null&&returnToCenter===true?require('../game/world/playerRecovery').getPokemonCenterRespawnPoint():null;
  let balance;
  if(center||payout){const [[user]]=await c.execute('SELECT id,money FROM users WHERE id=? FOR UPDATE',[id]);if(!user)throw Error('Dresseur introuvable.');balance=Number(user.money);}
  await c.execute('INSERT IGNORE INTO super_tournament_profiles(user_id) VALUES(?)',[id]);
  let credited=0;
  if(payout){
   // Lock order matches inventory transactions (user, then tournament). Read
   // the previous checkpoint under that lock; a stale winner cannot pay twice.
   const [[stored]]=await c.execute('SELECT snapshot,version FROM super_tournament_profiles WHERE user_id=? FOR UPDATE',[id]);
   if(Number(stored.version)!==version)throw Error('La tentative a changé. Reconnecte-toi pour la reprendre.');
   const before=stored.snapshot?codec.decode(stored.snapshot):null,prior=before?cashPrizes.ensure(before):null;
   if(!run||!before||before.id!==payout.runId||run.id!==payout.runId||before.phase!=='battle'||run.phase!=='reward'||run.battle||
    before.room!==run.room||run.cleared!==run.room+1||payout.room!==run.cleared||!run.cash||run.cash.paidThrough!==payout.room||
    prior.paidThrough>=payout.room)throw Error('Cette prime de salle n’est plus disponible.');
   const prize=cashPrizes.quote(payout.room);
   if(run.cash.earned!==prior.earned+prize.total)throw Error('Prime de salle incohérente.');
   // Persist the actual credit with the room transition, even at the purse cap.
   credited=Math.max(0,Math.min(prize.total,cashPrizes.MAX_BALANCE-balance));
   run.cash.earned=prior.earned+credited;run.cash.last={...prize,amount:credited,limited:credited<prize.total};
   snapshot=await codec.encodeAsync(run);
  }
  const [r]=await c.execute('UPDATE super_tournament_profiles SET snapshot=?,score=?,best_score=GREATEST(best_score,?),best_rooms=GREATEST(best_rooms,?),version=version+1 WHERE user_id=? AND version=?',[snapshot,score,score,rooms,id,version]);
  if(r.affectedRows!==1)throw Error('La tentative a changé. Reconnecte-toi pour la reprendre.');
  if(credited>0)await c.execute('UPDATE users SET money=money+? WHERE id=?',[credited,id]);
  if(center)await c.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',[center.map,center.x,center.y,id]);
  return {version:version+1,balance:payout?balance+credited:null};
 });
 // The controller publishes the balance only after the transaction commits.
 if(payout)payout.balance=result.balance;
 return result.version;
}
async function ownsPass(id,c=dbPool){const[[r]]=await c.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?',[id,content.PASS]);return r?.quantity>0;}
async function grantPass(id){return withTransaction(async c=>{
 const r=await require('./mirrorRiftRepository').read(id,c,true);
 if(!content.eligible(r.progress))return false;
 const owned=await ownsPass(id,c);
 await c.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1) ON DUPLICATE KEY UPDATE quantity=GREATEST(quantity,1)',[id,content.PASS]);
 await c.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'super_tournament_invited','true') ON DUPLICATE KEY UPDATE flag_value='true'",[id]);
 return !owned;
});}
async function leaderboard(id){
 const [rows]=await dbPool.execute('SELECT u.id,u.username,p.best_score AS score,p.best_rooms AS rooms FROM super_tournament_profiles p JOIN users u ON u.id=p.user_id WHERE p.best_score>0 ORDER BY p.best_score DESC,p.best_rooms DESC,u.id ASC LIMIT 50');
 const [[own]]=await dbPool.execute('SELECT best_score AS score,best_rooms AS rooms FROM super_tournament_profiles WHERE user_id=?',[id]);
 return {rows:rows.map((r,i)=>({...r,rank:i+1,self:r.id===id})),personal:own||{score:0,rooms:0}};
}
module.exports={load,save,ownsPass,grantPass,leaderboard};
