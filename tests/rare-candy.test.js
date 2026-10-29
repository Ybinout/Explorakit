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
 const economy=require('../server/game/drift/economy'),p={alive:true,currentmap:'tour_etage1',money:10000,run:{mode,phase:'exploration'},equipe:{pokemons:[factory.create(7,5,true),factory.create(4,5,true)]},items:{},drifts:[],equipped:[]};
 economy.buy(p,'rare_candy',1);assert.equal(p.money,5000);p.run.phase='colosseum_ready';const reserve=JSON.stringify(p.equipe.pokemons[1]),r=economy.usePotion(p,'rare_candy',p.equipe.pokemons[0].uuid);assert.equal(r.equipe.pokemons[0].level,6);assert.equal(p.items.rare_candy,0);assert.equal(JSON.stringify(p.equipe.pokemons[1]),reserve);assert.equal(codec.decode(codec.encode(p)).equipe.pokemons[0].level,6);assert.throws(()=>economy.usePotion(p,'rare_candy',p.equipe.pokemons[0].uuid));
});
