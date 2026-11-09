// A separate durable receipt also covers sealed tournament copies and Pokémon from PC.
const {withTransaction}=require('../config/database');
const {permanent,spent}=require('../game/berries/combat');
async function apply(c,records){
 const unique=[...new Map(records.filter(r=>r?.battleId&&r.pokemonUuid&&permanent(r.itemKey)).map(r=>[`${r.battleId}:${r.pokemonUuid}:${r.itemKey}`,r])).values()];
 if(!unique.length)return [];
 const applied=[];
 const owned=[];
 for(const r of unique){
  const[[row]]=await c.execute('SELECT t.user_id FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE p.uuid=? UNION ALL SELECT user_id FROM pokemon_storage WHERE uuid=? LIMIT 1',[r.pokemonUuid,r.pokemonUuid]);
  if(row)owned.push({...r,userId:Number(row.user_id)});
 }
 for(const id of [...new Set(owned.map(r=>r.userId))].sort((a,b)=>a-b))await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[id]);
 for(const r of owned){
  const[result]=await c.execute('INSERT IGNORE INTO berry_consumption_receipts(battle_id,pokemon_uuid,user_id,item_key) VALUES(?,?,?,?)',[r.battleId,r.pokemonUuid,r.userId,r.itemKey]);
  if(!result.affectedRows)continue;
  applied.push(r);
  await c.execute('UPDATE pokemons p JOIN teams t ON t.id=p.team_id SET p.held_item=NULL WHERE p.uuid=? AND t.user_id=? AND p.held_item=?',[r.pokemonUuid,r.userId,r.itemKey]);
  await c.execute("UPDATE pokemon_storage SET pokemon_data=JSON_SET(pokemon_data,'$.held_item',NULL) WHERE uuid=? AND user_id=? AND JSON_UNQUOTE(JSON_EXTRACT(pokemon_data,'$.held_item'))=?",[r.pokemonUuid,r.userId,r.itemKey]);
 }
 return applied;
}
async function flush(models,c=null){const records=spent(models);if(!records.length)return [];if(c)return apply(c,records);return withTransaction(tx=>apply(tx,records));}
function clearLive(models,records){for(const p of models)if(records.some(r=>r.pokemonUuid===p.uuid&&r.itemKey===p.heldItem))p.heldItem=null;}
module.exports={apply,flush,clearLive};
