const {dbPool,withTransaction}=require('../config/database');
const journal=require('../game/world/questJournal');
function userId(value){const id=Number(value);if(!Number.isSafeInteger(id)||id<1)throw Error('Dresseur invalide.');return id;}
async function facts(id,c){
 const [[flags],[quests],[items],[badges],[battles],[[profile]],[[user]]]=await Promise.all([
  c.execute('SELECT flag_key,flag_value FROM player_story_flags WHERE user_id=?',[id]),
  c.execute('SELECT quest_key,status,progress,updated_at,completed_at FROM player_quests WHERE user_id=?',[id]),
  c.execute('SELECT item_key,quantity FROM user_items WHERE user_id=? AND quantity>0',[id]),
  c.execute('SELECT badge_key FROM player_badges WHERE user_id=?',[id]),
  c.execute('SELECT battle_key FROM user_npc_battles WHERE user_id=?',[id]),
  c.execute('SELECT best_rooms FROM super_tournament_profiles WHERE user_id=?',[id]),
  c.execute('SELECT map FROM users WHERE id=?',[id])]);
 return {flags:Object.fromEntries(flags.map(r=>[r.flag_key,r.flag_value])),quests,items,badges,battles,bestRooms:profile?.best_rooms||0,hasTournamentProfile:!!profile,map:user?.map};
}
async function setFlag(c,id,key){const[r]=await c.execute("INSERT IGNORE INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,'true')",[id,key]);return r.affectedRows>0;}
async function initialize(c,id,f){
 if(f.flags.journal_started==='true')return;
 if(journal.legacyComptoir(f)){await setFlag(c,id,'journal_legacy_comptoir');f.flags.journal_legacy_comptoir='true';}
 await setFlag(c,id,'journal_started');f.flags.journal_started='true';
}
async function project(c,id,f){
 await initialize(c,id,f);
 const value=journal.derive(f),old=new Map(f.quests.map(q=>[q.quest_key,q]));
 for(const e of value.entries){
  const previous=old.get(e.key);
  if(previous?.status===e.status&&Number(previous.progress)===e.progress)continue;
  await c.execute(`INSERT INTO player_quests(user_id,quest_key,status,progress,completed_at) VALUES(?,?,?,?,IF(?='completed',CURRENT_TIMESTAMP,NULL))
   ON DUPLICATE KEY UPDATE status=IF(status='completed',status,VALUES(status)),progress=GREATEST(progress,VALUES(progress)),completed_at=IF(VALUES(status)='completed',COALESCE(completed_at,CURRENT_TIMESTAMP),completed_at)`,[id,e.key,e.status,e.progress,e.status]);
 }
 // Preserve the real SQL timestamps in the same authoritative snapshot.
 const[rows]=await c.execute("SELECT quest_key,status,progress,updated_at,completed_at FROM player_quests WHERE user_id=?",[id]);
 return journal.derive({...f,quests:rows});
}
async function reconcile(value){const id=userId(value);return withTransaction(async c=>{const[[owner]]=await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[id]);if(!owner)throw Error('Dresseur introuvable.');return project(c,id,await facts(id,c));});}
async function markRead(value,keys){
 const id=userId(value),allowed=new Set(journal.definitions.map(d=>d.key));
 if(!Array.isArray(keys)||keys.length>allowed.size||keys.some(k=>typeof k!=='string'||!allowed.has(k)))throw Error('Quêtes invalides.');
 return withTransaction(async c=>{
  const[[owner]]=await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[id]);if(!owner)throw Error('Dresseur introuvable.');
  const f=await facts(id,c),current=await project(c,id,f),visible=new Set(current.entries.map(e=>e.key));
  if(keys.some(k=>!visible.has(k)))throw Error('Cette quête n’est pas encore disponible.');
  for(const key of new Set(keys)){await setFlag(c,id,journal.READ_PREFIX+key);f.flags[journal.READ_PREFIX+key]='true';}
  for(const entry of current.entries)if(keys.includes(entry.key))entry.unread=false;
  current.unreadCount=current.entries.filter(e=>e.unread).length;return current;
 });
}
async function noteVisit(value,map){const flag=journal.visitFlag(map);if(!flag)return false;return setFlag(dbPool,userId(value),flag);}
module.exports={reconcile,markRead,noteVisit,facts};
