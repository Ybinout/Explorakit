const {withTransaction}=require('../config/database');
const policy=require('../game/items/heldItemPolicy');
function mutation(value){try{return typeof value==='string'?JSON.parse(value):value;}catch{return null;}}
// Only canonical, inactive possessions are reconciled; durable battles retain
// their checkpoint and incompatible effects are disabled by the shared policy.
async function reconcile(userId){
 if(require('../game/social/tradeLocks').locked(userId))return[];
 return withTransaction(async c=>{
  await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
  try{await require('./darkBattleRepository').assertInactive(userId,c);}catch(error){if(error.statusCode===409)return[];throw error;}
  const [[run]]=await c.execute('SELECT snapshot FROM super_tournament_profiles WHERE user_id=?',[userId]);if(run?.snapshot)return[];
  const [team]=await c.execute('SELECT p.uuid,p.held_item,p.corruption FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=? AND p.held_item IS NOT NULL FOR UPDATE',[userId]);
  const [boxes]=await c.execute('SELECT uuid,pokemon_data FROM pokemon_storage WHERE user_id=? FOR UPDATE',[userId]);
  const returned=[];
  async function credit(key){await c.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1) ON DUPLICATE KEY UPDATE quantity=quantity+1',[userId,key]);returned.push(key);}
  for(const p of team)if(!policy.canHold({corruption:mutation(p.corruption)},p.held_item)){await credit(p.held_item);await c.execute('UPDATE pokemons SET held_item=NULL WHERE uuid=?',[p.uuid]);}
  for(const p of boxes){const data=mutation(p.pokemon_data);if(data?.held_item&&!policy.canHold({corruption:mutation(data.corruption)},data.held_item)){await credit(data.held_item);data.held_item=null;if(Object.hasOwn(data,'heldItem'))data.heldItem=null;await c.execute('UPDATE pokemon_storage SET pokemon_data=? WHERE user_id=? AND uuid=?',[JSON.stringify(data),userId,p.uuid]);}}
  return returned;
 });
}
module.exports={reconcile};
