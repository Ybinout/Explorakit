const test=require('node:test'),assert=require('node:assert/strict');
const dc=require('../server/game/world/darkContinent'),edges=require('../server/game/world/darkContinentEdges'),terrain=require('../server/game/world/mapRepository');
function fixture(){const commands={},events=[],moves=[],p={currentmap:'jungle1',x:208,y:368,equipe:{pokemons:[{currentHp:10}]}};const handlers=require('../server/realtime/handlers/darkContinentHandlers').createHandlers({socket:{emit:(e,d)=>events.push({e,d})},account:{on:(e,f)=>commands[e]=f},getPlayer:()=>p,getState:()=>({}),setState(){},refreshActors(){},canUse:()=>true,travel:async d=>{moves.push(d);p.currentmap=d.map;p.x=d.x;p.y=d.y;},closeFishing(){}});return{p,commands,moves,handlers,async call(e,d={}){let r;await commands[e](d,v=>r=v);return r;}};}
test('only the beach guide can send the trainer home, free and without healing or arbitrary coordinates',async()=>{
 const f=fixture();f.p.currentmap='jungle9';assert.equal((await f.call('dark:return',{map:'ville5'})).success,false);assert.equal((await f.call('dark:travel')).success,false);assert.equal(f.moves.length,0);
 f.p.currentmap='jungle1';f.p.x=16;f.p.y=16;assert.equal((await f.call('dark:return')).success,false);f.p.x=208;f.p.y=368;
 const hp=f.p.equipe.pokemons[0].currentHp,r=await f.call('dark:return',{map:'ville5',x:9999,y:9999});assert(r.success);assert.deepEqual(f.moves,[require('../server/game/world/flightTravel').flightDestination('start')]);assert.equal(f.p.equipe.pokemons[0].currentHp,hp);assert.equal(f.p.inventoryBusy,false);assert.equal((await f.call('dark:return')).success,false);
});
test('flight is refused on all nine island maps before loading an entitlement or moving',async()=>{
 let command,loads=0,moves=0;const p={};require('../server/realtime/handlers/flightHandlers').registerFlightHandlers({socket:{on:(_,f)=>command=f,connected:true},getPlayer:()=>p,canUse:()=>true,setBusy(){},loadState:async()=>{loads++;return{unlocked:true,visited:['start']};},travel:async()=>moves++});
 for(let i=1;i<=9;i++){p.currentmap='jungle'+i;let r;await command({map:'start'},v=>r=v);assert.equal(r.success,false);assert.match(r.message,/guide/);}assert.equal(loads,0);assert.equal(moves,0);
});
test('all edge departures and both corner directions are aligned, reversible, and cannot jump a row or column',()=>{
 const maps=require('../data/game/nextMap.json').maps.filter(m=>/^jungle[1-9]$/.test(m.mapName)),opposite={up:'down',down:'up',left:'right',right:'left'};let corners=0;
 for(const map of maps){assert.deepEqual(edges.linksFor(map.mapName,terrain.readMap),map.mapchange);for(const l of map.mapchange){const p={currentmap:map.mapName,x:l.valX*32+16,y:l.valY*32+16},r=edges.departure(p,l.edgeDirection);assert(r);assert.equal(r.nextMap,l.goto);assert.equal(r.nextX,l.nexX+16);assert.equal(r.nextY,l.nexY-16);const back=edges.departure({currentmap:r.nextMap,x:r.nextX,y:r.nextY},opposite[l.edgeDirection]);assert(back);assert.equal(back.nextMap,map.mapName);assert.equal(back.nextX,p.x);assert.equal(back.nextY,p.y);if(['left','right'].includes(l.edgeDirection))assert.equal(r.nextY,p.y);else assert.equal(r.nextX,p.x);if([0,27].includes(l.valX)&&[0,19].includes(l.valY))corners++;}}
 assert(corners>0);assert.equal(edges.departure({currentmap:'route3',x:16,y:16},'left'),null);
});
