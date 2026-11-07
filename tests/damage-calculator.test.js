const test=require('node:test'),assert=require('node:assert/strict');
const {make}=require('../scripts/calibrateCorruptionRaids'),{calculate}=require('../server/game/strategy/damageCalculator'),engine=require('../server/game/battle/battleEngine');
function pair(move='Flamethrower',ability='Blaze',id=6){return [make(id,100,4,[move],'Keen Eye'),make(143,150,4,['Tackle'],ability)];}
function calc(team,options={}){return calculate(team,{attacker:team[0].uuid,defender:team[1].uuid,move:0,options});}
test('calculator uses actual direct engine output without mutating HP, PP, held items, types or flags',()=>{
 const team=pair(),before=JSON.stringify(team),r=calc(team);assert.equal(JSON.stringify(team),before);
 const[a,d]=structuredClone(team),state=engine.createBattleState({battleType:'trainer'});state.weather={kind:null};const hp=d.currentHp;
 const live=engine.useattack('Flamethrower',a,d,{battleState:state,consumePp:false,skipTurnStart:true,damagePreview:{roll:0,critical:false}});assert(live.success);assert.equal(r.min,hp-d.currentHp);assert.equal(r.min,r.max);
});
test('weather, STAB, critical hits, real K/IV/EV stats and boosts affect the simulation',()=>{
 const t=pair(),base=calc(t).max;assert(calc(t,{weather:'sun'}).max>base);assert(calc(t,{weather:'rain'}).max<base);assert(calc(t,{critical:true}).max>base);assert(calc(t,{attackerBoosts:{specialAttack:2}}).max>base);t[0].k=1;t[0].recalculateStats();assert(calc(t).max<base);
});
test('burn, paralysis contexts, screens and critical immunity keep canonical behavior',()=>{
 const t=pair('Earthquake');const base=calc(t).max;assert(calc(t,{attackerStatus:'burn'}).max<base);assert(calc(t,{reflect:true}).max<base);t[1].passiveAbility='Battle Armor';assert.equal(calc(t,{critical:true}).max,base);
});
test('absorptions, Levitate, type immunity and Mold Breaker use the live ability pipeline',()=>{
 const t=pair('Earthquake','Levitate');assert.equal(calc(t).max,0);t[0].passiveAbility='Mold Breaker';assert(calc(t).max>0);
 const electric=pair('Thunderbolt','Volt Absorb',135);assert.equal(calc(electric).max,0);
 const ghost=[make(6,100,4,['Tackle'],'Keen Eye'),make(94,100,4,['Shadow Ball'],'Levitate')];assert.equal(calc(ghost).max,0);
});
test('held items, survival effects and corruption are included, never consumed on the actual team',()=>{
 const t=pair(),base=calc(t).max;t[0].heldItem='life_orb';const before=JSON.stringify(t);assert(calc(t).max>base);assert.equal(JSON.stringify(t),before);
 t[0].heldItem=null;t[0].corruption={version:1,revision:1,permanent:true,modules:{combat:{itemKey:'cmod_offense_fire'}}};assert(calc(t).max>base);
 const high=[make(6,500,4,['Flamethrower'],'Keen Eye'),make(1,1,1,['Tackle'],'Keen Eye')];high[1].heldItem='focus_sash';assert.equal(calc(high).minHpAfter,1);assert(!calc(high).possibleKo);assert.equal(high[1].heldItem,'focus_sash');
});
test('multi-hit and variable power ranges come from native hit and special-case resolvers',()=>{
 const t=pair('Bullet Seed','Keen Eye',286),r=calc(t);assert.deepEqual(r.hits,[2,5]);assert(r.max>r.min);t[0].passiveAbility='Skill Link';const linked=calc(t);assert.deepEqual(linked.hits,[5,5]);
 const wave=calc(pair('Psywave','Keen Eye',65));assert.equal(wave.min,50);assert.equal(wave.max,149);
 const magnitude=calc(pair('Magnitude'));assert(magnitude.max>magnitude.min);
});
test('two-turn moves simulate their release, False Swipe leaves one HP and fixed damage is exact',()=>{
 assert(calc(pair('Fly')).max>0);const t=[make(6,500,4,['False Swipe'],'Keen Eye'),make(1,1,1,['Tackle'],'Keen Eye')];assert.equal(calc(t).minHpAfter,1);assert(!calc(t).possibleKo);
 const fixed=calc(pair('Dragon Rage'));assert.equal(fixed.min,40);assert.equal(fixed.max,40);
});
test('Forecast and Weather Ball transform on simulation copies only',()=>{
 const t=[make(351,100,4,['Weather Ball'],'Forecast'),make(143,150,4,['Tackle'],'Keen Eye')],snapshot=JSON.stringify(t),plain=calc(t).max;assert(calc(t,{weather:'rain'}).max>plain*2);assert.equal(JSON.stringify(t),snapshot);
});
test('ownership, species selection and learned move validation prevent spoofed stats or attacks',()=>{
 const t=pair();assert.throws(()=>calculate(t,{attacker:t[0].uuid,defender:'another-account',move:0}),/deux Pokémon/);assert.throws(()=>calculate(t,{attacker:t[0].uuid,defender:t[0].uuid,move:0}),/différents/);assert.throws(()=>calculate(t,{attacker:t[0].uuid,defender:t[1].uuid,move:3}),/capacité/);
 const plain=calc(t).max;assert.equal(calc(t,{attackerBoosts:{specialAttack:999},attackerHp:999999}).max,plain);
});

test('future moves use the actual delayed resolver and unpredictable move calls are explicit',()=>{
 const t=pair('Future Sight'),saved=JSON.stringify(t),r=calc(t);assert(r.max>0);assert(r.notes.some(n=>n.includes('deux tours')));assert.equal(JSON.stringify(t),saved);const dark=pair('Future Sight');dark[1]=make(197,150,4,['Tackle'],'Keen Eye');assert.equal(calc(dark).max,0);assert.throws(()=>calc(pair('Metronome')),/appelle une autre attaque/);
});
