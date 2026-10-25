const test=require('node:test'),assert=require('node:assert/strict');
const {encode,encodeAsync,decode}=require('../server/game/drift/checkpointCodec');
const {createLobbyStore}=require('../server/game/drift/lobbyStore');
const {registerDriftLobbies}=require('../server/realtime/driftLobbyHandler');
const terrain=require('../server/game/world/mapRepository');
const {staticAssetHeaders}=require('../server/http/staticAssets');
const fakeIo=()=>({of:()=>({use(){},on(){},to:()=>({emit(){}}),sockets:new Map()})});

test('immutable map grids are reused without merging alias-specific logical doors',()=>{
 const world=require('../data/game/nextMap.json').maps;
 for(const {mapName}of world){
  for(const method of ['loadCollisionData','changeMapData','battleMapData','InteractMapData']){
   let grid;try{grid=terrain[method](mapName);}catch{continue;}
   assert.equal(terrain[method](mapName),grid);assert(Object.isFrozen(grid));
   for(const row of grid)assert(Object.isFrozen(row));
  }
  for(const door of world.find(m=>m.mapName===mapName).mapchange.filter(d=>d.logicalDoor)){
   assert.equal(terrain.changeMapData(mapName)[door.valY][door.valX],1,mapName);
  }
 }
 assert.notEqual(terrain.changeMapData('centre'),terrain.changeMapData('ville1_shop'));
});

test('async checkpoint keeps the exact format, snapshots before yielding, and preserves graph identity',async()=>{
 const member={hp:23},root={savedAt:123,runs:new Map([['r',{team:[member,member]}]])};
 const expected=encode(root),pending=encodeAsync(root);member.hp=1;
 const actual=await pending;assert(actual.equals(expected));
 const saved=decode(actual),team=saved.runs.get('r').team;assert.equal(team[0].hp,23);assert.equal(team[0],team[1]);
});

test('idle checkpoints write once, then save new lobbies and their removal',async()=>{
 const store=createLobbyStore();let writes=0,last;
 const cleanup=registerDriftLobbies(fakeIo(),{store,checkpointRepository:{async save(p){writes++;last=decode(p);}}});
 try{
  for(let n=0;n<60;n++)await cleanup.checkpoint();assert.equal(writes,1);
  store.connect({id:1,username:'fixture'},'s1');store.create({id:1},{capacity:2,durationMinutes:30});
  await cleanup.checkpoint();assert.equal(writes,2);assert.equal(last.lobbies.length,1);
  store.leave({id:1});await cleanup.checkpoint();await cleanup.checkpoint();assert.equal(writes,3);assert.equal(last.lobbies.length,0);
 }finally{cleanup();}
});

test('checkpoint confirmations wait for the durable write, failed saves retry and stay ordered',async()=>{
 let release,attempts=0,active=0,maxActive=0,first=true;
 const store=createLobbyStore();store.connect({id:1,username:'fixture'},'s1');store.create({id:1},{capacity:2,durationMinutes:30});
 const cleanup=registerDriftLobbies(fakeIo(),{store,checkpointRepository:{async save(){
  attempts++;active++;maxActive=Math.max(maxActive,active);
  try{if(first){first=false;await new Promise(r=>{release=r;});throw Error('controlled write failure');}}
  finally{active--;}
 }}});
 try{
  let confirmed=false;const firstWrite=cleanup.checkpoint().then(()=>{confirmed=true;},()=>{});
  while(!release)await new Promise(r=>setImmediate(r));
  assert.equal(confirmed,false);const secondWrite=cleanup.checkpoint();release();await firstWrite;await secondWrite;
  assert.equal(confirmed,false);assert.equal(attempts,2);assert.equal(maxActive,1);
 }finally{cleanup();}
});

test('only hashed assets receive immutable caching, HTML revalidates and worker/sprites keep their policy',()=>{
 for(const [file,expected]of [['game.f64a2425.js','public, max-age=31536000, immutable'],['app.1234abcd.css','public, max-age=31536000, immutable'],['index.html','no-cache'],['service-worker.js',undefined],['manifest.webmanifest',undefined],['493.png',undefined],['game.f64a2425.js.map',undefined]]){
  const headers={};staticAssetHeaders({setHeader:(k,v)=>{headers[k]=v;}},'/dist/'+file);assert.equal(headers['Cache-Control'],expected);
 }
});
