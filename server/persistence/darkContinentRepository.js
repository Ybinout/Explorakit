const {dbPool,withTransaction}=require('../config/database'),dc=require('../game/world/darkContinent');
async function loadState(userId,c=dbPool){const [[row]]=await c.execute(`SELECT COALESCE((SELECT best_rooms FROM super_tournament_profiles WHERE user_id=?),0) AS rooms,
 EXISTS(SELECT 1 FROM user_items WHERE user_id=? AND item_key=? AND quantity>0) AS owned,
 EXISTS(SELECT 1 FROM player_story_flags WHERE user_id=? AND flag_key='dark_rules_read' AND flag_value='true') AS introduced,
 (SELECT money FROM users WHERE id=?) AS money,
 (SELECT flag_value FROM player_story_flags WHERE user_id=? AND flag_key=?) AS card_ready_at,
 EXISTS(SELECT 1 FROM player_story_flags WHERE user_id=? AND flag_key='dark_horizon_heard' AND flag_value='true') AS revealed,
 (EXISTS(SELECT 1 FROM user_items WHERE user_id=? AND item_key='dark_exploration_chart' AND quantity>0) OR EXISTS(SELECT 1 FROM player_story_flags WHERE user_id=? AND flag_key='dc2_chart_found' AND flag_value='true')) AS chart_owned,
 EXISTS(SELECT 1 FROM player_story_flags WHERE user_id=? AND flag_key='dc2_arrived' AND flag_value='true') AS arrived`,[userId,userId,dc.ITEM,userId,userId,userId,dc.CARD_READY_FLAG,userId,userId,userId,userId]);return{arrived:Boolean(row.arrived),revealed:Boolean(row.revealed),chartOwned:Boolean(row.chart_owned),eligible:Number(row.rooms)>=dc.REQUIRED_ROOMS,owned:Boolean(row.owned),introduced:Boolean(row.introduced),money:Number(row.money)||0,cardReadyAt:Number(row.card_ready_at)||0};}
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
 const teams=require('./teamRepository'),record=await teams.getTeamRecord(userId,c),team={pokemons:(await teams.getTeamPokemons(record.id,c)).map(teams.rowToPokemon)},survivors=team.pokemons;
 if(!survivors.length)throw Error('Je ne peux plus leur porter secours. Il faut rejoindre un Centre Pokémon.');
 const pp=require('../game/battle/battleResources'),needsCare=survivors.some(p=>p.currentHp<p.maxHp||p.status!=='normal'||p.abilities.some((move,i)=>p.movePp[i]<pp.getMaxMovePp(move)));
 if(!needsCare)return{equipe:team,money:Number(user.money),charged:0};
 if(Number(user.money)<dc.HEAL_PRICE)throw Error(`Les premiers secours coûtent ${dc.HEAL_PRICE.toLocaleString('fr-FR')} ₽ pour l’équipe. Tu n’as pas assez de Pokédollars.`);
 require('../game/world/playerRecovery').healTeam({pokemons:survivors});await teams.editEquipe(userId,team,c);await c.execute('UPDATE users SET money=money-? WHERE id=?',[dc.HEAL_PRICE,userId]);return{equipe:team,money:Number(user.money)-dc.HEAL_PRICE,charged:dc.HEAL_PRICE};
});}
async function acknowledgeRules(userId){await dbPool.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'dark_rules_read','true') ON DUPLICATE KEY UPDATE flag_value='true'",[userId]);}
async function grantLoot(userId,pokemon,random=Math.random,map='jungle1',executor=null){
 const apply=async c=>{const found=dc.loot(pokemon,random,map),ordinary=random()<dc.lootProfile(map).ordinaryChance;
 const items=ordinary||found.length?await require('./wildLootRepository').grantBattleLoot(userId,ordinary,found,random,c):[];
 return [...items,...await require('./darkAerialRepository').award(userId,map,random,c)];};
 return executor?apply(executor):withTransaction(apply);
}
async function buySurvivalKit(userId,{quantity=1,requestId}={}){
 if(!Number.isInteger(quantity)||quantity<1||quantity>20)throw Error('Choisis entre 1 et 20 kits.');
 if(typeof requestId!=='string'||!/^[0-9a-f-]{36}$/i.test(requestId))throw Error('Confirmation d’achat invalide.');
 return withTransaction(async c=>{
  const [[user]]=await c.execute('SELECT id,money FROM users WHERE id=? FOR UPDATE',[userId]);if(!user)throw Error('Dresseur introuvable.');
  require('../game/social/tradeLocks').assertUnlocked(userId);
  const flag='dark_survival_last_purchase',[[saved]]=await c.execute('SELECT flag_value FROM player_story_flags WHERE user_id=? AND flag_key=?',[userId,flag]);
  const previous=saved?JSON.parse(saved.flag_value):null;
  if(previous?.requestId===requestId){if(previous.quantity!==quantity)throw Error('Cette confirmation correspond à un autre achat.');return{...previous,money:Number(user.money),duplicate:true};}
  const total=quantity*dc.SURVIVAL_KIT.PRICE;if(Number(user.money)<total)throw Error('Tu n’as pas assez de Pokédollars.');
  const [[stock]]=await c.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?',[userId,dc.SURVIVAL_KIT.KEY]);
  if(Number(stock?.quantity||0)+quantity>9999)throw Error('Tu ne peux pas porter plus de 9 999 kits.');
  await c.execute('UPDATE users SET money=money-? WHERE id=?',[total,userId]);
  await c.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,?) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity)',[userId,dc.SURVIVAL_KIT.KEY,quantity]);
  const result={requestId,quantity,charged:total,money:Number(user.money)-total};
  await c.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[userId,flag,JSON.stringify(result)]);
  return result;
 });
}
// A KO is deleted durably before the next choice; a marked object can never be saved again.
async function persistFaints(userId,player,io,eligible=null,executor=null){
 const kit=require('../game/items/darkSurvivalKit');
 const dead=player.equipe.pokemons.filter(p=>p.currentHp<=0&&!p.__darkContinentDead&&!p.__darkSurvivalSettled&&(!eligible||eligible.has(p.uuid)));if(!dead.length)return[];
 const persist=async c=>{
  await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);const lost=[],protectedIds=[];
  for(const p of dead){
   if(p.__darkSurvivalProtected||p.heldItem===kit.KEY){
    const [[owned]]=await c.execute('SELECT p.held_item,p.current_hp FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=? AND p.uuid=? FOR UPDATE',[userId,p.uuid]);
    if(!owned)continue;
    if(owned.held_item===kit.KEY)await c.execute('UPDATE pokemons SET held_item=NULL,current_hp=0 WHERE uuid=?',[p.uuid]);
    else if(!(p.__darkSurvivalProtected&&owned.held_item===null&&owned.current_hp===0))throw Error('Le Kit de survie de ce Pokémon a changé. Reconnecte-toi pour reprendre le combat.');
    protectedIds.push(p.uuid);continue;
   }
   const [r]=await c.execute('DELETE p FROM pokemons p JOIN teams t ON t.id=p.team_id WHERE t.user_id=? AND p.uuid=?',[userId,p.uuid]);if(!r.affectedRows)continue;
   const item=Object.hasOwn(p,'__darkLostItem')?p.__darkLostItem:Object.hasOwn(p,'__heldItemBeforeExchange')?p.__heldItemBeforeExchange:p.heldItem||p.__heldItemKnockedOff||p.__heldItemConsumedForBattle;
   if(item)await c.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1) ON DUPLICATE KEY UPDATE quantity=quantity+1',[userId,item]);
   lost.push(p.uuid);
  }return{lost,protectedIds};
 };
 const {lost,protectedIds}=await(executor?persist(executor):withTransaction(persist));
 for(const p of dead){
  if(protectedIds.includes(p.uuid)){kit.protect(p);p.heldItem=null;p.__darkSurvivalProtected=true;p.__darkSurvivalSettled=true;delete p.__darkLostItem;}
  else if(lost.includes(p.uuid))p.__darkContinentDead=true;
 }
 if(protectedIds.length)io?.to(player.id).emit('progressionNotice',{type:'reward',message:`Kit de survie consommé : ${dead.filter(p=>protectedIds.includes(p.uuid)).map(p=>p.truename||p.name).join(', ')} reste K.O. et peut être soigné.`});
 if(lost.length)io?.to(player.id).emit('progressionNotice',{type:'warning',message:`Dark Continent : ${dead.filter(p=>lost.includes(p.uuid)).map(p=>p.name==='test'?p.truename:p.name).join(', ')} définitivement perdu${lost.length>1?'s':''}.`});
 return lost;
}

function removeFallen(player){player.equipe.pokemons=player.equipe.pokemons.filter(p=>!p.__darkContinentDead);}
module.exports={beginTravel,cancelTravel,loadState,grantCard,healSurvivors,buySurvivalKit,acknowledgeRules,grantLoot,persistFaints,removeFallen};
