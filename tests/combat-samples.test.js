const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..'),catalogue=require('../vue-explorakit/src/data/combatAudio.json'),manifest=require('../vue-explorakit/assets/combat-audio/manifest.json');
test('all 640 moves resolve in English and French; the 17 generic entries are explicit',async()=>{
 const {moveSample}=await import('../vue-explorakit/src/services/battleSamples.js'),moves=require('../data/game/moves.json');assert.equal(moves.length,640);assert.equal(Object.keys(catalogue.moves).length,640);
 const missing=[];for(const m of moves){const row=catalogue.moves[m.id];assert.equal(moveSample(catalogue,m.ename),row.file);assert.equal(moveSample(catalogue,row.label,'fr'),row.file);if(!row.file)missing.push(m.ename);else assert(manifest.samples[row.file]);}
 assert.equal(missing.length,17);assert(missing.includes('Assist'));assert.equal(moveSample(catalogue,'Vampi-Poing'),'moves/409.mp3');
});
test('every species has a cry, and simultaneous entrances select only the local side without revealing Illusion',async()=>{
 const {crySample,entryCry}=await import('../vue-explorakit/src/services/battleSamples.js');for(const p of require('../data/game/pokedex.json'))assert(manifest.samples[crySample(catalogue,{data:{id:p.id}})]);
 const foe={own:false,pokemon:{data:{id:143},currentHp:100}},own={own:true,pokemon:{data:{id:9},currentHp:100}};assert.equal(entryCry([foe,own]),own);assert.equal(entryCry([foe]),foe);assert.equal(entryCry([{...own,pokemon:{currentHp:0}}]),null);
 assert.equal(crySample(catalogue,{data:{id:571},__battle:{illusion:{id:25}}}),'cries/25.mp3');assert.equal(crySample(catalogue,{storyActor:'professor',data:{id:1}}),null);
});
test('audio packs verify every sample and reject tampering and missing files',()=>{
 const {unpack}=require('../vue-explorakit/scripts/unpackCombatAudio.cjs');let count=0;for(const p of manifest.packs){const data=fs.readFileSync(root+'/vue-explorakit/assets/combat-audio/'+p.file);unpack(data,p.files,(_name,b)=>{assert(b.length>100);count++;});const invalid={...p.files};delete invalid[Object.keys(invalid)[0]];assert.throws(()=>unpack(data,invalid,()=>{}),/checksum/);}
 assert.equal(count,1432);const invalid=zlib.gzipSync(Buffer.alloc(1024));assert.throws(()=>unpack(invalid,{'moves/1.mp3':{}},()=>{}),/Incomplete/);
});
test('sample loading deduplicates, enforces the LRU budget, never queues late audio, and releases sources and fetches',async()=>{
 const {BattleSamples,ENTRY_BLOOM_DELAY}=await import('../vue-explorakit/src/services/battleSamples.js');let requests=0,fallbacks=0,starts=0,disconnects=0;const startTimes=[],parameter={setValueAtTime(){},exponentialRampToValueAtTime(){},cancelScheduledValues(){},setTargetAtTime(){}};
 const context={currentTime:0,decodeAudioData:async()=>({length:1000,numberOfChannels:1,duration:.1}),createBufferSource:()=>({connect(){},disconnect(){disconnects++;},start(at){starts++;startTimes.push(at);},stop(){}}),createGain:()=>({connect(){},disconnect(){disconnects++;},gain:parameter})};
 const audio={volume:1,context,output:{},ready:()=>true,ensureContext(){},playPlan(){fallbacks++;}};
 const bank=new BattleSamples(audio,catalogue,{maxBytes:8000,fetcher:async()=>{requests++;return{ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};}});
 assert.equal(bank.move('Gust'),false);assert.equal(fallbacks,1);assert.equal(starts,0);await Promise.all([bank.load('moves/1.mp3'),bank.load('moves/1.mp3')]);assert.equal(requests,1);assert.equal(starts,0);
 assert(bank.play('moves/1.mp3'));bank.play('moves/1.mp3');assert.equal(bank.channels.size,1);assert(disconnects>=2);await bank.load('moves/2.mp3');await bank.load('moves/3.mp3');assert.equal(bank.bytes,8000);assert.equal(bank.cache.size,2);assert(!bank.cache.has('moves/1.mp3'));
 await bank.load('../../secret');assert.equal(requests,3);await bank.load('cries/9.mp3');bank.cry({data:{id:9}},{delay:ENTRY_BLOOM_DELAY});assert.equal(startTimes.at(-1),.34);bank.dispose();assert.equal(bank.channels.size,0);assert.equal(bank.bytes,0);assert.equal(await bank.load('moves/4.mp3'),null);
});
test('all ordinary and corrupted Balls retain their own accent and valid compact SVG markings',async()=>{
 const {pokeBallStyle,ballMark}=await import('../vue-explorakit/src/services/pokeBallStyle.js');const balls=require('../data/game/items.json').items.filter(i=>i.category==='ball');assert.equal(balls.length,31);
 for(const b of balls){const style=pokeBallStyle(b.key);assert(Object.values(style).every(c=>/^#[a-f0-9]{6}$/i.test(c)));assert.equal(typeof ballMark(b.key),'string');}
 assert.notDeepEqual(pokeBallStyle('corrupted_ball_fire'),pokeBallStyle('corrupted_ball_water'));assert.notEqual(ballMark('superball'),ballMark('hyperball'));
});
