const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
if(process.env.DB_NAME!=='explorakit_test'||process.env.RUN_MYSQL_TESTS!=='1')throw Error('Dedicated test database required');
const {dbPool:db}=require('../server/config/database'),users=require('../server/persistence/userRepository'),friends=require('../server/persistence/trainerRepository'),messages=require('../server/persistence/socialMessageRepository'),repo=require('../server/persistence/inputObservationRepository');
const {InputObservation}=require('../server/game/social/inputObservation'),ids=[];
async function user(){const u=await users.createUserWithStarter('InputTest_'+randomUUID().slice(0,10),randomUUID());ids.push(u.id);return u;}
async function pair(a,b){await friends.friendAction(a.id,b.id,'request');await friends.friendAction(b.id,a.id,'accept');}
function evidence(){let now=1000000;const m=new InputObservation({},()=>now);for(let i=0;i<900;i++){now+=200;m.command('world:action');if(i%10===9)m.telemetry({version:1,sequence:i+1,intervals:Array(20).fill(200),count:20,untrusted:0,assisted:false,mobile:false});m.evaluate();}assert(m.evaluate().highConfidence);return{snapshot:{...m.snapshot(),confirmedAt:m.candidateAt},now};}
test.after(async()=>{for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();});
test('one durable batch for all accepted friends, including offline, with honest automatic attribution and no game-data changes',async()=>{
 const a=await user(),b=await user(),c=await user(),outsider=await user();await pair(a,b);await pair(a,c);await friends.friendAction(a.id,outsider.id,'request');const e=evidence();
 const [[before]]=await db.execute('SELECT money,map,x,y FROM users WHERE id=?',[a.id]);const teamBefore=JSON.stringify((await require('../server/persistence/teamRepository').loadEquipe(a.id)).pokemons);
 await repo.save(a.id,e.snapshot);const batches=await Promise.all(Array.from({length:5},()=>repo.notifyFriends(a.id,e.snapshot,e.now)));
 assert.equal(batches.filter(r=>r.qualified).length,1);const batch=batches.find(r=>r.qualified);assert.equal(batch.messages.length,2);assert(batch.messages.every(m=>m.senderId===a.id&&m.automatic&&m.text===repo.TEXT));
 for(const peer of[b,c]){const h=await messages.history(peer.id,a.id);assert.equal(h.messages.length,1);assert(h.messages[0].automatic);assert.equal(h.messages[0].text,"J'utilise un autoclicker 🤖");assert.equal((await messages.unread(peer.id))[a.id],1);}
 assert.deepEqual(await messages.unread(outsider.id),{});const[[after]]=await db.execute('SELECT money,map,x,y FROM users WHERE id=?',[a.id]);assert.deepEqual(after,before);assert.equal(JSON.stringify((await require('../server/persistence/teamRepository').loadEquipe(a.id)).pokemons),teamBefore);
 const {createSocialHub}=require('../server/realtime/socialHub'),{EventEmitter}=require('node:events'),hub=createSocialHub({tickMs:0});
 const socket=u=>{const s=new EventEmitter();s.connected=true;s.data={user:u};return s;},sender=socket(a),online=socket(b),events=[];online.on('social:message',m=>events.push(m));await hub.attach(sender);await hub.attach(online);
 await hub.deliverStoredMessage(batch.messages.find(m=>m.recipientId===b.id));assert.equal(events.length,1);assert.equal(hub.state(b.id).accepted.find(f=>f.id===a.id).unread,1);
 const offline=socket(c);await hub.attach(offline);assert.equal(hub.state(c.id).accepted.find(f=>f.id===a.id).unread,1);hub.stop();
 await assert.rejects(messages.send(a.id,b.id,'fake','auto:'+randomUUID().replaceAll('-','').slice(0,30)),/Identifiant/);
 const manual=await messages.send(a.id,b.id,repo.TEXT,randomUUID());assert(!manual.message.automatic);
});
test('cooldown survives a new observer and normal saves, and stale/low-confidence packets cannot notify',async()=>{
 const a=await user(),b=await user();await pair(a,b);const e=evidence();
 for(const snapshot of [{version:1,score:100,highConfidence:true,confirmedAt:e.now-30000,observedAt:e.now},{...e.snapshot,confirmedAt:e.now-1000},{...e.snapshot,observedAt:e.now-10001}])assert.equal((await repo.notifyFriends(a.id,snapshot,e.now)).qualified,false);
 await repo.save(a.id,e.snapshot);assert((await repo.notifyFriends(a.id,e.snapshot,e.now)).qualified);await repo.save(a.id,{...e.snapshot,observedAt:e.now+1});
 const re=new InputObservation(await repo.load(a.id),()=>e.now+1);assert(!re.evaluate().highConfidence);assert((await repo.notifyFriends(a.id,{...e.snapshot,observedAt:e.now+2},e.now+2)).duplicate);
 const[[row]]=await db.execute('SELECT last_alert_at FROM input_observations WHERE user_id=?',[a.id]);assert.equal(Number(row.last_alert_at),e.now);
});
test('notification batch rollback is atomic and a retry cannot duplicate already committed messages',async()=>{
 const a=await user(),b=await user(),c=await user();await pair(a,b);await pair(a,c);const e=evidence(),get=db.getConnection.bind(db);let injected=false;
 db.getConnection=async()=>{const conn=await get(),execute=conn.execute.bind(conn),release=conn.release.bind(conn);conn.execute=async(sql,...args)=>{const r=await execute(sql,...args);if(sql.startsWith('INSERT INTO trainer_messages')&&!injected){injected=true;throw Error('injected notification rollback');}return r;};conn.release=()=>{conn.execute=execute;conn.release=release;release();};return conn;};
 try{await assert.rejects(repo.notifyFriends(a.id,e.snapshot,e.now),/injected/);}finally{db.getConnection=get;}
 assert(injected);assert.deepEqual(await messages.unread(b.id),{});assert.deepEqual(await messages.unread(c.id),{});assert.equal((await repo.notifyFriends(a.id,e.snapshot,e.now)).messages.length,2);
 await pair(a,await user());assert((await repo.notifyFriends(a.id,e.snapshot,e.now+1)).duplicate);
});
test('a removed friend receives nothing; persistence never overwrites a newer observation',async()=>{
 const a=await user(),b=await user();await pair(a,b);const e=evidence();await friends.friendAction(a.id,b.id,'remove');assert.equal((await repo.notifyFriends(a.id,e.snapshot,e.now)).messages.length,0);
 await repo.save(a.id,{...e.snapshot,observedAt:e.now+100});await repo.save(a.id,e.snapshot);assert.equal((await repo.load(a.id)).observedAt,e.now+100);
 const [[r]]=await db.execute('SELECT COUNT(*) n FROM player_story_flags WHERE user_id=? AND flag_key LIKE \'%input%\'',[a.id]);assert.equal(Number(r.n),0,'private evidence never enters progression flags');
});
