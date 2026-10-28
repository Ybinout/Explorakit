const {dbPool,withTransaction}=require('../config/database');
const fail=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode});};
function userId(value){if(!/^[1-9]\d*$/.test(String(value))||!Number.isSafeInteger(Number(value))||Number(value)>2147483647)fail('Dresseur invalide.');return Number(value);}
function messageId(value){if(!/^[1-9]\d*$/.test(String(value))||Number(value)>4294967295)fail('Message invalide.');return Number(value);}
function messageText(value){if(typeof value!=='string')fail('Message invalide.');const text=value.trim();if(!text||text.length>500||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))fail('Écris un message de 1 à 500 caractères.');return text;}
const pair=(a,b)=>[Math.min(a,b),Math.max(a,b)];
async function requireFriends(a,b,c=dbPool){
 if(a===b)fail('Choisis un autre dresseur.');
 const[[r]]=await c.execute("SELECT status FROM trainer_friendships WHERE user_low=? AND user_high=?",pair(a,b));
 if(r?.status!=='accepted')fail('Vous devez être amis pour échanger des messages.',403);
}
function view(row){return{id:Number(row.id),senderId:Number(row.sender_id),recipientId:Number(row.recipient_id),clientId:row.client_id,text:row.body,createdAt:new Date(row.created_at).toISOString()};}
async function send(sender,recipient,text,clientId){
 sender=userId(sender);recipient=userId(recipient);text=messageText(text);
 if(typeof clientId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId))fail('Identifiant du message invalide.');
 return withTransaction(async c=>{
  // Same account-lock order as friend requests/removals: no write after removal.
  for(const id of pair(sender,recipient))await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[id]);
  await requireFriends(sender,recipient,c);
  const[[previous]]=await c.execute('SELECT * FROM trainer_messages WHERE sender_id=? AND client_id=?',[sender,clientId]);
  if(previous){if(Number(previous.recipient_id)!==recipient||previous.body!==text)fail('Ce message a déjà été envoyé avec un autre contenu.',409);return{message:view(previous),duplicate:true};}
  const[result]=await c.execute('INSERT INTO trainer_messages(user_low,user_high,sender_id,recipient_id,client_id,body) VALUES(?,?,?,?,?,?)',[...pair(sender,recipient),sender,recipient,clientId,text]);
  const[[row]]=await c.execute('SELECT * FROM trainer_messages WHERE id=?',[result.insertId]);return{message:view(row),duplicate:false};
 });
}
async function history(viewer,peer,before){
 viewer=userId(viewer);peer=userId(peer);const cursor=before==null?null:messageId(before);await requireFriends(viewer,peer);
 const[rows]=await dbPool.execute(`SELECT * FROM trainer_messages WHERE user_low=? AND user_high=?${cursor?' AND id<?':''} ORDER BY id DESC LIMIT 41`,[...pair(viewer,peer),...(cursor?[cursor]:[])]);
 const messages=rows.slice(0,40).reverse().map(view);return{messages,nextBefore:rows.length>40?messages[0].id:null};
}
async function unread(viewer){
 viewer=userId(viewer);
 const[rows]=await dbPool.execute(`SELECT m.sender_id,COUNT(*) AS total FROM trainer_messages m LEFT JOIN trainer_message_reads r ON r.user_id=m.recipient_id AND r.peer_id=m.sender_id WHERE m.recipient_id=? AND m.id>COALESCE(r.last_read_id,0) GROUP BY m.sender_id`,[viewer]);
 return Object.fromEntries(rows.map(r=>[Number(r.sender_id),Number(r.total)]));
}
async function markRead(viewer,peer,through){
 viewer=userId(viewer);peer=userId(peer);through=messageId(through);await requireFriends(viewer,peer);
 const[[r]]=await dbPool.execute('SELECT MAX(id) AS last_id FROM trainer_messages WHERE recipient_id=? AND sender_id=? AND id<=?',[viewer,peer,through]);
 if(r.last_id)await dbPool.execute('INSERT INTO trainer_message_reads(user_id,peer_id,last_read_id) VALUES(?,?,?) ON DUPLICATE KEY UPDATE last_read_id=GREATEST(last_read_id,VALUES(last_read_id))',[viewer,peer,r.last_id]);
 return{through:Number(r.last_id)||0};
}
module.exports={send,history,unread,markRead,userId,messageText};
