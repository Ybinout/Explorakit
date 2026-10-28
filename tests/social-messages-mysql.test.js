const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';if(enabled){if(!/test/i.test(process.env.DB_TEST_NAME||''))throw Error('Dedicated test database required');process.env.DB_NAME=process.env.DB_TEST_NAME;}
const {dbPool}=require('../server/config/database'),trainers=require('../server/persistence/trainerRepository'),messages=require('../server/persistence/socialMessageRepository');
const ids=[];
async function user(){const[r]=await dbPool.execute("INSERT INTO users(username,password_hash,map,x,y,sprite) VALUES(?,'fixture','start',48,240,'sprite.png')",['social_'+randomUUID()]);ids.push(r.insertId);return r.insertId;}
async function friends(a,b){await trainers.friendAction(a,b,'request');await trainers.friendAction(b,a,'accept');}
test.after(async()=>{if(enabled){for(const id of ids)await dbPool.execute('DELETE FROM users WHERE id=?',[id]);await dbPool.end();}});
test('private messages persist once across concurrent retries, include Unicode, and require actual accepted friendships',{skip:!enabled},async()=>{
 const a=await user(),b=await user(),c=await user();await friends(a,b);
 await assert.rejects(messages.send(a,c,'Hello',randomUUID()),/amis/);await assert.rejects(messages.history(c,b),/amis/);await assert.rejects(messages.send(a,a,'Hello',randomUUID()),/autre/);
 const clientId=randomUUID(),text='Bonjour 🐾 <script>aucune exécution</script>';
 const results=await Promise.all(Array.from({length:8},()=>messages.send(a,b,text,clientId)));
 assert.equal(results.filter(r=>!r.duplicate).length,1);assert.equal(new Set(results.map(r=>r.message.id)).size,1);
 assert.equal((await messages.history(b,a)).messages[0].text,text);assert.equal((await messages.unread(b))[a],1);assert.deepEqual(await messages.unread(a),{});
 await assert.rejects(messages.send(a,b,'Different',clientId),/autre contenu/);await friends(a,c);await assert.rejects(messages.send(a,c,text,clientId),/autre contenu/);
 for(const value of['','x'.repeat(501),'bad\u0000',null])await assert.rejects(messages.send(a,b,value,randomUUID()));
 await assert.rejects(messages.send(a,b,'Hello','forged'));const[[count]]=await dbPool.execute('SELECT COUNT(*) AS n FROM trainer_messages WHERE sender_id=?',[a]);assert.equal(Number(count.n),1);
});
test('conversation pages have no gaps; read cursors are monotonic and never touch another recipient',{skip:!enabled},async()=>{
 const a=await user(),b=await user(),c=await user();await friends(a,b);const saved=[];
 for(let i=0;i<45;i++)saved.push((await messages.send(a,b,'Message '+i,randomUUID())).message);
 const latest=await messages.history(b,a);assert.equal(latest.messages.length,40);assert.equal(latest.nextBefore,saved[5].id);
 const older=await messages.history(b,a,latest.nextBefore);assert.deepEqual(older.messages.map(m=>m.id),saved.slice(0,5).map(m=>m.id));assert.equal(older.nextBefore,null);
 await messages.markRead(b,a,saved[40].id);assert.equal((await messages.unread(b))[a],4);await messages.markRead(b,a,saved[0].id);assert.equal((await messages.unread(b))[a],4);
 await assert.rejects(messages.markRead(c,a,saved[44].id),/amis/);assert.equal((await messages.unread(b))[a],4);
 await messages.markRead(b,a,saved[44].id);assert.deepEqual(await messages.unread(b),{});
 await messages.send(b,a,'Réponse',randomUUID());assert.equal((await messages.unread(a))[b],1);assert.deepEqual(await messages.unread(b),{});
 for(const before of[-1,'1 OR 1',0,1.5,Infinity])await assert.rejects(messages.history(a,b,before));
});
test('removing an accepted friendship immediately blocks further sends and history, without deleting prior messages',{skip:!enabled},async()=>{
 const a=await user(),b=await user();await friends(a,b);const first=await messages.send(a,b,'À bientôt',randomUUID());
 await trainers.friendAction(a,b,'remove');await assert.rejects(messages.send(b,a,'Forbidden',randomUUID()),/amis/);await assert.rejects(messages.history(b,a),/amis/);
 const[[row]]=await dbPool.execute('SELECT body FROM trainer_messages WHERE id=?',[first.message.id]);assert.equal(row.body,'À bientôt');
 await friends(a,b);assert.equal((await messages.history(a,b)).messages.length,1);
});
