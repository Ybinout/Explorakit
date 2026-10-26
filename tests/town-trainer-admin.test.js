const test=require('node:test'),assert=require('node:assert/strict');
const store=require('../server/game/world/pnjStore'),maps=require('../server/game/world/mapRepository');
const policy=require('../server/game/world/arenaTests'),dialogue=require('../server/game/world/interactionRepository'),catalog=require('../data/game/progression.json');
const names=['town_lina','town_bastien'];
test('Maria and Clément have real unique trainer encounters, personal admin retries, and Clément stays on open pavement',()=>{
 const p=store.getPnjsForMap('ville1').find(n=>n.name==='town_bastien'),terrain=maps.loadCollisionData(p.map);
 assert.equal(p.roamRadius,0,'Clément cannot wander back behind the building');
 for(const y of [p.y,p.y-1]){assert.equal(terrain[y][p.x],0);assert.equal(store.getPnjAtTile(p.map,p.x,y).name,p.name);assert(store.isPnjBlockingTile(p.map,p.x,y));}
 assert([[0,1],[1,0],[-1,0]].every(([dx,dy])=>terrain[p.y+dy][p.x+dx]===0));
 const progress={flags:{},completedNpcBattles:names.map(battleKey=>({battleKey}))};
 for(const name of names){
  assert.equal(catalog.npcBattles[name].once,true);assert.equal(catalog.npcBattles[name].experienceKind,'trainer');
  assert.equal(dialogue.getEndSentenceInformation(name),'battle');assert(require('../server/game/world/pnjTeamFactory').getPnjTeam(dialogue.getTeamInformation(name)).pokemons.length>0);
  const encounter=policy.encounters.find(c=>c.name===name);assert(encounter);progress.flags[encounter.flag]='ready';
  assert(policy.canReplay({id:4,username:'binout'},name,progress));assert(!policy.canReplay({id:5,username:'binout'},name,progress));
  assert.equal(dialogue.getSentenceForName(name,progress)[1],name+'_after');assert.equal(dialogue.getSentenceForName(name,progress,{replayArena:true})[1],name);
 }
});

test('SQL/socket Maria and Clément: admin reset, two actual victories, no repeat gains, persistence and other-player isolation',{skip:process.env.RUN_MYSQL_TESTS!=='1',timeout:40000},async()=>{
 assert.match(process.env.DB_NAME||'',/test/i);process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
 const http=require('node:http'),{once}=require('node:events'),{randomUUID}=require('node:crypto'),express=require('express'),{Server}=require('socket.io'),{io:client}=require('../vue-explorakit/node_modules/socket.io-client');
 const {dbPool:db}=require('../server/config/database'),progression=require('../server/persistence/progressionRepository'),teamRepo=require('../server/persistence/teamRepository');
 const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
 const ids=[],sockets=[],oldOwner=policy.isOwner,pause=ms=>new Promise(r=>setTimeout(r,ms));let base,phase="setup";
 const event=(s,name,match=()=>true)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{s.off(name,handler);reject(Error('Missing '+name+' during '+phase));},9000);function handler(p){if(!match(p))return;clearTimeout(timer);s.off(name,handler);resolve(p);}s.on(name,handler);});
 const reset=s=>new Promise(resolve=>s.emit('admin:rearmArenas',{},resolve));
 async function create(){const r=await fetch(base+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'town_admin_'+randomUUID(),password:randomUUID(),starterId:7})});assert.equal(r.status,201);const u=await r.json();ids.push(u.user.id);return u;}
 async function connect(u,name){const n=store.getPnjsForMap('ville1').find(n=>n.name===name);await db.execute("UPDATE users SET map='ville1',x=?,y=? WHERE id=?",[n.x*32+16,(n.y+1)*32+16,u.user.id]);const s=client(base,{autoConnect:false,auth:{token:u.token},transports:['websocket'],reconnection:false});sockets.push(s);const ready=event(s,'adminArenaState');s.connect();await ready;return s;}
 async function protectedState(id){const p=await progression.loadProgressState(id),team=await teamRepo.loadEquipe(id);return{money:p.money,completed:p.completedNpcBattles.map(b=>b.battleKey).sort(),flags:Object.fromEntries(Object.entries(p.flags).filter(([k])=>!k.startsWith('admin_'))),training:team.pokemons.map(p=>({id:p.data.id,uuid:p.uuid,experience:p.experience,level:p.level,k:p.k,iv:p.iv,ev:p.ev}))};}
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
  const admin=await create(),other=await create();policy.isOwner=u=>u?.id===admin.user.id&&u?.username===admin.user.username;
  for(const u of [admin,other])for(const name of names)assert((await progression.completeNpcBattle(u.user.id,name)).granted);
  const lead=require('../server/game/drift/pokemonFactory').create(150,200,true);lead.k=4;lead.recalculateStats();lead.currentHp=lead.maxHp;lead.abilities=[];lead.movePp=[];lead.addAbility('Psychic');await teamRepo.editEquipe(admin.user.id,{pokemons:[lead]});
  let s=await connect(admin,names[0]);let visitor=await connect(other,names[0]);assert.equal((await reset(visitor)).success,false);visitor.disconnect();await pause(100);
  const before=await protectedState(admin.user.id),otherBefore=await protectedState(other.user.id);
  phase='normal post-victory Maria';const oldSpeech=event(s,'dialogue');s.emit('Space');assert.equal((await oldSpeech)[1],names[0]+'_after');s.emit('onEndDialogue',names[0]+'_after');await pause(100);
  assert.equal((await reset(s)).count,2);
  for(const name of names){
   if(name!==names[0]){s.disconnect();await pause(180);s=await connect(admin,name);}
   assert(policy.canReplay(admin.user,name,await progression.loadProgressState(admin.user.id)));
   phase='replay dialogue '+name;const speech=event(s,'dialogue');s.emit('Space');assert.equal((await speech)[1],name);
   phase='replay battle/followup '+name;const trigger=event(s,'battletrigger'),end=event(s,'endbattle'),after=event(s,'dialogue',d=>d[1]===name+'_after');s.on('requestAction',()=>s.emit('actionResponse',{action:'attack',number:0}));s.emit('onEndDialogue',name);
   const [started,outcome,followup]=await Promise.all([trigger,end,after]);assert.equal(started.trainerKey,name);assert.equal(outcome.summary.outcome,'victory');assert.equal(outcome.summary.money,0);assert.equal(followup[2].afterBattle,true);s.emit('onEndDialogue',name+'_after');await pause(100);s.removeAllListeners('requestAction');
   assert(!policy.canReplay(admin.user,name,await progression.loadProgressState(admin.user.id)));
  }
  assert.deepEqual(await protectedState(admin.user.id),before);assert.deepEqual(await protectedState(other.user.id),otherBefore);
  assert.equal((await reset(s)).count,2);assert.equal((await progression.loadProgressState(admin.user.id)).testReplays.filter(n=>names.includes(n)).length,2);
  visitor=await connect(other,names[0]);phase='other player post-victory Maria';const readOnly=event(visitor,'dialogue');visitor.emit('Space');assert.equal((await readOnly)[1],names[0]+'_after');
 }finally{for(const s of sockets)s.disconnect();await new Promise(r=>io.close(r));await pause(250);policy.isOwner=oldOwner;for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();}
});
