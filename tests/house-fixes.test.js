const test=require('node:test'),assert=require('node:assert/strict');
const factory=require('../server/game/drift/pokemonFactory'),engine=require('../server/game/battle/battleEngine');
const {DriftBattle}=require('../server/game/drift/driftBattle'),codec=require('../server/game/drift/checkpointCodec');
const clear=require('../server/game/battle/battleOutcome').clearBattleTransientState;
function mon(id=143,item='sitrus_berry'){const p=factory.create(id,50,true);p.passiveAbility=null;p.heldItem=item;p.abilities=['Splash'];p.movePp=[40];return p;}
function party(p,npc=false){return{npc,equipe:{pokemons:[p]},items:{},drifts:[],equipped:[],defeated:new Set()};}
for(const restore of [true,false])test(`Consumed berries ${restore?'return only after the scoped fight':'remain consumed in ordinary Adventure'}`,()=>{
 const p=mon(),q=mon(9,null),a=party(p),b=party(q,true),events=[];
 const battle=new DriftBattle(a,b,{type:'trainer',emit:(_p,e,d)=>events.push([e,d]),rules:{rewards:false,report:false,permanentDeaths:false,restoreBerries:restore}});
 p.currentHp=Math.floor(p.maxHp*.4);engine.processEndOfRound(p,q,null,null,battle.state);assert.equal(p.heldItem,null);
 const saved=codec.decode(codec.encode(battle));assert.equal(saved.state.restoreBerries===true,restore);assert.equal(saved.a.equipe.pokemons[0].heldItem,null);
 saved.emit=()=>{};saved.finish(saved.a,'finished');assert.equal(saved.a.equipe.pokemons[0].heldItem,restore?'sitrus_berry':null);
 saved.emit=()=>{};saved.finish(saved.a,'finished');assert.deepEqual(saved.a.items,{});assert.equal(a.equipe.pokemons.length,1);
});
test('Trick and consumption restore a tournament berry to its original owner, never to two holders',()=>{
 const p=mon(),q=mon(65,'leftovers'),state=engine.createBattleState();state.restoreBerries=true;
 engine.useattack('Trick',q,p,{battleState:state});assert.equal(q.heldItem,'sitrus_berry');assert.equal(p.heldItem,'leftovers');
 q.currentHp=Math.floor(q.maxHp*.4);engine.processEndOfRound(p,q,null,null,state);assert.equal(q.heldItem,null);
 clear([p,q]);clear([p,q]);assert.equal(p.heldItem,'sitrus_berry');assert.equal(q.heldItem,'leftovers');
});
test('Jungle 4 gives fully evolved Ghosts 20 percent, without changing the other western jungles or aquatic encounters',()=>{
 const habitats=require('../server/game/world/darkHabitats'),maps=require('../data/game/nextMap.json').maps,chances=require('../server/game/world/wildEncounterPool').encounterChances;
 const zone=maps.find(m=>m.mapName==='jungle4'),ghosts=new Set(habitats.JUNGLE4_GHOSTS),rates=chances(zone);
 assert.deepEqual(zone.wildpokemon,habitats.landPool('jungle4'));assert(ghosts.size>=4);
 assert(Math.abs(rates.filter(([id])=>ghosts.has(id)).reduce((s,[,rate])=>s+rate,0)-20)<1e-10);
 for(const map of ['jungle1','jungle7'])assert(habitats.landPool(map).every(id=>!ghosts.has(id)));
 assert(!habitats.WATER[0].some(id=>ghosts.has(id)));
});
test('Casino sign is beside the real door, readable from a free tile and never on the entrance',()=>{
 // Load through the same JSONC parser as the game, retaining stable dialogue ids.
 const list=require('../server/game/world/pnjStore').getPnjsForMap('ville5');
 const p=list.find(p=>p.name==='building_sign_ville5_23'),door=require('../data/game/nextMap.json').maps.find(m=>m.mapName==='ville5').mapchange.find(t=>t.goto==='ville5_maison2');
 assert.equal(p.sprite,'building-sign.png');assert.notDeepEqual([p.x,p.y],[door.valX,door.valY]);
 const grid=require('../server/game/world/mapRepository').loadCollisionData('ville5');assert.equal(grid[p.y][p.x],0);assert.equal(grid[p.y+1][p.x],0);
 assert.match(require('../server/game/world/interactionRepository').getSentenceForName(p.name)[0][0].text,/Casino de Blanchecime/);
});
