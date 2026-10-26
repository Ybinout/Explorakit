const test=require('node:test'),assert=require('node:assert/strict');
const {machines,teachMachine}=require('../server/game/items/machines');
const factory=require('../server/game/drift/pokemonFactory'),economy=require('../server/game/drift/economy'),codec=require('../server/game/drift/checkpointCodec');
const items=require('../data/game/items.json').items,shops=require('../server/game/world/shopCatalog');
const create=()=>{const p=factory.create(7,20,true);p.abilities=['Tackle','Tail Whip','Water Gun','Withdraw'];p.movePp=[2,3,4,5];return p;};
const choice=(p,slot=2)=>({pokemonUuid:p.uuid,itemKey:'cs_surf',slot,expectedMoves:[...p.abilities]});
test('CS catalogue: expanded French moves, shared compatibility and floor 2 stock only',()=>{
 assert.deepEqual([...new Set(Object.values(machines).map(m=>m.price))].sort((a,b)=>a-b),[3000,4000,5000]);
 assert.equal(Object.keys(machines).length,263);assert.deepEqual(require('../vue-explorakit/src/data/machines.json'),machines);
 for(const [key,m] of Object.entries(machines)){assert(items.some(i=>i.key===key&&i.name===m.name&&i.category==='machine'));assert.match(m.name,/^CS /);assert(m.species.length>0);assert(shops.getShopCatalog({mapName:'tour_etage1'}).some(i=>i.key===key&&i.price===m.price));for(const mapName of ['tour_rdc','tour_etage2','tour_etage3','ville1_shop','ville5_shop'])assert(!shops.getShopCatalog({mapName,expedition:true}).some(i=>i.key===key));}
 assert(machines.cs_thunderbolt.species.includes(25));assert(!machines.cs_surf.species.includes(4));assert(!machines.cs_surf.species.includes(129),'Magikarp water type is insufficient');
});
test('CS appends or replaces explicitly, preserves existing PP and removes only matching queued move',()=>{
 const p=create(),before=JSON.stringify(p);p.pendingMoves=[{move:'Surf',level:20},{move:'Bite',level:21}];
 const r=teachMachine(p,'cs_surf',choice(p));assert.deepEqual(r.abilities,['Tackle','Tail Whip','Surf','Withdraw']);assert.deepEqual(r.movePp,[2,3,15,5]);assert.deepEqual(r.pendingMoves,[{move:'Bite',level:21}]);assert.equal(p.abilities[2],'Water Gun');
 p.pendingMoves=[];assert.equal(JSON.stringify(p),before);p.abilities=['Tackle'];p.movePp=[2];assert.deepEqual(teachMachine(p,'cs_surf',choice(p,1)).abilities,['Tackle','Surf']);
});
test('CS rejects incompatible, already known, stale, forged slot, egg and KO without mutation',()=>{
 const p=create();for(const slot of [-1,4,'1',null])assert.throws(()=>teachMachine(p,'cs_surf',choice(p,slot)),/remplacer/);
 assert.throws(()=>teachMachine(p,'cs_surf',{slot:1,expectedMoves:['Tackle']}),/changé/);
 assert.throws(()=>teachMachine(factory.create(4,20,true),'cs_surf',{}),/compatible/);
 p.isEgg=true;assert.throws(()=>teachMachine(p,'cs_surf',choice(p)),/œuf/);p.isEgg=false;p.currentHp=0;assert.throws(()=>teachMachine(p,'cs_surf',choice(p)),/conscient/);p.currentHp=1;
 p.abilities[0]='Surf';assert.throws(()=>teachMachine(p,'cs_surf',choice(p)),/déjà/);
});
for(const mode of ['rift','colosseum'])test(mode+': CS purchase/use consumes once, checkpoints and battle guards preserve inventory',()=>{
 const mon=create(),p={alive:true,currentmap:'tour_etage1',money:10000,run:{mode,phase:'exploration'},equipe:{pokemons:[mon]},items:{},drifts:[],equipped:[]};
 economy.buy(p,'cs_surf',2);assert.equal(p.items.cs_surf,2);assert.equal(p.money,10000-2*machines.cs_surf.price);const c=choice(mon);
 p.inbattle=true;assert.throws(()=>economy.useMachine(p,c),/indisponible/);p.inbattle=false;assert.equal(p.items.cs_surf,2);
 economy.useMachine(p,c);assert.equal(p.items.cs_surf,1);assert.equal(mon.abilities[2],'Surf');assert.throws(()=>economy.useMachine(p,c),/déjà/);assert.equal(p.items.cs_surf,1);
 const saved=codec.decode(codec.encode(p));assert.equal(saved.items.cs_surf,1);assert.equal(saved.equipe.pokemons[0].abilities[2],'Surf');assert.equal(saved.equipe.pokemons[0].movePp[2],15);
});
