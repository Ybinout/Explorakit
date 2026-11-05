const {dbPool,withTransaction}=require('../config/database'),dc=require('../game/world/darkContinent');
async function loadState(userId,c=dbPool){const [[row]]=await c.execute(`SELECT COALESCE((SELECT best_rooms FROM super_tournament_profiles WHERE user_id=?),0) AS rooms,
 EXISTS(SELECT 1 FROM user_items WHERE user_id=? AND item_key=? AND quantity>0) AS owned,
 EXISTS(SELECT 1 FROM player_story_flags WHERE user_id=? AND flag_key='dark_rules_read' AND flag_value='true') AS introduced,
 (SELECT money FROM users WHERE id=?) AS money,
 (SELECT flag_value FROM player_story_flags WHERE user_id=? AND flag_key=?) AS card_ready_at`,[userId,userId,dc.ITEM,userId,userId,userId,dc.CARD_READY_FLAG]);return{eligible:Number(row.rooms)>=dc.REQUIRED_ROOMS,owned:Boolean(row.owned),introduced:Boolean(row.introduced),money:Number(row.money)||0,cardReadyAt:Number(row.card_ready_at)||0};}
async function grantCard(userId){return withTransaction(async c=>{await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);require('../game/social/tradeLocks').assertUnlocked(userId);const state=await loadState(userId,c);if(state.owned)return{...state,granted:false,charged:0};if(!state.eligible)throw Error('Termine les deux premiers paliers du Super Tournoi.');if(state.money<dc.CARD_PRICE)throw Error(`La carte coûte ${dc.CARD_PRICE.toLocaleString('fr-FR')} ₽. Tu n’as pas assez de Pokédollars.`);await c.execute('UPDATE users SET money=money-? WHERE id=?',[dc.CARD_PRICE,userId]);await c.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1) ON DUPLICATE KEY UPDATE quantity=GREATEST(quantity,1)',[userId,dc.ITEM]);return{...state,owned:true,granted:true,charged:dc.CARD_PRICE,money:state.money-dc.CARD_PRICE};});}
// Lock the account before checking/claiming the durable cooldown, including concurrent sockets.
async function beginTravel(userId){return withTransaction(async c=>{
 await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
 require('../game/social/tradeLocks').assertUnlocked(userId);
 const state=await loadState(userId,c),serverNow=Date.now();
 if(!state.owned)throw Error('Une carte de dresseur professionnel est nécessaire.');
 if(state.cardReadyAt>serverNow){const seconds=Math.ceil((state.cardReadyAt-serverNow)/1000),error=Error(`La carte se recharge : ${Math.floor(seconds/60)} min ${String(seconds%60).padStart(2,'0')} s restantes.`);error.readyAt=state.cardReadyAt;throw error;}
 const readyAt=serverNow+dc.CARD_COOLDOWN_MS;
 await c.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[userId,dc.CARD_READY_FLAG,String(readyAt)]);
 return{readyAt,serverNow};
});}
async function cancelTravel(userId,readyAt){await dbPool.execute('DELETE FROM player_story_flags WHERE user_id=? AND flag_key=? AND flag_value=?',[userId,dc.CARD_READY_FLAG,String(readyAt)]);}
async function healSurvivors(userId){return withTransaction(async c=>{
 const [[user]]=await c.execute('SELECT money FROM users WHERE id=? FOR UPDATE',[userId]);require('../game/social/tradeLocks').assertUnlocked(userId);
 const teams=require('./teamRepository'),record=await teams.getTeamRecord(userId,c),team={pokemons:(await teams.getTeamPokemons(record.id,c)).map(teams.rowToPokemon)},survivors=team.pokemons.filter(p=>p.currentHp>0);
 if(!survivors.length)throw Error('Je ne peux plus leur porter secours. Il faut rejoindre un Centre Pokémon.');
 const pp=require('../game/battle/battleResources'),needsCare=survivors.some(p=>p.currentHp<p.maxHp||p.status!=='normal'||p.abilities.some((move,i)=>p.movePp[i]<pp.getMaxMovePp(move)));
 if(!needsCare)return{equipe:team,money:Number(user.money),charged:0};
 if(Number(user.money)<dc.HEAL_PRICE)throw Error(`Les premiers secours coûtent ${dc.HEAL_PRICE.toLocaleString('fr-FR')} ₽ pour l’équipe. Tu n’as pas assez de Pokédollars.`);
 require('../game/world/playerRecovery').healTeam({pokemons:survivors});await teams.editEquipe(userId,team,c);await c.execute('UPDATE users SET money=money-? WHERE id=?',[dc.HEAL_PRICE,userId]);return{equipe:team,money:Number(user.money)-dc.HEAL_PRICE,charged:dc.HEAL_PRICE};
});}
async function acknowledgeRules(userId){await dbPool.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'dark_rules_read','true') ON DUPLICATE KEY UPDATE flag_value='true'",[userId]);}
async function grantLoot(userId,pokemon,random=Math.random,map='jungle1',executor=null){const found=dc.loot(pokemon,random,map),ordinary=random()<dc.lootProfile(map).ordinaryChance;return ordinary||found.length?require('./wildLootRepository').grantBattleLoot(userId,ordinary,found,random,executor):[];}
// A KO is deleted durably before the next choice; a marked object can never be saved again.
async function persistFaints(userId,player,io,eligible=null,executor=null){
 const dead=player.equipe.pokemons.filter(p=>p.currentHp<=0&&!p.__darkContinentDead&&(!eligible||eligible.has(p.uuid)));if(!dead.length)return[];
 const persist=async c=>{await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);const result=[];
  for(const p of dead){const [r]=await c.execute('DELETE p FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=? AND p.uuid=?',[userId,p.uuid]);if(!r.affectedRows)continue;
   const item=Object.hasOwn(p,'__darkLostItem')?p.__darkLostItem:Object.hasOwn(p,'__heldItemBeforeExchange')?p.__heldItemBeforeExchange:p.heldItem||p.__heldItemKnockedOff||p.__heldItemConsumedForBattle;
   if(item)await c.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1) ON DUPLICATE KEY UPDATE quantity=quantity+1',[userId,item]);
   result.push(p.uuid);
  }return result;};
 const lost=await (executor?persist(executor):withTransaction(persist));
 for(const p of dead)p.__darkContinentDead=true;
 if(lost.length)io?.to(player.id).emit('progressionNotice',{type:'warning',message:`Dark Continent : ${dead.filter(p=>lost.includes(p.uuid)).map(p=>p.name==='test'?p.truename:p.name).join(', ')} définitivement perdu${lost.length>1?'s':''}.`});
 return lost;
}
function removeFallen(player){player.equipe.pokemons=player.equipe.pokemons.filter(p=>!p.__darkContinentDead);}
module.exports={beginTravel,cancelTravel,loadState,grantCard,healSurvivors,acknowledgeRules,grantLoot,persistFaints,removeFallen};
