const {randomBytes}=require('node:crypto');
const {dbPool,withTransaction}=require('../config/database');
const {InputObservation}=require('../game/social/inputObservation');
const ALERT_COOLDOWN=7*24*60*60*1000,TEXT="J'utilise un autoclicker 🤖";
async function load(userId){const[[r]]=await dbPool.execute('SELECT snapshot FROM input_observations WHERE user_id=?',[userId]);return r?JSON.parse(r.snapshot):{};}
async function save(userId,snapshot){
 if(!snapshot||snapshot.version!==1||JSON.stringify(snapshot).length>40000)throw Error('Observation invalide.');
 await withTransaction(async c=>{await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);await c.execute('INSERT INTO input_observations(user_id,snapshot) VALUES(?,?) ON DUPLICATE KEY UPDATE snapshot=IF(CAST(JSON_UNQUOTE(JSON_EXTRACT(snapshot,\'$.observedAt\')) AS UNSIGNED)<=?,VALUES(snapshot),snapshot)',[userId,JSON.stringify(snapshot),snapshot.observedAt]);});
}
async function notifyFriends(userId,snapshot,now=Date.now()){
 // This function is internal only. Re-evaluate the server's observations rather
 // than accepting a score or an account ID from a browser packet.
 const model=new InputObservation(snapshot,()=>now),assessment=model.evaluate();
 if(!assessment.qualifies||!Number.isFinite(snapshot.confirmedAt)||now-snapshot.confirmedAt<20000||!Number.isFinite(snapshot.observedAt)||snapshot.observedAt>now||now-snapshot.observedAt>10000)return {messages:[],qualified:false};
 const [candidates]=await dbPool.execute("SELECT user_low,user_high FROM trainer_friendships WHERE (user_low=? OR user_high=?) AND status='accepted'",[userId,userId]);
 const peers=[...new Set(candidates.map(r=>Number(r.user_low)===userId?Number(r.user_high):Number(r.user_low)))],ids=[userId,...peers].sort((a,b)=>a-b);
 return withTransaction(async c=>{
  for(const id of ids)await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[id]);
  const[[saved]]=await c.execute('SELECT last_alert_at FROM input_observations WHERE user_id=? FOR UPDATE',[userId]);
  if(Number(saved?.last_alert_at)>0&&now-Number(saved.last_alert_at)<ALERT_COOLDOWN)return {messages:[],duplicate:true,nextAlertAt:Number(saved.last_alert_at)+ALERT_COOLDOWN};
  const result=[];
  for(const peer of peers){
   const[[friend]]=await c.execute('SELECT status FROM trainer_friendships WHERE user_low=? AND user_high=?',[Math.min(userId,peer),Math.max(userId,peer)]);if(friend?.status!=='accepted')continue;
   const clientId='auto:'+randomBytes(15).toString('hex');
   const[inserted]=await c.execute('INSERT INTO trainer_messages(user_low,user_high,sender_id,recipient_id,client_id,body) VALUES(?,?,?,?,?,?)',[Math.min(userId,peer),Math.max(userId,peer),userId,peer,clientId,TEXT]);
   const[[row]]=await c.execute('SELECT * FROM trainer_messages WHERE id=?',[inserted.insertId]);result.push(require('./socialMessageRepository').view(row));
  }
  await c.execute('INSERT INTO input_observations(user_id,snapshot,last_alert_at) VALUES(?,?,?) ON DUPLICATE KEY UPDATE last_alert_at=VALUES(last_alert_at)',[userId,JSON.stringify(snapshot),now]);
  return {messages:result,qualified:true,nextAlertAt:now+ALERT_COOLDOWN};
 });
}
module.exports={load,save,notifyFriends,ALERT_COOLDOWN,TEXT};
