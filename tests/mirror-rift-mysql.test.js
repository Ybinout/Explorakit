const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{EventEmitter}=require('node:events');
const enabled=process.env.RUN_MYSQL_TESTS==='1';let db,users,repo,teams,scene,factory;
process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';process.env.MIRROR_SCENE_SCALE='0';
test.before(()=>{if(!enabled)return;assert.match(process.env.DB_NAME||'',/test/i);db=require('../server/config/database').dbPool;users=require('../server/persistence/userRepository');repo=require('../server/persistence/mirrorRiftRepository');teams=require('../server/persistence/teamRepository');scene=require('../server/game/world/mirrorRift');factory=require('../server/game/drift/pokemonFactory');});
test.after(async()=>{await db?.end();});
async function flags(id,values){for(const[k,v]of Object.entries(values))await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value)VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[id,k,String(v)]);}
async function fixture(ending='pardon_badge'){
 const u=await users.createUserWithStarter('mirror_'+randomUUID(),'Mirror-test-password-2026',{starterId:1});
 for(const b of [...scene.requiredBadges,ending])await db.execute('INSERT INTO player_badges(user_id,badge_key)VALUES(?,?)',[u.id,b]);return u;
}
const at=(id,x,y)=>({userId:id,currentmap:'route2_maison',x:x*32+16,y:y*32+16,sprite:'sprite.png'});
test('SQL mirror: badge ownership, full bookshelf proximity and duplicate packets are authoritative',{skip:!enabled},async()=>{
 let u;try{u=await fixture();await db.execute("DELETE FROM player_badges WHERE user_id=? AND badge_key='pardon_badge'",[u.id]);
  assert.equal(await repo.advance(u.id,'open',at(u.id,7,4)),false);await db.execute("INSERT INTO player_badges(user_id,badge_key)VALUES(?,'violence_badge')",[u.id]);
  assert.equal(await repo.advance(u.id,'open',at(u.id+1,7,4)),false);assert.equal(await repo.advance(u.id,'open',at(u.id,7,8)),false);
  const result=await Promise.all([repo.advance(u.id,'open',at(u.id,7,7)),repo.advance(u.id,'open',at(u.id,9,6))]);assert.equal(result.filter(Boolean).length,1);
  let r=await repo.read(u.id);assert.equal(r.state.stage,'open');assert(r.state.ruined);assert.equal(await repo.win(u.id),false);assert.equal(await repo.completeWake(u.id),false);
  assert(await repo.advance(u.id,'emerge',at(u.id,13,12)));r=await repo.read(u.id);assert.deepEqual(r.state.appearance,{sprite:'sprite.png'});
  assert.equal(await repo.advance(u.id,'emerge',at(u.id,13,12)),false);assert.equal(scene.interaction(at(u.id,13,12),r.progress),'battle');
 }finally{if(u)await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
test('SQL mirror: committed win survives reconnect, wake persists home and the ruined house remains',{skip:!enabled},async()=>{
 let u;try{u=await fixture('violence_badge');await flags(u.id,{mirror_stage:'clone',mirror_ruined:'true'});
  assert.equal((await Promise.all([repo.win(u.id),repo.win(u.id)])).filter(Boolean).length,1);assert.equal((await repo.read(u.id)).state.stage,'won');
  assert(await repo.completeWake(u.id));assert.equal(await repo.completeWake(u.id),false);
  const r=await repo.read(u.id);assert.equal(r.state.stage,'complete');assert(r.state.ruined);assert(scene.blocked(scene.config.map,13,10,r.progress));assert.equal(r.owner.map,'etage');assert.equal(r.owner.x,592);assert.equal(r.owner.y,336);
  assert.equal(await repo.advance(u.id,'open',at(u.id,7,4)),false);
 }finally{if(u)await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
test('SQL mirror: behind and both sides can summon and challenge the clone, without duplicate summons or ownership bypass',{skip:!enabled},async()=>{
 let u;try{u=await fixture();
  for(const[x,y]of[[12,8],[14,8],[10,10],[16,10]]){
   await flags(u.id,{mirror_stage:'open',mirror_ruined:'true'});
   assert.equal(await repo.advance(u.id,'emerge',at(u.id+1,x,y)),false);
   const results=await Promise.all([repo.advance(u.id,'emerge',at(u.id,x,y)),repo.advance(u.id,'emerge',at(u.id,x,y))]);assert.equal(results.filter(Boolean).length,1);
   const r=await repo.read(u.id);assert.equal(r.state.stage,'clone');assert.equal(scene.interaction(at(u.id,x,y),r.progress),'battle');assert.equal(await repo.advance(u.id,'emerge',at(u.id,x,y)),false);
  }
 }finally{if(u)await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
test('SQL mirror: admin replay has its own stage and preserves permanent completion, damage and badges',{skip:!enabled},async()=>{
 let u;try{u=await fixture();await flags(u.id,{mirror_stage:'complete',mirror_ruined:'true'});const before=(await repo.read(u.id)).progress.badges;
  await require('../server/config/database').withTransaction(c=>repo.resetReplay(c,u.id));let r=await repo.read(u.id);assert.equal(r.state.stage,'sealed');assert(!r.state.ruined);
  assert(await repo.advance(u.id,'open',at(u.id,7,4)));await flags(u.id,{admin_mirror_stage:'clone'});assert(await repo.win(u.id));assert(await repo.completeWake(u.id));
  r=await repo.read(u.id);assert.equal(r.progress.flags.mirror_stage,'complete');assert.equal(r.progress.flags.mirror_ruined,'true');assert.deepEqual(r.progress.badges,before);
  await require('../server/config/database').withTransaction(c=>repo.resetReplay(c,u.id));assert.equal((await repo.read(u.id)).state.stage,'sealed');
 }finally{if(u)await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
for(const savedMap of ['route2_maison','etage'])test(`SQL/socket mirror: reconnect from ${savedMap} after a committed win recovers the upstairs bed once`,{skip:!enabled},async()=>{
 let u,socket,server,io;try{
  u=await fixture();await flags(u.id,{mirror_stage:'won',mirror_ruined:'true'});await db.execute('UPDATE users SET map=?,x=?,y=? WHERE id=?',[savedMap,savedMap==='etage'?592:400,savedMap==='etage'?336:208,u.id]);
  const p=factory.create(1,12,true);p.currentHp=0;p.abilities=['Tackle'];p.movePp=[0];await teams.editEquipe(u.id,{pokemons:[p]});
  server=require('node:http').createServer();io=new(require('socket.io').Server)(server);io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);server.listen(0,'127.0.0.1');await require('node:events').once(server,'listening');
  const token=require('../server/config/auth').signAccessToken(u),client=require('../vue-explorakit/node_modules/socket.io-client').io;
  socket=client('http://127.0.0.1:'+server.address().port,{autoConnect:false,auth:{token},transports:['websocket'],reconnection:false});
  const state=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('No recovered state')),10000);socket.on('mirrorRiftState',s=>{if(s.stage==='complete'){clearTimeout(timer);resolve(s);}});});socket.connect();assert((await state).ruined);
  const r=await repo.read(u.id);assert.equal(r.owner.map,'etage');assert.equal(r.owner.x,592);assert.equal(r.owner.y,336);const saved=(await teams.loadEquipe(u.id)).pokemons[0];assert.equal(saved.currentHp,saved.maxHp);assert.equal(saved.movePp[0],35);assert.equal(await repo.completeWake(u.id),false);
 }finally{socket?.disconnect();if(io)await new Promise(r=>io.close(r));await new Promise(r=>setTimeout(r,100));if(u)await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
class Socket extends EventEmitter{
 constructor(){super();this.connected=true;this.events=[];}
 emit(event,data){this.events.push({event,data:JSON.parse(JSON.stringify(data??null))});if(event==='requestAction'){setImmediate(()=>super.emit('actionResponse',{action:'attack',number:0,turnId:data.turnId}));return true;}return super.emit(event,data);}
}
for(const win of [true,false])test(`SQL mirror real duel: ${win?'victory and awakening':'defeat without false completion'}`,{skip:!enabled},async()=>{
 let u;const old=Math.random;try{u=await fixture();await flags(u.id,{mirror_stage:'clone',mirror_ruined:'true',mirror_appearance:'{"sprite":"sprite.png"}'});
  const lead=factory.create(151,35,true),reserve=factory.create(9,35,true);lead.currentHp=1;reserve.currentHp=0;lead.passiveAbility=reserve.passiveAbility=null;lead.heldItem='choice_band';reserve.heldItem='leftovers';lead.abilities=['Tackle'];lead.movePp=[7];reserve.abilities=['Splash'];reserve.movePp=[4];
  const player={...at(u.id,win?12:13,win?8:12),id:'mirror-owner',equipe:{pokemons:[lead,reserve]}};await teams.editEquipe(u.id,player.equipe);
  const [[before]]=await db.execute('SELECT money FROM users WHERE id=?',[u.id]);const training=player.equipe.pokemons.map(p=>({uuid:p.uuid,experience:p.experience,ev:structuredClone(p.ev),level:p.level}));
  const socket=new Socket(),io={sockets:{sockets:new Map([[player.id,socket]])},to:()=>({emit:socket.emit.bind(socket)})};let traveled=null,blackouts=0,busy=false;
  const handlers=require('../server/realtime/handlers/mirrorRiftHandlers').createMirrorRiftHandlers({socket,io,userId:u.id,getPlayer:()=>player,canUse:()=>!busy,setBusy:v=>{busy=v;},emitProgression:()=>{},blackout:async()=>{blackouts++;},travel:async d=>{traveled=d;Object.assign(player,{currentmap:d.map,x:d.x,y:d.y});}});
  Math.random=()=>win?.9:.1;assert(await handlers.interact());
  const intro=socket.events.find(e=>e.event==='introAnimation').data;assert.equal(intro.player.equipe.pokemons[0].currentHp,1);assert.equal(intro.wildPokemon.currentHp,1);assert.notEqual(intro.wildPokemon.uuid,lead.uuid);assert.equal(intro.wildPokemon.heldItem,'choice_band');assert.deepEqual(intro.wildPokemon.movePp,[7]);
  const result=socket.events.find(e=>e.event==='endbattle').data;assert.equal(result.playerWon,win);assert.deepEqual(result.summary.experience,[]);assert.equal(result.summary.money,0);assert.deepEqual(result.summary.loot,[]);
  assert.deepEqual(player.equipe.pokemons.map(p=>({uuid:p.uuid,experience:p.experience,ev:p.ev,level:p.level})),training);assert.equal((await db.execute('SELECT money FROM users WHERE id=?',[u.id]))[0][0].money,before.money);
  assert.equal((await repo.read(u.id)).state.stage,win?'won':'clone');assert.equal(await handlers.awaken(),win);
  if(win){assert.equal(traveled.map,'etage');assert.equal(traveled.x,592);assert.equal(traveled.y,336);assert.equal((await repo.read(u.id)).state.stage,'complete');for(const p of player.equipe.pokemons)assert.equal(p.currentHp,p.maxHp);}else{assert.equal(traveled,null);assert.equal(blackouts,1);}
  assert.deepEqual(player.equipe.pokemons.map(p=>p.heldItem),['choice_band','leftovers']);
 }finally{Math.random=old;if(u)await db.execute('DELETE FROM users WHERE id=?',[u.id]);}
});
