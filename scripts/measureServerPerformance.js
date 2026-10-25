// No production I/O: synthetic expeditions use the real logic and serializer.
const fs=require('node:fs'),{performance}=require('node:perf_hooks'),{createHash}=require('node:crypto');
const terrain=require('../server/game/world/mapRepository'),codec=require('../server/game/drift/checkpointCodec');
const {createLobbyStore}=require('../server/game/drift/lobbyStore'),{createRunManager}=require('../server/game/drift/runManager');
const factory=require('../server/game/drift/pokemonFactory'),world=require('../data/game/nextMap.json').maps;
const time=100000,store=createLobbyStore({now:()=>time}),runtime=createRunManager({store,namespace:{to:()=>({emit(){}})},now:()=>time,random:()=>.9,starterChoiceMs:0});
for(let id=1;id<=8;id++)store.connect({id,username:'performance_'+id},'s'+id);
const {code}=store.create({id:1},{capacity:8,durationMinutes:30});for(let id=2;id<=8;id++)store.join({id},code);for(let id=1;id<=8;id++)store.ready({id},true);runtime.start({id:1});
for(const p of runtime.runs.values().next().value.players.values())p.equipe.pokemons=[1,6,9,94,130,376].map(id=>factory.create(id,55,true));
function bench(fn,count){for(let n=0;n<20;n++)fn();const samples=[];for(let n=0;n<count;n++){const t=performance.now();fn();samples.push(performance.now()-t);}samples.sort((a,b)=>a-b);return{count,meanMs:samples.reduce((s,v)=>s+v,0)/count,p95Ms:samples[Math.floor(count*.95)]};}
(async()=>{
 const hashes=[];for(const m of world){try{hashes.push({map:m.mapName,hash:createHash('sha256').update(JSON.stringify([terrain.loadCollisionData(m.mapName),terrain.changeMapData(m.mapName),terrain.battleMapData(m.mapName),terrain.InteractMapData(m.mapName)])).digest('hex')});}catch(e){hashes.push({map:m.mapName,error:e.message});}}
 const layers=bench(()=>{for(const m of ['start','route2','ville1_arene','ville_safe1_arene','centre']){terrain.loadCollisionData(m);terrain.changeMapData(m);terrain.battleMapData(m);}},1000);
 const root={savedAt:time,lobbies:store.exportLobbies(),runs:runtime.runs};const checkpoint=bench(()=>codec.encode(root),30),bytes=codec.encode(root);let asyncEncode=null;
 if(codec.encodeAsync){const t=performance.now();let timerAt;const timer=new Promise(r=>setTimeout(()=>{timerAt=performance.now();r();},0));const encoded=await codec.encodeAsync(root);await timer;asyncEncode={totalMs:performance.now()-t,timerDelayMs:timerAt-t,bytes:encoded.length,identical:encoded.equals(bytes)};}
 const p=runtime.playerFor({id:1}),state=runtime.state(p);const report={node:process.version,maps:hashes.length,layerHashes:hashes,layers,checkpoint:{...checkpoint,bytes:bytes.length,asyncEncode},fullStateBytes:Buffer.byteLength(JSON.stringify(state)),movementStateBytes:runtime.movementState?Buffer.byteLength(JSON.stringify(runtime.movementState(p))):null};
 runtime.fishing.stop();console.log(JSON.stringify(report,null,2));if(process.env.PERF_REPORT_OUT)fs.writeFileSync(process.env.PERF_REPORT_OUT,JSON.stringify(report,null,2)+'\n');
})().catch(e=>{console.error(e.stack);process.exitCode=1});
