const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
const rules=require('../server/game/magicIsland/rules'),balls=require('../server/game/items/captureBalls'),maps=require('../server/game/world/mapRepository');
const factory=require('../server/game/drift/pokemonFactory'),forms=require('../server/game/models/rotomForms'),teams=require('../server/persistence/teamRepository');
const item=key=>require('../server/game/battle/battleResources').getItemDefinition(key),mon=(id=479,level=80)=>factory.create(id,level,true);
test('Île Magique: four source maps keep drawing/collision cells and all 134 edge links land safely without shifting the crossing coordinate',()=>{
 let total=0;
 for(let n=1;n<=4;n++){
  const name='ile2_0'+n,map=maps.readMap(name),cfg=require('../data/game/nextMap.json').maps.find(m=>m.mapName===name),coll=maps.loadCollisionData(name);
  assert.equal(map.width,28);assert.equal(map.height,20);assert.equal(maps.InteractMapData(name).length,20);
  for(const link of cfg.mapchange){const d=maps.getNextMap(name,link.valX,link.valY,link.edgeDirection);assert.equal(d.nextMap,link.goto);assert.equal(d.nextX,link.nexX+16);assert.equal(d.nextY,link.nexY-16);assert.equal(maps.loadCollisionData(d.nextMap)[Math.floor(d.nextY/32)][Math.floor(d.nextX/32)],0);assert.equal(coll[link.valY][link.valX],0);if(['up','down'].includes(link.edgeDirection))assert.equal(d.nextX,link.valX*32+16);else assert.equal(d.nextY,link.valY*32+16);total++;}
  assert(!require('../server/game/world/flightTravel').flightDestination(name));
 }
 assert.equal(total,134);
 for(const a of rules.actors('jungle3').concat(...Array.from({length:4},(_,i)=>rules.actors('ile2_0'+(i+1))))){const grid=maps.loadCollisionData(a.map);assert.equal(grid[a.y][a.x],0,a.name);assert([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>grid[a.y+dy]?.[a.x+dx]===0));}
 for(const p of[rules.ARRIVAL,rules.RETURN])assert.equal(maps.loadCollisionData(p.map)[Math.floor(p.y/32)][Math.floor(p.x/32)],0);
});
test('Île Magique: reachable region, voyage-only event nodes and forbidden return modules',()=>{
 const region=require('../server/game/world/regionMap').getRegionMap();for(let i=1;i<=4;i++){assert(region.nodes.some(n=>n.id==='ile2_0'+i&&n.kind==='event'));assert.throws(()=>require('../server/game/world/darkContinent').assertTravelAllowed('ile2_0'+i),/bateau/);}
});
test('daily missions use common Paris dates, vary daily and expose vague two/three-type hints; score responds to actual Pokémon',()=>{
 const dates=Array.from({length:7},(_,i)=>rules.daily(Date.UTC(2026,10,12+i,12)));assert.equal(new Set(dates.map(d=>d.key)).size,7);
 assert.equal(rules.daily(Date.UTC(2026,10,12,23,30)).date,'2026-11-13');
 for(const d of dates){assert(d.types.length>=2&&d.types.length<=3);assert.equal(d.durationMs,43200000);}
 const mission={types:['Electric','Steel'],moves:['Electric','Steel']},good=mon(462,250),weak=mon(10,1);good.k=4;good.abilities=['Thunderbolt'];weak.k=1;weak.abilities=['Tackle'];assert(rules.assess([good],mission)>rules.assess([weak],mission));
 for(let n=0;n<=100;n++){const loot=rules.rewards(n/100,(_,end)=>end-1);assert(loot.money<=2000000);assert(loot.items.crystal_shard<=1000);assert(loot.items.clear_crystal<=500);assert(loot.items.aurora_prism<=100);assert(Object.entries(loot.items).filter(([k])=>k.startsWith('dark_plate_')).reduce((s,[,q])=>s+q,0)<=20);}
});
test('all eighteen corrupted Balls have exact recipes and no resale or market value; Master Ball cannot be bought, but can be resold',()=>{
 for(const type of Object.keys(rules.TYPES)){const key=rules.ballKey(type);assert.equal(item(key).corruptedBallType,type);assert.equal(require('../server/game/items/itemSales').getSellPrice(key),0);assert(item(key).noMarket);assert.deepEqual(rules.recipe(type,2).map(x=>x.quantity),[4,100,50,8]);}
 assert.equal(item('master_ball').sell_price,2000000);assert(!require('../data/game/shop_offers.json').offers.master_ball);for(const f of Object.values(require('../data/game/department_store.json').floors))assert(!f.offers.master_ball);assert.throws(()=>rules.recipe('Water',0));assert.throws(()=>rules.recipe('Fake',1));
});
test('contextual common Balls: turn, night, cave, fishing, previous catch and dual type are effective',()=>{
 const p=mon(130,20),day=Date.UTC(2026,10,12,12),night=Date.UTC(2026,10,12,20),c=opts=>balls.context(p,{map:'road3',now:day,...opts});
 assert.equal(balls.multiplier(item('dive_ball'),p,c({fishing:true})),3.5);assert.equal(balls.multiplier(item('dive_ball'),p,c()),1);
 assert.equal(balls.multiplier(item('dusk_ball'),p,c()),1);assert.equal(balls.multiplier(item('dusk_ball'),p,c({map:'cave1'})),3);assert.equal(balls.multiplier(item('dusk_ball'),p,c({now:night})),3);
 assert.equal(balls.multiplier(item('timer_ball'),p,c({turn:1})),1);assert.equal(balls.multiplier(item('timer_ball'),p,c({turn:11})),4);
 assert.equal(balls.multiplier(item('net_ball'),p,c()),3.5);assert.equal(balls.multiplier(item('nest_ball'),p,c()),2.1);
 assert.equal(balls.multiplier(item('repeat_ball'),p,c({caught:true})),3.5);assert.equal(balls.multiplier(item('quick_ball'),p,c({turn:1})),5);assert.equal(balls.multiplier(item('quick_ball'),p,c({turn:2})),1);
 assert.equal(balls.fixedChance(item('master_ball'),c()),1);
});
test('DC captures: fixed 30%, matching either type; ordinary Balls, wrong type and typed elite captures reject before consumption',()=>{
 const p=mon(130),ctx=balls.context(p,{map:'jungle9'}),ball=item('corrupted_ball_water');balls.validate(ball,p,ctx);assert.equal(balls.fixedChance(ball,ctx),.3);balls.validate(item('corrupted_ball_flying'),p,ctx);
 for(const key of['pokeball','hyperball'])assert.throws(()=>balls.validate(item(key),p,ctx),/Balls Corrompues/);
 assert.throws(()=>balls.validate(item('corrupted_ball_fire'),p,ctx),/type/);assert.throws(()=>balls.validate(ball,p,balls.context(p,{map:'start'})),/uniquement/);
 p.darkContinentEncounter={kind:'corrupted'};assert.throws(()=>balls.validate(ball,p,balls.context(p,{map:'DC2_44'})),/Élites/);
});
test('captured DC Pokémon keep species/level/K/shiny, clear EVs and draw all IVs anew; Heal Ball restores HP/status/PP',()=>{
 const p=mon(130,250);p.k=4;p.shiny=true;p.ev={hp:252,attack:252,speed:4};p.currentHp=1;balls.prepareCaptured(p,item('corrupted_ball_water'),()=>.5);assert.equal(p.data.id,130);assert.equal(p.level,250);assert.equal(p.k,4);assert(p.shiny);assert.deepEqual(Object.values(p.iv),[16,16,16,16,16,16]);assert(Object.values(p.ev).every(n=>n===0));assert(p.currentHp>=1&&p.currentHp<=p.maxHp);
 p.status='poison';p.abilities=['Waterfall'];p.movePp=[0];balls.prepareCaptured(p,item('heal_ball'));assert.equal(p.currentHp,p.maxHp);assert.equal(p.status,'normal');assert.equal(p.movePp[0],15);
});
for(const key of Object.keys(forms.FORMS))test('Rotom '+key+': permanent stats/types/signature survive party and PC serialization, EV changes and reset',()=>{
 const p=mon();p.abilities=['Thunderbolt','Shadow Ball','Protect','Will-O-Wisp'];p.movePp=[15,15,10,15];p.shiny=true;
 const change=(k)=>forms.change(p,k,{expectedUuid:p.uuid,expectedMoves:[...p.abilities],expectedForm:p.formData?.key||null,slot:3});
 change(key);assert.equal(p.formSpriteId,forms.FORMS[key].sprite);assert.deepEqual(p.data.type,['Electric',forms.FORMS[key].type]);assert(p.abilities.includes(forms.FORMS[key].move));assert.equal(p.data.base.Defense,107);
 const row=Object.fromEntries(teams.POKEMON_COLUMNS.map((k,i)=>[k,teams.pokemonToRow(p,1,1)[i]])),restored=teams.rowToPokemon(row);assert.equal(restored.defense,p.defense);assert.equal(restored.formSpriteId,p.formSpriteId);assert(restored.shiny);assert.deepEqual(restored.abilities,p.abilities);
 const pc=require('../server/persistence/pokemonStorageRepository');assert.equal(pc.decodePokemon(pc.encodePokemon(p)).formData.key,key);
 p.ev.defense=252;p.recalculateStats();assert.equal(p.formData.key,key);change(null);assert.deepEqual(p.data.type,['Electric','Ghost']);assert(!p.abilities.includes(forms.FORMS[key].move));
});
test('furniture catalog and all 20 Rotom animation variants exist, with five 50k devices and protected first party selection',()=>{
 const housing=require('../server/game/housing/rules');assert.deepEqual(require('../data/game/housing.json'),require('../vue-explorakit/src/data/housing.json'));
 for(const f of Object.values(forms.FORMS))for(const folder of['front','back','shiny/front','shiny/back']){const m=require('../vue-explorakit/src/data/pokemonSpriteManifest.json')[folder+'/'+f.sprite];assert(m.frames>1);assert(fs.existsSync('vue-explorakit/public/img/pokemon/animated/'+folder+'/'+f.sprite+'.webp'));}
 for(const i of housing.items.values())if(i.device?.startsWith('rotom:')){assert.equal(i.price,50000);const placement={key:i.key,x:12,y:12,rotation:0,id:randomUUID()},home={floors:[{model:'nid',placements:[placement]}]};assert(housing.deviceAt(home,0,{currentmap:'housing_nid',x:12*32+16,y:13*32+16},i.device));assert(!housing.deviceAt(home,0,{currentmap:'housing_nid',x:16,y:16},i.device));}
 assert.throws(()=>forms.change(mon(25),'heat',{}),/Motisma/);
});
test('Rotom form-to-form preserves the other three moves and rejects stale previews',()=>{
 const p=mon();p.abilities=['Thunderbolt','Protect','Shadow Ball','Rest'];p.movePp=[15,10,15,5];
 const change=key=>forms.change(p,key,{expectedUuid:p.uuid,expectedMoves:[...p.abilities],expectedForm:p.formData?.key||null,slot:3});
 change('heat');change('wash');assert.deepEqual(p.abilities,['Thunderbolt','Protect','Shadow Ball','Hydro Pump']);assert.throws(()=>forms.change(p,'fan',{expectedUuid:p.uuid,expectedMoves:['Tackle'],expectedForm:'wash',slot:3}),/changé/);
});

test('casino child can be spoken to across its existing counter without moving the NPC or collisions',()=>{assert.equal(rules.near({currentmap:'ville5_maison2',x:112,y:208}).name,'casino_croupier');assert(!rules.near({currentmap:'ville5_maison2',x:500,y:500}));});

test('Rotom native singles/doubles/raid bridge uses each actual form and its stats; public movement state contains only the authoritative speed flag',()=>{
 const set=require('../server/game/doubles/ruleset').teamSet;
 for(const [key,form] of Object.entries(forms.FORMS)){const p=mon();p.passiveAbility='Levitate';p.abilities=['Thunderbolt'];p.movePp=[15];forms.change(p,key,{expectedUuid:p.uuid,expectedMoves:p.abilities,expectedForm:null});assert.equal(set(p).species,form.species);}
 const p=require('../server/realtime/playerState').toPublicPlayer({speedModuleActive:true,currentmap:'start'});assert.equal(p.speedModuleActive,true);assert(!p.equipe);
});
