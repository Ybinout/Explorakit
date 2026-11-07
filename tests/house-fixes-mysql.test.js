const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,teams,factory;
test.before(()=>{if(!enabled)return;assert.equal(process.env.DB_NAME,'explorakit_test');process.env.NODE_ENV='test';db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');teams=require('../server/persistence/teamRepository');factory=require('../server/game/drift/pokemonFactory');});
test.after(async()=>{await db?.end();});
test('SQL/socket: three private PvE fights coexist with a public PvP reservation; commands, reconnects, results and locks stay isolated',{skip:!enabled},async()=>{
 const {Server}=require('socket.io'),{io:client}=require('../vue-explorakit/node_modules/socket.io-client');
 const mod=require('../server/realtime/whitepeakClub'),original=mod.getClub,contexts=new Map(),hooks=new Map(),accounts=[],sockets=[],owned=new Map();
 let club,server,io,clock=Date.now(),publicWatchEnds=0;
 const wait=(s,event)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Missing '+event)),10000);s.once(event,d=>{clearTimeout(timer);resolve(d);});});
 const command=(s,name,data={})=>new Promise((resolve,reject)=>s.timeout(10000).emit('whitepeak:'+name,data,(e,r)=>e?reject(e):resolve(r)));
 async function connect(u){const s=client('http://127.0.0.1:'+server.address().port,{auth:{token:require('../server/config/auth').signAccessToken(u),houseModes:1},forceNew:true,autoConnect:false,reconnection:false,transports:['websocket']});sockets.push(s);const ready=wait(s,'whitepeak:trainers');s.connect();await ready;return s;}
 try{
  mod.getClub=io=>{if(club)return club;club=mod.createClub(io,{now:()=>clock,tickMs:0});const attach=club.attach;club.attach=c=>{contexts.set(c.id,c);const h=attach(c);hooks.set(c.id,h);return h;};return club;};
  server=http.createServer();io=new Server(server);io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);server.listen(0,'127.0.0.1');await once(server,'listening');
  for(let i=0;i<5;i++){
   const u=await users.createUserWithStarter('private_house_'+randomUUID(),randomUUID());accounts.push(u);
   const p=factory.create(143,100,true);p.k=4;p.recalculateStats();p.currentHp=p.maxHp;p.abilities=['Splash'];p.movePp=[40];p.heldItem='sitrus_berry';p.passiveAbility=null;
   await teams.editEquipe(u.id,{pokemons:[p]});owned.set(u.id,JSON.stringify(await teams.loadEquipe(u.id)));
   await db.execute("UPDATE users SET map='ville5_maison1',x=432,y=176,money=50000 WHERE id=?",[u.id]);await db.execute("UPDATE player_story_flags SET flag_value='complete' WHERE user_id=? AND flag_key='adventure_opening'",[u.id]);await connect(u);
  }
  const[a,b,c,d,e]=sockets,[ua,ub,uc,ud,ue]=accounts;e.on('whitepeak:watchEnd',()=>publicWatchEnds++);
  const answers=await Promise.all([command(a,'create',{mode:'pve',trainerKey:'gwenn_rochebrume'}),command(b,'create',{mode:'pve',trainerKey:'dia1'})]);assert(answers.every(r=>r.success));
  const ra=club.roomFor(ua.id),rb=club.roomFor(ub.id);assert.notEqual(ra.id,rb.id);assert.notEqual(ra.engine,rb.engine);assert.notEqual(ra.copies[0].equipe,rb.copies[0].equipe);assert.equal(club.room,null);
  assert((await command(d,'create',{mode:'1v1',money:1000})).success);const publicRoom=club.room;
  Object.assign(contexts.get(ud.id).getPlayer(),{x:8*32+16,y:8*32+16});await hooks.get(ud.id).step();
  assert((await command(c,'create',{mode:'pve',trainerKey:'champion_ana'})).success);const rc=club.roomFor(uc.id);assert.equal(rc.phase,'battle');assert.equal(club.room,publicRoom);assert.equal(publicRoom.phase,'waiting');assert(!publicRoom.ids.includes(uc.id));
  assert.equal((await command(a,'forfeit',{id:rb.id})).success,false);assert.equal(rb.phase,'battle');
  const beforeB=rb.engine.round,beforeC=rc.engine.round,pp=ra.copies[0].equipe.pokemons[0].movePp[0];
  const play=(s,r)=>{const control=r.sides[0].control;return command(s,'action',{id:r.id,turnId:r.engine.token,controlRevision:control.revision,action:'attack',number:0});};
  assert((await play(a,ra)).success);assert.equal(ra.copies[0].equipe.pokemons[0].movePp[0],pp-1);assert.equal(rb.engine.round,beforeB);assert.equal(rc.engine.round,beforeC);
  const gone=once(contexts.get(ub.id).socket,'disconnect');b.disconnect();await gone;await club.execute(()=>{});assert(rb.disconnected.has(ub.id));assert.equal(ra.disconnected.size,0);assert.equal(rc.disconnected.size,0);
  clock+=2000;await club.tick();const re=await connect(ub);await club.execute(()=>{});assert.equal(club.roomFor(ub.id).id,rb.id);assert.equal(rb.disconnected.size,0);assert((await play(re,rb)).success,'first choice after reconnect');
  assert((await command(a,'forfeit',{id:ra.id})).success);await club.tick();assert.equal(ra.phase,'finished');assert.equal(rb.phase,'battle');assert.equal(rc.phase,'battle');assert.equal(club.room,publicRoom);assert.equal(publicWatchEnds,0);
  assert((await command(a,'create',{mode:'pve',trainerKey:'gwenn_rochebrume'})).success);assert.notEqual(club.roomFor(ua.id).id,ra.id);assert.equal((await command(e,'create',{mode:'1v1'})).success,false);
  for(const u of accounts)assert.equal(JSON.stringify(await teams.loadEquipe(u.id)),owned.get(u.id));
  const[[scores]]=await db.execute('SELECT COUNT(*) n FROM whitepeak_duel_scores WHERE user_id IN (?,?,?,?,?)',accounts.map(u=>u.id));assert.equal(Number(scores.n),0);
 }finally{
  if(club){await club.execute(()=>{for(const u of accounts){const r=club.roomFor(u.id);if(r?.advanced&&r.phase==='battle')r.engine.finish(null,'server_restart');}});await club.tick();if(club.room?.phase==='waiting')await command(sockets[3],'leave');}
  sockets.forEach(s=>s.disconnect());club?.close();if(io){await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);}mod.getClub=original;
  for(const u of accounts)await db.execute('DELETE FROM users WHERE id=?',[u.id]);
 }
});
test('SQL Tower: berry stays consumed through a checkpoint/reconnect, returns after the fight, and never changes the real inventory',{skip:!enabled},async()=>{
 const u=await users.createUserWithStarter('tower_berry_'+randomUUID(),randomUUID()),repo=require('../server/persistence/superTournamentRepository');
 const Controller=require('../server/game/superTournament/controller').TournamentController,engine=require('../server/game/battle/battleEngine');
 const p=factory.create(143,130,true);p.passiveAbility=null;p.heldItem='sitrus_berry';p.abilities=['Splash'];p.movePp=[40];await teams.editEquipe(u.id,{pokemons:[p]});
 const real={id:'tower-berry',userId:u.id,username:u.username,equipe:await teams.loadEquipe(u.id)},owned=JSON.stringify(real.equipe);
 const create=()=>new Controller({userId:u.id,getPlayer:()=>real,emit(){},travel:async()=>{},random:()=>.5});let c=create();
 try{
  await c.load();await c.register(real.equipe);await c.next();await c.atomic(()=>c.startBattle());
  await c.atomic(()=>{const b=c.run.battle,hero=b.active(0);hero.currentHp=Math.floor(hero.maxHp*.4);engine.processEndOfRound(hero,b.active(1),null,null,b.state);return true;});
  assert.equal(c.run.battle.active(0).heldItem,null);assert.equal((await repo.load(u.id)).run.battle.active(0).heldItem,null);
  c=create();await c.load();await c.resume();assert.equal(c.run.battle.active(0).heldItem,null);
  await c.atomic(()=>{const b=c.run.battle;for(const enemy of b.b.equipe.pokemons)enemy.currentHp=0;b.prune();b.checkEnd();c.reconcile();return true;});
  assert.equal(c.run.phase,'reward');assert.equal(c.run.player.equipe.pokemons[0].heldItem,'sitrus_berry');
  const saved=await repo.load(u.id);assert.equal(saved.run.player.equipe.pokemons[0].heldItem,'sitrus_berry');assert.equal(JSON.stringify(await teams.loadEquipe(u.id)),owned);
  const[[stock]]=await db.execute("SELECT COALESCE(SUM(quantity),0) n FROM user_items WHERE user_id=? AND item_key='sitrus_berry'",[u.id]);assert.equal(Number(stock.n),0);
  await c.abandon();assert.equal(JSON.stringify(await teams.loadEquipe(u.id)),owned);
 }finally{await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
