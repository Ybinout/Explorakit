const test=require('node:test'),assert=require('node:assert/strict');
const {captureProgress,captureAssessment}=require('../server/game/battle/captureProgression');
const {calculateCaptureChance:chance}=require('../server/game/battle/wildBattle');
const keys=require('../data/game/progression.json').badges.map(b=>b.key);
const badges=n=>keys.slice(0,n).map(key=>({key,earned:true}));
test('capture tiers count distinct known earned badges only, including existing saves, with a monotone six-arena curve',()=>{
 assert.equal(keys.length,6);assert.equal(captureProgress(badges(6)).nextComfortableLevel,null);
 assert.equal(captureProgress([{key:'forest_badge',earned:true},{key:'crystal_badge',earned:true}]).badgeCount,0);
 for(const [n,level]of [22,35,40,45,50,60,100].entries())assert.equal(captureProgress(badges(n)).comfortableLevel,level);
 assert.deepEqual(captureProgress([{key:keys[0],earned:true},{key:keys[0],earned:true},{key:keys[1],earned:false},{key:keys[2],earned:'true'},{key:'forged_badge',earned:true}]),{badgeCount:1,comfortableLevel:35,nextComfortableLevel:40});
});
test('captures at and below the badge tier preserve all previous probabilities; no effect without Adventure context',()=>{
 for(let n=0;n<6;n++){const progress=captureProgress(badges(n));for(const level of [1,progress.comfortableLevel])for(const ball of [1.15,1.5,2]){
  const p={level},w={level,maxHp:100,currentHp:10};assert.equal(chance(p,w,ball,progress),chance(p,w,ball));
 }}assert.equal(captureAssessment(null,100),null);
});
test('going beyond the tier progressively reduces chances below the former five-percent floor; every valid level remains possible',()=>{
 const progress=captureProgress(),p={level:100};let old=1;
 for(let level=23;level<=100;level++){
  const value=chance(p,{level,maxHp:100,currentHp:1},2,progress);assert(value>0&&value<old);old=value;
 }const w={level:60,maxHp:100,currentHp:1};assert(chance(p,w,2,progress)<.001);assert(chance(p,w,2,progress)>0);
 assert.equal(captureAssessment(progress,32).multiplier,Math.pow(.8,10));
});
test('each badge eases high-level capture, while a level-100 fighter, best Ball or one HP cannot bypass the penalty',()=>{
 const p={level:100},w={level:80,maxHp:100,currentHp:1};let previous=0;
 for(let n=0;n<=6;n++){const value=chance(p,w,2,captureProgress(badges(n)));assert(value>previous);previous=value;}
 assert.equal(previous,.95);assert(chance(p,w,2,captureProgress())<.001);
});
test('weakening the opponent and choosing a better Ball still help within the same badge penalty, without mutating combatants',()=>{
 const p={level:5},w={level:50,maxHp:100,currentHp:100},before=JSON.stringify([p,w]),progress=captureProgress();
 assert(chance(p,{...w,currentHp:5},1.15,progress)>chance(p,w,1.15,progress));
 assert(chance(p,w,2,progress)>chance(p,w,1.5,progress));assert(chance(p,w,1.5,progress)>chance(p,w,1.15,progress));
 assert.equal(JSON.stringify([p,w]),before);
});
