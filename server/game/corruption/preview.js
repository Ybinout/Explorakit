const mutation=require('./pokemon'),modules=require('./modules');
const fields=['maxHp','attack','defense','specialAttack','specialDefense','speed'];
function snapshot(p){return {stats:Object.fromEntries(fields.map(k=>[k,p[k]])),types:[...p.data.type],ability:p.passiveAbility,moves:[...p.abilities]};}
// Preview uses isolated native models and deterministic branches, never the
// crafting RNG, inventory, receipt writer or the owner's live Pokémon.
function preview(p,item,choice){
 mutation.validateTarget(p,item,choice);
 const before=snapshot(p),variants=[];
 for(const roll of item.corruptionModule.family==='type'&&p.data.type.length===2&&!p.data.type.includes(item.corruptionModule.type)?[0,.999999]:[0]){
  const copy=require('../drift/checkpointCodec').decode(require('../drift/checkpointCodec').encode(p));
  mutation.install(copy,item,choice,()=>roll);variants.push(snapshot(copy));
 }
 return {before,after:variants[0],variants,randomType:variants.length>1,itemKey:item.key,pokemonUuid:p.uuid,penalty:require('./balance').penalty({corruption:{modules:{...p.corruption?.modules,[item.corruptionModule.family]:{itemKey:item.key}}}})};
}
async function ownedPreview(userId,payload){
 const storage=require('../../persistence/pokemonStorageRepository'),teams=require('../../persistence/teamRepository'),{dbPool}=require('../../config/database');
 if(!['team','box'].includes(payload?.source)||!modules.get(payload?.itemKey))throw Error('Choisis un module et un Pokémon.');
 if(!(await require('../../persistence/darkContinentRepository').loadState(userId)).owned)throw Error('Le laboratoire n’est pas encore accessible.');
 const [[stock]]=await dbPool.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?',[userId,payload.itemKey]);if(!(stock?.quantity>0))throw Error('Ce module ne se trouve plus dans ton sac.');
 let p;
 if(payload.source==='box'){
  const [[row]]=await dbPool.execute('SELECT pokemon_data FROM pokemon_storage WHERE user_id=? AND uuid=?',[userId,payload.pokemonUuid]);
  p=row?storage.decodePokemon(row.pokemon_data):null;
 }else p=(await teams.loadEquipe(userId))?.pokemons.find(p=>p.uuid===payload.pokemonUuid);
 if(!p)throw Error('Ce Pokémon ne t’appartient pas.');return preview(p,modules.get(payload.itemKey),payload);
}
module.exports={preview,ownedPreview};
