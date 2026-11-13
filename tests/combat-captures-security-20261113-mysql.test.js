const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
if(process.env.RUN_MYSQL_TESTS!=='1'||process.env.DB_NAME!=='explorakit_test')throw Error('Dedicated test database required');
const {dbPool:db}=require('../server/config/database'),users=require('../server/persistence/userRepository'),teams=require('../server/persistence/teamRepository'),pc=require('../server/persistence/pokemonStorageRepository'),items=require('../server/persistence/itemRepository');
const factory=require('../server/game/drift/pokemonFactory'),ids=[];
async function user(){const u=await users.createUserWithStarter('CombatSecure_'+randomUUID().slice(0,12),randomUUID());ids.push(u.id);return u;}
async function stock(id,key,q){await db.execute('INSERT INTO user_items(user_id,item_key,quantity) VALUES(?,?,?) ON DUPLICATE KEY UPDATE quantity=VALUES(quantity)',[id,key,q]);}
async function qty(id,key){return Number((await db.execute('SELECT quantity FROM user_items WHERE user_id=? AND item_key=?',[id,key]))[0][0]?.quantity)||0;}
async function money(id){return Number((await db.execute('SELECT money FROM users WHERE id=?',[id]))[0][0].money);}
test.after(async()=>{for(const id of ids)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end();});

for(const scenario of [{map:'jungle1',count:1,corrupted:false},{map:'jungle9',count:6,corrupted:false},{map:'DC2_44',count:1,corrupted:true}])test(`Master elite capture persists and replays safely: ${JSON.stringify(scenario)}`,async()=>{
 const u=await user(),party=Array.from({length:scenario.count},()=>factory.create(143,200,true));for(const p of party)p.heldItem=null;
 if(scenario.corrupted)party[0].corruption={version:1,revision:1,permanent:true,modules:{}};
 await teams.editEquipe(u.id,{pokemons:party});await stock(u.id,'master_ball',1);
 const enemy=factory.create(130,300,true);require('../server/game/world/darkEncounters').prepare(enemy,scenario.map,()=>0);enemy.recalculateStats();enemy.heldItem=null;enemy.abilities=['Splash'];enemy.movePp=[40];enemy.shiny=true;
 const player={id:'capture',userId:u.id,username:u.username,currentmap:scenario.map,x:400,y:400,equipe:{pokemons:party}},events=[];
 const {DarkBattleController}=require('../server/game/battle/darkBattleController');const c=new DarkBattleController({userId:u.id,getPlayer:()=>player,emit:(e,d)=>events.push([e,d]),random:()=>.999999});
 await c.start(enemy);const token=c.run.battle.token;
 assert(await c.action({action:'bag',itemKey:'master_ball',turnId:token,money:999999999,ev:{attack:99999},catchChance:0}));assert(!c.active);assert.equal(await qty(u.id,'master_ball'),0);
 const owned=[...(await teams.loadEquipe(u.id)).pokemons,...(await pc.loadEntries(u.id)).map(e=>e.pokemon)],captured=owned.find(p=>p.uuid===enemy.uuid);assert(captured);assert.equal(captured.level,300);assert.equal(captured.k,4);assert(captured.shiny);assert(Object.values(captured.ev).every(v=>v===0));assert(Object.values(captured.iv).every(v=>v===31));assert(captured.currentHp>0&&captured.currentHp<=captured.maxHp);
 const stored=(await pc.loadEntries(u.id)).some(e=>e.pokemon.uuid===enemy.uuid);assert.equal(stored,scenario.count===6||scenario.corrupted);assert((await teams.loadEquipe(u.id)).pokemons.filter(p=>p.corruption?.permanent).length<=1);
 const before=await money(u.id),count=owned.length;assert.equal(await c.action({action:'bag',itemKey:'master_ball',turnId:token}),false);
 const re=new DarkBattleController({userId:u.id,getPlayer:()=>player,emit(){}});await re.load();assert(!re.active);assert.equal(await qty(u.id,'master_ball'),0);assert.equal(await money(u.id),before);assert.equal((await teams.loadEquipe(u.id)).pokemons.length+(await pc.loadEntries(u.id)).length,count);
 assert.equal(Number((await db.execute('SELECT caught_count FROM user_pokedex WHERE user_id=? AND pokemon_id=130',[u.id]))[0][0].caught_count),1);assert(events.some(([e,d])=>e==='captureAnimation'&&d.success));
});
test('resale transactions enforce catalog price, stock, valid quantities and single debit under simultaneous replay',async()=>{
 const u=await user();await stock(u.id,'master_ball',1);await stock(u.id,'exp_share',1);const before=await money(u.id);
 const results=await Promise.all(Array.from({length:4},()=>items.sellUserItem(u.id,'master_ball',1,{mapName:'ville1_shop',unitPrice:999999999})));
 assert.equal(results.filter(r=>r.success).length,1);assert.equal(await money(u.id),before+2000000);assert.equal(await qty(u.id,'master_ball'),0);
 for(const n of [-1,0,1.5,Infinity,100])assert.equal((await items.sellUserItem(u.id,'exp_share',n,{mapName:'ville1_shop'})).success,false);
 assert.equal((await items.sellUserItem(u.id,'exp_share',1,{mapName:'start'})).success,false);
 assert((await items.sellUserItem(u.id,'exp_share',1,{mapName:'ville1_shop'})).success);assert.equal(await money(u.id),before+2000100);
});
test('real authenticated HTTP + live Socket: legacy equipment cannot duplicate cached items; injected party/stats/money and foreign UUIDs are refused', {timeout:30000},async()=>{
 process.env.NODE_ENV='test';const express=require('express'),http=require('node:http'),{once}=require('node:events'),{Server}=require('socket.io'),client=require('../vue-explorakit/node_modules/socket.io-client').io;
 const u=await user(),other=await user(),team=await teams.getTeamRecord(u.id),pokemon=(await teams.loadEquipe(u.id)).pokemons[0],foreign=(await teams.loadEquipe(other.id)).pokemons[0];
 await stock(u.id,'leftovers',1);await items.equipHeldItem(u.id,team.id,pokemon.uuid,'leftovers');await require('../server/persistence/playerRepository').saveUserPosition(u.id,{map:'centre',x:400,y:400});
 const app=express(),server=http.createServer(app),io=new Server(server);app.use(express.json());app.use('/api',require('../server/http/routes'));io.use(require('../server/http/authMiddleware').authenticateSocket);require('../server/realtime/socketHandler')(io);
 const token=require('../server/config/auth').signAccessToken(u),sockets=[];
 const event=(s,e)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Missing '+e)),6000);s.once(e,d=>{clearTimeout(timer);resolve(d);});});
 const command=(s,e,...args)=>new Promise((resolve,reject)=>s.timeout(6000).emit(e,...args,(err,r)=>err?reject(err):resolve(r)));
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
  const put=(path,body,auth=token)=>fetch(base+'/api'+path,{method:'PUT',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const heldPath=`/teams/${team.id}/pokemons/${pokemon.uuid}/held-item`;
  assert.equal((await put(heldPath,{itemKey:null},'forged')).status,401);
  assert.equal((await put(`/teams/${team.id}/pokemons/${foreign.uuid}/held-item`,{itemKey:null})).status,404);
  const socket=client(base,{autoConnect:false,auth:{token},transports:['websocket'],forceNew:true,reconnection:false});sockets.push(socket);const ready=event(socket,'playersList');socket.connect();await ready;
  const before=await money(u.id),stats=JSON.stringify((await teams.loadEquipe(u.id)).pokemons[0].ev);
  for(let n=0;n<3;n++){
   assert.equal((await put(heldPath,{itemKey:null,quantity:1000000,money:999999999})).status,409);
   assert((await command(socket,'requestGameSave')).success);assert.equal(await qty(u.id,'leftovers'),0);assert.equal((await teams.loadEquipe(u.id)).pokemons[0].heldItem,'leftovers');
  }
  assert.equal((await put(`/teams/${team.id}/pokemons/reorder`,{orderedUuids:[pokemon.uuid]})).status,409);
  assert.equal((await put(`/teams/${team.id}/pokemons/${pokemon.uuid}`,{ev:{attack:99999},iv:{hp:99999},level:3000})).status,404);
  const fake={teamId:team.id,pokemonUuid:foreign.uuid,itemKey:null};assert.equal((await command(socket,'equipHeldItem',fake)).success,false);
  assert.equal((await command(socket,'reorderTeam',{orderedUuids:[foreign.uuid]})).success,false);
  assert.equal((await command(socket,'equipHeldItem',{teamId:team.id,pokemonUuid:pokemon.uuid,itemKey:'leftovers',quantity:-100,money:999999999})).success,true);
  assert.equal(await qty(u.id,'leftovers'),0);assert.equal(await money(u.id),before);assert.equal(JSON.stringify((await teams.loadEquipe(u.id)).pokemons[0].ev),stats);
  assert((await command(socket,'equipHeldItem',{teamId:team.id,pokemonUuid:pokemon.uuid,itemKey:null})).success);assert.equal(await qty(u.id,'leftovers'),1);assert((await command(socket,'requestGameSave')).success);assert.equal((await teams.loadEquipe(u.id)).pokemons[0].heldItem,null);
  socket.disconnect();await require('../server/realtime/accountConnection').waitForAccountConnections(io);
  assert.equal((await put(heldPath,{itemKey:'leftovers'})).status,200);assert.equal(await qty(u.id,'leftovers'),0);
 }finally{sockets.forEach(s=>s.disconnect());await new Promise(r=>io.close(r));await require('../server/realtime/accountConnection').waitForAccountConnections(io);}
});
