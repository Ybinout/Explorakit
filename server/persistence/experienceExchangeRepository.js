const {createHash}=require('node:crypto'),{withTransaction}=require('../config/database'),teams=require('./teamRepository');
const lab=require('../game/experienceExchange/laboratory'),op=require('../game/experienceExchange/operation');
async function load(c,userId){
 const record=await teams.getTeamRecord(userId,c);if(!record)throw Error('Équipe introuvable.');
 const [team]=await c.execute('SELECT * FROM pokemons WHERE team_id=? ORDER BY position FOR UPDATE',[record.id]);
 const [stored]=await c.execute('SELECT uuid,box_index,slot_index,pokemon_data FROM pokemon_storage WHERE user_id=? ORDER BY box_index,slot_index FOR UPDATE',[userId]);
 const entries=[...team.map(raw=>({source:'team',raw,pokemon:teams.rowToPokemon(raw)})),...stored.map(row=>{const raw=typeof row.pokemon_data==='string'?JSON.parse(row.pokemon_data):row.pokemon_data;return{source:'box',box:row.box_index,slot:row.slot_index,raw,pokemon:teams.rowToPokemon(raw)};})];
 return{record,entries};
}
// Every inventory mutation takes this same user lock before touching party or PC.
async function lock(c,userId){const [[user]]=await c.execute('SELECT id,money FROM users WHERE id=? FOR UPDATE',[userId]);if(!user)throw Error('Dresseur introuvable.');require('../game/social/tradeLocks').assertUnlocked(userId);return user;}
function view(user,entries){return{price:lab.PRICE,money:Number(user.money),roster:entries.map(op.dto)};}
async function open(userId){return withTransaction(async c=>{const user=await lock(c,userId),{entries}=await load(c,userId);return view(user,entries);});}
async function preview(userId,payload){return withTransaction(async c=>{const user=await lock(c,userId),{entries}=await load(c,userId),first=entries.find(e=>e.pokemon.uuid===payload?.firstUuid),second=entries.find(e=>e.pokemon.uuid===payload?.secondUuid);return{money:Number(user.money),offer:op.offer(first,second)};});}
async function exchange(userId,payload){
 if(!op.UUID.test(payload?.requestId||'')||!op.UUID.test(payload?.firstUuid||'')||!op.UUID.test(payload?.secondUuid||'')||payload?.price!==lab.PRICE||!Array.isArray(payload?.expected)||payload.expected.length!==2)throw Error('Prépare un nouvel aperçu avant de confirmer.');
 const digest=createHash('sha256').update(JSON.stringify({first:payload.firstUuid,second:payload.secondUuid,expected:payload.expected,price:payload.price})).digest('hex');
 return withTransaction(async c=>{
  const user=await lock(c,userId);
  // Resolve a retried confirmation before stale-preview checks: never swap twice.
  const [[previous]]=await c.execute('SELECT user_id,request_hash,result_json FROM experience_exchange_receipts WHERE request_id=? FOR UPDATE',[payload.requestId]);
  if(previous){if(Number(previous.user_id)!==userId||previous.request_hash!==digest)throw Error('Cette confirmation a déjà été utilisée.');const {entries}=await load(c,userId);return{...view(user,entries),receipt:typeof previous.result_json==='string'?JSON.parse(previous.result_json):previous.result_json,duplicate:true,equipe:{pokemons:entries.filter(e=>e.source==='team').map(e=>e.pokemon)}};}
  const {record,entries}=await load(c,userId),first=entries.find(e=>e.pokemon.uuid===payload.firstUuid),second=entries.find(e=>e.pokemon.uuid===payload.secondUuid);op.validate(first,second);
  if(payload.expected[0]!==op.fingerprint(first)||payload.expected[1]!==op.fingerprint(second))throw Error('Ces Pokémon ont changé depuis l’aperçu. Actualise le laboratoire.');
  const before=[op.dto(first),op.dto(second)];
  const [paid]=await c.execute('UPDATE users SET money=money-? WHERE id=? AND money>=?',[lab.PRICE,userId,lab.PRICE]);if(!paid.affectedRows)throw Error('Il te faut 1 000 000 ₽ pour cet échange.');
  for(const [entry,experience]of [[first,before[1].experience],[second,before[0].experience]]){
   // Only XP, its derived level/stats and clamped HP are written. All other columns
   // (and unknown future PC JSON fields) stay exactly as stored.
   const changed=op.changes(entry.pokemon,experience);
   let written;
   if(entry.source==='team')[written]=await c.execute('UPDATE pokemons SET '+op.FIELDS.map(f=>f+'=?').join(',')+' WHERE team_id=? AND uuid=?',[...op.FIELDS.map(f=>changed[f]),record.id,entry.pokemon.uuid]);
   else [written]=await c.execute('UPDATE pokemon_storage SET pokemon_data=? WHERE user_id=? AND uuid=?',[JSON.stringify({...entry.raw,...changed}),userId,entry.pokemon.uuid]);
   if(written.affectedRows!==1)throw Error('L’emplacement de ce Pokémon a changé. Actualise le laboratoire.');
  }
  const receipt={requestId:payload.requestId,price:lab.PRICE,before,after:[op.dto(first),op.dto(second)]};
  await c.execute('INSERT INTO experience_exchange_receipts(request_id,user_id,request_hash,result_json) VALUES(?,?,?,?)',[payload.requestId,userId,digest,JSON.stringify(receipt)]);
  return{...view({...user,money:Number(user.money)-lab.PRICE},entries),receipt,equipe:{pokemons:entries.filter(e=>e.source==='team').map(e=>e.pokemon)}};
 });
}
module.exports={open,preview,exchange};
