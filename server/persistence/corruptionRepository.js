const {createHash}=require('node:crypto');
const {withTransaction}=require('../config/database');
const modules=require('../game/corruption/modules'),mutation=require('../game/corruption/pokemon');
const teams=require('./teamRepository'),dark=require('./darkContinentRepository');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function transaction(userId,operation,payload,work){
 if(!uuid.test(payload?.requestId||''))throw Error('Cette opération n’est plus disponible. Rouvre la fenêtre.');
 const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 return withTransaction(async c=>{
  const [[user]]=await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);if(!user)throw Error('Dresseur introuvable.');
  require('../game/social/tradeLocks').assertUnlocked(userId);
  const [[previous]]=await c.execute('SELECT * FROM corruption_receipts WHERE id=? FOR UPDATE',[payload.requestId]);
  if(previous){if(Number(previous.user_id)!==userId||previous.operation!==operation||previous.request_hash!==hash)throw Error('Cette opération a déjà été utilisée.');const result={...(typeof previous.result_json==='string'?JSON.parse(previous.result_json):previous.result_json),duplicate:true};if(operation==='install'){const record=await teams.getTeamRecord(userId,c);result.equipe={pokemons:(await teams.getTeamPokemons(record.id,c)).map(teams.rowToPokemon)};}return result;}
  const state=await dark.loadState(userId,c);if(!state.owned)throw Error('Je ne comprends rien à tout ce charabia… Peut-être devrais-je en apprendre plus sur ces cristaux.');
  const result=await work(c);
  const {equipe,...receipt}=result; // Runtime team is published after commit; receipts retain only the operation result.
  await c.execute('INSERT INTO corruption_receipts(id,user_id,operation,request_hash,result_json) VALUES(?,?,?,?,?)',[payload.requestId,userId,operation,hash,JSON.stringify(receipt)]);return equipe?{...receipt,equipe}:receipt;
 });
}
async function craft(userId,payload,random=Math.random){
 const {family,type}=payload||{},cost=modules.recipe(family,type);
 return transaction(userId,'craft',payload,async c=>{
  for(const {key,quantity}of cost){const [r]=await c.execute('UPDATE user_items SET quantity=quantity-? WHERE user_id=? AND item_key=? AND quantity>=?',[quantity,userId,key,quantity]);if(!r.affectedRows)throw Error('Tu n’as pas assez de composants. Aucune ressource n’a été consommée.');}
  const result=modules.craft(family,type,random);
  if(result.created)await c.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1) ON DUPLICATE KEY UPDATE quantity=quantity+1',[userId,result.itemKey]);
  return{...result,family,type,cost,item:result.created?modules.get(result.itemKey):null};
 });
}
async function install(userId,payload,random=Math.random){
 if(!['team','box'].includes(payload?.source||'team'))throw Error('Emplacement de Pokémon invalide.');
 const item=modules.get(payload?.itemKey);if(!item)throw Error('Module introuvable.');
 return transaction(userId,'install',payload,async c=>{
  const record=await teams.getTeamRecord(userId,c);if(!record)throw Error('Équipe introuvable.');
  const [rows]=await c.execute('SELECT * FROM pokemons WHERE team_id=? ORDER BY position FOR UPDATE',[record.id]),team=rows.map(teams.rowToPokemon);
  let p=team.find(p=>p.uuid===payload.pokemonUuid),stored;
  if(payload.source==='box'){const [[row]]=await c.execute('SELECT pokemon_data FROM pokemon_storage WHERE user_id=? AND uuid=? FOR UPDATE',[userId,payload.pokemonUuid]);if(row){stored=typeof row.pokemon_data==='string'?JSON.parse(row.pokemon_data):row.pokemon_data;p=teams.rowToPokemon(stored);}else p=null;}
  mutation.validateTarget(p,item,payload);
  if(!stored&&!mutation.corrupted(p)&&team.some(mutation.corrupted))throw Error('Ton équipe contient déjà un Pokémon corrompu. Dépose-le au PC avant d’en corrompre un autre.');
  const [spent]=await c.execute('UPDATE user_items SET quantity=quantity-1 WHERE user_id=? AND item_key=? AND quantity>=1',[userId,item.key]);if(!spent.affectedRows)throw Error('Ce module n’est plus dans le sac.');
  mutation.install(p,item,payload,random);mutation.assertTeam(team);
  const changed={corruption:JSON.stringify(mutation.normalize(p.corruption)),passive_ability:p.passiveAbility,pending_moves:JSON.stringify(p.pendingMoves||[])};
  for(let i=0;i<4;i++){changed['ability'+(i+1)]=p.abilities[i]||null;changed['move'+(i+1)+'_pp']=p.movePp[i]??null;}
  if(stored)await c.execute('UPDATE pokemon_storage SET pokemon_data=? WHERE user_id=? AND uuid=?',[JSON.stringify({...stored,...changed}),userId,p.uuid]);
  else await c.execute('UPDATE pokemons SET '+Object.keys(changed).map(k=>k+'=?').join(',')+' WHERE uuid=? AND team_id=?',[...Object.values(changed),p.uuid,record.id]);
  return{equipe:{pokemons:team},installed:true,itemKey:item.key,pokemonUuid:p.uuid,family:item.corruptionModule.family,corruption:mutation.view(p),types:p.data.type,passiveAbility:p.passiveAbility};
 });
}
module.exports={craft,install};
