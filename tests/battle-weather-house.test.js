const test=require('node:test'),assert=require('node:assert/strict');
test('all House modes and trainer themes use Gwenn while adventure, Tower and Draft keep their mappings',async()=>{
 const {battleMusicTrack}=await import('../vue-explorakit/src/services/battleMusic.js');
 for(const kind of ['trainer','arena','gwenn','lucie','hoze','raph','ana','wanda','7p','pvp']){
  assert.equal(battleMusicTrack(kind,'ville5_maison1'),'gwenn');
  assert.equal(battleMusicTrack(kind,'route1','whitepeak-club'),'gwenn');
 }
 assert.equal(battleMusicTrack('arena','ville1_arene'),'mounir');assert.equal(battleMusicTrack('lucie','super_tournament_duel'),'lucie');assert.equal(battleMusicTrack('trainer','route2_maison'),'lucie');assert.equal(battleMusicTrack('wild','route1'),'wild');
});
test('House training presentation is competitive without reclassifying adventure trainers or the Tower',async()=>{
 const {competitiveBattlePresentation:competitive}=await import('../vue-explorakit/src/services/battleContext.js');
 for(const kind of ['trainer','pvp',null])assert(competitive(kind,'ville5_maison1'));
 assert(competitive('trainer','route1','whitepeak-club'));assert(competitive('pvp','draft_house'));
 for(const map of ['route1','ville1_arene','super_tournament_duel','professor_lab'])assert(!competitive('trainer',map));
});
test('weather onset and updates allocate no audio graph; only damaging sand/hail hits remain audible and bounded',async()=>{
 const {BattleAudio}=await import('../vue-explorakit/src/services/battleAudio.js'),{combatCuePlan}=await import('../vue-explorakit/src/services/moveSounds.js');
 const audio=new BattleAudio(()=>{throw Error('No context should be allocated by silent weather');});audio.volume=.5;
 for(const weather of ['rain','sandstorm','hail','snow','sun']){audio.cue({kind:'weather',weather});assert.deepEqual(combatCuePlan({kind:'weather',weather}),[]);}
 assert.equal(audio.context,null);assert.equal(audio.weatherAudio,undefined);assert.equal(audio.voices.size,0);
 const plans=[];audio.playPlan=(plan,gain)=>plans.push({plan,gain});
 for(const weather of ['rain','snow','sun',null])assert.deepEqual(combatCuePlan({kind:'weather-damage',weather}),[]);
 for(const weather of ['sandstorm','hail']){
  audio.impact({weather,damage:0});audio.impact({weather,damage:-1});assert.equal(plans.length,0);
  audio.impact({weather,damage:6,maxHp:100});const p=plans.pop();assert(p.plan.length>=2&&p.gain>=2);assert(p.plan.every(v=>v.duration+v.delay<.5));
 }
 audio.stop();audio.dispose();assert.equal(audio.voices.size,0);
});
