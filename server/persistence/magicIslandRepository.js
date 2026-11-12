const {createHash,randomInt}=require('node:crypto');
const {dbPool,withTransaction}=require('../config/database');
const rules=require('../game/magicIsland/rules');
const teams=require('./teamRepository'),pc=require('./pokemonStorageRepository');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const parse=value=>typeof value==='string'?JSON.parse(value):value;
async function add(c,id,key,n){if(!Number.isSafeInteger(n)||n<0)throw Error('Quantité invalide.');if(n)await c.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,?) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity)',[id,key,n]);}
async function consume(c,id,key,n){const[r]=await c.execute('UPDATE user_items SET quantity=quantity-? WHERE user_id=? AND item_key=? AND quantity>=?',[n,id,key,n]);if(r.affectedRows!==1)throw Error('Ressource insuffisante : '+(require('../game/battle/battleResources').getItemDefinition(key)?.name||key));}
async function flag(c,id,key,value){await c.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[id,key,String(value)]);}
async function flags(id,c=dbPool){const[rows]=await c.execute('SELECT flag_key,flag_value FROM player_story_flags WHERE user_id=?',[id]);return Object.fromEntries(rows.map(r=>[r.flag_key,r.flag_value]));}
async function state(id,c=dbPool,now=Date.now()){
 const f=await flags(id,c),[[user]]=await c.execute('SELECT money FROM users WHERE id=?',[id]),[[owned]]=await c.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?',[id,rules.SPEED_ITEM]);
 const [[row]]=await c.execute('SELECT * FROM magic_island_expeditions WHERE user_id=?',[id]);
 const expedition=row?{mission:row.mission_key,startedAt:Number(row.started_at),readyAt:Number(row.ready_at),ready:Number(row.ready_at)<=now,pokemon:parse(row.pokemon_data).map(e=>{const p=pc.decodePokemon(e.data);return{uuid:p.uuid,name:p.name||p.truename,id:p.data.id,level:p.level,k:p.k,shiny:p.shiny,formData:p.formData,formSpriteId:p.formSpriteId};})}:null;
 const {key,title,hint,date,durationMs}=rules.daily(now);
 return {money:Number(user?.money)||0,speed:{owned:Number(owned?.quantity)>0,active:Number(owned?.quantity)>0&&f[rules.SPEED_FLAG]==='true'},expedition,mission:{key,title,hint,date,durationMs},casinoPlayed:f.magic_casino_day===date,serverNow:now};
}
async function mutate(id,kind,payload,work){
 id=Number(id);if(!UUID.test(payload?.requestId||''))throw Error('Actualise cette confirmation.');
 const hash=createHash('sha256').update(JSON.stringify({kind,payload})).digest('hex');
 return withTransaction(async c=>{
  const[[user]]=await c.execute('SELECT id,money FROM users WHERE id=? FOR UPDATE',[id]);if(!user)throw Error('Dresseur introuvable.');
  require('../game/social/tradeLocks').assertUnlocked(id);await require('./darkBattleRepository').assertInactive(id,c);
  const[[old]]=await c.execute('SELECT * FROM magic_island_receipts WHERE request_id=? FOR UPDATE',[payload.requestId]);
  if(old){if(Number(old.user_id)!==id||old.request_hash!==hash)throw Error('Cette confirmation a déjà été utilisée.');return{...parse(old.result_json),duplicate:true};}
  const result=await work(c,user);
  await c.execute('INSERT INTO magic_island_receipts(request_id,user_id,request_hash,result_json) VALUES(?,?,?,?)',[payload.requestId,id,hash,JSON.stringify(result)]);
  return result;
 });
}
function craft(id,p){return mutate(id,'craft',p,async c=>{for(const r of rules.recipe(p.type,p.quantity))await consume(c,id,r.key,r.quantity);const key=rules.ballKey(p.type);await add(c,id,key,p.quantity);return{itemKey:key,quantity:p.quantity};});}
function purchaseModule(id,p){return mutate(id,'module',p,async(c,u)=>{
 const[[owned]]=await c.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?',[id,rules.SPEED_ITEM]);if(owned?.quantity>0)throw Error('Tu possèdes déjà cet étrange module.');
 if(Number(u.money)<2000000)throw Error('Il te faut 2 000 000 ₽.');
 for(const type of Object.keys(rules.TYPES))await consume(c,id,'dark_plate_'+type.toLowerCase(),20);
 await c.execute('UPDATE users SET money=money-2000000 WHERE id=?',[id]);await add(c,id,rules.SPEED_ITEM,1);await flag(c,id,rules.SPEED_FLAG,false);return{itemKey:rules.SPEED_ITEM};
 });}
function setSpeed(id,p){return mutate(id,'speed',p,async c=>{if(typeof p.active!=='boolean')throw Error('Choisis d’activer ou désactiver le module.');const[[owned]]=await c.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?',[id,rules.SPEED_ITEM]);if(!(owned?.quantity>0))throw Error('Tu ne possèdes pas ce module.');await flag(c,id,rules.SPEED_FLAG,p.active);return{active:p.active};});}
function travel(id,p){return mutate(id,'travel',p,async(c,u)=>{if(p.direction!=='out'&&p.direction!=='return')throw Error('Voyage invalide.');if(p.direction==='out'){if(Number(u.money)<20000)throw Error('Le voyage coûte 20 000 ₽.');await c.execute('UPDATE users SET money=money-20000 WHERE id=?',[id]);}const destination=p.direction==='out'?rules.ARRIVAL:rules.RETURN;await c.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',[destination.map,destination.x,destination.y,id]);return{destination};});}
function playCasino(id,p,now=Date.now(),draw=()=>randomInt(50)){return mutate(id,'casino',p,async c=>{
 const f=await flags(id,c),today=require('../game/world/safari').calendar(now).date;if(f.magic_casino_day===today)throw Error('On a déjà joué aujourd’hui ! Reviens demain.');
 const won=draw()===0;await flag(c,id,'magic_casino_day',today);if(won)await add(c,id,'master_ball',1);return{won,itemKey:won?'master_ball':null};
 });}
async function roster(id,c=dbPool){const record=await teams.getTeamRecord(id,c),rows=record?await teams.getTeamPokemons(record.id,c):[],stored=await pc.loadEntries(id,c);return{record,team:rows.map(teams.rowToPokemon),stored};}
function startExpedition(id,p,now=Date.now()){return mutate(id,'expedition-start',p,async c=>{
 const[[active]]=await c.execute('SELECT user_id FROM magic_island_expeditions WHERE user_id=? FOR UPDATE',[id]);if(active)throw Error('Ton équipe est déjà en expédition.');
 const mission=rules.daily(now);if(p.missionKey!==mission.key||p.missionDay!==mission.date)throw Error('La mission du jour a changé. Reparle au spécialiste.');
 if(!Array.isArray(p.uuids)||p.uuids.length<1||p.uuids.length>3||new Set(p.uuids).size!==p.uuids.length)throw Error('Choisis de un à trois Pokémon différents.');
 const {record,team,stored}=await roster(id,c),all=[...team.map(p=>({pokemon:p,source:'team'})),...stored.map(e=>({...e,source:'pc'}))];
 const selected=p.uuids.map(uuid=>all.find(e=>e.pokemon.uuid===uuid));if(selected.some(e=>!e||e.pokemon.isEgg||e.pokemon.currentHp<=0))throw Error('Choisis des Pokémon conscients qui t’appartiennent.');
 if(!team.some(q=>q.currentHp>0&&!selected.some(e=>e.pokemon.uuid===q.uuid)))throw Error('Garde au moins un Pokémon conscient dans ton équipe.');
 const result=rules.rewards(rules.assess(selected.map(e=>e.pokemon),mission));
 const snapshots=selected.map(e=>({source:e.source,box:e.box,slot:e.slot,data:pc.encodePokemon(e.pokemon)}));
 for(const e of selected)if(e.source==='team')await c.execute('DELETE FROM pokemons WHERE team_id=? AND uuid=?',[record.id,e.pokemon.uuid]);else await c.execute('DELETE FROM pokemon_storage WHERE user_id=? AND uuid=?',[id,e.pokemon.uuid]);
 const remaining=team.filter(q=>!selected.some(e=>e.pokemon.uuid===q.uuid));for(const[i,q]of remaining.entries())await c.execute('UPDATE pokemons SET position=? WHERE team_id=? AND uuid=?',[i+1,record.id,q.uuid]);
 await c.execute('INSERT INTO magic_island_expeditions(user_id,mission_day,mission_key,started_at,ready_at,pokemon_data,rewards_json) VALUES(?,?,?,?,?,?,?)',[id,mission.date,mission.key,now,now+rules.EXPEDITION_MS,JSON.stringify(snapshots),JSON.stringify(result)]);
 return{readyAt:now+rules.EXPEDITION_MS};
 });}
function claimExpedition(id,p,now=Date.now()){return mutate(id,'expedition-claim',p,async c=>{
 const[[row]]=await c.execute('SELECT * FROM magic_island_expeditions WHERE user_id=? FOR UPDATE',[id]);if(!row)throw Error('Aucune expédition à récupérer.');if(Number(row.ready_at)>now)throw Error('Tes compagnons ne sont pas encore rentrés.');
 const {record,team,stored}=await roster(id,c),snapshots=parse(row.pokemon_data);if(!record)throw Error('Équipe introuvable.');
 const storage=require('../game/storage/pokemonStorage');
 for(const entry of snapshots){const pokemon=pc.decodePokemon(entry.data);if(entry.source==='team'&&team.length<6&&(!pokemon.corruption||!team.some(q=>q.corruption?.permanent))){const values=teams.pokemonToRow(pokemon,record.id,team.length+1);await c.execute(`INSERT INTO pokemons (${teams.POKEMON_COLUMNS.join(',')}) VALUES (${teams.POKEMON_COLUMNS.map(()=>'?').join(',')})`,values);team.push(pokemon);}else{if(stored.length>=storage.CAPACITY)throw Error('Libère des places au PC pour récupérer tes compagnons.');const slot=storage.freeSlot(stored);await c.execute('INSERT INTO pokemon_storage(uuid,user_id,box_index,slot_index,pokemon_data) VALUES(?,?,?,?,?)',[pokemon.uuid,id,slot.box,slot.slot,pc.encodePokemon(pokemon)]);stored.push({...slot,pokemon});}}
 const result=parse(row.rewards_json);await c.execute('UPDATE users SET money=money+? WHERE id=?',[result.money,id]);for(const[key,n]of Object.entries(result.items))await add(c,id,key,n);
 await c.execute('DELETE FROM magic_island_expeditions WHERE user_id=?',[id]);return{rewards:result};
 });}
module.exports={state,mutate,craft,purchaseModule,setSpeed,travel,playCasino,roster,startExpedition,claimExpedition};
