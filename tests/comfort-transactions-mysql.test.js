const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
if(process.env.RUN_MYSQL_TESTS!=='1'||process.env.DB_NAME!=='explorakit_test')throw Error('Dedicated SQL suite only');
const {dbPool:db}=require('../server/config/database'),users=require('../server/persistence/userRepository'),trades=require('../server/persistence/tradeRepository'),friends=require('../server/persistence/trainerRepository'),fav=require('../server/persistence/bagFavoritesRepository'),casino=require('../server/persistence/whitepeakRepository');
const ids=[];const of=money=>({money,items:[],pokemonUuid:null});
async function user(money=10000){const u=await users.createUserWithStarter('comfort_'+randomUUID(),randomUUID());ids.push(u.id);await db.execute('UPDATE users SET money=? WHERE id=?',[money,u.id]);return u.id;}
async function wallet(id){const[[r]]=await db.execute('SELECT money FROM users WHERE id=?',[id]);return Number(r.money);}
async function pair(a=10000,b=200){const x=await user(a),y=await user(b);await friends.friendAction(x,y,'request');await friends.friendAction(y,x,'accept');return[x,y];}
test.after(async()=>{for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();});
test('money gift commits once with its receipt, including simultaneous replay',async()=>{
 const ids=await pair(),offers=[of(7777),of(0)],v=await trades.inspect(ids,offers),args={id:randomUUID(),ids,offers,digest:v.review.digest};
 assert.equal(v.inventories[0].money,10000);await Promise.all([trades.commit(args),trades.commit(args)]);assert.deepEqual(await Promise.all(ids.map(wallet)),[2223,7977]);const receipt=await trades.loadReceipt(ids[1],args.id);assert.equal(receipt.offers[0].money,7777);await trades.commit(args);assert.deepEqual(await Promise.all(ids.map(wallet)),[2223,7977]);
});
test('changed or insufficient funds reject all assets; errors after wallet writes roll back the whole gift',async()=>{
 const ids=await pair(),offers=[of(8000),of(0)],v=await trades.inspect(ids,offers),args={id:randomUUID(),ids,offers,digest:v.review.digest};
 await db.execute('UPDATE users SET money=7999 WHERE id=?',[ids[0]]);await assert.rejects(trades.commit(args),/assez/);assert.deepEqual(await Promise.all(ids.map(wallet)),[7999,200]);await db.execute('UPDATE users SET money=9999 WHERE id=?',[ids[0]]);await assert.rejects(trades.commit(args),/changé/);
 args.digest=(await trades.inspect(ids,offers)).review.digest;
 const get=db.getConnection.bind(db);let injected=false;db.getConnection=async()=>{const c=await get(),execute=c.execute.bind(c),release=c.release.bind(c);c.execute=async(sql,...a)=>{if(sql.startsWith('INSERT INTO trainer_trade_receipts')){injected=true;throw Error('fixture receipt failure');}return execute(sql,...a);};c.release=()=>{c.execute=execute;c.release=release;release();};return c;};
 try{await assert.rejects(trades.commit(args),/fixture receipt/);}finally{db.getConnection=get;}
 assert(injected);assert.deepEqual(await Promise.all(ids.map(wallet)),[9999,200]);assert.equal(await trades.loadReceipt(ids[0],args.id),null);await trades.commit(args);assert.deepEqual(await Promise.all(ids.map(wallet)),[1999,8200]);
});
test('favorites are per-account, concurrent changes merge, repeated desired state is idempotent and depletion preserves preference',async()=>{
 const a=await user(),b=await user();await db.execute("INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,'potion',3) ON DUPLICATE KEY UPDATE quantity=3",[a]);
 await Promise.all([fav.set(a,'pokeball',true),fav.set(a,'potion',true)]);assert.deepEqual((await fav.load(a)).keys.sort(),['pokeball','potion']);assert.deepEqual((await fav.load(b)).keys,[]);await fav.set(a,'pokeball',true);await db.execute("UPDATE user_items SET quantity=0 WHERE user_id=? AND item_key='pokeball'",[a]);assert((await fav.load(a)).keys.includes('pokeball'));await assert.rejects(fav.set(b,'potion',true),/plus/);await fav.set(a,'pokeball',false);assert.deepEqual((await fav.load(a)).keys,['potion']);
});
test('all-in stakes the entire authoritative wallet above the normal ceiling, replays and pays exactly once',async()=>{
 const a=await user(2345678),now=Date.now(),round=await casino.newRound(now),bet={id:randomUUID(),roundId:round.id,amount:2345678,choice:{kind:'red'},allIn:true};
 try{await assert.rejects(casino.placeBet(a,{...bet,amount:2345677},now),/solde/);await assert.rejects(casino.placeBet(a,{...bet,allIn:false},now),/Maximum/);await Promise.all([casino.placeBet(a,bet,now),casino.placeBet(a,bet,now)]);assert.equal(await wallet(a),0);await assert.rejects(casino.placeBet(a,{...bet,id:randomUUID()},now),/solde/);await casino.spin(round.id,7,now+30000);await casino.settleRoulette(round.id,now+38000);assert.equal(await wallet(a),4691356);await casino.settleRoulette(round.id,now+38001);assert.equal(await wallet(a),4691356);await casino.placeBet(a,bet,now+40000);assert.equal(await wallet(a),4691356);}finally{await db.execute('DELETE FROM whitepeak_roulette_rounds WHERE id=?',[round.id]);}
});
