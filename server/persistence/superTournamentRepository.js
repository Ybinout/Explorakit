const {dbPool,withTransaction}=require('../config/database');
const codec=require('../game/drift/checkpointCodec');
const content=require('../game/superTournament/content');
async function load(id){const [[row]]=await dbPool.execute('SELECT version,snapshot,best_score,best_rooms FROM super_tournament_profiles WHERE user_id=?',[id]);return {version:Number(row?.version||0),run:row?.snapshot?codec.decode(row.snapshot):null,best:Number(row?.best_score||0)};}
async function save(id,run,version,{score=run?.score||0,rooms=run?.cleared||0}={}){
 const snapshot=run?await codec.encodeAsync(run):null;
 return withTransaction(async c=>{
  await c.execute('INSERT IGNORE INTO super_tournament_profiles(user_id) VALUES(?)',[id]);
  const [r]=await c.execute('UPDATE super_tournament_profiles SET snapshot=?,score=?,best_score=GREATEST(best_score,?),best_rooms=GREATEST(best_rooms,?),version=version+1 WHERE user_id=? AND version=?',[snapshot,score,score,rooms,id,version]);
  if(r.affectedRows!==1)throw Error('La tentative a changé. Reconnecte-toi pour la reprendre.');
  return version+1;
 });
}
async function ownsPass(id,c=dbPool){const[[r]]=await c.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?',[id,content.PASS]);return r?.quantity>0;}
async function grantPass(id){return withTransaction(async c=>{
 const r=await require('./mirrorRiftRepository').read(id,c,true);
 if(!content.eligible(r.progress))return false;
 const owned=await ownsPass(id,c);
 await c.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1) ON DUPLICATE KEY UPDATE quantity=GREATEST(quantity,1)',[id,content.PASS]);
 await c.execute("INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,'super_tournament_invited','true') ON DUPLICATE KEY UPDATE flag_value='true'",[id]);
 return !owned;
});}
async function leaderboard(id){
 const [rows]=await dbPool.execute('SELECT u.id,u.username,p.best_score AS score,p.best_rooms AS rooms FROM super_tournament_profiles p JOIN users u ON u.id=p.user_id WHERE p.best_score>0 ORDER BY p.best_score DESC,p.best_rooms DESC,u.id ASC LIMIT 50');
 const [[own]]=await dbPool.execute('SELECT best_score AS score,best_rooms AS rooms FROM super_tournament_profiles WHERE user_id=?',[id]);
 return {rows:rows.map((r,i)=>({...r,rank:i+1,self:r.id===id})),personal:own||{score:0,rooms:0}};
}
module.exports={load,save,ownsPass,grantPass,leaderboard};
