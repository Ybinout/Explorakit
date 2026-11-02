const {dbPool,withTransaction}=require('../config/database'),dc=require('../game/world/darkContinent');
async function loadState(userId,c=dbPool){const [[row]]=await c.execute(`SELECT COALESCE((SELECT best_rooms FROM super_tournament_profiles WHERE user_id=?),0) AS rooms,
 EXISTS(SELECT 1 FROM user_items WHERE user_id=? AND item_key=? AND quantity>0) AS owned,
 EXISTS(SELECT 1 FROM player_story_flags WHERE user_id=? AND flag_key='dark_rules_read' AND flag_value='true') AS introduced`,[userId,userId,dc.ITEM,userId]);return{eligible:Number(row.rooms)>=dc.REQUIRED_ROOMS,owned:Boolean(row.owned),introduced:Boolean(row.introduced)};}
async function grantCard(userId){return withTransaction(async c=>{await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);const state=await loadState(userId,c);if(!state.eligible)throw Error('Termine les trois premiers cycles du Super Tournoi.');if(!state.owned)await c.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1) ON DUPLICATE KEY UPDATE quantity=GREATEST(quantity,1)',[userId,dc.ITEM]);return{...state,owned:true,granted:!state.owned};});}
async function acknowledgeRules(userId){await dbPool.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'dark_rules_read','true') ON DUPLICATE KEY UPDATE flag_value='true'",[userId]);}
async function grantLoot(userId,pokemon,random=Math.random){const found=dc.loot(pokemon,random),ordinary=random()<require('../game/items/wildLoot').ADVENTURE_CHANCE;return ordinary||found.length?require('./wildLootRepository').grantBattleLoot(userId,ordinary,found,random):[];}
// A KO is deleted durably before the next choice; a marked object can never be saved again.
async function persistFaints(userId,player,io,eligible=null){
 const dead=player.equipe.pokemons.filter(p=>p.currentHp<=0&&!p.__darkContinentDead&&(!eligible||eligible.has(p.uuid)));if(!dead.length)return[];
 const lost=await withTransaction(async c=>{await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);const result=[];
  for(const p of dead){const [r]=await c.execute('DELETE p FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=? AND p.uuid=?',[userId,p.uuid]);if(!r.affectedRows)continue;
   const item=Object.hasOwn(p,'__heldItemBeforeExchange')?p.__heldItemBeforeExchange:p.heldItem||p.__heldItemKnockedOff||p.__heldItemConsumedForBattle;
   if(item)await c.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1) ON DUPLICATE KEY UPDATE quantity=quantity+1',[userId,item]);
   result.push(p.uuid);
  }return result;});
 for(const p of dead)p.__darkContinentDead=true;
 if(lost.length)io?.to(player.id).emit('progressionNotice',{type:'warning',message:`Dark Continent : ${dead.filter(p=>lost.includes(p.uuid)).map(p=>p.name==='test'?p.truename:p.name).join(', ')} définitivement perdu${lost.length>1?'s':''}.`});
 return lost;
}
function removeFallen(player){player.equipe.pokemons=player.equipe.pokemons.filter(p=>!p.__darkContinentDead);}
module.exports={loadState,grantCard,acknowledgeRules,grantLoot,persistFaints,removeFallen};
