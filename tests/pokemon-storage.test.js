const test=require('node:test'),assert=require('node:assert/strict');
const storage=require('../server/game/storage/pokemonStorage');
const computer=require('../server/game/world/pokemonComputer');
const factory=require('../server/game/drift/pokemonFactory');
const driftComputer=require('../server/game/drift/pokemonComputer');
const {encode,decode}=require('../server/game/drift/checkpointCodec');
const {DriftBattle}=require('../server/game/drift/driftBattle');
const mon=(id=7)=>{const p=factory.create(id,12,true);p.abilities=['Growl'];p.movePp=[37];p.passiveAbility=null;return p;};
test('PC de chaque Centre : terminal sur meuble bloqué, abord libre hors porte et distance stricte',()=>{
 const maps=require('../server/game/world/mapRepository'),{x,y}=computer.TERMINAL;
 assert.notEqual(maps.loadCollisionData('centre')[y][x],0);assert.equal(maps.loadCollisionData('centre')[y+1][x],0);assert(!maps.changeMapData('centre')[y+1][x]);
 const p={currentmap:'centre',x:x*32+16,y:(y+1)*32+16};assert(computer.isNearComputer(p));assert.equal(computer.devicesForMap('centre').devices.length,1);assert.equal(computer.devicesForMap('ville1').devices.length,0);assert(!computer.isNearComputer({...p,currentmap:'start'}));assert(!computer.isNearComputer({...p,y:(y+2)*32+16}));
});
test('déposer, retirer et échanger conservent toutes les identités et ne mutent pas les entrées avant validation',()=>{
 const a=mon(),b=mon(4),c=mon(1);const team=[a,b],entries=[{box:1,slot:4,pokemon:c}];
 let plan=storage.planAction(team,entries,{action:'deposit',pokemonUuid:b.uuid,box:2});assert.deepEqual(team,[a,b]);assert.equal(entries.length,1);assert.equal(plan.entries[1].pokemon,b);assert.equal(plan.entries[1].box,2);assert.equal(plan.entries[1].slot,0);
 plan=storage.planAction(plan.team,plan.entries,{action:'swap',pokemonUuid:c.uuid,teamUuid:a.uuid});assert.equal(plan.team[0],c);assert.equal(plan.entries[0].pokemon,a);assert.equal(plan.entries[0].slot,4);
 plan=storage.planAction(plan.team,plan.entries,{action:'withdraw',pokemonUuid:b.uuid});assert.deepEqual(plan.team,[c,b]);assert.equal(plan.entries.length,1);assert.equal(plan.entries[0].pokemon,a);
});
test('garde-fous : dernier apte, équipe complète, Pokémon étranger, boîte invalide et confirmation explicite',()=>{
 const a=mon(),b=mon();b.currentHp=0;
 assert.throws(()=>storage.planAction([a],[],{action:'deposit',pokemonUuid:a.uuid,box:0}),/apte/);
 assert.throws(()=>storage.planAction([a,b],[],{action:'deposit',pokemonUuid:a.uuid,box:0}),/apte/);
 assert.throws(()=>storage.planAction([a],[{box:0,slot:0,pokemon:b}],{action:'swap',pokemonUuid:b.uuid,teamUuid:a.uuid}),/apte/);
 assert.throws(()=>storage.planAction([a,b],[],{action:'release',pokemonUuid:b.uuid,source:'team'}),/Confirme/);
 assert.throws(()=>storage.planAction([a,b],[],{action:'deposit',pokemonUuid:b.uuid,box:8}),/Boîte/);
 assert.throws(()=>storage.planAction([a,b],[],{action:'deposit',pokemonUuid:'foreign',box:0}));
 assert.throws(()=>storage.planAction(Array.from({length:6},()=>mon()),[{box:0,slot:0,pokemon:a}],{action:'withdraw',pokemonUuid:a.uuid}),/complète/);
 const plan=storage.planAction([a,b],[],{action:'release',pokemonUuid:b.uuid,source:'team',confirm:true});assert.equal(plan.released,b);assert.equal(plan.team.length,1);
});
test('boîtes pleines : pas de débordement ni remplacement silencieux, capture vers la première place libre',()=>{
 const entries=Array.from({length:240},(_,i)=>({box:Math.floor(i/30),slot:i%30}));assert.throws(()=>storage.freeSlot(entries),/PC est plein/);assert.throws(()=>storage.freeSlot(entries,0),/boîte est pleine/);entries.splice(37,1);assert.deepEqual(storage.freeSlot(entries),{box:1,slot:7});
});
for(const mode of ['rift','colosseum'])test(`${mode} : septième capture au PC, checkpoint et échanges sans soin ni XP de réserve`,()=>{
 const p={userId:1,alive:true,run:{mode,phase:'exploration'},currentmap:'centre',x:17*32+16,y:9*32+16,equipe:{pokemons:Array.from({length:6},()=>mon())},items:{pokeball:3},drifts:[],equipped:[],defeated:new Set(),money:0};
 const target=mon(19);const battle=new DriftBattle(p,{npc:true,equipe:{pokemons:[target]},drifts:[],equipped:[]},{random:()=>0,paceMs:0,emit:()=>{}});
 assert(battle.action(p,{action:'bag',itemKey:'pokeball',turnId:battle.token}));assert(battle.finished);assert.equal(p.equipe.pokemons.length,6);assert.equal(p.storage.length,1);assert.equal(p.storage[0].pokemon,target);assert.equal(p.items.pokeball,2);
 const restored=decode(encode(p));assert.equal(restored.storage[0].pokemon.uuid,target.uuid);assert.equal(restored.storage[0].pokemon.level,target.level);
 target.currentHp=2;const outgoing=p.equipe.pokemons[2];outgoing.heldItem='leftovers';const result=driftComputer.mutate(p,{action:'swap',pokemonUuid:target.uuid,teamUuid:outgoing.uuid});assert.equal(result.equipe.pokemons[2],target);assert.equal(target.currentHp,2);assert.equal(p.storage[0].pokemon,outgoing);
 assert.throws(()=>driftComputer.mutate(p,{action:'release',source:'box',pokemonUuid:outgoing.uuid}),/Confirme/);
 driftComputer.mutate(p,{action:'release',source:'box',pokemonUuid:outgoing.uuid,confirm:true});assert.equal(p.items.leftovers,1);assert.equal(p.storage.length,0);assert.throws(()=>driftComputer.mutate(p,{action:'release',source:'box',pokemonUuid:outgoing.uuid,confirm:true}));assert.equal(p.items.leftovers,1);
 p.run.phase='colosseum_ready';assert.throws(()=>driftComputer.open(p),/exploration/);p.run.phase='exploration';p.currentmap='route1';assert.throws(()=>driftComputer.open(p),/Approche/);
});

test('la fiche PC reçoit les statistiques permanentes, la vraie nature, l’XP et les PP sans modifier le compagnon',()=>{
 const p=mon(4);p.nature='Modest';p.recalculateStats();p.movePp=[0];p.currentHp=3;p.heldItem='leftovers';
 const before=JSON.stringify(p);const result=storage.view([p],[{box:0,slot:0,pokemon:p}],true);const entry=result.entries[0].pokemon;
 for(const key of ['attack','defense','specialAttack','specialDefense','speed'])assert.equal(entry.stats[key],p[key]);
 assert.equal(entry.nature,'Modest');assert.equal(entry.experience,p.experience);assert.equal(entry.experienceRate,p.experienceRate);assert.equal(entry.potential,p.k);assert.deepEqual(entry.iv,p.iv);assert.deepEqual(entry.ev,p.ev);assert.equal(entry.moveDetails[0].pp,0);assert.equal(entry.moveDetails[0].maxPp,40);assert.equal(entry.moveDetails[0].type,'Normal');assert.equal(entry.moveDetails[0].damageClass,'status');assert.equal(entry.heldItemName,'Restes');assert.deepEqual(result.team[0],entry);assert.equal(JSON.stringify(p),before);
});
test('adaptation vers la fiche commune : statistiques, potentiel, types et capacités sans modifier le snapshot PC',async()=>{
 const {computerPokemonDetails}=await import('../vue-explorakit/src/services/pokemonComputer.js');const p=mon();const snapshot=storage.view([p],[]).team[0],before=JSON.stringify(snapshot);const adapted=computerPokemonDetails(snapshot);
 assert.equal(adapted.spriteId,p.data.id);assert.equal(adapted.k,p.k);assert.equal(adapted.attack,p.attack);assert.equal(adapted.nature,p.nature);assert.equal(adapted.currentHp,p.currentHp);assert.deepEqual(adapted.data.type,p.data.type);assert.deepEqual(adapted.abilities,p.abilities);adapted.abilities.push('Scratch');assert.equal(JSON.stringify(snapshot),before);assert.equal(computerPokemonDetails(null),null);
});
