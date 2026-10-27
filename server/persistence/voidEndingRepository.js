const{dbPool,withTransaction}=require('../config/database');
const ending=require('../game/world/voidEnding');
const {createHash}=require('node:crypto');
async function read(userId,c=dbPool,lock=false){
 const[[owner]]=await c.execute('SELECT id,username FROM users WHERE id=?'+(lock?' FOR UPDATE':''),[userId]);if(!owner)throw Error('Dresseur introuvable.');
 const[rows]=await c.execute('SELECT flag_key,flag_value FROM player_story_flags WHERE user_id=?',[userId]);const progress={flags:Object.fromEntries(rows.map(r=>[r.flag_key,r.flag_value]))};
 if(!require('../game/world/arenaTests').isOwner(owner))delete progress.flags.admin_void_replay;
 const[[item]]=await c.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?',[userId,ending.config.item]);
 return{owner,progress,state:ending.state(progress),owned:Number(item?.quantity)>0};
}
async function flag(c,id,key,value){await c.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[id,key,String(value)]);}
async function pickup(id){return withTransaction(async c=>{const r=await read(id,c,true);if(!r.state.available||r.state.found)return false;
 await c.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1) ON DUPLICATE KEY UPDATE quantity=GREATEST(quantity,1)',[id,ending.config.item]);
 await flag(c,id,ending.key(r.progress,'found'),'true');await flag(c,id,ending.key(r.progress,'charge'),0);return true;});}
async function charge(id,receipt){return withTransaction(async c=>{const r=await read(id,c,true);if(!r.owned||!r.state.available||!r.state.found||r.state.charge>=5)return{changed:false,...r.state};
 const key=ending.key(r.progress,'use_'+createHash('sha256').update(String(receipt)).digest('hex').slice(0,24));if(r.progress.flags[key])return{changed:false,...r.state};
 await flag(c,id,key,'true');await flag(c,id,ending.key(r.progress,'charge'),r.state.charge+1);return{...r.state,changed:true,charge:r.state.charge+1};});}
async function defeat(id){return withTransaction(async c=>{const r=await read(id,c,true);if(!r.owned||!r.state.available||!r.state.found||r.state.charge!==5)return false;
 if(r.state.defeated)return true;await flag(c,id,ending.key(r.progress,'defeated'),'true');return true;});}
async function acknowledgeEntry(id){return withTransaction(async c=>{const r=await read(id,c,true);if(!r.owned||!ending.entryDialogue(r.progress))return false;
 await flag(c,id,ending.key(r.progress,'intro'),'true');return true;});}
async function badge(id){return withTransaction(async c=>{const r=await read(id,c,true);if(!r.state.available||!r.owned||!r.state.found||!r.state.defeated||r.state.claimed)return false;
 if(!r.state.replay){await c.execute('INSERT IGNORE INTO player_badges(user_id,badge_key)VALUES(?,?)',[id,ending.config.badge]);await flag(c,id,'true_ending','true');}
 await flag(c,id,ending.key(r.progress,'claimed'),'true');return true;});}
async function decorateItems(id,items,c=dbPool){if(!items.some(i=>i.key===ending.config.item))return items;const r=await read(id,c);return items.filter(i=>i.key!==ending.config.item||r.state.found).map(i=>i.key===ending.config.item?{...i,...ending.itemView(r.state)}:i);}
async function resetReplay(c,id){for(const[name,value]of Object.entries({replay:'true',found:'false',charge:0,intro:'false',defeated:'false',claimed:'false'}))await flag(c,id,'admin_void_'+name,value);await c.execute("DELETE FROM player_story_flags WHERE user_id=? AND flag_key LIKE 'admin_void_use_%'",[id]);}
module.exports={read,pickup,charge,acknowledgeEntry,defeat,badge,decorateItems,resetReplay};
