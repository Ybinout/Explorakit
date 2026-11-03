const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{once}=require('node:events'),{randomUUID}=require('node:crypto');
const enabled=process.env.RUN_MYSQL_TESTS==='1';
test('SQL/socket Dark: save before land/fishing battle; immediate reconnect retains island, HP/PP and deaths; failed save prevents battle',{skip:!enabled,timeout:60000},async()=>{
 assert.equal(process.env.DB_NAME,'explorakit_test');process.env.NODE_ENV='test';process.env.BATTLE_DELAY_SCALE='0';
 const {dbPool:db}=require('../server/config/database'),users=require('../server/persistence/userRepository'),teams=require('../server/persistence/teamRepository'),storage=require('../server/persistence/pokemonStorageRepository'),factory=require('../server/game/drift/pokemonFactory'),terrain=require('../server/game/world/mapRepository'),dc=require('../server/game/world/darkContinent');
 const handlers=require('../server/realtime/handlers/darkContinentHandlers'),createHandlers=handlers.createHandlers,registry=new Map();handlers.createHandlers=o=>{registry.set(o.userId,o);return createHandlers(o);};
 const positions=require('../server/persistence/playerRepository'),savePosition=positions.saveUserPosition;let failId=null;
 positions.saveUserPosition=async(id,p)=>{if(id===failId)throw Error('injected_dark_checkpoint_failure');return savePosition(id,p);};
 const rates=require('../server/game/world/encounterRate'),chance=rates.WILD_ENCOUNTER_CHANCE;rates.WILD_ENCOUNTER_CHANCE=1;
 const wildPath=require.resolve('../server/game/world/wildPokemonFactory'),realWild=require(wildPath);
 const adjust=p=>{p.abilities=['Tackle'];p.movePp=[35];p.passiveAbility=null;return p;};
 const fakeWild=async(map,random,options)=>adjust(await realWild(map,()=>.5,options));fakeWild.createAtLevel=async(id,level,options)=>adjust(await realWild.createAtLevel(id,level,{...options,random:()=>.5}));require.cache[wildPath].exports=fakeWild;
 const fishingModule=require('../server/game/world/fishingController'),createFishing=fishingModule.createFishingController;
 fishingModule.createFishingController=o=>createFishing({...o,setTimer:(fn,ms)=>setTimeout(fn,[650,250].includes(ms)||ms>=2200&&ms<=5500?1:ms)});
 const express=require('express'),{Server}=require('socket.io'),{io:client}=require('../vue-explorakit/node_modules/socket.io-client');
 const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));io.use(require('../server/http/authMiddleware').authenticateSocket);
 // Optional isolated baseline probe: compiles the committed source in memory, never edits live files.
 if(process.env.DARK_RECONNECT_BASELINE==='1'){
  const path=require('node:path'),Module=require('node:module'),filename=require.resolve('../server/realtime/socketHandler'),prior=new Module(filename,module);
  prior.filename=filename;prior.paths=Module._nodeModulePaths(path.dirname(filename));prior._compile(require('node:child_process').execFileSync('git',['show','7b3c618aa240eff641e108591133331f765f460f:server/realtime/socketHandler.js'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'}),filename);require.cache[filename]=prior;
 }
 require('../server/realtime/socketHandler')(io);
 const accounts=[],sockets=[],checks=[];let base;
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 function event(s,name,filter=()=>true){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{s.off(name,done);reject(Error('Missing '+name));},7000);function done(data){if(filter(data)){clearTimeout(timer);s.off(name,done);resolve(data);}}s.on(name,done);});}
 async function connect(a,polling=false){const s=client(base,{autoConnect:false,forceNew:true,reconnection:false,transports:[polling?'polling':'websocket'],auth:{token:a.token}});sockets.push(s);const ready=event(s,'playersList');s.connect();const list=await ready;assert(list[s.id]);return {s,p:list[s.id]};}
 async function account(map,kind='normal'){
  const a=await users.createUserWithStarter('dark_reco_'+randomUUID().slice(0,12),randomUUID(),{starterId:7});const token=require('../server/config/auth').signAccessToken(a);accounts.push(a);a.token=token;
  const lead=factory.create(143,kind==='replacement'||kind==='loss'?5:kind==='repel'?90:200,true);lead.abilities=['Splash'];lead.movePp=[40];lead.passiveAbility=null;lead.heldItem=null;lead.currentHp=kind==='replacement'||kind==='loss'?1:lead.maxHp-15;
  const reserve=factory.create(9,200,true);reserve.passiveAbility=null;await teams.editEquipe(a.id,{pokemons:kind==='replacement'?[lead,reserve]:[lead]});
  if(kind==='loss')await storage.storeCapturedPokemon(a.id,reserve);
  const grid=terrain.loadCollisionData(map),battle=terrain.battleMapData(map),change=terrain.changeMapData(map);let spot;
  for(let y=2;y<grid.length-2&&!spot;y++)for(let x=2;x<grid[y].length-2&&!spot;x++)if(grid[y][x]===0&&grid[y][x+1]===0&&battle[y]?.[x+1]&&!change[y]?.[x]&&!change[y]?.[x+1]&&!dc.actors(map).some(n=>[x,x+1].includes(n.x)&&[n.y,n.y-1].includes(y)))spot={x:x*32+16,y:y*32+16};
  assert(spot,map+' grass approach');await db.execute('UPDATE users SET map=?,x=?,y=?,money=12345,repel_steps=? WHERE id=?',[map,spot.x,spot.y,kind==='repel'?1:0,a.id]);
  for(const [key,value]of [['adventure_opening','complete'],['dark_rules_read','true']])await db.execute('INSERT INTO player_story_flags(user_id,flag_key,flag_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE flag_value=VALUES(flag_value)',[a.id,key,value]);
  for(const key of [dc.ITEM,'fishing_rod'])await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,1)',[a.id,key]);
  return {...a,lead,reserve,spot};
 }
 async function stalePosition(id){await db.execute("UPDATE users SET map='start',x=80,y=208 WHERE id=?",[id]);}
 async function saved(id){return (await db.execute('SELECT map,x,y,money,repel_steps FROM users WHERE id=?',[id]))[0][0];}
 async function enterFight(a,kind='land'){
  const first=await connect(a),{s}=first,p=registry.get(a.id).getPlayer();
  if(kind==='fishing'){
   const {waterNear}=require('../server/game/world/fishingWaters'),grid=terrain.loadCollisionData(p.currentmap),change=terrain.changeMapData(p.currentmap);let shore;
   for(let y=2;y<grid.length-2&&!shore;y++)for(let x=2;x<grid[y].length-2&&!shore;x++)if(grid[y][x]===0&&!change[y]?.[x]&&!dc.interactionActor({currentmap:p.currentmap,x:x*32+16,y:y*32+16})&&waterNear({currentmap:p.currentmap,x:x*32+16,y:y*32+16,direction:'up'}))shore={x:x*32+16,y:y*32+16};
   assert(shore);await registry.get(a.id).travel({map:p.currentmap,...shore});
  }
  await stalePosition(a.id);const trigger=event(s,'battletrigger'),prompt=event(s,'requestAction');
  if(kind==='land')s.emit('playerAction','move_d');else{
   const offered=event(s,'fishingState',v=>v.phase==='offer'),bite=event(s,'fishingState',v=>v.phase==='bite');s.emit('Space');const offer=await offered;s.emit('fishing:start',{id:offer.id});await bite;s.emit('fishing:reel',{id:offer.id});
  }
  await trigger;const action=await prompt,row=await saved(a.id);assert.equal(row.map,p.currentmap,'checkpoint must precede battle UI, not wait for autosave');assert.equal(row.x,p.x);assert.equal(row.y,p.y);return{s,p,action};
 }
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;
  for(let n=1;n<=9;n++){
   const a=await account('jungle'+n),{s,p,action}=await enterFight(a);const next=event(s,'requestAction');s.emit('actionResponse',{action:'attack',number:0,turnId:action.turnId});await next;
   const expected=p.equipe.pokemons.map(q=>({uuid:q.uuid,hp:q.currentHp,pp:[...q.movePp],xp:q.experience})),where={map:p.currentmap,x:p.x,y:p.y};assert.equal(expected[0].pp[0],39);
   s.disconnect();const re=await connect(a,n%2===0);assert.equal(re.p.currentmap,where.map);assert.equal(re.p.x,where.x);assert.equal(re.p.y,where.y);
   const persisted=(await teams.loadEquipe(a.id)).pokemons;assert.deepEqual(persisted.map(q=>({uuid:q.uuid,hp:q.currentHp,pp:q.movePp,xp:q.experience})),expected);assert.equal((await saved(a.id)).money,12345);re.s.disconnect();checks.push('land '+n);
  }
  for(const map of ['jungle1','jungle2','jungle3']){const a=await account(map),{s,p}=await enterFight(a,'fishing'),hp=p.equipe.pokemons[0].currentHp;s.disconnect();const re=await connect(a);assert.equal(re.p.currentmap,map);assert.equal((await teams.loadEquipe(a.id)).pokemons[0].currentHp,hp);re.s.disconnect();checks.push('fishing '+map);}
  const spent=await account('jungle9','repel'),spentFight=await enterFight(spent);assert.equal(spentFight.p.repelSteps,0);assert.equal((await saved(spent.id)).repel_steps,0,'forced checkpoint preserves the last consumed repel step');spentFight.s.disconnect();const spentReconnect=await connect(spent);assert.equal(spentReconnect.p.currentmap,'jungle9');assert.equal(registry.get(spent.id).getPlayer().repelSteps,0);assert.equal((await saved(spent.id)).repel_steps,0);spentReconnect.s.disconnect();checks.push('expired repel stays expired');
  const a=await account('jungle4','replacement'),f=await enterFight(a),choice=event(f.s,'requestAction',v=>Boolean(v.replacementId));f.s.emit('actionResponse',{action:'attack',number:0,turnId:f.action.turnId});await choice;f.s.disconnect();const re=await connect(a);assert.equal(re.p.currentmap,'jungle4');assert.deepEqual((await teams.loadEquipe(a.id)).pokemons.map(p=>p.uuid),[a.reserve.uuid]);re.s.disconnect();checks.push('replacement death remains permanent');
  const b=await account('jungle5','loss'),loss=await enterFight(b),end=event(loss.s,'endbattle');loss.s.emit('actionResponse',{action:'attack',number:0,turnId:loss.action.turnId});await end;loss.s.disconnect();const rescued=await connect(b);assert.equal(rescued.p.currentmap,'centre');assert.deepEqual((await teams.loadEquipe(b.id)).pokemons.map(p=>p.uuid),[b.reserve.uuid]);rescued.s.disconnect();checks.push('true defeat still rescues');
  const bad=await account('jungle7'),connected=await connect(bad);failId=bad.id;let triggered=false;connected.s.on('battletrigger',()=>triggered=true);const rejected=event(connected.s,'progressionNotice',v=>v.message?.includes('sauvegardée'));connected.s.emit('playerAction','move_d');await rejected;await pause(70);assert(!triggered);assert.equal(registry.get(bad.id).getPlayer().inbattle,false);failId=null;connected.s.disconnect();checks.push('failed checkpoint blocks fight');
  assert.equal(checks.length,16);console.log(JSON.stringify({darkReconnectChecks:checks}));
 }finally{
  if(checks.length!==16)console.log(JSON.stringify({completedDarkReconnectChecks:checks}));
  failId=null;sockets.forEach(s=>s.disconnect());require('../server/realtime/whitepeakClub').getClub(io).close();await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);
  handlers.createHandlers=createHandlers;fishingModule.createFishingController=createFishing;positions.saveUserPosition=savePosition;rates.WILD_ENCOUNTER_CHANCE=chance;require.cache[wildPath].exports=realWild;
  for(const a of accounts)await db.execute('DELETE FROM users WHERE id=?',[a.id]);await db.end();
 }
});
