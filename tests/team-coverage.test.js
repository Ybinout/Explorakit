const test=require('node:test'),assert=require('node:assert/strict'),coverage=require('../shared/typeCoverage');
const {make}=require('../scripts/calibrateCorruptionRaids'),engine=require('../server/game/battle/battleEngine');
const lookup=p=>p.abilities.map(name=>{const m=engine.getMoveByName(name);return{name,type:m.type,power:m.power,damageClass:m.combat.damage_class,fixedDamage:['Dragon Rage','Sonic Boom','Seismic Toss','Night Shade'].includes(name)};});
test('coverage follows battle forms, Multitype plates and Judgment without mutating Pokémon',()=>{
 const p=make(493,100,4,['Judgment'],'Multitype');p.heldItem='splash_plate';const saved=JSON.stringify(p);assert.deepEqual(coverage.types(p),['Water']);assert.equal(coverage.defense(p,'Electric'),2);assert.equal(coverage.analyze([p],lookup).offense.find(r=>r.type==='Fire').best,2);assert.equal(JSON.stringify(p),saved);
 const c=make(351,100,4,['Weather Ball'],'Forecast');c.__battle={formTypes:['Water']};assert.equal(coverage.defense(c,'Electric'),2);
});
test('all eighteen types use the canonical chart and four actually learned moves only',()=>{
 const p=make(6,80,4,['Flamethrower','Roost'],'Blaze'),r=coverage.analyze([p],lookup);assert.equal(r.offense.length,18);assert.equal(r.defense.length,18);assert.equal(r.offense.find(r=>r.type==='Grass').count,1);assert.equal(r.offense.find(r=>r.type==='Water').count,0);assert.equal(r.defense.find(r=>r.type==='Rock').multipliers[0],4);assert.equal(r.defense.find(r=>r.type==='Ground').multipliers[0],0);
});
test('Levitate, absorptions, Wonder Guard and permanent defensive abilities are reflected',()=>{
 const p=make(94,80,4,['Shadow Ball'],'Levitate');assert.equal(coverage.defense(p,'Ground'),0);p.passiveAbility='Thick Fat';assert.equal(coverage.defense(p,'Fire'),.5);p.passiveAbility='Wonder Guard';assert.equal(coverage.defense(p,'Water'),0);p.passiveAbility='Volt Absorb';assert.equal(coverage.defense(p,'Electric'),0);
});
test('corrupted type replacement changes defensive coverage immediately',()=>{
 const p=make(6,80,4,['Flamethrower'],'Blaze');p.corruption={permanent:true,modules:{type:{types:['Water','Ground']}}};assert.equal(coverage.defense(p,'Electric'),0);assert.equal(coverage.defense(p,'Grass'),4);
});
test('special move type interactions and fixed damage do not create imaginary super-effective answers',()=>{
 const p=make(6,80,4,['Freeze-Dry','Flying Press'],'Keen Eye');assert.equal(coverage.analyze([p],lookup).offense.find(r=>r.type==='Water').best,2);p.abilities=['Dragon Rage'];assert.equal(coverage.analyze([p],lookup).offense.find(r=>r.type==='Dragon').best,1);
});
test('score is reproducible, penalizes shared holes, and reacts to composition and move changes',()=>{
 const repeated=Array.from({length:6},()=>make(6,80,4,['Flamethrower'],'Blaze')),mixed=[make(6,80,4,['Flamethrower','Air Slash'],'Blaze'),make(9,80,4,['Surf','Ice Beam'],'Torrent'),make(3,80,4,['Energy Ball','Sludge Bomb'],'Overgrow'),make(135,80,4,['Thunderbolt','Shadow Ball'],'Volt Absorb'),make(445,80,4,['Earthquake','Dragon Claw'],'Rough Skin'),make(448,80,4,['Aura Sphere','Flash Cannon'],'Inner Focus')];assert(coverage.analyze(mixed,lookup).score>coverage.analyze(repeated,lookup).score);assert.deepEqual(coverage.analyze(mixed,lookup),coverage.analyze(mixed,lookup));assert.equal(coverage.analyze([],lookup).score,0);
});
