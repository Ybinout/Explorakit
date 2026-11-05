const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const dc=require('../server/game/world/darkContinent'),terrain=require('../server/game/world/mapRepository'),world=require('../data/game/nextMap.json').maps;
const factory=require('../server/game/drift/pokemonFactory'),engine=require('../server/game/battle/battleEngine'),wild=require('../server/game/world/wildPokemonFactory');
test('nine authored maps and both image layers are preserved byte-for-byte; the eastern land and water cover 18 types',()=>{
 const habitats=require('../server/game/world/darkHabitats'),species=new Set([...dc.COLUMNS[2],...habitats.WATER[2]]),dex=require('../data/game/pokedex.json');
 assert.equal(new Set([...species].flatMap(id=>dex.find(p=>p.id===id).type)).size,18);
 for(const id of species){assert(id<=493);assert(!require('../server/game/world/legendaryEncounters').isLegendary(id));const rules=[...require('../data/game/evolutions.json').rules,...require('../data/game/stone_evolutions.json').rules];assert(rules.some(r=>r.to===id));assert(!rules.some(r=>r.from===id));}
 for(const asset of require('../docs/DARK_CONTINENT_ASSETS_2026-11-02.json').assets)assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(asset.path)).digest('hex'),asset.sha256,asset.path);
});
test('all nine maps can be traversed from the beach; every transition is authored, adjacent and lands on the exact authored edge without a transverse jump',()=>{
 const start={map:dc.ARRIVAL.map,x:Math.floor(dc.ARRIVAL.x/32),y:Math.floor(dc.ARRIVAL.y/32)},queue=[start],seen=new Set(),visited=new Set();
 for(const p of queue){const k=`${p.map}:${p.x}:${p.y}`;if(seen.has(k)||seen.size>6000)continue;seen.add(k);visited.add(p.map);const grid=terrain.loadCollisionData(p.map);if(grid[p.y]?.[p.x]!==0)continue;
  for(const[dx,dy]of[[0,-1],[1,0],[0,1],[-1,0]]){const x=p.x+dx,y=p.y+dy;if(grid[y]?.[x]!==0)continue;if(dc.actors(p.map).some(a=>a.x===x&&(a.y===y||a.y-1===y)))continue;const link=terrain.changeMapData(p.map)[y][x]&&terrain.getNextMap(p.map,x,y);if(link)queue.push({map:link.nextMap,x:Math.floor(link.nextX/32),y:Math.floor(link.nextY/32)});else queue.push({map:p.map,x,y});}
 }
 assert.equal(visited.size,9);
 for(const map of world.filter(m=>dc.isMap(m.mapName))){const source=require('../data/maps/'+map.mapName+'.json'),authored=source.layers.find(l=>l.name==='liaisons').objects;const cells=new Set();
  for(const link of map.mapchange){const key=link.valX+':'+link.valY+':'+link.edgeDirection;assert(!cells.has(key));cells.add(key);assert(authored.some(o=>o.x===link.valX*16&&o.y===link.valY*16&&o.properties.some(p=>p.name==='destination'&&p.value===link.goto)));
   const resolved=terrain.getNextMap(map.mapName,link.valX,link.valY,link.edgeDirection),x=Math.floor(resolved.nextX/32),y=Math.floor(resolved.nextY/32);assert.equal(terrain.loadCollisionData(link.goto)[y][x],0);const o=authored.find(o=>o.x===link.valX*16&&o.y===link.valY*16&&o.properties.some(p=>p.name==='destination'&&p.value===link.goto)),p=Object.fromEntries(o.properties.map(p=>[p.name,p.value]));assert.equal(x,p.destination_x);assert.equal(y,p.destination_y);assert.equal(require('../server/game/world/darkContinentEdges').departure({currentmap:link.goto,x:resolved.nextX,y:resolved.nextY},link.edgeDirection),null,'holding direction continues into the destination, never back');
   const a=Number(map.mapName.slice(6))-1,b=Number(link.goto.slice(6))-1;assert.equal(Math.abs(a%3-b%3)+Math.abs(Math.floor(a/3)-Math.floor(b/3)),1);
  }
 }
});
test('wild levels follow columns with Jungle 9 at 200–250, module ignored and no legendary bypass',async()=>{
 for(let i=1;i<=9;i++){const map='jungle'+i,[min,max]=dc.levels(map);for(const expected of[min,max])for(const active of[false,true]){let draw=0;const rng=expected===min?()=>++draw===2?0:.02:()=>.999999;const p=await wild(map,rng,{experienceModuleActive:active});assert.equal(p.level,expected);assert(dc.COLUMNS[dc.column(map)].includes(p.data.id));assert(p.currentHp===p.maxHp);assert(p.abilities.length>=1&&p.abilities.length<=4);}}
});
test('no flight via button, high-level escape bonus, Ghost, Run Away or Teleport; ordinary switching remains available',()=>{
 const a=factory.create(94,100,true),b=factory.create(65,200,true),state=engine.createBattleState({mapName:'jungle1',battleType:'wild'});a.passiveAbility='Run Away';a.abilities=[];a.movePp=[];a.addAbility('Teleport');
 assert.equal(require('../server/game/battle/wildEscape').canFleeWildBattle(a,b,state),false);assert.equal(engine.canSwitchOut(a,b,state,{escape:true}),false);assert.equal(engine.canSwitchOut(a,b,state),true);
 const result=engine.useattack('Teleport',a,b,{battleState:state,attackerSide:state.sides.player,defenderSide:state.sides.enemy,attackerTeam:[a],defenderTeam:[b]});assert(!result.escape);
 const ordinary=engine.createBattleState({mapName:'route3',battleType:'wild'});assert(require('../server/game/battle/wildEscape').canFleeWildBattle(a,b,ordinary));
});
test('all 18 plates sell for 20k, stay out of ordinary loot and are selected only from the defeated types',()=>{
 const items=require('../data/game/items.json').items,plates=items.filter(i=>i.plateType);assert.equal(plates.length,18);for(const p of plates){assert.equal(require('../server/game/items/itemSales').getSellPrice(p.key),20000);assert.equal(p.category,'treasure');assert(!p.wildLoot);assert(!p.wildCrystalChance);}
 let seed=1;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);const p=factory.create(6,100,true),counts={plate:0,crystal_shard:0,clear_crystal:0,aurora_prism:0};
 for(let i=0;i<20000;i++){const found=dc.loot(p,random);for(const item of found){if(item.plateType){counts.plate++;assert(p.data.type.includes(item.plateType));assert.equal(item.quantity,1);}else{counts[item.key]++;assert(item.quantity>=1&&item.quantity<=4);}}}
 for(const[key,chance]of[['plate',.11],['crystal_shard',.5525],['clear_crystal',.425],['aurora_prism',.255]])assert(Math.abs(counts[key]/20000-chance)<.015,JSON.stringify(counts));
});
test('the scout is personal, appears after 48 rooms and vanishes after giving the permanent card; the guide blocks correctly',()=>{
 const empty={getPnjsForMap:()=>[],getPnjAtTile:()=>null,isPnjBlockingTile:()=>false};let state={eligible:false,owned:false};const store=dc.scopedStore(empty,()=>state);assert.equal(store.getPnjsForMap(dc.LOBBY.map).length,0);state={eligible:true,owned:false};assert.equal(store.getPnjsForMap(dc.LOBBY.map).length,1);state={eligible:true,owned:true};assert.equal(store.getPnjsForMap(dc.LOBBY.map).length,0);assert(store.isPnjBlockingTile('jungle1',6,10));assert(store.isPnjBlockingTile('jungle1',6,9));assert(!store.isPnjBlockingTile('jungle1',6,11));
});
test('a whole-party loss can recover an unconscious reserve from the PC for the nurse, without healing or bypassing last-able guards',()=>{
 const p=factory.create(7,10,true);p.currentHp=0;const plan=require('../server/game/storage/pokemonStorage').planAction([],[{box:19,slot:29,pokemon:p}],{action:'withdraw',pokemonUuid:p.uuid});assert.equal(plan.team[0].currentHp,0);assert.equal(plan.entries.length,0);
});

test('personal scout reaches a trainer around furniture without crossing a wall or the trainer',()=>{const grid=Array.from({length:20},()=>Array(28).fill(0));for(let y=10;y<18;y++)grid[y][12]=1;const goal={x:15,y:14},path=dc.scoutPath(grid,goal);assert(path.length>5);assert(path.every(p=>grid[p.y][p.x]===0&&(p.x!==goal.x||p.y!==goal.y)));const end=path.at(-1);assert.equal(Math.abs(end.x-goal.x)+Math.abs(end.y-goal.y),1);for(let i=1;i<path.length;i++)assert.equal(Math.abs(path[i].x-path[i-1].x)+Math.abs(path[i].y-path[i-1].y),1);});

test('paid Dark commands reject stale clients before any purchase or heal when the displayed price was not acknowledged',async()=>{const commands={},p={currentmap:'jungle1',x:208,y:368};require('../server/realtime/handlers/darkContinentHandlers').createHandlers({socket:{emit(){}},account:{on:(name,fn)=>commands[name]=fn},userId:0,getPlayer:()=>p,getState:()=>({}),setState(){},refreshActors(){},canUse:()=>true,travel(){},closeFishing(){}});for(const event of['dark:claim','dark:heal']){let ack;await commands[event]({},r=>ack=r);assert.equal(ack.success,false);assert.match(ack.message,/prix|10[ \u202f]000/);assert.equal(p.inventoryBusy,false);}});

test('loot increases by west/center/east column, with the Jungle 9 plate exception; ordinary regions cannot opt into these rewards',()=>{
 assert.throws(()=>dc.lootProfile('route3'),/réservé/);assert.throws(()=>dc.lootProfile('jungle10'),/réservé/);
 assert.equal(dc.lootProfile('jungle1').ordinaryChance,require('../server/game/items/wildLoot').ADVENTURE_CHANCE);
 const p=factory.create(6,100,true),minimums=[[2,1,1],[3,2,1],[4,3,2]];
 for(let c=0;c<3;c++)for(let row=0;row<3;row++){
  const map='jungle'+(row*3+c+1);if(map==='jungle9'){assert.equal(dc.lootProfile(map).plateChance,.28);assert.equal(dc.lootProfile(map).crystals,dc.lootProfile('jungle3').crystals);assert.equal(dc.lootProfile(map).ordinaryChance,dc.lootProfile('jungle3').ordinaryChance);}else assert.equal(dc.lootProfile(map),dc.lootProfile('jungle'+(c+1)));
  assert.deepEqual(dc.loot(p,()=>0,map).filter(i=>!i.plateType).map(i=>i.quantity),minimums[c]);
 }
 let seed=1;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296),means=[];
 for(let c=0;c<3;c++){
  const map='jungle'+(c+1),profile=dc.lootProfile(map),counts={},totals={};
  for(let i=0;i<20000;i++)for(const item of dc.loot(p,random,map)){
   const key=item.plateType?'plate':item.key;counts[key]=(counts[key]||0)+1;totals[key]=(totals[key]||0)+item.quantity;
   if(item.plateType){assert(p.data.type.includes(item.plateType));assert.equal(item.quantity,1);}
   else{const spec=profile.crystals.find(([key])=>key===item.key);assert(item.quantity>=spec[2]&&item.quantity<=spec[3]);}
  }
  for(const[key,chance,min,max]of profile.crystals){assert(Math.abs(counts[key]/20000-chance)<.015);assert(Math.abs(totals[key]/20000-chance*(min+max)/2)<.04);}
  assert(Math.abs(counts.plate/20000-profile.plateChance)<.01);means.push(totals);
 }
 for(const key of ['crystal_shard','clear_crystal','aurora_prism','plate'])assert(means[0][key]<means[1][key]&&means[1][key]<means[2][key],key+' must reward the extra risk');
});
