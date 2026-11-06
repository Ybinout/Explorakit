const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const safari=require('../server/game/world/safari'),terrain=require('../server/game/world/mapRepository');
const {maps}=require('../data/game/nextMap.json'),config=require('../data/game/safari_encounters.json');
const factory=require('../server/game/world/wildPokemonFactory'),fishing=require('../server/game/world/fishingEncounters');
const dates=['2026-11-04T12:00:00Z','2026-11-05T12:00:00Z'].map(Date.parse);
test('the 15 authored maps and both art layers remain byte-identical to the supplied resources',()=>{
 const receipt=require('../docs/SAFARI_MAP_IMPORT_2026-11-05.json');
 assert(receipt);for(let i=1;i<=15;i++){
  const authored=`/home/ubuntu/dev/tout/ile_habitee/ile${i}/ile${i}`;
  if(!fs.existsSync(authored+'.json'))continue; // Portable checkout: structural checks below remain mandatory.
  for(const[source,target]of[[authored+'.json',`data/maps/safari${i}.json`],[authored+'.png',`vue-explorakit/src/assets/safari${i}.png`],[authored+'_f.png',`vue-explorakit/src/assets/safari${i}_f.png`]])
   assert.equal(crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'));
 }
});
test('all encounters, town doors and 22 two-way seams are reachable from the real arrival',()=>{
 const seen=new Set(),queue=[['safari1',6,14]],seams=new Set();
 for(let at=0;at<queue.length;at++){
  const[m,x,y]=queue[at],key=[m,x,y].join(':');if(seen.has(key))continue;seen.add(key);
  for(const[direction,dx,dy]of[['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]]){
   const nx=x+dx,ny=y+dy;
   if(terrain.loadCollisionData(m)[ny]?.[nx]===0)queue.push([m,nx,ny]);
   else if(nx<0||nx>=28||ny<0||ny>=20){
    const link=safari.departure({currentmap:m,x:x*32+16,y:y*32+16},direction);
    if(link){assert(safari.isMap(link.nextMap));const tx=Math.floor(link.nextX/32),ty=Math.floor(link.nextY/32);assert.equal(terrain.loadCollisionData(link.nextMap)[ty]?.[tx],0);queue.push([link.nextMap,tx,ty]);seams.add([m,link.nextMap].sort().join('/'));}
   }
  }
 }
 assert.equal(seams.size,22);
 for(let i=1;i<=15;i++){
  const m='safari'+i,grass=terrain.battleMapData(m);assert([...seen].some(k=>k.startsWith(m+':')));
  for(let y=0;y<20;y++)for(let x=0;x<28;x++)if(grass[y]?.[x])assert(seen.has([m,x,y].join(':')),`Inaccessible encounter ${m} ${x},${y}`);
 }
 assert(seen.has('safari9:13:5'));assert.equal(terrain.getNextMap('safari9',13,5).nextMap,'safari_lab');
 for(const[x,y,to]of[[6,7,'centre'],[20,12,'safari_shop']]){assert(seen.has(`safari8:${x}:${y}`));assert.equal(terrain.getNextMap('safari8',x,y).nextMap,to);}
});
test('one Paris calendar handles day parity and month boundaries for every client',()=>{
 assert.equal(safari.calendar(Date.parse('2026-11-04T22:59:59Z')).parity,'even');
 assert.equal(safari.calendar(Date.parse('2026-11-04T23:00:00Z')).parity,'odd');
 assert.equal(safari.calendar(Date.parse('2026-10-31T23:00:00Z')).date,'2026-11-01');
 assert.equal(safari.calendar(Date.parse('2026-07-01T22:00:00Z')).date,'2026-07-02');
});
test('all 156 Unova species are obtainable over two dates, with no Gen5 wild outside Safari',()=>{
 const found=new Set();for(const date of dates)for(const m of Object.keys(config.maps))for(const method of['grass','fishing','rare'])for(const[id]of safari.pool(m,method,date))found.add(id);
 for(let id=494;id<=649;id++)assert(found.has(id),'Missing Unova #'+id);
 for(const map of maps.filter(m=>!safari.isMap(m.mapName)))assert(!map.wildpokemon?.some(id=>id>=494&&id<=649),map.mapName);
 for(const pool of Object.entries(fishing.profiles).filter(([m])=>!safari.isMap(m)))assert(!pool[1].some(([id])=>id>=494&&id<=649));
});
test('real grass and fishing factories reach every daily weighted species at the requested 60–90 levels',async()=>{
 const oldNow=Date.now;try{for(const date of dates){Date.now=()=>date;
  for(const map of maps.filter(m=>safari.isMap(m.mapName)))for(const method of['grass','fishing']){
   const pool=safari.pool(map.mapName,method,date),total=pool.reduce((n,[,w])=>n+w,0);let before=0;
   for(const[id,weight]of pool){const roll=(before+weight/2)/total;before+=weight;
    const p=method==='grass'?await factory(map.mapName,()=>roll):await(async()=>{const e=fishing.fishingEncounter(map.mapName,()=>roll);assert.equal(e.id,id);return factory.createAtLevel(e.id,e.level);})();
    assert.equal(p.data.id,id);
    assert(p.level>=map.level.min&&p.level<=map.level.max,`${map.mapName} ${p.level}`);assert(p.abilities.length>0);assert(Number.isFinite(p.experienceRate));
   }
  }
 }}finally{Date.now=oldNow;}
});
test('server travel rejects spoofed targets, distance, fainted parties and concurrent departures',async()=>{
 let command,release;const p={currentmap:'super_tournament_lobby',x:24*32+16,y:14*32+16,equipe:{pokemons:[{currentHp:1}]}},destinations=[];
 const h=require('../server/realtime/handlers/safariHandlers').registerSafariHandlers({socket:{emit(){}},account:{on:(_,fn)=>command=fn},getPlayer:()=>p,canUse:()=>true,canInteract:()=>true,travel:async target=>{destinations.push(target);await new Promise(r=>release=r);}});
 const send=async data=>{let answer;await command(data,r=>answer=r);return answer;};
 assert(await h.interact());const first=send({destination:{map:'ville5',x:1,y:1}});while(!release)await new Promise(r=>setImmediate(r));
 assert.equal((await send({})).success,false);release();assert((await first).success);assert.deepEqual(destinations,[safari.ARRIVAL]);
 p.x=16;assert.equal((await send({})).success,false);p.x=24*32+16;p.equipe.pokemons[0].currentHp=0;assert.equal((await send({})).success,false);
});
