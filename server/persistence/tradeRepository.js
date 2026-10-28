const {withTransaction,dbPool}=require('../config/database');
const teamRepo=require('./teamRepository'),pcRepo=require('./pokemonStorageRepository');
const {markPokemonCaught}=require('./progressionRepository');
const rules=require('../game/social/tradeRules');
const fail=message=>{throw Object.assign(Error(message),{statusCode:409});};
async function snapshotsFor(ids,c){
 for(const id of [...ids].sort((a,b)=>a-b)){const[[user]]=await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[id]);if(!user)fail('Dresseur introuvable.');}
 const[[friendship]]=await c.execute("SELECT status FROM trainer_friendships WHERE user_low=? AND user_high=? FOR UPDATE",[Math.min(...ids),Math.max(...ids)]);
 if(friendship?.status!=='accepted')fail('Vous devez être amis pour échanger.');
 const result=[];
 for(const id of ids){
  const record=await teamRepo.getTeamRecord(id,c);if(!record)fail('Équipe introuvable.');
  const[rows]=await c.execute('SELECT * FROM pokemons WHERE team_id=? ORDER BY position FOR UPDATE',[record.id]);
  const entries=await pcRepo.loadEntries(id,c,true);
  const[items]=await c.execute('SELECT item_key,quantity FROM user_items WHERE user_id=? ORDER BY item_key FOR UPDATE',[id]);
  result.push({userId:id,teamId:record.id,team:rows.map(teamRepo.rowToPokemon),entries,items:Object.fromEntries(items.map(r=>[r.item_key,Number(r.quantity)]))});
 }
 return result;
}
async function inspect(ids,offers){return withTransaction(async c=>{const snapshots=await snapshotsFor(ids,c);return{review:rules.review(snapshots,offers,ids),inventories:snapshots.map(rules.inventory)};});}
async function commit({id,ids,offers,digest}){
 if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))fail('Échange invalide.');
 return withTransaction(async c=>{
  // Serialize both owners first, exactly as inventory, PC and friendship writes.
  for(const owner of [...ids].sort((a,b)=>a-b))await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[owner]);
  const[[previous]]=await c.execute('SELECT * FROM trainer_trade_receipts WHERE id=? FOR UPDATE',[id]);
  if(previous){if(Number(previous.user_low)!==Math.min(...ids)||Number(previous.user_high)!==Math.max(...ids)||previous.offer_digest!==digest)fail('Le récapitulatif de cet échange a changé.');return{duplicate:true,receipt:typeof previous.receipt_json==='string'?JSON.parse(previous.receipt_json):previous.receipt_json};}
  const snapshots=await snapshotsFor(ids,c),current=rules.review(snapshots,offers,ids);
  if(current.digest!==digest)fail('Une offre a changé. Vérifiez à nouveau le récapitulatif.');
  if(current.error)fail(current.error);
  const plans=rules.planTrade(snapshots,current.offers);
  // Remove both outgoing parties/storage entries before reinsertion: UUIDs and
  // occupied party/box slots must never collide during the transaction.
  for(let i=0;i<2;i++){
   await c.execute('DELETE FROM pokemons WHERE team_id=?',[snapshots[i].teamId]);
   if(current.offers[i].pokemonUuid)await c.execute('DELETE FROM pokemon_storage WHERE user_id=? AND uuid=?',[ids[i],current.offers[i].pokemonUuid]);
  }
  const insert=`INSERT INTO pokemons (${teamRepo.POKEMON_COLUMNS.join(',')}) VALUES (${teamRepo.POKEMON_COLUMNS.map(()=>'?').join(',')})`;
  for(let i=0;i<2;i++){
   const plan=plans[i],old=snapshots[i];
   for(const[index,pokemon]of plan.team.entries())await c.execute(insert,teamRepo.pokemonToRow(pokemon,old.teamId,index+1));
   for(const entry of plan.entries)if(!old.entries.some(e=>e.pokemon.uuid===entry.pokemon.uuid))await c.execute('INSERT INTO pokemon_storage(uuid,user_id,box_index,slot_index,pokemon_data) VALUES(?,?,?,?,?)',[entry.pokemon.uuid,ids[i],entry.box,entry.slot,pcRepo.encodePokemon(entry.pokemon)]);
   for(const key of new Set([...current.offers[0].items,...current.offers[1].items].map(i=>i.key)))await c.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,?) ON DUPLICATE KEY UPDATE quantity=VALUES(quantity)',[ids[i],key,plan.items[key]||0]);
   if(plan.received)await markPokemonCaught(ids[i],plan.received,c);
   for(const key of [...current.offers[1-i].items.map(i=>i.key),...(plan.received?.heldItem?[plan.received.heldItem]:[])])if(rules.catalog.get(key)?.unique)await c.execute('INSERT IGNORE INTO user_item_discoveries(user_id,item_key) VALUES(?,?)',[ids[i],key]);
  }
  const receipt={id,completedAt:new Date().toISOString(),participants:ids,offers:current.summaries};
  await c.execute('INSERT INTO trainer_trade_receipts(id,user_low,user_high,offer_digest,receipt_json) VALUES(?,?,?,?,?)',[id,Math.min(...ids),Math.max(...ids),digest,JSON.stringify(receipt)]);
  return{duplicate:false,receipt,plans:plans.map(p=>({team:p.team,entries:p.entries,items:p.items}))};
 });
}
async function loadReceipt(userId,id){const[[row]]=await dbPool.execute('SELECT receipt_json FROM trainer_trade_receipts WHERE id=? AND (user_low=? OR user_high=?)',[id,userId,userId]);return row?(typeof row.receipt_json==='string'?JSON.parse(row.receipt_json):row.receipt_json):null;}
module.exports={inspect,commit,loadReceipt,snapshotsFor};
