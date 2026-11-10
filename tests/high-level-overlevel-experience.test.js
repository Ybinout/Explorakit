const test=require('node:test'),assert=require('node:assert/strict');
const progression=require('../server/game/models/progression'),balance=require('../data/game/experience_balance.json');
const {calculateBattleExperience:xp,overlevelExperienceFactor:factor,reduceActiveOverlevelExperience:active}=progression;
const factory=require('../server/game/drift/pokemonFactory'),{AdventureExperience}=require('../server/game/battle/adventureExperience');
const io={to:()=>({emit(){}})};
function oldFactor(enemy,level){return Math.max(.1,1/(1+(Math.max(0,level-enemy-Math.max(5,Math.ceil(enemy*.1)))/10)**2));}
test('through level150 every progressive penalty, active penalty and base award is unchanged',()=>{
 for(let level=1;level<=150;level++)for(const enemy of [1,5,20,40,75,100,145,150,200,300,1000]){
  assert.equal(factor(enemy,level),oldFactor(enemy,level));
  assert.equal(active(1000,{level:enemy},{level}),level-enemy>=5?700:1000);
  const scaling=Math.max(.25,Math.min(1.5,(enemy/level)**1.25));
  assert.equal(xp({level:enemy,k:1},1,{level}),Math.max(1,Math.round((12+.9*enemy**2)*scaling*oldFactor(enemy,level))));
 }
});
test('strict level150/151 threshold halves only lost XP: progressive floor55%, active penalty15%',()=>{
 assert.deepEqual(balance.highLevelOverlevelPenalty,{aboveLevel:150,severity:.5});
 assert.equal(factor(40,150),.1);assert.equal(factor(40,151),.55);assert.equal(active(1000,{level:40},{level:150}),700);assert.equal(active(1000,{level:40},{level:151}),850);
 for(const level of [151,180,200,250,500,1000])for(const enemy of [1,40,100,145,150,180,200,250,500,1000]){
  assert.equal(factor(enemy,level),1-(1-oldFactor(enemy,level))*.5);
  assert.equal(active(1000,{level:enemy},{level}),level-enemy>=5?850:1000);
  assert(factor(enemy,level)>=.55&&factor(enemy,level)<=1);
 }
 assert.equal(active(0,{level:1},{level:200}),0);assert.equal(active(1,{level:1},{level:200}),1);assert.equal(active(1000,{}, {level:200}),1000);
});
test('same-level or harder opponents keep exactly the same XP, including four-level active grace',()=>{
 for(const level of [151,200,300,1000])for(const enemy of [level-4,level,level+25]){
  assert.equal(factor(enemy,level),1);assert.equal(active(1000,{level:enemy},{level}),1000);
  assert.equal(xp({level:enemy,k:4},2,{level}),Math.round((12+.9*enemy**2)*1.3*2*Math.max(.25,Math.min(1.5,(enemy/level)**1.25))));
 }
});
test('within each threshold band weaker opponents still award less; base level ratio remains in effect',()=>{
 for(const level of [150,151,200,300,1000]){let before=0;for(let enemy=1;enemy<=level+10;enemy++){const gain=active(xp({level:enemy,k:1},1,{level}),{level:enemy},{level});assert(gain>=before,`${level}/${enemy}`);before=gain;}}
});
for(const [map,rate]of [['jungle1',.425],['DC2_24',.425],['jungle9',.85],['DC2_04',.85]])for(const captured of [false,true])test(`${map} ${captured?'capture':'KO'}: actual shares use each recipient, never penalize reserves as active, and pay once`,()=>{
 const team=[200,140,180].map((level,i)=>factory.create([9,143,94][i],level,true));team[0].heldItem='exp_share';const foe=factory.create(19,150,true),tracker=new AdventureExperience({expShare:'equipped'}),owner={id:'test',equipe:{pokemons:team}};tracker.enter(team[0],foe);
 const before=team.map(p=>p.experience),expected=team.map((p,i)=>{const base=Math.max(1,Math.floor(xp(foe,progression.BATTLE_EXPERIENCE_MULTIPLIERS.wild*rate,p)*(i?.4:1)));return i?base:active(base,foe,p);});if(!captured)foe.currentHp=0;
 tracker.reward(owner,foe,progression.BATTLE_EXPERIENCE_MULTIPLIERS.wild*rate,io,{captured});assert.deepEqual(team.map((p,i)=>p.experience-before[i]),expected);assert.deepEqual(tracker.reward(owner,foe,1,io,{captured}),[]);
});
test('award uses level before levelling: reaching151 does not retroactively soften the just-earned reward',()=>{
 const p=factory.create(9,150,true);p.experience=p.getNextLevelExpForLevel(151)-1;const tracker=new AdventureExperience(),owner={id:'test',equipe:{pokemons:[p]}};
 for(const multiplier of [.7,.85]){const foe=factory.create(19,145,true);tracker.enter(p,foe);const expected=Math.floor(xp(foe,1,p)*multiplier),before=p.experience;foe.currentHp=0;tracker.reward(owner,foe,1,io);assert.equal(p.experience-before,expected);assert(p.level>150);}
});
test('Dark zone rates, fixed raid XP, Tour cap and growth thresholds remain unchanged',()=>{
 const d=require('../server/game/world/darkEncounters');assert.equal(d.experienceMultiplier({},'jungle1'),.425);assert.equal(d.experienceMultiplier({},'DC2_44'),.425);
 const r=require('../server/game/raids/experience');for(const level of [100,300,1000])assert.equal(r.amount({level}),level*500);
 assert.equal(require('../server/game/superTournament/experience').MAX_LEVEL,130);assert.equal(progression.getTotalExperienceForLevel(200),199**3);
});
