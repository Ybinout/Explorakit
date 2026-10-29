const test=require('node:test'),assert=require('node:assert/strict');
const factory=require('../server/game/drift/pokemonFactory'),evolution=require('../server/game/models/evolution');
const {pokemonToRow,rowToPokemon,POKEMON_COLUMNS}=require('../server/persistence/teamRepository');
const codec=require('../server/game/drift/checkpointCodec');
const level=(p,n)=>p.gainExperience(p.getNextLevelExpForLevel(n)-p.experience,{deferEvolution:true});
const restore=p=>rowToPokemon(Object.fromEntries(POKEMON_COLUMNS.map((k,i)=>[k,pokemonToRow(p,1,1)[i]])));
test('owned XP defers evolution, cancellation survives SQL rows and checkpoints and only a new level offers it again',()=>{
 const p=factory.create(4,15,true);level(p,16);assert.equal(p.data.id,4);const prompt=p.evolutionState.pending;assert.equal(prompt.targetId,5);
 for(const copy of [p,restore(p),codec.decode(codec.encode(p))]){
  assert.throws(()=>evolution.resolvePending(copy,{promptId:'forged',cancel:true}));
  assert.deepEqual(evolution.resolvePending(copy,{promptId:prompt.id,cancel:true}),{cancelled:true});assert.equal(copy.data.id,4);
  copy.gainExperience(1,{deferEvolution:true});assert.equal(copy.evolutionState.pending,null);
  const saved=restore(copy);assert.equal(saved.evolutionState.declinedLevel,16);level(saved,17);assert(saved.evolutionState.pending);assert.notEqual(saved.evolutionState.pending.id,prompt.id);
  const result=evolution.resolvePending(saved,{promptId:saved.evolutionState.pending.id,cancel:false});assert.equal(result.to,5);assert.equal(saved.data.id,5);assert.equal(saved.level,17);
 }
});
test('large XP keeps each evolution cancellable and confirmation catches up the intermediate learnset',()=>{
 const p=factory.create(4,15,true);level(p,40);assert.equal(p.data.id,4);evolution.resolvePending(p,{promptId:p.evolutionState.pending.id,cancel:false});assert.equal(p.data.id,5);assert.equal(p.evolutionState.pending.targetId,6);const known=new Set([...p.abilities,...p.pendingMoves.map(m=>m.move)]);for(const [n,move]of require('../data/game/level_up_moves.json').species[5])if(n>16&&n<=40)assert(known.has(move),move);
 evolution.resolvePending(p,{promptId:p.evolutionState.pending.id,cancel:true});assert.equal(p.data.id,5);assert.equal(p.evolutionState.pending,null);
});
test('Everstone prevents automatic and manual level evolution, keeps XP and works after reload/removal',()=>{
 const p=factory.create(4,15,true);p.heldItem='everstone';level(p,40);assert.equal(p.data.id,4);assert.equal(p.level,40);assert(!p.evolutionState?.pending);
 assert.throws(()=>evolution.evolve(p,{fromSpeciesId:4,targetId:5}));assert(evolution.options(p).every(o=>!o.ready));
 const saved=restore(p);saved.heldItem=null;saved.gainExperience(1,{deferEvolution:true});assert(saved.evolutionState.pending);evolution.resolvePending(saved,{promptId:saved.evolutionState.pending.id,cancel:false});assert.equal(saved.data.id,5);
});
test('XP skip completes exactly the current Pokemon while a subsequent playback still waits',async()=>{
 const {playExperienceGain}=await import('../vue-explorakit/src/services/experiencePlayback.js');const signal=new AbortController(),frames=[],control={};
 const payload={pokemon:{level:7,experience:216},previousLevel:5,previousExperience:64,xpGained:152};
 const task=playExperienceGain(payload,f=>frames.push(f),signal.signal,false,control);control.skip();await task;assert.equal(frames.at(-1).level,7);assert.equal(frames.at(-1).percent,0);
 const nextControl={},nextFrames=[];const next=playExperienceGain(payload,f=>nextFrames.push(f),signal.signal,false,nextControl);assert.equal(nextFrames.length,1);assert.equal(nextControl.skipped,false);signal.abort();await next;
});
test('a wild Route 6 Ditto can really roll its hidden Imposter ability',async()=>{
 const abilities=require('../server/game/abilities/abilityDex');assert(abilities.getSpeciesAbilitySlots(132).some(s=>s.hidden&&s.name==='Imposter'));assert(require('../data/game/nextMap.json').maps.find(m=>m.mapName==='route6').wildpokemon.includes(132));
 const original=Math.random;try{Math.random=()=>0;const p=await require('../server/game/world/wildPokemonFactory').createAtLevel(132,25);assert.equal(p.passiveAbility,'Imposter');assert.deepEqual(p.abilities,['Transform']);}finally{Math.random=original;}
});
