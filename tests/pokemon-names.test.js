const test=require('node:test'),assert=require('node:assert/strict');
const names=require('../server/game/models/ownedNames'),storage=require('../server/game/storage/pokemonStorage'),factory=require('../server/game/drift/pokemonFactory');
const codec=require('../server/game/drift/checkpointCodec'),computer=require('../server/game/drift/pokemonComputer');
const {registerPokemonNameHandlers}=require('../server/realtime/handlers/pokemonNameHandlers');
const mon=()=>factory.create(7,20,true),payload=(p,name)=>({pokemonUuid:p.uuid,expectedName:p.name,name});
test('owned names normalize accents/spacing, allow simple punctuation and reject markup, controls and excessive lengths',()=>{
 assert.equal(names.normalizeName('  E\u0301clair   2 !  '),'Éclair 2 !');assert.equal(names.normalizeName("L'équipe-1"),"L'équipe-1");assert.equal(names.normalizeName('   '),'');
 assert.equal(names.normalizeName('a'.repeat(24)),'a'.repeat(24));for(const n of [null,{},42,'a'.repeat(25),'<img src=x>','a\nb','a\u202eb','a\u200bb'])assert.throws(()=>names.normalizeName(n));
});
test('renaming changes no species or resources; empty restores species and stale/foreign/egg requests fail',()=>{
 const p=mon(),before=codec.encode(p);assert.equal(names.renamedPokemon(p,payload(p,'Écume')),'Écume');assert.deepEqual(codec.encode(p),before);
 p.name='Écume';assert.equal(names.renamedPokemon(p,payload(p,'')),'Carapuce');assert.throws(()=>names.renamedPokemon(p,{...payload(p,'New'),expectedName:'Carapuce'}),/changé/);assert.throws(()=>names.renamedPokemon(p,{...payload(p,'New'),pokemonUuid:'foreign'}),/appartient/);p.isEgg=true;assert.throws(()=>names.renamedPokemon(p,payload(p,'New')),/éclosion/);
});
test('20 private boxes, 600 slots, legacy full PC continues in box 9 and slot 600 is usable',()=>{
 assert.equal(storage.BOX_COUNT,20);assert.equal(storage.CAPACITY,600);
 const old=Array.from({length:240},(_,i)=>({box:Math.floor(i/30),slot:i%30}));assert.deepEqual(storage.freeSlot(old),{box:8,slot:0});
 const full=Array.from({length:600},(_,i)=>({box:Math.floor(i/30),slot:i%30}));assert.throws(()=>storage.freeSlot(full),/plein/);full.pop();assert.deepEqual(storage.freeSlot(full),{box:19,slot:29});assert.throws(()=>storage.assertBox(20));
 const custom={19:'Favoris'};assert.equal(storage.boxNames(custom)[19],'Favoris');assert.equal(storage.boxNames()[19],'Boîte 20');assert.equal(storage.renamedBox(custom,{box:19,name:'',expectedName:'Favoris'}),'');assert.throws(()=>storage.renamedBox(custom,{box:19,name:'Other',expectedName:'Boîte 20'}),/changé/);
});
function handler(persist,canUse=()=>true){const handlers={},events=[],p={equipe:{pokemons:[mon()]}};registerPokemonNameHandlers({socket:{on:(n,f)=>handlers[n]=f,emit:(n,d)=>events.push([n,d])},userId:12,getPlayer:()=>p,canUse,persist});return{p,events,send:async(data=payload(p.equipe.pokemons[0],'Écume'))=>{let r;await handlers.renamePokemon(data,v=>r=v);return r;}};}
test('nickname publication waits for save, blocks concurrent requests and touches only the name',async()=>{
 let finish;const h=handler(async(id,p)=>{assert.equal(id,12);await new Promise(r=>finish=r);return{name:names.renamedPokemon(h.p.equipe.pokemons[0],p)};});
 const p=h.p.equipe.pokemons[0],before=codec.decode(codec.encode(p)),pending=h.send();assert(h.p.inventoryBusy);assert.equal(p.name,before.name);assert.equal((await h.send()).success,false);finish();assert((await pending).success);before.name='Écume';assert.deepEqual(codec.encode(p),codec.encode(before));assert.equal(h.events[0][0],'teamStateChanged');assert(!h.p.inventoryBusy);
 assert.equal((await h.send({...payload(p,'New'),pokemonUuid:'foreign'})).success,false);
});
test('combat, busy/closed context and write failures keep original name without a success event',async()=>{
 let calls=0;const h=handler(async()=>{calls++;throw Error('injected_failure');}),before=h.p.equipe.pokemons[0].name;
 h.p.inbattle=true;assert(!(await h.send()).success);h.p.inbattle=false;h.p.inventoryBusy=true;assert(!(await h.send()).success);h.p.inventoryBusy=false;assert(!(await h.send()).success);assert.equal(calls,1);assert.equal(h.p.equipe.pokemons[0].name,before);assert.equal(h.events.length,0);assert(!(await handler(()=>assert.fail(),()=>false).send()).success);
});
for(const mode of ['rift','colosseum'])test(`${mode}: private box and Pokémon names survive a checkpoint, independent from other runs`,()=>{
 const a=mon(),b=mon(),p={userId:1,alive:true,run:{mode,phase:'exploration'},currentmap:'centre',x:560,y:304,equipe:{pokemons:[a]},storage:[{box:19,slot:29,pokemon:b}],items:{},drifts:[],equipped:[]},before=codec.decode(codec.encode(b));
 computer.mutate(p,{action:'renameBox',box:19,name:'Les champions',expectedName:'Boîte 20'});computer.mutate(p,{action:'renamePokemon',...payload(b,'Écume')});before.name='Écume';assert.deepEqual(codec.encode(b),codec.encode(before));assert.equal(computer.open(p).entries[0].pokemon.name,'Écume');assert.equal(computer.open(p).entries[0].pokemon.speciesName,'Carapuce');
 const restored=codec.decode(codec.encode(p));assert.equal(computer.open(restored).boxNames[19],'Les champions');assert.equal(restored.storage[0].pokemon.name,'Écume');assert.equal(storage.view([a],[]).boxNames[19],'Boîte 20');p.inbattle=true;assert.throws(()=>computer.mutate(p,{action:'renamePokemon',...payload(b,'No')}));
});
