const test=require('node:test'),assert=require('node:assert/strict');
const factory=require('../server/game/drift/pokemonFactory'),engine=require('../server/game/battle/battleEngine');
const codec=require('../server/game/drift/checkpointCodec'),{clearBattleTransientState}=require('../server/game/battle/battleOutcome');
const {DriftBattle}=require('../server/game/drift/driftBattle'),reward=require('../server/game/raids/pokemonReward');
function mon(id=9,moves=['Tackle']){const p=factory.create(id,100,true);p.passiveAbility=null;p.heldItem=null;p.abilities=moves;p.movePp=moves.map(require('../server/game/battle/battleResources').getMaxMovePp);return p;}
function cast(move,a,b,state=engine.createBattleState()){return engine.useattack(move,a,b,{battleState:state,attackerSide:state.sides.player,defenderSide:state.sides.enemy,attackerTeam:[a],defenderTeam:[b]});}
function fixed(f){const old=Math.random;Math.random=()=>.5;try{return f();}finally{Math.random=old;}}
test('rift reward boundaries: 15%, conditional 1% shiny, normal K4, random IVs, no boss traits/items/EVs',()=>{
 const boss=mon(150);boss.level=1000;boss.corruption={permanent:true};boss.heldItem='life_orb';
 assert.equal(reward.roll({},boss,()=>.15),null);
 let calls=0;assert.equal(reward.roll({training:true},boss,()=>{calls++;return 0;}),null);assert.equal(calls,0);
 for(const [shinyRoll,shiny]of [[.009999,true],[.01,false]]){
  let n=0;const p=reward.roll({},boss,()=>++n===1?.149999:n===2?shinyRoll:.5);
  assert.equal(p.data.id,150);assert.equal(p.level,1000);assert.equal(p.k,4);assert.equal(p.shiny,shiny);assert.equal(p.corruption,null);assert.equal(p.heldItem,null);assert(Object.values(p.ev).every(v=>v===0));assert(Object.values(p.iv).every(v=>v===16));assert.equal(p.currentHp,p.maxHp);assert.notEqual(p.uuid,boss.uuid);assert(p.abilities.length>0);
 }
 const seeded=s=>()=>((s=Math.imul(s,1664525)+1013904223>>>0)/4294967296),r=seeded(1921);let received=0,shiny=0;
 for(let i=0;i<10000;i++){const p=reward.roll({},boss,r);if(p){received++;shiny+=p.shiny;assert(Object.values(p.iv).every(v=>v>=0&&v<=31));}}
 assert(Math.abs(received/10000-.15)<.015);assert(Math.abs(shiny/received-.01)<.006);
});
test('final level1000 rift rotates only legendary species, preserving every other rift and the closed generation',()=>{
 const c=require('../server/game/raids/content'),r=require('../server/game/raids/rotation'),dc=require('../server/game/world/darkContinent2');
 const w=c.createDay(1000),f=w.rifts.find(dc.isFinal),others=structuredClone(w.rifts.filter(p=>p!==f));
 for(const id of r.pool(f.map,w.day)){assert(factory.legendary.has(id));assert(id<=649);const boss=c.bossFor({...f,bossSpecies:id});assert.equal(boss.level,1000);assert.equal(boss.abilities.length,4);require('../server/game/raids/ruleset').teamSet(boss);}
 f.bossSpecies=9;const generation=f.generation;r.upgrade(w,1000);assert(factory.legendary.has(f.bossSpecies));assert.equal(f.generation,generation+1);assert.deepEqual(w.rifts.filter(p=>p!==f),others);assert(!r.upgrade(w,1000));
 f.bossSpecies=9;f.closedUntil=2000;assert(!r.upgrade(w,1000));assert.equal(f.bossSpecies,9);assert(!r.reopen(w,1999,()=>0));assert(r.reopen(w,2000,()=>0));assert(factory.legendary.has(f.bossSpecies));const previous=f.bossSpecies;f.closedUntil=3000;r.reopen(w,3000,()=>0);assert.notEqual(f.bossSpecies,previous);
});
test('casino exact theoretical RTP96%, 7771%, identical UI catalogue and unchanged payouts',()=>{
 const c=require('../data/game/casino_slots.json'),ui=require('../vue-explorakit/src/data/casinoSlots.json');assert.deepEqual(c,ui);
 assert.equal(c.results.reduce((n,v)=>n+v.weight,0),1000000);assert.equal(c.results.reduce((n,v)=>n+v.weight*v.numerator/v.denominator,0),960000);assert.equal(c.results.find(v=>v.kind==='seven').weight,10000);
});
test('Dark wild and fishing XP +25%, plates +2 points, shards +50% capped at100%, outside untouched',()=>{
 const dc=require('../server/game/world/darkContinent'),d=require('../server/game/world/darkEncounters');
 for(const [map,plate,shard]of [['jungle1',.21,.82875],['jungle4',.21,.82875],['jungle2',.28,1],['jungle3',.32,1],['jungle9',.38,1],['DC2_44',.38,1],['DC2_04',.38,1]]){
  assert.equal(dc.lootProfile(map).plateChance,plate);assert.equal(dc.lootProfile(map).crystals[0][1],shard);assert.equal(d.experienceMultiplier({},map),.425);assert.equal(d.experienceMultiplier({darkContinentEncounter:{version:1,map,kind:'corrupted'}},map),.85);
 }assert.equal(d.experienceMultiplier({},'route3'),1);
});
test('normal berries consume once in battle, survive a checkpoint and restore on exit; mutation berries remain consumed',()=>fixed(()=>{
 for(const key of ['oran_berry','sitrus_berry']){let p=mon();p.heldItem=key;p.currentHp=1;cast('Splash',p,mon());assert.equal(p.heldItem,null);const hp=p.currentHp;cast('Splash',p,mon());assert.equal(p.currentHp,hp);p=codec.decode(codec.encode(p));clearBattleTransientState([p]);assert.equal(p.heldItem,key);}
 const p=mon();p.heldItem='mutant_stat_attack_common_berry';const state=engine.createBattleState();engine.applySwitchInEffects(p,state.sides.player,state.sides.enemy,state,mon());clearBattleTransientState([p]);assert.equal(p.heldItem,null);
}));
for(const mode of ['adventure','super-tournament','draft','house-2v1','house-2v2'])test(mode+': trapped switch reopens same decision without consuming turn or NPC choice; attack works after reload',()=>{
 const events=[],p={userId:1,equipe:{pokemons:[mon(25),mon(9)]},items:{},drifts:[],equipped:[]},foe={npc:true,equipe:{pokemons:[mon(51,['Splash'])]},drifts:[],equipped:[]};foe.equipe.pokemons[0].passiveAbility='Arena Trap';
 const b=new DriftBattle(p,foe,{type:'trainer',paceMs:0,emit:(p,e,d)=>events.push({e,d}),rules:{rewards:false}}),token=b.token,choice=structuredClone(b.pending.get(foe)),deadline=b.deadline;
 assert.equal(b.action(p,{action:'change',number:1,turnId:token}),false);assert.equal(b.token,token);assert.equal(b.deadline,deadline);assert.deepEqual(b.pending.get(foe),choice);assert.equal(events.at(-1).e,'requestAction');assert.equal(events.at(-1).d.turnId,token);
 const resumed=codec.decode(codec.encode(b));resumed.emit=()=>{};resumed.now=Date.now;resumed.resume(resumed.a);assert.equal(resumed.action(resumed.a,{action:'attack',number:0,turnId:token}),true);b.finished=resumed.finished=true;
});
test('Draft free Wonder Guard ability really blocks neutral/fixed hits, allows super-effective, status, residual and Mold Breaker',()=>fixed(()=>{
 const prep=require('../server/game/draft/preparation'),base={id:'p',kind:'pokemon',pokemon:mon(9)},a={id:'a',kind:'ability',ability:'Wonder Guard'},run={cards:new Map([['p',base],['a',a]])},seat={collection:['p','a'],plan:{attachments:{p:{ability:'a'}}}};
 for(const [move,id,blocked,ability]of [['Tackle',143,true],['Seismic Toss',143,true],['Thunderbolt',25,false],['Tackle',143,false,'Mold Breaker']]){
  const target=prep.build(run,seat,'p'),source=mon(id,[move]);source.passiveAbility=ability||null;const hp=target.currentHp,result=cast(move,source,target);assert.equal(target.passiveAbility,'Wonder Guard');assert.equal(target.currentHp===hp,blocked,move+' '+ability);assert.equal(result.damage===0,blocked,move);
 }
 const target=prep.build(run,seat,'p'),source=mon(143,['Toxic']),state=engine.createBattleState();cast('Toxic',source,target,state);assert.equal(target.status,'badly_poison');const hp=target.currentHp;engine.processEndOfRound(source,target,state.sides.player,state.sides.enemy,state);assert(target.currentHp<hp);
}));
test('Corruption pills exclude Pure Power but old modules, native abilities and ordinary capsule options remain valid',()=>{
 const modules=require('../server/game/corruption/modules');for(const p of Object.values(modules.pools))for(const key of p.ability)assert(!['Pure Power','Huge Power','Wonder Guard'].includes(modules.get(key).corruptionModule.ability));
 assert(modules.get('cmod_ability_purepower'));const p=mon(308);p.passiveAbility='Telepathy';assert(require('../server/game/items/abilityCapsule').alternatives(p).includes('Pure Power'));
});
test('Housing PC and healer cost500000 without changing other furniture prices',()=>{
 const c=require('../data/game/housing.json');assert.deepEqual(c,require('../vue-explorakit/src/data/housing.json'));for(const id of ['pokemon_pc','healing_station'])assert.equal(c.furniture.find(p=>p.key===id).price,500000);
});
test('Endeavor fails against raid boss even at1HP and when called; outside raids its ordinary effect remains',()=>fixed(()=>{
 const {RaidBattle}=require('../server/game/raids/RaidBattle'),{make}=require('../scripts/calibrateCorruptionRaids');
 const b=new RaidBattle(Array.from({length:4},()=>({ownerId:1,pokemon:make(9,100,4,['Endeavor'],'Keen Eye')})),make(143,100,4,['Splash'],'Keen Eye'),{seed:[1,2,3,4],now:()=>1000}),sim=b.sim,a=sim.p1.active[0],boss=b.bossPokemon;a.hp=1;const hp=boss.hp,shield=structuredClone(boss.m);
 sim.actions.runMove('endeavor',a,1);assert.equal(boss.hp,hp);assert.equal(a.moveSlots[0].pp,4);assert(!a.m.aggro);assert.deepEqual(boss.m,shield);
 sim.actions.useMove('endeavor',a,boss,sim.dex.moves.get('metronome'));assert.equal(boss.hp,hp);
 const source=mon(9,['Endeavor']),target=mon(143);source.currentHp=1;cast('Endeavor',source,target);assert.equal(target.currentHp,1);
}));

test('normal berries restore after actual raid and doubles consumption, without allowing a second in-battle activation',()=>{
 const {RaidBattle}=require('../server/game/raids/RaidBattle'),{DoublesBattle}=require('../server/game/doubles/doublesBattle'),{make}=require('../scripts/calibrateCorruptionRaids');
 const p=()=>{const q=make(9,100,4,['Splash'],'Keen Eye');q.heldItem='oran_berry';return q;},b=new RaidBattle(Array.from({length:4},()=>({ownerId:1,pokemon:p()})),p(),{seed:[1,2,3,4],now:()=>1000});b.sim.p1.active[0].hp=1;assert(b.sim.p1.active[0].eatItem());assert.equal(b.sim.p1.active[0].item,'');assert(!b.sim.p1.active[0].eatItem());b.applyModels();assert.equal(b.models[0].pokemon.heldItem,'oran_berry');const restored=RaidBattle.restore(codec.decode(codec.encode(b.snapshot())),()=>1000);restored.applyModels();assert.equal(restored.models[0].pokemon.heldItem,'oran_berry');
 const players=[1,2].map(id=>({id,username:'test'+id,equipe:{pokemons:[p(),p()]}})),d=new DoublesBattle(...players,{emit(){}});d.sim.p1.active[0].hp=1;assert(d.sim.p1.active[0].eatItem());assert.equal(players[0].equipe.pokemons[0].heldItem,'oran_berry');assert(!d.sim.p1.active[0].eatItem());
});
