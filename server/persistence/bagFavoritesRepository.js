const {dbPool,withTransaction}=require('../config/database');
const FLAG='bag_favorites',MAX=2048;
function parse(value){try{const list=JSON.parse(value||'[]');return Array.isArray(list)?[...new Set(list.filter(k=>typeof k==='string'&&k.length<=180))].slice(0,MAX):[];}catch{return [];}}
async function load(userId,c=dbPool){const[[r]]=await c.execute('SELECT flag_value FROM player_story_flags WHERE user_id=? AND flag_key=?',[userId,FLAG]);return {keys:parse(r?.flag_value)};}
async function set(userId,itemKey,favorite){
 if(typeof itemKey!=='string'||!itemKey.length||itemKey.length>180||typeof favorite!=='boolean')throw Error('Favori invalide.');
 return withTransaction(async c=>{
  await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
  const {keys}=await load(userId,c),list=new Set(keys);
  if(favorite){const[[item]]=await c.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?',[userId,itemKey]);if(!item||Number(item.quantity)<1)throw Error('Cet objet n’est plus dans ton sac.');if(!list.has(itemKey)&&list.size>=MAX)throw Error('La liste de favoris est pleine.');list.add(itemKey);}else list.delete(itemKey);
  const state={keys:[...list]};await c.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[userId,FLAG,JSON.stringify(state.keys)]);return state;
 });
}
module.exports={load,set,parse,FLAG};
