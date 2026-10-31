const {dbPool,withTransaction}=require('../config/database');
const codec=require('../game/drift/checkpointCodec');
const content=require('../game/superTournament/content');
const cashPrizes=require('../game/superTournament/cashPrizes');
const augmentations=require('../game/superTournament/augmentations');
async function load(id){const [[row]]=await dbPool.execute('SELECT version,snapshot,best_score,best_rooms FROM super_tournament_profiles WHERE user_id=?',[id]);return {version:Number(row?.version||0),run:row?.snapshot?codec.decode(row.snapshot):null,best:Number(row?.best_score||0)};}
async function save(id,run,version,{score=run?.score||0,rooms=run?.cleared||0,returnToCenter=false,payout=null,rewardClaim=null}={}){
 if(payout&&rewardClaim)throw Error('Deux récompenses incompatibles.');
 let snapshot=run&&!payout&&!rewardClaim?await codec.encodeAsync(run):null;
 const result=await withTransaction(async c=>{
  // Persist the exit together with the final score. A lost connection between
  // the commit and the map packet must not reopen the island on reconnect.
  const center=run===null&&returnToCenter===true?require('../game/world/playerRecovery').getPokemonCenterRespawnPoint():null;
  let balance;
  if(center||payout||rewardClaim){const [[user]]=await c.execute('SELECT id,money FROM users WHERE id=? FOR UPDATE',[id]);if(!user)throw Error('Dresseur introuvable.');balance=Number(user.money);}
  await c.execute('INSERT IGNORE INTO super_tournament_profiles(user_id) VALUES(?)',[id]);
  let credited=0,before,items;
  if(payout||rewardClaim){
   // Lock order matches inventory transactions (user, then tournament). Read
   // the previous checkpoint under that lock; a stale winner cannot pay twice.
   const [[stored]]=await c.execute('SELECT snapshot,version FROM super_tournament_profiles WHERE user_id=? FOR UPDATE',[id]);
   if(Number(stored.version)!==version)throw Error('La tentative a changé. Reconnecte-toi pour la reprendre.');
   before=stored.snapshot?codec.decode(stored.snapshot):null;
  }
  if(payout){
   const prior=before?cashPrizes.ensure(before):null;
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
  if(rewardClaim){
   // Claim, inventory and wallet use the same versioned transaction. No public
   // amount/item is trusted, and a committed offer can never be claimed again.
   if(!run||!before||before.id!==rewardClaim.runId||run.id!==rewardClaim.runId||before.phase!=='reward'||run.phase!=='cleared'||run.battle||run.reward||
    before.room!==run.room||before.cleared!==run.cleared||before.score!==run.score||before.reward?.id!==rewardClaim.offerId||
    !before.reward.cards.includes(rewardClaim.cardKey)||run.lastAugment?.offerId!==rewardClaim.offerId||run.lastAugment.cardKey!==rewardClaim.cardKey)throw Error('Cette augmentation n’est plus disponible.');
   const grant=augmentations.grant(rewardClaim.cardKey,before.reward.afterRoom),prior=cashPrizes.ensure(before);
   if(!grant||!run.cash||run.cash.paidThrough!==prior.paidThrough||run.cash.earned!==prior.earned+(grant.kind==='money'?grant.amount:0))throw Error('Augmentation incohérente.');
   run.lastAugment={...grant,offerId:rewardClaim.offerId,afterRoom:before.reward.afterRoom,cardKey:rewardClaim.cardKey};
   if(grant.kind==='money'){
    credited=Math.max(0,Math.min(grant.amount,cashPrizes.MAX_BALANCE-balance));
    run.cash.earned=prior.earned+credited;run.lastAugment.amount=credited;run.lastAugment.limited=credited<grant.amount;
   }else{
    const [[stock]]=await c.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=? FOR UPDATE',[id,grant.itemKey]);
    const quantity=Math.max(0,Math.min(grant.quantity,2147483647-Number(stock?.quantity||0)));
    if(quantity)await c.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,?) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity)',[id,grant.itemKey,quantity]);
    run.lastAugment.quantity=quantity;run.lastAugment.limited=quantity<grant.quantity;
    items=await require('./itemRepository').loadUserItems(id,c);
   }
   snapshot=await codec.encodeAsync(run);
  }
  const [r]=await c.execute('UPDATE super_tournament_profiles SET snapshot=?,score=?,best_score=GREATEST(best_score,?),best_rooms=GREATEST(best_rooms,?),version=version+1 WHERE user_id=? AND version=?',[snapshot,score,score,rooms,id,version]);
  if(r.affectedRows!==1)throw Error('La tentative a changé. Reconnecte-toi pour la reprendre.');
  if(credited>0)await c.execute('UPDATE users SET money=money+? WHERE id=?',[credited,id]);
  if(center)await c.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',[center.map,center.x,center.y,id]);
  return {version:version+1,balance:payout||rewardClaim?balance+credited:null,items};
 });
 // The controller publishes the balance only after the transaction commits.
 if(payout)payout.balance=result.balance;
 if(rewardClaim){rewardClaim.balance=result.balance;rewardClaim.items=result.items;}
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
