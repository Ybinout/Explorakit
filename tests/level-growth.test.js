const test=require('node:test'),assert=require('node:assert/strict');
const factory=require('../server/game/drift/pokemonFactory');
const {growthSnapshot,levelGrowth}=require('../server/game/models/levelGrowth');
const {createBattleSummaryTracker}=require('../server/game/battle/battleOutcome');
const {rewardTraining}=require('../server/game/models/training');
const codec=require('../server/game/drift/checkpointCodec');
function gainTo(p,level){p.gainExperience(p.getNextLevelExpForLevel(level)-p.experience);}
test('level growth: exact permanent stats, six fields, no damage or combat-stage contamination',()=>{
 const p=factory.create(7,10,true),before=growthSnapshot(p);p.currentHp=1;p.currentAttack*=6;p.currentSpeed/=4;gainTo(p,11);
 const growth=levelGrowth(p,before);assert.deepEqual([growth.previousLevel,growth.level],[10,11]);assert.equal(Object.keys(growth.stats).length,6);
 for(const [key,field]of Object.entries({hp:'maxHp',attack:'attack',defense:'defense',specialAttack:'specialAttack',specialDefense:'specialDefense',speed:'speed'})){assert.equal(growth.stats[key].after,p[field]);assert.equal(growth.stats[key].gain,p[field]-before.stats[key]);}
 assert(growth.stats.hp.after>p.currentHp);assert(growth.stats.attack.after<p.currentAttack);assert.equal(levelGrowth(p,growthSnapshot(p)),null);
 const saved=JSON.stringify(growth);gainTo(p,12);assert.equal(JSON.stringify(growth),saved,'payload is immutable from later changes');
});
test('multi-level evolution is grouped and identified; zero/decreasing stats are not misreported',()=>{
 const p=factory.create(11,9,true),before=growthSnapshot(p);gainTo(p,12);const growth=levelGrowth(p,before);assert(growth.evolved);assert.equal(growth.previousLevel,9);assert.equal(growth.level,12);assert.equal(growth.pokemonId,12);const late=factory.create(11,99,true),old=growthSnapshot(late);gainTo(late,100);assert(levelGrowth(late,old).stats.defense.gain<0,'Late Metapod evolution can reduce permanent defense');
});
test('battle summary includes levelled reserves and lost companions, aggregates multiple rewards and survives checkpoint',()=>{
 for(const mode of ['adventure','drift']){const p=factory.create(7,10,true),reserve=factory.create(4,10,true),same=factory.create(1,10,true),tracker=createBattleSummaryTracker([p,reserve,same],mode);gainTo(p,11);gainTo(p,12);gainTo(reserve,11);same.gainExperience(1);
 const restored=codec.decode(codec.encode(tracker)),summary=restored.snapshot([reserve,same]);assert.equal(summary.experience.length,3);assert.equal(summary.experience[0].levelGrowth.previousLevel,10);assert.equal(summary.experience[0].levelGrowth.level,12);assert.equal(summary.experience[1].levelGrowth.level,11);assert.equal(summary.experience[2].levelGrowth,null);}
});
test('actual XP notification includes same six permanent stat gains without altering XP reward',()=>{
 const p=factory.create(7,10,true),events=[],xp=p.getNextLevelExpForLevel(11)-p.experience;
 rewardTraining(p,factory.create(19,10,true),xp,{to:()=>({emit:(event,data)=>events.push({event,data})})},'player');
 assert.equal(events[0].event,'battleExperience');assert.equal(events[0].data.xpGained,xp);assert.equal(events[0].data.levelGrowth.level,11);assert.equal(events[0].data.levelGrowth.stats.hp.after,p.maxHp);
});
