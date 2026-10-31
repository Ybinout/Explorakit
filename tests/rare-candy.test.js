const test=require('node:test'),assert=require('node:assert/strict');
const factory=require('../server/game/drift/pokemonFactory'),{medicineBatch}=require('../server/game/items/medicineEffects'),evolution=require('../server/game/models/evolution'),codec=require('../server/game/drift/checkpointCodec');
test('Super Bonbon gives exactly one level, preserves traits/wounds/PP and queues natural moves/evolution without mutating the source',()=>{
 const p=factory.create(4,15,true);p.experience+=7;p.currentHp-=9;p.status='poison';p.movePp[0]=1;p.pendingMoves=[];const before=JSON.stringify(p);
 const r=medicineBatch(p,'rare_candy',1,2);assert.equal(JSON.stringify(p),before);assert.equal(r.consumed,1);assert.equal(r.level,16);assert.equal(r.experience,p.getNextLevelExpForLevel(16));assert.equal(r.maxHp-r.currentHp,9);assert.equal(r.status,'poison');assert.deepEqual(r.movePp,p.movePp);assert.equal(r.evolutionState.pending.targetId,5);assert.equal(r.trainingChange.growth.level,16);
 for(const [n,name]of require('../data/game/level_up_moves.json').species[4].filter(([n])=>n===16))if(!p.abilities.includes(name))assert(r.pendingMoves.some(m=>m.move===name));
 Object.assign(p,r);assert.throws(()=>medicineBatch(p,'rare_candy',1,1),/évolution/);evolution.resolvePending(p,{promptId:p.evolutionState.pending.id,cancel:true});Object.assign(p,medicineBatch(p,'rare_candy',1,1));assert.equal(p.level,17);assert(p.evolutionState.pending);assert.equal(p.data.id,4);
});
test('Super Bonbon refuses eggs, KO, level 100 and empty/invalid stock; Everstone keeps level gain and blocks evolution',()=>{
 for(const kind of ['egg','ko','max','empty','batch']){const p=factory.create(7,kind==='max'?100:5,true);if(kind==='egg')p.isEgg=true;if(kind==='ko')p.currentHp=0;const old=JSON.stringify(p);assert.throws(()=>medicineBatch(p,'rare_candy',kind==='batch'?2:1,kind==='empty'?0:2));assert.equal(JSON.stringify(p),old);}
 const p=factory.create(4,15,true);p.heldItem='everstone';const r=medicineBatch(p,'rare_candy',1,1);assert.equal(r.level,16);assert(!r.evolutionState?.pending);assert.equal(p.heldItem,'everstone');
 const q=factory.create(7,99,true);assert.equal(medicineBatch(q,'rare_candy',1,1).level,100);
});
for(const mode of ['rift','colosseum'])test(mode+': candy uses only target/stock, works between rounds and survives checkpoint',()=>{
 const economy=require('../server/game/drift/economy'),p={alive:true,currentmap:'tour_etage1',money:40000,run:{mode,phase:'exploration'},equipe:{pokemons:[factory.create(7,5,true),factory.create(4,5,true)]},items:{},drifts:[],equipped:[]};
 economy.buy(p,'rare_candy',1);assert.equal(p.money,20000);p.run.phase='colosseum_ready';const reserve=JSON.stringify(p.equipe.pokemons[1]),r=economy.usePotion(p,'rare_candy',p.equipe.pokemons[0].uuid);assert.equal(r.equipe.pokemons[0].level,6);assert.equal(p.items.rare_candy,0);assert.equal(JSON.stringify(p.equipe.pokemons[1]),reserve);assert.equal(codec.decode(codec.encode(p)).equipe.pokemons[0].level,6);assert.throws(()=>economy.usePotion(p,'rare_candy',p.equipe.pokemons[0].uuid));
});
test('Super and Mega Candy enforce separate caps, preserve stats/traits and never mutate a rejected target',()=>{
 for(const [key,level,allowed]of [['rare_candy',99,true],['rare_candy',100,false],['rare_candy',101,false],['rare_candy',200,false],['rare_candy',250,false],['mega_candy',99,true],['mega_candy',100,true],['mega_candy',101,true],['mega_candy',199,true],['mega_candy',200,false],['mega_candy',250,false]]){
  const p=factory.create(9,level,true);p.currentHp-=5;p.status='burn';p.movePp[0]=1;p.heldItem='leftovers';const before=JSON.stringify(p);
  if(!allowed)assert.throws(()=>medicineBatch(p,key,1,2),/maximum/);
  else{const r=medicineBatch(p,key,1,2);assert.equal(r.level,level+1);assert.equal(r.consumed,1);assert.equal(r.experience,p.getNextLevelExpForLevel(level+1));assert.equal(r.maxHp-r.currentHp,5);assert.equal(r.status,'burn');assert.deepEqual(r.movePp,p.movePp);assert(r.maxHp>p.maxHp);assert(r.attack>=p.attack);assert.equal(r.trainingChange.growth.level,level+1);}
  assert.equal(JSON.stringify(p),before,`${key} at ${level}`);
 }
 for(const kind of ['egg','ko','pending','batch','empty']){const p=factory.create(9,150,true);if(kind==='egg')p.isEgg=true;if(kind==='ko')p.currentHp=0;if(kind==='pending')p.evolutionState={pending:{id:'waiting'}};assert.throws(()=>medicineBatch(p,'mega_candy',kind==='batch'?2:1,kind==='empty'?0:2));}
});
test('Mega Candy costs 50000 in the same training shops, remains unheld and has no wild drop',async()=>{
 const items=require('../data/game/items.json').items,shops=require('../server/game/world/shopCatalog');const mega=items.find(i=>i.key==='mega_candy'),rare=items.find(i=>i.key==='rare_candy');
 assert.equal(rare.buy_price,20000);assert.equal(rare.fieldUse.maxLevel,100);assert.equal(mega.buy_price,50000);assert.equal(mega.fieldUse.maxLevel,200);assert(!mega.heldEffect&&!mega.wildLoot&&!mega.unique);
 const tower=shops.getShopCatalog({mapName:'tour_etage1'}).find(i=>i.key==='mega_candy');assert(tower.locked);assert.equal(tower.price,50000);assert.equal(shops.getShopCatalog({mapName:'tour_etage1',flags:{hoze_defeated:'true'}}).find(i=>i.key==='mega_candy').locked,false);
 assert(!shops.getShopCatalog({mapName:'ville5_shop'}).some(i=>i.key==='mega_candy'));assert.equal(shops.getShopCatalog({mapName:'ville5_shop',flags:{wanda_defeated:'true'}}).find(i=>i.key==='mega_candy').price,50000);assert(!shops.getShopCatalog({mapName:'ville1_shop',flags:{wanda_defeated:'true'}}).some(i=>i.key==='mega_candy'));
 const {bagPocket,trainingGroup}=await import('../vue-explorakit/src/services/bagPockets.js');assert.equal(bagPocket(mega),'training');assert.equal(trainingGroup(mega),'levels');assert.equal(require('../server/game/items/itemSales').getSellPrice('mega_candy'),25000);
});
for(const mode of ['rift','colosseum'])test(mode+': Mega Candy preserves checkpoint at 200 and refuses further consumption',()=>{
 const economy=require('../server/game/drift/economy'),p={alive:true,currentmap:'tour_etage1',money:100000,run:{mode,phase:'exploration'},equipe:{pokemons:[factory.create(9,199,true),factory.create(94,100,true)]},items:{},drifts:[],equipped:[]};
 economy.buy(p,'mega_candy',2);assert.equal(p.money,0);p.run.phase='colosseum_ready';const reserve=JSON.stringify(p.equipe.pokemons[1]);economy.usePotion(p,'mega_candy',p.equipe.pokemons[0].uuid);assert.equal(p.equipe.pokemons[0].level,200);assert.equal(p.items.mega_candy,1);assert.equal(JSON.stringify(p.equipe.pokemons[1]),reserve);assert.equal(codec.decode(codec.encode(p)).equipe.pokemons[0].level,200);assert.throws(()=>economy.usePotion(p,'mega_candy',p.equipe.pokemons[0].uuid),/maximum 200/);assert.equal(p.items.mega_candy,1);
});
