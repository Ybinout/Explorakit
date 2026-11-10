const {dbPool,withTransaction}=require('../config/database');
const {createHash}=require('node:crypto');
const FLAG='bag_favorites',PREFIX='bag_favorite:',MAX=2048;
function parse(value){try{const list=JSON.parse(value||'[]');return Array.isArray(list)?[...new Set(list.filter(k=>typeof k==='string'&&k.length<=180))].slice(0,MAX):[];}catch{return [];}}
const flagKey=key=>PREFIX+createHash('sha256').update(key).digest('hex');
async function read(userId,c){
 const[rows]=await c.execute("SELECT flag_key,flag_value FROM player_story_flags WHERE user_id=? AND (flag_key=? OR flag_key LIKE 'bag!_favorite:%' ESCAPE '!')",[userId,FLAG]);
 const legacy=rows.find(r=>r.flag_key===FLAG),keys=new Set(parse(legacy?.flag_value));
 for(const r of rows)if(r.flag_key!==FLAG&&typeof r.flag_value==='string'&&r.flag_value.length<=180&&r.flag_key===flagKey(r.flag_value))keys.add(r.flag_value);
 return {keys:[...keys].slice(0,MAX),legacy:legacy?parse(legacy.flag_value):null};
}
async function load(userId,c=dbPool){const{keys}=await read(userId,c);return{keys};}
async function set(userId,itemKey,favorite){
 if(typeof itemKey!=='string'||!itemKey.length||itemKey.length>180||typeof favorite!=='boolean')throw Error('Favori invalide.');
 return withTransaction(async c=>{
  await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
  const {keys,legacy}=await read(userId,c),list=new Set(keys);
  if(favorite){const[[item]]=await c.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?',[userId,itemKey]);if(!item||Number(item.quantity)<1)throw Error('Cet objet n’est plus dans ton sac.');if(!list.has(itemKey)&&list.size>=MAX)throw Error('La liste de favoris est pleine.');list.add(itemKey);}else list.delete(itemKey);
  // flag_value is VARCHAR(255). Keep one bounded value per item instead of a
  // JSON array which overflowed after only a few long mutation-berry names.
  if(legacy){for(const key of legacy)if(list.has(key))await c.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[userId,flagKey(key),key]);await c.execute('DELETE FROM player_story_flags WHERE user_id=? AND flag_key=?',[userId,FLAG]);}
  if(favorite)await c.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[userId,flagKey(itemKey),itemKey]);
  else await c.execute('DELETE FROM player_story_flags WHERE user_id=? AND flag_key=?',[userId,flagKey(itemKey)]);
  return{keys:[...list]};
 });
}
module.exports={load,set,parse,FLAG};
