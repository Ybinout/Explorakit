const test=require('node:test'),assert=require('node:assert/strict');
test('all canonical move types and gesture families have distinct, bounded sound plans',async()=>{
 const {moveSoundPlan}=await import('../vue-explorakit/src/services/moveSounds.js');
 const types=['Normal','Fighting','Fire','Water','Electric','Grass','Ice','Flying','Poison','Ground','Rock','Bug','Psychic','Ghost','Dark','Dragon','Steel','Fairy'];
 const signatures=new Set();
 for(const moveType of types){const plan=moveSoundPlan({moveName:'Shadow Ball',moveType,damageClass:'special'});signatures.add(JSON.stringify(plan));assert(plan.length>0&&plan.length<=8);for(const v of plan){assert(v.frequency>0&&v.endFrequency>0);assert(v.duration>0&&v.duration+v.delay<.8);assert(v.volume>0&&v.volume<=.4);}}
 assert.equal(signatures.size,18);
 const families=['Crunch','Slash','Mach Punch','Tackle','Ice Beam','Shadow Ball','Giga Drain','Earthquake','Purify','Growl'];
 assert.equal(new Set(families.map(moveName=>JSON.stringify(moveSoundPlan({moveName,moveType:'Normal'})))).size,families.length);
});
test('impacts require connected damage; charge turns, misses, protection and immunities never sound like a hit',async()=>{
 const {moveSoundPlan}=await import('../vue-explorakit/src/services/moveSounds.js');
 const base={moveName:'Solar Beam',moveType:'Grass',damageClass:'special',result:{success:true,damage:30,hits:1}};
 assert(moveSoundPlan(base,'impact').length>0);assert.deepEqual(moveSoundPlan({...base,phase:'prepare'},'impact'),[]);
 for(const result of[{success:false,damage:30},{missed:true,damage:30},{blocked:true,damage:30},{immune:true,damage:30},{effectiveness:0,damage:30},{success:true,damage:0}])assert.deepEqual(moveSoundPlan({...base,result},'impact'),[]);
 assert.notDeepEqual(moveSoundPlan(base),moveSoundPlan({...base,phase:'prepare'}));
 const multi=moveSoundPlan({...base,result:{damage:30,hits:3}},'impact');assert.equal(multi.length,moveSoundPlan(base,'impact').length*3);assert(multi.some(v=>v.delay>=.15));assert(moveSoundPlan({...base,result:{damage:30,hits:100}},'impact').length<=12);
});
test('fast attacks bound active Web Audio voices and disconnect every source when stopped',async()=>{
 const {BattleAudio}=await import('../vue-explorakit/src/services/battleAudio.js');let disconnected=0;
 const param=()=>({value:0,setValueAtTime(){},exponentialRampToValueAtTime(){}}),node=()=>({connect(){},disconnect(){disconnected++;},gain:param(),frequency:param(),Q:param()});
 const context={state:'running',currentTime:0,sampleRate:100,destination:{},createGain:node,createOscillator:()=>({...node(),start(){},stop(){}}),createBufferSource:()=>({...node(),start(){},stop(){}}),createBiquadFilter:node,createBuffer:()=>({getChannelData:()=>new Float32Array(100)}),close:async()=>{}};
 const audio=new BattleAudio(()=>context);audio.setVolume(1);await audio.unlock();
 for(let i=0;i<100;i++){audio.move({moveName:'Thunderbolt',moveType:'Electric',damageClass:'special'});audio.impact({moveName:'Thunderbolt',result:{damage:30,hits:5}});assert(audio.voices.size<=48);}
 audio.stop();assert.equal(audio.voices.size,0);assert(disconnected>500);audio.dispose();
});
