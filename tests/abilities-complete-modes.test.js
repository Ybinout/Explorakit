const test=require('node:test'),assert=require('node:assert/strict'),{cases,mon,hit,state,rng}=require('./fixtures/abilityContracts'),{arena,Dex}=require('./fixtures/nativeAbilityArena');
const inventory=require('../scripts/auditAbilityReview').buildReport(),catalog=require('../data/game/abilities.gen7.json').abilities;
const native=require('../server/game/doubles/ruleset').dex,raid=require('../server/game/raids/ruleset').dex;
for(const mode of ['doubles','raid'])test(mode+': Imposter copying fewer moves survives a cold checkpoint with PP and virtual slots preserved',()=>{
 const a=arena(mode,'Imposter',{species:132}),sim=a.sim,p=a.subject;
 // Transform a four-move Pokémon into a real one-move target.
 p.clearVolatile();p.setAbility('imposter');const foe=a.foe;foe.moveSlots=foe.moveSlots.slice(0,1);p.transformInto(foe);
 assert.equal(p.moveSlots.length,1);assert.equal(p.baseMoveSlots.length,4);p.moveSlots[0].pp=3;
 const snapshot=JSON.stringify(sim.toJSON()),saved=snapshot;
 const cold=mode==='raid'?require('../server/game/raids/ruleset').restore(snapshot):require('../server/game/doubles/checkpoint').restore(snapshot);
 const q=cold.p1.active[0];assert.equal(q.moveSlots.length,1);assert.equal(q.moveSlots[0].pp,3);assert.equal(q.moveSlots[0].virtual,true);assert.equal(q.baseMoveSlots.length,4);assert.equal(q.transformed,true);assert.equal(snapshot,saved);
 // A second restoration must remain stable and must not expose padding moves.
 const again=require('../server/game/doubles/checkpoint').restore(JSON.stringify(cold.toJSON()));assert.equal(again.p1.active[0].moveSlots.length,1);assert.equal(again.p1.active[0].moveSlots[0].pp,3);
});
test('every currently playable ability has an explicit behavioral contract; non-combat and field-only effects are separated',()=>{assert.equal(inventory.totalStudied,167);for(const p of inventory.abilities)assert(cases.has(p.name),p.name);});
for(const c of cases.values())if(!c.nativeOnly)test('Playable single ability contract: '+c.name+' — '+c.label,c.run);
for(const name of ['Illuminate','Honey Gather'])test(name+' has no in-combat modifier in singles; overworld policy remains explicit',()=>rng(.8,()=>{for(const move of ['Pound','Water Gun','Toxic']){const a=mon(name),d=mon(),r=hit(a,d,move),x=mon(),y=mon(),control=hit(x,y,move);assert.equal(r.damage,control.damage);assert.equal(d.status,y.status);}}));
for(const mode of ['doubles','raid']){
 test(mode+': every one of the223 catalog abilities preserves the canonical Gen7 native hooks',()=>{for(const {name}of catalog){const expected= Dex.mod('gen7').abilities.get(name),actual=(mode==='raid'?raid:native).abilities.get(name);assert(expected.exists&&actual.exists,name);for(const key of Object.keys(expected).filter(k=>k.startsWith('on'))){assert.equal(String(actual[key]),String(expected[key]),name+':'+key);}}});
 for(const name of ['Aftermath'])for(const variant of ['contact','ranged','pads','magicguard','longreach','damp','moldbreaker'])test(mode+': '+name+' KO contract, '+variant,()=>{
  const a=arena(mode,name,{species:426}),p=a.subject,s=a.foe;p.hp=1;
  if(variant==='pads')s.setItem('protectivepads');if(['magicguard','longreach','damp','moldbreaker'].includes(variant))s.setAbility(variant);
  a.move(variant==='ranged'?'Water Gun':'Bite');assert.equal(p.hp,0);assert.equal(400-s.hp,['contact','moldbreaker'].includes(variant)?100:0);
 });
 test(mode+': Damp on the farthest ally prevents Aftermath across owner boundaries',()=>{const a=arena(mode,'Aftermath',{species:426});a.subject.hp=1;a.allies.at(-1).setAbility('damp');a.move('Bite');assert.equal(a.subject.hp,0);assert.equal(a.foe.hp,400);});
 test(mode+': Friend Guard protects every other allied slot, never itself',()=>{const a=arena(mode,'Friend Guard',{owner:mode==='raid'?3:1}),move=a.sim.dex.getActiveMove('Water Gun');move.willCrit=false;a.sim.randomizer=n=>n;const before=a.allies.map(p=>a.sim.actions.getDamage(a.foe,p,move));a.subject.setAbility('keeneye');const after=a.allies.map(p=>a.sim.actions.getDamage(a.foe,p,move));for(let i=0;i<a.allies.length;i++)assert(i===a.subject.position?before[i]===after[i]:before[i]<after[i]);});
 for(const name of ['Plus','Minus'])test(mode+': '+name+' sees a matching ability in the farthest ally slot',()=>{const a=arena(mode,name);a.allies.at(-1).setAbility(name);assert.equal(a.subject.getStat('spa'),150);a.allies.at(-1).setAbility('keeneye');assert.equal(a.subject.getStat('spa'),100);});
 test(mode+': Telepathy prevents allied spread damage, while the foe is still hit',()=>{const a=arena(mode,'Telepathy',{owner:mode==='raid'?3:1}),p=a.subject;a.move('Surf',a.allies[0],a.foe);assert.equal(p.hp,400);assert(a.foe.hp<400);});
 test(mode+': Healer cures allies in every eligible slot, without curing itself',()=>{const a=arena(mode,'Healer');a.sim.randomChance=()=>true;for(const p of a.allies)p.setStatus('brn');a.sim.fieldEvent('Residual');assert.equal(a.subject.status,'brn');for(const p of a.allies.filter(p=>p!==a.subject))assert.equal(p.status,'');});
 for(const [name,move,stat]of [['Storm Drain','Water Gun','spa'],['Lightning Rod','Thunderbolt','spa']])test(mode+': '+name+' redirects a targeted attack to the farthest eligible ally',()=>{const a=arena(mode,name,{owner:mode==='raid'?3:1});a.move(move,a.foe,a.allies[0]);assert.equal(a.allies[0].hp,400);assert.equal(a.subject.hp,400);assert.equal(a.subject.boosts[stat],1);});
}
for(const type of ['wild','trainer','pvp'])for(const variant of ['contact','ranged','pads','magicguard','longreach','damp','moldbreaker','substitute'])test(type+': Aftermath real KO and contact exceptions — '+variant,()=>rng(.8,()=>{const {make}=require('../scripts/calibrateCorruptionRaids'),a=make(68,50,4,['Bite','Water Gun'],'Keen Eye'),d=make(426,50,4,['Splash'],'Aftermath');a.heldItem=d.heldItem=null;d.currentHp=1;if(variant==='pads')a.heldItem='protective_pads';a.passiveAbility={magicguard:'Magic Guard',longreach:'Long Reach',damp:'Damp',moldbreaker:'Mold Breaker'}[variant]||'Keen Eye';if(variant==='substitute')require('../server/game/battle/battleEngine').ensureBattleData(a).substituteHp=100;const hp=a.currentHp,s=require('../server/game/battle/battleEngine').createBattleState({battleType:type});hit(a,d,variant==='ranged'?'Water Gun':'Bite',s);assert.equal(d.currentHp,0);assert.equal(hp-a.currentHp,['contact','moldbreaker','substitute'].includes(variant)?Math.floor(a.maxHp/4):0);}));
